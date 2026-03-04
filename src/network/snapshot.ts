/**
 * State Snapshot & Rollback for Repairs
 *
 * Before any repair action, capture the current state of:
 * - Running processes
 * - Key configuration files
 * - Service states
 *
 * If repair makes things worse, rollback to pre-repair state.
 *
 * Safety principle: Never leave a system worse than we found it.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import pathMod from "node:path";
import { getHomeDir } from "../utils/fs.js";
import type { InstanceConnection } from "./repair.js";

// =============================================================================
// Types
// =============================================================================

export interface StateSnapshot {
  /** Unique snapshot ID */
  id: string;

  /** When snapshot was taken */
  timestamp: Date;

  /** Instance this snapshot is for */
  instanceId: string;

  /** What repair action this snapshot is for */
  repairAction: string;

  /** Running processes at snapshot time */
  processes: ProcessSnapshot[];

  /** Configuration files backed up */
  configFiles: ConfigFileBackup[];

  /** Service states at snapshot time */
  services: ServiceSnapshot[];

  /** System info at snapshot time */
  system: SystemSnapshot;
}

export interface ProcessSnapshot {
  name: string;
  pid: number;
  command: string;
  running: boolean;
}

export interface ConfigFileBackup {
  path: string;
  content: string;
  permissions: string;
}

export interface ServiceSnapshot {
  name: string;
  running: boolean;
  pid?: number;
  uptime?: number;
}

export interface SystemSnapshot {
  uptime: number;
  loadAverage: number[];
  memoryUsed: number;
  memoryTotal: number;
}

export interface SnapshotConfig {
  /** Files to always backup before repairs */
  configPaths: string[];

  /** Processes to track */
  trackedProcesses: string[];

  /** Optional path for persisting snapshots to disk */
  persistPath?: string;

  /** Logger */
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface RollbackResult {
  success: boolean;
  restored: {
    processes: string[];
    configs: string[];
  };
  failed: {
    processes: string[];
    configs: string[];
  };
  errors: string[];
}

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_SNAPSHOT_CONFIG: Omit<SnapshotConfig, "logger"> = {
  configPaths: [
    "~/.openclaw/config.json",
    "~/.openclaw/channels.json",
    "~/.openclaw/cron.json",
    "/tmp/openclaw-gateway.log",
    "/tmp/qmd.log",
  ],
  trackedProcesses: [
    "openclaw",
    "qmd",
    "caffeinate",
  ],
};

// =============================================================================
// Snapshot Manager
// =============================================================================

export class SnapshotManager {
  private config: SnapshotConfig;
  private snapshots: Map<string, StateSnapshot> = new Map();
  private persistPath: string;

  constructor(config: Partial<SnapshotConfig> & { logger: SnapshotConfig["logger"] }) {
    this.config = {
      ...DEFAULT_SNAPSHOT_CONFIG,
      ...config,
    };
    this.persistPath = config.persistPath ||
      pathMod.join(getHomeDir(), ".openclaw", "bernard", ".25o1-snapshots.json");
    this.loadFromDisk();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /**
   * Load snapshots from disk. Restores pre-repair snapshots after a restart
   * so rollback remains possible.
   */
  private loadFromDisk(): void {
    try {
      const raw = fs.readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, StateSnapshot>;
      for (const [id, snapshot] of Object.entries(data)) {
        // Restore Date objects from JSON serialization
        snapshot.timestamp = new Date(snapshot.timestamp);
        this.snapshots.set(id, snapshot);
      }
      if (this.snapshots.size > 0) {
        this.config.logger.info(`Restored ${this.snapshots.size} snapshots from disk`);
      }
    } catch {
      // File doesn't exist or is corrupt — start fresh
    }
  }

  /**
   * Persist snapshots to disk. Called after any mutation.
   */
  private saveToDisk(): void {
    try {
      const data: Record<string, StateSnapshot> = {};
      for (const [id, snapshot] of this.snapshots) {
        data[id] = snapshot;
      }
      fs.mkdirSync(pathMod.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.config.logger.warn(`Failed to persist snapshots: ${err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot Creation
  // ---------------------------------------------------------------------------

  /**
   * Create a state snapshot before repair.
   */
  async createSnapshot(
    connection: InstanceConnection,
    repairAction: string,
    executeSSH: (connection: InstanceConnection, commands: string[]) => Promise<string>
  ): Promise<StateSnapshot> {
    const id = `snapshot-${connection.instanceId}-${Date.now()}`;

    this.config.logger.info(`Creating snapshot ${id} for ${repairAction}`);

    // Capture processes
    const processes = await this.captureProcesses(connection, executeSSH);

    // Backup config files
    const configFiles = await this.backupConfigs(connection, executeSSH);

    // Capture service states
    const services = await this.captureServices(connection, executeSSH);

    // Capture system state
    const system = await this.captureSystem(connection, executeSSH);

    const snapshot: StateSnapshot = {
      id,
      timestamp: new Date(),
      instanceId: connection.instanceId,
      repairAction,
      processes,
      configFiles,
      services,
      system,
    };

    this.snapshots.set(id, snapshot);
    this.saveToDisk();
    this.config.logger.info(`Snapshot ${id} created: ${processes.length} processes, ${configFiles.length} configs`);

    return snapshot;
  }

  private async captureProcesses(
    connection: InstanceConnection,
    executeSSH: (connection: InstanceConnection, commands: string[]) => Promise<string>
  ): Promise<ProcessSnapshot[]> {
    const processes: ProcessSnapshot[] = [];

    for (const name of this.config.trackedProcesses) {
      try {
        const output = await executeSSH(connection, [
          `pgrep -a '${name}' 2>/dev/null || echo 'NOT_RUNNING'`,
        ]);

        if (output.includes("NOT_RUNNING")) {
          processes.push({
            name,
            pid: 0,
            command: "",
            running: false,
          });
        } else {
          // Parse pgrep output: "PID command args"
          const lines = output.trim().split("\n");
          for (const line of lines) {
            const [pidStr, ...cmdParts] = line.split(" ");
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid)) {
              processes.push({
                name,
                pid,
                command: cmdParts.join(" "),
                running: true,
              });
            }
          }
        }
      } catch {
        processes.push({
          name,
          pid: 0,
          command: "",
          running: false,
        });
      }
    }

    return processes;
  }

  private async backupConfigs(
    connection: InstanceConnection,
    executeSSH: (connection: InstanceConnection, commands: string[]) => Promise<string>
  ): Promise<ConfigFileBackup[]> {
    const backups: ConfigFileBackup[] = [];

    for (const path of this.config.configPaths) {
      try {
        // Read file content and permissions
        const content = await executeSSH(connection, [
          `cat '${path}' 2>/dev/null || echo '__FILE_NOT_FOUND__'`,
        ]);

        if (content.includes("__FILE_NOT_FOUND__")) {
          continue;
        }

        const permissions = await executeSSH(connection, [
          `stat -f '%Lp' '${path}' 2>/dev/null || stat -c '%a' '${path}' 2>/dev/null || echo '644'`,
        ]);

        backups.push({
          path,
          content: content.trim(),
          permissions: permissions.trim(),
        });
      } catch {
        // Skip files we can't read
      }
    }

    return backups;
  }

  private async captureServices(
    connection: InstanceConnection,
    executeSSH: (connection: InstanceConnection, commands: string[]) => Promise<string>
  ): Promise<ServiceSnapshot[]> {
    const services: ServiceSnapshot[] = [];

    // Check OpenClaw gateway
    try {
      const output = await executeSSH(connection, [
        `pgrep -f 'openclaw gateway' 2>/dev/null || echo ''`,
      ]);
      const pid = parseInt(output.trim(), 10);
      services.push({
        name: "gateway",
        running: !isNaN(pid) && pid > 0,
        pid: isNaN(pid) ? undefined : pid,
      });
    } catch {
      services.push({ name: "gateway", running: false });
    }

    // Check QMD
    try {
      const output = await executeSSH(connection, [
        `pgrep -f 'qmd' 2>/dev/null || echo ''`,
      ]);
      const pid = parseInt(output.trim(), 10);
      services.push({
        name: "qmd",
        running: !isNaN(pid) && pid > 0,
        pid: isNaN(pid) ? undefined : pid,
      });
    } catch {
      services.push({ name: "qmd", running: false });
    }

    // Check caffeinate (sleep prevention)
    try {
      const output = await executeSSH(connection, [
        `pgrep caffeinate 2>/dev/null || echo ''`,
      ]);
      const pid = parseInt(output.trim(), 10);
      services.push({
        name: "caffeinate",
        running: !isNaN(pid) && pid > 0,
        pid: isNaN(pid) ? undefined : pid,
      });
    } catch {
      services.push({ name: "caffeinate", running: false });
    }

    return services;
  }

  private async captureSystem(
    connection: InstanceConnection,
    executeSSH: (connection: InstanceConnection, commands: string[]) => Promise<string>
  ): Promise<SystemSnapshot> {
    try {
      // Get uptime in seconds
      const uptimeOutput = await executeSSH(connection, [
        `sysctl -n kern.boottime 2>/dev/null | awk '{print $4}' | tr -d ',' || uptime -s 2>/dev/null || echo '0'`,
      ]);

      // Get load average
      const loadOutput = await executeSSH(connection, [
        `sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg 2>/dev/null || echo '0 0 0'`,
      ]);

      // Get memory
      const memOutput = await executeSSH(connection, [
        `vm_stat 2>/dev/null | head -5 || free -b 2>/dev/null | head -2 || echo 'mem 0 0'`,
      ]);

      // Parse values (simplified - real implementation would be more robust)
      const bootTime = parseInt(uptimeOutput.trim(), 10);
      const uptime = bootTime > 0 ? Math.floor(Date.now() / 1000) - bootTime : 0;

      const loadParts = loadOutput.replace(/[{}]/g, "").trim().split(/\s+/);
      const loadAverage = loadParts
        .filter((p: string) => !isNaN(parseFloat(p)))
        .slice(0, 3)
        .map((p: string) => parseFloat(p));

      return {
        uptime: Math.max(0, uptime),
        loadAverage: loadAverage.length > 0 ? loadAverage : [0, 0, 0],
        memoryUsed: 0, // Would need more parsing
        memoryTotal: 0,
      };
    } catch {
      return {
        uptime: 0,
        loadAverage: [0, 0, 0],
        memoryUsed: 0,
        memoryTotal: 0,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Health Check (Post-Repair)
  // ---------------------------------------------------------------------------

  /**
   * Check if system is healthier after repair.
   * Returns true if OK to proceed, false if rollback needed.
   */
  async verifyRepairSuccess(
    connection: InstanceConnection,
    snapshot: StateSnapshot,
    executeSSH: (connection: InstanceConnection, commands: string[]) => Promise<string>
  ): Promise<{ healthy: boolean; issues: string[] }> {
    const issues: string[] = [];

    // Check services that were running before are still running
    const currentServices = await this.captureServices(connection, executeSSH);

    for (const originalService of snapshot.services) {
      if (originalService.running) {
        const current = currentServices.find((s) => s.name === originalService.name);
        if (!current?.running) {
          issues.push(`Service ${originalService.name} was running but is now stopped`);
        }
      }
    }

    // Basic connectivity check
    try {
      await executeSSH(connection, ["echo 'health_check_ok'"]);
    } catch {
      issues.push("SSH connection lost after repair");
    }

    // Check critical processes
    for (const process of snapshot.processes) {
      if (process.running && process.name === "openclaw") {
        try {
          const output = await executeSSH(connection, [
            `pgrep -f '${process.command.split(" ")[0]}' 2>/dev/null || echo ''`,
          ]);
          if (!output.trim()) {
            issues.push(`Process ${process.name} (${process.command}) no longer running`);
          }
        } catch {
          issues.push(`Could not verify process ${process.name}`);
        }
      }
    }

    return {
      healthy: issues.length === 0,
      issues,
    };
  }

  // ---------------------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------------------

  /**
   * Rollback to a snapshot state.
   */
  async rollback(
    connection: InstanceConnection,
    snapshotId: string,
    executeSSH: (connection: InstanceConnection, commands: string[]) => Promise<string>
  ): Promise<RollbackResult> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      return {
        success: false,
        restored: { processes: [], configs: [] },
        failed: { processes: [], configs: [] },
        errors: [`Snapshot ${snapshotId} not found`],
      };
    }

    this.config.logger.warn(`Rolling back to snapshot ${snapshotId}`);

    const result: RollbackResult = {
      success: true,
      restored: { processes: [], configs: [] },
      failed: { processes: [], configs: [] },
      errors: [],
    };

    // Restore config files
    for (const config of snapshot.configFiles) {
      try {
        // Write file content back
        // Use base64 to handle special characters
        const base64Content = Buffer.from(config.content).toString("base64");
        await executeSSH(connection, [
          `echo '${base64Content}' | base64 -d > '${config.path}'`,
          `chmod ${config.permissions} '${config.path}'`,
        ]);
        result.restored.configs.push(config.path);
      } catch (err) {
        result.failed.configs.push(config.path);
        result.errors.push(`Failed to restore ${config.path}: ${err}`);
      }
    }

    // Restart processes that were running
    for (const service of snapshot.services) {
      if (service.running) {
        try {
          if (service.name === "gateway") {
            await executeSSH(connection, [
              "pkill -f 'openclaw gateway' 2>/dev/null || true",
              "sleep 1",
              "nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &",
            ]);
            result.restored.processes.push("gateway");
          } else if (service.name === "qmd") {
            await executeSSH(connection, [
              "pkill -f 'qmd' 2>/dev/null || true",
              "sleep 1",
              "nohup qmd serve > /tmp/qmd.log 2>&1 &",
            ]);
            result.restored.processes.push("qmd");
          } else if (service.name === "caffeinate") {
            await executeSSH(connection, [
              "pkill caffeinate 2>/dev/null || true",
              "nohup caffeinate -dims > /dev/null 2>&1 &",
            ]);
            result.restored.processes.push("caffeinate");
          }
        } catch (err) {
          result.failed.processes.push(service.name);
          result.errors.push(`Failed to restore ${service.name}: ${err}`);
        }
      }
    }

    result.success = result.failed.processes.length === 0 && result.failed.configs.length === 0;

    if (result.success) {
      this.config.logger.info(`Rollback to ${snapshotId} completed successfully`);
    } else {
      this.config.logger.error(`Rollback to ${snapshotId} had failures: ${result.errors.join(", ")}`);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Snapshot Management
  // ---------------------------------------------------------------------------

  /**
   * Get a snapshot by ID.
   */
  getSnapshot(snapshotId: string): StateSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * List all snapshots for an instance.
   */
  listSnapshots(instanceId: string): StateSnapshot[] {
    return Array.from(this.snapshots.values()).filter((s) => s.instanceId === instanceId);
  }

  /**
   * Delete a snapshot (after successful repair).
   */
  deleteSnapshot(snapshotId: string): void {
    this.snapshots.delete(snapshotId);
    this.saveToDisk();
  }

  /**
   * Clean up old snapshots (keep last N per instance).
   */
  cleanupSnapshots(instanceId: string, keepCount: number = 5): void {
    const instanceSnapshots = this.listSnapshots(instanceId).sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );

    for (let i = keepCount; i < instanceSnapshots.length; i++) {
      this.snapshots.delete(instanceSnapshots[i].id);
    }
    this.saveToDisk();
  }
}

// =============================================================================
// Singleton
// =============================================================================

let snapshotManagerInstance: SnapshotManager | null = null;

export function getSnapshotManager(
  config?: Partial<SnapshotConfig> & { logger: SnapshotConfig["logger"] }
): SnapshotManager {
  if (!snapshotManagerInstance && config) {
    snapshotManagerInstance = new SnapshotManager(config);
  }

  if (!snapshotManagerInstance) {
    throw new Error("Snapshot manager not initialized");
  }

  return snapshotManagerInstance;
}

export function initSnapshotManager(
  config: Partial<SnapshotConfig> & { logger: SnapshotConfig["logger"] }
): SnapshotManager {
  snapshotManagerInstance = new SnapshotManager(config);
  return snapshotManagerInstance;
}
