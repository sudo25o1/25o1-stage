/**
 * Repair System
 *
 * Bernard's remote repair capabilities for managed instances.
 * Uses SSH to execute repairs on client Mac Minis.
 *
 * Management tiers:
 * - fully_managed: Bernard has full SSH access, auto-repairs
 * - remote_managed: Bernard monitors, user approves repairs
 * - self_managed: User handles maintenance, reports optional
 * 
 * SSH Key Management:
 * - During setup: Bernard generates a keypair per client instance
 * - Key deployment: Part of `25o1:setup --client` adds Bernard's public key
 * - Key storage: Bernard keeps private keys in `~/.openclaw/bernard/keys/`
 * - Rotation: Annual rotation, Bernard initiates, client confirms
 * 
 * Repair Safety:
 * - Snapshot state before any repair action
 * - Verify repair success with health check
 * - Rollback if repair makes things worse
 * 
 * Customer Notification:
 * - Notifications go through the companion, not Bernard directly
 * - "Your companion was briefly offline and is back now"
 * - Customer sees natural conversation, not admin alerts
 */

import { spawn } from "node:child_process";
import { getStateManager } from "../state/store.js";
import type { PersistedIssue, ManagementTier } from "../state/types.js";
import { getSnapshotManager, type SnapshotManager, type StateSnapshot } from "./snapshot.js";
import { getNotificationManager, type NotificationManager } from "./notification.js";

// =============================================================================
// Types
// =============================================================================

export interface RepairConfig {
  /** SSH user for remote connections */
  sshUser: string;

  /** Path to SSH key */
  sshKeyPath: string;

  /** SSH connection timeout (ms) */
  sshTimeout: number;

  /** Logger */
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface RepairAction {
  id: string;
  name: string;
  description: string;
  component: string;
  commands: string[];
  requiresReboot: boolean;
  estimatedDuration: number; // seconds
}

export interface RepairResult {
  success: boolean;
  action: RepairAction;
  startedAt: Date;
  completedAt: Date;
  output: string;
  error?: string;
  /** Snapshot taken before repair (for rollback) */
  snapshotId?: string;
  /** Was rollback attempted? */
  rolledBack?: boolean;
}

export interface RepairPlan {
  instanceId: string;
  issues: PersistedIssue[];
  actions: RepairAction[];
  requiresApproval: boolean;
  estimatedDuration: number;
}

export interface InstanceConnection {
  instanceId: string;
  host: string;
  user: string;
  keyPath: string;
  managementTier: ManagementTier;
}

// =============================================================================
// Default Config
// =============================================================================

export const DEFAULT_REPAIR_CONFIG: Omit<RepairConfig, "logger"> = {
  sshUser: "admin",
  sshKeyPath: "~/.ssh/25o1_network",
  sshTimeout: 30000,
};

// =============================================================================
// Repair Actions
// =============================================================================

const REPAIR_ACTIONS: Record<string, RepairAction> = {
  restart_gateway: {
    id: "restart_gateway",
    name: "Restart Gateway",
    description: "Stop and restart the OpenClaw gateway service",
    component: "gateway",
    commands: [
      "pkill -f 'openclaw gateway' || true",
      "sleep 2",
      "nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &",
      "sleep 3",
      "pgrep -f 'openclaw gateway' && echo 'Gateway started' || echo 'Gateway failed to start'",
    ],
    requiresReboot: false,
    estimatedDuration: 10,
  },

  restart_qmd: {
    id: "restart_qmd",
    name: "Restart QMD",
    description: "Stop and restart the QMD memory service",
    component: "qmd",
    commands: [
      "pkill -f 'qmd' || true",
      "sleep 2",
      "nohup qmd serve > /tmp/qmd.log 2>&1 &",
      "sleep 3",
      "pgrep -f 'qmd' && echo 'QMD started' || echo 'QMD failed to start'",
    ],
    requiresReboot: false,
    estimatedDuration: 10,
  },

  reindex_qmd: {
    id: "reindex_qmd",
    name: "Reindex QMD",
    description: "Rebuild the QMD search index",
    component: "qmd",
    commands: ["qmd reindex --force"],
    requiresReboot: false,
    estimatedDuration: 60,
  },

  restart_channel: {
    id: "restart_channel",
    name: "Restart Channel",
    description: "Restart a specific channel connection",
    component: "channel",
    commands: [
      // This is a template - channel name will be substituted
      "openclaw channels restart ${CHANNEL}",
    ],
    requiresReboot: false,
    estimatedDuration: 15,
  },

  enable_sleep_prevention: {
    id: "enable_sleep_prevention",
    name: "Enable Sleep Prevention",
    description: "Prevent the Mac from sleeping",
    component: "system",
    commands: [
      "pkill caffeinate || true",
      "nohup caffeinate -dims > /dev/null 2>&1 &",
      "pmset -g assertions | grep -q PreventUserIdleSystemSleep && echo 'Sleep prevention active' || echo 'Sleep prevention failed'",
    ],
    requiresReboot: false,
    estimatedDuration: 5,
  },

  clear_disk_space: {
    id: "clear_disk_space",
    name: "Clear Disk Space",
    description: "Remove temporary files and old logs",
    component: "disk",
    commands: [
      "rm -rf /tmp/openclaw-*.log.old 2>/dev/null || true",
      "rm -rf ~/.openclaw/logs/*.log.old 2>/dev/null || true",
      "rm -rf ~/Library/Caches/openclaw/* 2>/dev/null || true",
      "df -h / | tail -1",
    ],
    requiresReboot: false,
    estimatedDuration: 30,
  },

  update_openclaw: {
    id: "update_openclaw",
    name: "Update OpenClaw",
    description: "Update OpenClaw to the latest version",
    component: "dependency",
    commands: [
      "npm install -g openclaw@latest",
      "openclaw --version",
    ],
    requiresReboot: false,
    estimatedDuration: 120,
  },

  full_restart: {
    id: "full_restart",
    name: "Full Service Restart",
    description: "Restart all OpenClaw services",
    component: "system",
    commands: [
      "pkill -f 'openclaw' || true",
      "pkill -f 'qmd' || true",
      "sleep 3",
      "nohup qmd serve > /tmp/qmd.log 2>&1 &",
      "sleep 2",
      "nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &",
      "sleep 5",
      "pgrep -f 'openclaw gateway' && pgrep -f 'qmd' && echo 'All services started' || echo 'Some services failed'",
    ],
    requiresReboot: false,
    estimatedDuration: 30,
  },
};

// =============================================================================
// Repair System
// =============================================================================

export class RepairSystem {
  private config: RepairConfig;
  private connections: Map<string, InstanceConnection> = new Map();
  private snapshotManager: SnapshotManager | null = null;
  private notificationManager: NotificationManager | null = null;

  constructor(config: Partial<RepairConfig> & { logger: RepairConfig["logger"] }) {
    this.config = {
      ...DEFAULT_REPAIR_CONFIG,
      ...config,
    };

    // Try to get managers if they're initialized
    try {
      this.snapshotManager = getSnapshotManager();
    } catch {
      // Snapshot manager not initialized, will work without it
    }

    try {
      this.notificationManager = getNotificationManager();
    } catch {
      // Notification manager not initialized, will work without it
    }
  }

  /**
   * Set snapshot manager (for testing or late initialization).
   */
  setSnapshotManager(manager: SnapshotManager): void {
    this.snapshotManager = manager;
  }

  /**
   * Set notification manager (for testing or late initialization).
   */
  setNotificationManager(manager: NotificationManager): void {
    this.notificationManager = manager;
  }

  // ---------------------------------------------------------------------------
  // Connection Management
  // ---------------------------------------------------------------------------

  registerInstance(connection: InstanceConnection): void {
    this.connections.set(connection.instanceId, connection);
    this.config.logger.info(`Registered instance ${connection.instanceId} at ${connection.host}`);
  }

  unregisterInstance(instanceId: string): void {
    this.connections.delete(instanceId);
  }

  getConnection(instanceId: string): InstanceConnection | undefined {
    return this.connections.get(instanceId);
  }

  // ---------------------------------------------------------------------------
  // Repair Planning
  // ---------------------------------------------------------------------------

  async createRepairPlan(instanceId: string, issues: PersistedIssue[]): Promise<RepairPlan> {
    const connection = this.connections.get(instanceId);
    const requiresApproval = !connection || connection.managementTier !== "fully_managed";

    const actions: RepairAction[] = [];

    for (const issue of issues) {
      const action = this.getRepairAction(issue);
      if (action && !actions.some((a) => a.id === action.id)) {
        actions.push(action);
      }
    }

    const estimatedDuration = actions.reduce((sum, a) => sum + a.estimatedDuration, 0);

    return {
      instanceId,
      issues,
      actions,
      requiresApproval,
      estimatedDuration,
    };
  }

  private getRepairAction(issue: PersistedIssue): RepairAction | null {
    if (!issue.canSelfRepair) {
      return null;
    }

    switch (issue.component) {
      case "gateway":
        return REPAIR_ACTIONS.restart_gateway;
      case "qmd":
        if (issue.description.includes("reindex")) {
          return REPAIR_ACTIONS.reindex_qmd;
        }
        return REPAIR_ACTIONS.restart_qmd;
      case "channel":
        return REPAIR_ACTIONS.restart_channel;
      case "system":
        if (issue.description.includes("sleep")) {
          return REPAIR_ACTIONS.enable_sleep_prevention;
        }
        return REPAIR_ACTIONS.full_restart;
      case "disk":
        return REPAIR_ACTIONS.clear_disk_space;
      case "dependency":
        return REPAIR_ACTIONS.update_openclaw;
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Repair Execution
  // ---------------------------------------------------------------------------

  async executeRepair(instanceId: string, action: RepairAction): Promise<RepairResult> {
    const connection = this.connections.get(instanceId);
    if (!connection) {
      return {
        success: false,
        action,
        startedAt: new Date(),
        completedAt: new Date(),
        output: "",
        error: `No connection registered for instance ${instanceId}`,
      };
    }

    if (connection.managementTier === "self_managed") {
      return {
        success: false,
        action,
        startedAt: new Date(),
        completedAt: new Date(),
        output: "",
        error: "Instance is self-managed, cannot execute remote repairs",
      };
    }

    const startedAt = new Date();
    this.config.logger.info(`Executing repair ${action.name} on ${instanceId}`);

    // Create snapshot before repair (if snapshot manager available)
    let snapshot: StateSnapshot | null = null;
    if (this.snapshotManager) {
      try {
        snapshot = await this.snapshotManager.createSnapshot(
          connection,
          action.name,
          (conn, cmds) => this.executeSSH(conn, cmds)
        );
        this.config.logger.info(`Created pre-repair snapshot: ${snapshot.id}`);
      } catch (err) {
        this.config.logger.warn(`Could not create snapshot: ${err}`);
        // Continue without snapshot - repair is still important
      }
    }

    // Notify companion that maintenance is starting
    if (this.notificationManager) {
      this.notificationManager.notifyMaintenanceStarting(instanceId, action.estimatedDuration);
    }

    try {
      const output = await this.executeSSH(connection, action.commands);

      const completedAt = new Date();
      let success = !output.toLowerCase().includes("failed");

      // Verify repair success if we have a snapshot
      if (success && snapshot && this.snapshotManager) {
        const verification = await this.snapshotManager.verifyRepairSuccess(
          connection,
          snapshot,
          (conn, cmds) => this.executeSSH(conn, cmds)
        );

        if (!verification.healthy) {
          this.config.logger.warn(
            `Repair verification failed: ${verification.issues.join(", ")}`
          );
          success = false;

          // Attempt rollback
          const rollbackResult = await this.snapshotManager.rollback(
            connection,
            snapshot.id,
            (conn, cmds) => this.executeSSH(conn, cmds)
          );

          if (rollbackResult.success) {
            this.config.logger.info(`Successfully rolled back to ${snapshot.id}`);
          } else {
            this.config.logger.error(`Rollback failed: ${rollbackResult.errors.join(", ")}`);
          }

          // Notify companion about the issue
          if (this.notificationManager) {
            this.notificationManager.notifyIssueDetected(
              instanceId,
              `Repair attempt for ${action.name} was unsuccessful and reverted`,
              "medium"
            );
          }

          return {
            success: false,
            action,
            startedAt,
            completedAt,
            output,
            error: `Verification failed: ${verification.issues.join(", ")}`,
            snapshotId: snapshot.id,
            rolledBack: rollbackResult.success,
          };
        }

        // Cleanup snapshot on success
        this.snapshotManager.deleteSnapshot(snapshot.id);
      }

      if (success) {
        this.config.logger.info(`Repair ${action.name} completed successfully on ${instanceId}`);

        // Notify companion that maintenance is complete
        if (this.notificationManager) {
          const duration = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);
          this.notificationManager.notifyMaintenanceComplete(instanceId, duration);
        }
      } else {
        this.config.logger.warn(`Repair ${action.name} may have failed on ${instanceId}`);
      }

      return {
        success,
        action,
        startedAt,
        completedAt,
        output,
        snapshotId: snapshot?.id,
      };
    } catch (error) {
      const completedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.config.logger.error(`Repair ${action.name} failed on ${instanceId}: ${errorMessage}`);

      // Attempt rollback on error
      let rolledBack = false;
      if (snapshot && this.snapshotManager) {
        const rollbackResult = await this.snapshotManager.rollback(
          connection,
          snapshot.id,
          (conn, cmds) => this.executeSSH(conn, cmds)
        );
        rolledBack = rollbackResult.success;

        if (rolledBack) {
          this.config.logger.info(`Rolled back after error`);
        }
      }

      // Notify companion about the issue
      if (this.notificationManager) {
        this.notificationManager.notifyIssueDetected(
          instanceId,
          `Repair attempt for ${action.name} encountered an error`,
          "high"
        );
      }

      return {
        success: false,
        action,
        startedAt,
        completedAt,
        output: "",
        error: errorMessage,
        snapshotId: snapshot?.id,
        rolledBack,
      };
    }
  }

  async executePlan(plan: RepairPlan): Promise<RepairResult[]> {
    const results: RepairResult[] = [];

    for (const action of plan.actions) {
      const result = await this.executeRepair(plan.instanceId, action);
      results.push(result);

      // Stop if a repair fails
      if (!result.success) {
        this.config.logger.warn(`Stopping repair plan due to failure: ${result.error}`);
        break;
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // SSH Execution
  // ---------------------------------------------------------------------------

  private async executeSSH(connection: InstanceConnection, commands: string[]): Promise<string> {
    const script = commands.join(" && ");

    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        connection.keyPath,
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "ConnectTimeout=10",
        "-o",
        `ServerAliveInterval=5`,
        `${connection.user}@${connection.host}`,
        script,
      ];

      const ssh = spawn("ssh", args, {
        timeout: this.config.sshTimeout,
      });

      let stdout = "";
      let stderr = "";

      ssh.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      ssh.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ssh.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`SSH command failed with code ${code}: ${stderr || stdout}`));
        }
      });

      ssh.on("error", (err) => {
        reject(err);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------

  async checkConnection(instanceId: string): Promise<boolean> {
    const connection = this.connections.get(instanceId);
    if (!connection) {
      return false;
    }

    try {
      const output = await this.executeSSH(connection, ["echo 'connected'"]);
      return output.includes("connected");
    } catch {
      return false;
    }
  }

  async pingInstance(instanceId: string): Promise<{ reachable: boolean; latency?: number }> {
    const connection = this.connections.get(instanceId);
    if (!connection) {
      return { reachable: false };
    }

    const start = Date.now();
    try {
      await this.executeSSH(connection, ["true"]);
      return {
        reachable: true,
        latency: Date.now() - start,
      };
    } catch {
      return { reachable: false };
    }
  }
}

// =============================================================================
// Public API
// =============================================================================

let repairSystemInstance: RepairSystem | null = null;

/**
 * Get or create the repair system.
 */
export function getRepairSystem(
  config?: Partial<RepairConfig> & { logger: RepairConfig["logger"] }
): RepairSystem {
  if (!repairSystemInstance && config) {
    repairSystemInstance = new RepairSystem(config);
  }

  if (!repairSystemInstance) {
    throw new Error("Repair system not initialized");
  }

  return repairSystemInstance;
}

/**
 * Initialize the repair system.
 */
export function initRepairSystem(
  config: Partial<RepairConfig> & { logger: RepairConfig["logger"] }
): RepairSystem {
  repairSystemInstance = new RepairSystem(config);
  return repairSystemInstance;
}

/**
 * Shutdown the repair system.
 */
export function shutdownRepairSystem(): void {
  repairSystemInstance = null;
}

/**
 * Get available repair actions.
 */
export function getAvailableRepairActions(): RepairAction[] {
  return Object.values(REPAIR_ACTIONS);
}

/**
 * Get a specific repair action by ID.
 */
export function getRepairAction(actionId: string): RepairAction | undefined {
  return REPAIR_ACTIONS[actionId];
}
