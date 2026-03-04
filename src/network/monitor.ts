/**
 * Network Monitor
 *
 * Bernard's active monitoring service that:
 * - Tracks all client instances
 * - Detects when instances go offline
 * - Generates alerts for issues
 * - Triggers repairs when needed
 *
 * This runs as a background service on the primary instance.
 */

import { getStateManager } from "../state/store.js";
import type {
  PersistedHealthReport,
  NetworkAlert,
  InstanceHealth,
  NetworkMonitorState,
  PersistedIssue,
} from "../state/types.js";
import { getRepairSystem, type RepairResult } from "./repair.js";

// =============================================================================
// Types
// =============================================================================

export interface MonitorConfig {
  /** How often to scan for issues (ms) */
  scanIntervalMs: number;

  /** How long before an instance is considered offline (ms) */
  offlineThresholdMs: number;

  /** How long before an instance is considered stale (ms) */
  staleThresholdMs: number;

  /** Enable auto-repair for fully managed instances */
  autoRepairEnabled: boolean;

  /** Logger */
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface MonitorHandle {
  stop: () => void;
  scan: () => Promise<ScanResult>;
  getStatus: () => Promise<NetworkStatus>;
}

export interface ScanResult {
  timestamp: Date;
  instancesScanned: number;
  healthy: number;
  degraded: number;
  critical: number;
  offline: number;
  alertsGenerated: number;
  repairsTriggered: number;
}

export interface NetworkStatus {
  health: "healthy" | "degraded" | "critical" | "unknown";
  instanceCount: number;
  healthyCount: number;
  degradedCount: number;
  criticalCount: number;
  offlineCount: number;
  needsAttention: string[];
  lastScan: Date | null;
}

export interface InstanceSummary {
  instanceId: string;
  clientId: string;
  clientName?: string;
  health: InstanceHealth;
  lastSeen: Date;
  isOffline: boolean;
  isStale: boolean;
  criticalIssues: number;
  warningIssues: number;
  agentName?: string;
  agentState: string;
}

// =============================================================================
// Default Config
// =============================================================================

export const DEFAULT_MONITOR_CONFIG: Omit<MonitorConfig, "logger"> = {
  scanIntervalMs: 5 * 60 * 1000, // 5 minutes
  offlineThresholdMs: 2 * 60 * 60 * 1000, // 2 hours
  staleThresholdMs: 90 * 60 * 1000, // 90 minutes (1.5x report interval)
  autoRepairEnabled: true,
};

// =============================================================================
// Network Monitor
// =============================================================================

export class NetworkMonitor {
  private config: MonitorConfig;
  private scanTimer?: NodeJS.Timeout;
  private running = false;

  constructor(config: Partial<MonitorConfig> & { logger: MonitorConfig["logger"] }) {
    this.config = {
      ...DEFAULT_MONITOR_CONFIG,
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.running) {
      this.config.logger.warn("Network monitor already running");
      return;
    }

    this.running = true;
    this.config.logger.info("Network monitor started");

    // Run initial scan
    this.scan().catch((err) => {
      this.config.logger.error(`Initial scan failed: ${err}`);
    });

    // Schedule periodic scans
    this.scheduleNextScan();
  }

  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = undefined;
    }

    this.config.logger.info("Network monitor stopped");
  }

  private scheduleNextScan(): void {
    if (!this.running) return;

    this.scanTimer = setTimeout(async () => {
      try {
        await this.scan();
      } catch (err) {
        this.config.logger.error(`Scan failed: ${err}`);
      }
      this.scheduleNextScan();
    }, this.config.scanIntervalMs);
  }

  // ---------------------------------------------------------------------------
  // Scanning
  // ---------------------------------------------------------------------------

  async scan(): Promise<ScanResult> {
    const stateManager = getStateManager();
    const state = await stateManager.getState();

    if (!state || state.instance.role !== "primary") {
      throw new Error("Not primary instance");
    }

    const now = Date.now();
    let alertsGenerated = 0;
    let repairsTriggered = 0;

    const monitor = state.networkMonitor || {
      instances: {},
      lastSeen: {},
      needsAttention: [],
      alerts: [],
      lastScan: null,
    };

    const instances = Object.entries(monitor.instances);
    const counts = { healthy: 0, degraded: 0, critical: 0, offline: 0 };

    // Analyze each instance
    for (const [instanceId, report] of instances) {
      const lastSeen = monitor.lastSeen[instanceId] || 0;
      const age = now - lastSeen;
      const isOffline = age > this.config.offlineThresholdMs;
      const isStale = age > this.config.staleThresholdMs;
      const wasOffline = this.wasInstanceOffline(instanceId, monitor);

      // Determine current health
      let health: InstanceHealth = report.health;
      if (isOffline) {
        health = "offline";
      }

      // Count by health
      counts[health === "unknown" ? "degraded" : health]++;

      // Check for state changes that need alerts
      if (isOffline && !wasOffline) {
        // Instance just went offline
        await this.addAlert(instanceId, "offline", `Instance ${instanceId} has gone offline (no report for ${Math.floor(age / 60000)} minutes)`);
        alertsGenerated++;
      }

      if (isStale && !isOffline && report.health === "healthy") {
        // Instance is late but not offline yet - just log
        this.config.logger.warn(`Instance ${instanceId} is late on health report (${Math.floor(age / 60000)} minutes)`);
      }

      // Check for critical issues
      const criticalIssues = report.issues.filter((i) => i.severity === "critical");
      if (criticalIssues.length > 0) {
        // Check if we already alerted for these issues
        const existingAlerts = monitor.alerts.filter(
          (a) => a.instanceId === instanceId && a.type === "critical" && !a.resolvedAt
        );

        if (existingAlerts.length === 0) {
          await this.addAlert(
            instanceId,
            "critical",
            `Instance ${instanceId} has ${criticalIssues.length} critical issue(s)`
          );
          alertsGenerated++;
        }

        // Trigger auto-repair if enabled and instance is fully managed
        if (this.config.autoRepairEnabled) {
          const repairableIssues = criticalIssues.filter((i) => i.canSelfRepair);
          if (repairableIssues.length > 0) {
            const repairResult = await this.triggerRepair(instanceId, repairableIssues);
            if (repairResult.triggered) {
              repairsTriggered++;
              this.config.logger.info(
                `Triggered repair for ${instanceId}: ${repairResult.actionsTriggered} actions`
              );
            }
          }
        }
      }
    }

    // Update state with scan results
    await stateManager.updateState((s) => {
      if (!s.networkMonitor) {
        s.networkMonitor = {
          instances: {},
          lastSeen: {},
          needsAttention: [],
          alerts: [],
          lastScan: null,
        };
      }
      s.networkMonitor.lastScan = now;

      // Update needs attention list
      s.networkMonitor.needsAttention = Object.entries(s.networkMonitor.instances)
        .filter(([id, report]) => {
          const lastSeen = s.networkMonitor!.lastSeen[id] || 0;
          const isOffline = now - lastSeen > this.config.offlineThresholdMs;
          const hasCritical = report.issues.some((i) => i.severity === "critical");
          return isOffline || hasCritical || report.health === "critical";
        })
        .map(([id]) => id);
    });

    const result: ScanResult = {
      timestamp: new Date(now),
      instancesScanned: instances.length,
      healthy: counts.healthy,
      degraded: counts.degraded,
      critical: counts.critical,
      offline: counts.offline,
      alertsGenerated,
      repairsTriggered,
    };

    this.config.logger.info(
      `Scan complete: ${result.instancesScanned} instances, ${result.healthy} healthy, ${result.offline} offline, ${result.alertsGenerated} alerts`
    );

    return result;
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  async getStatus(): Promise<NetworkStatus> {
    const stateManager = getStateManager();
    const state = await stateManager.getState();

    if (!state?.networkMonitor) {
      return {
        health: "unknown",
        instanceCount: 0,
        healthyCount: 0,
        degradedCount: 0,
        criticalCount: 0,
        offlineCount: 0,
        needsAttention: [],
        lastScan: null,
      };
    }

    const monitor = state.networkMonitor;
    const now = Date.now();

    let healthyCount = 0;
    let degradedCount = 0;
    let criticalCount = 0;
    let offlineCount = 0;

    for (const [instanceId, report] of Object.entries(monitor.instances)) {
      const lastSeen = monitor.lastSeen[instanceId] || 0;
      const isOffline = now - lastSeen > this.config.offlineThresholdMs;

      if (isOffline) {
        offlineCount++;
      } else if (report.health === "critical") {
        criticalCount++;
      } else if (report.health === "degraded") {
        degradedCount++;
      } else {
        healthyCount++;
      }
    }

    const instanceCount = Object.keys(monitor.instances).length;
    let health: NetworkStatus["health"] = "unknown";

    if (instanceCount === 0) {
      health = "unknown";
    } else if (offlineCount > 0 || criticalCount > 0) {
      health = "critical";
    } else if (degradedCount > 0) {
      health = "degraded";
    } else {
      health = "healthy";
    }

    return {
      health,
      instanceCount,
      healthyCount,
      degradedCount,
      criticalCount,
      offlineCount,
      needsAttention: monitor.needsAttention,
      lastScan: monitor.lastScan ? new Date(monitor.lastScan) : null,
    };
  }

  async getInstances(): Promise<InstanceSummary[]> {
    const stateManager = getStateManager();
    const state = await stateManager.getState();

    if (!state?.networkMonitor) {
      return [];
    }

    const monitor = state.networkMonitor;
    const now = Date.now();

    return Object.entries(monitor.instances).map(([instanceId, report]) => {
      const lastSeen = monitor.lastSeen[instanceId] || 0;
      const age = now - lastSeen;

      return {
        instanceId,
        clientId: report.clientId,
        clientName: report.clientName,
        health: age > this.config.offlineThresholdMs ? "offline" : report.health,
        lastSeen: new Date(lastSeen),
        isOffline: age > this.config.offlineThresholdMs,
        isStale: age > this.config.staleThresholdMs,
        criticalIssues: report.issues.filter((i) => i.severity === "critical").length,
        warningIssues: report.issues.filter((i) => i.severity === "warning").length,
        agentName: report.services.agent.name,
        agentState: report.services.agent.state,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Repair Integration
  // ---------------------------------------------------------------------------

  private async triggerRepair(
    instanceId: string,
    issues: PersistedIssue[]
  ): Promise<{ triggered: boolean; actionsTriggered: number; results: RepairResult[] }> {
    try {
      const repairSystem = getRepairSystem();
      const connection = repairSystem.getConnection(instanceId);

      if (!connection) {
        this.config.logger.warn(`No connection registered for ${instanceId}, cannot repair`);
        return { triggered: false, actionsTriggered: 0, results: [] };
      }

      if (connection.managementTier !== "fully_managed") {
        this.config.logger.info(
          `Instance ${instanceId} is ${connection.managementTier}, skipping auto-repair`
        );
        return { triggered: false, actionsTriggered: 0, results: [] };
      }

      // Create repair plan
      const plan = await repairSystem.createRepairPlan(instanceId, issues);

      if (plan.actions.length === 0) {
        return { triggered: false, actionsTriggered: 0, results: [] };
      }

      // Execute the plan
      const results = await repairSystem.executePlan(plan);

      // Log results
      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      if (failed > 0) {
        this.config.logger.warn(
          `Repair for ${instanceId}: ${successful} succeeded, ${failed} failed`
        );
      } else {
        this.config.logger.info(`Repair for ${instanceId}: ${successful} actions completed`);
      }

      return {
        triggered: true,
        actionsTriggered: results.length,
        results,
      };
    } catch (error) {
      this.config.logger.error(
        `Failed to trigger repair for ${instanceId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return { triggered: false, actionsTriggered: 0, results: [] };
    }
  }

  // ---------------------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------------------

  private async addAlert(
    instanceId: string,
    type: NetworkAlert["type"],
    message: string
  ): Promise<void> {
    const stateManager = getStateManager();

    await stateManager.updateState((s) => {
      if (!s.networkMonitor) {
        s.networkMonitor = {
          instances: {},
          lastSeen: {},
          needsAttention: [],
          alerts: [],
          lastScan: null,
        };
      }

      const alert: NetworkAlert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        instanceId,
        type,
        message,
        createdAt: Date.now(),
      };

      s.networkMonitor.alerts.push(alert);

      // Keep only last 100 alerts
      if (s.networkMonitor.alerts.length > 100) {
        s.networkMonitor.alerts = s.networkMonitor.alerts.slice(-100);
      }
    });

    this.config.logger.warn(`Alert: ${message}`);
  }

  async getAlerts(options?: {
    instanceId?: string;
    unacknowledgedOnly?: boolean;
    limit?: number;
  }): Promise<NetworkAlert[]> {
    const stateManager = getStateManager();
    const state = await stateManager.getState();

    if (!state?.networkMonitor) {
      return [];
    }

    let alerts = state.networkMonitor.alerts;

    if (options?.instanceId) {
      alerts = alerts.filter((a) => a.instanceId === options.instanceId);
    }

    if (options?.unacknowledgedOnly) {
      alerts = alerts.filter((a) => !a.acknowledgedAt);
    }

    if (options?.limit) {
      alerts = alerts.slice(-options.limit);
    }

    return alerts;
  }

  async acknowledgeAlert(alertId: string): Promise<boolean> {
    const stateManager = getStateManager();
    let found = false;

    await stateManager.updateState((s) => {
      if (!s.networkMonitor) return;

      const alert = s.networkMonitor.alerts.find((a) => a.id === alertId);
      if (alert) {
        alert.acknowledgedAt = Date.now();
        found = true;
      }
    });

    return found;
  }

  async resolveAlert(alertId: string): Promise<boolean> {
    const stateManager = getStateManager();
    let found = false;

    await stateManager.updateState((s) => {
      if (!s.networkMonitor) return;

      const alert = s.networkMonitor.alerts.find((a) => a.id === alertId);
      if (alert) {
        alert.resolvedAt = Date.now();
        found = true;
      }
    });

    return found;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private wasInstanceOffline(instanceId: string, monitor: NetworkMonitorState): boolean {
    // Check if there's an unresolved offline alert for this instance
    return monitor.alerts.some(
      (a) => a.instanceId === instanceId && a.type === "offline" && !a.resolvedAt
    );
  }
}

// =============================================================================
// Public API
// =============================================================================

let monitorInstance: NetworkMonitor | null = null;

/**
 * Start the network monitor.
 * Only runs on primary instance (Bernard).
 */
export async function startNetworkMonitor(
  config: Partial<MonitorConfig> & { logger: MonitorConfig["logger"] }
): Promise<MonitorHandle> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state || state.instance.role !== "primary") {
    throw new Error("Network monitor can only run on primary instance");
  }

  if (monitorInstance) {
    monitorInstance.stop();
  }

  monitorInstance = new NetworkMonitor(config);
  monitorInstance.start();

  return {
    stop: () => {
      if (monitorInstance) {
        monitorInstance.stop();
        monitorInstance = null;
      }
    },
    scan: () => {
      if (!monitorInstance) {
        throw new Error("Monitor not running");
      }
      return monitorInstance.scan();
    },
    getStatus: () => {
      if (!monitorInstance) {
        throw new Error("Monitor not running");
      }
      return monitorInstance.getStatus();
    },
  };
}

/**
 * Stop the network monitor.
 */
export function stopNetworkMonitor(): void {
  if (monitorInstance) {
    monitorInstance.stop();
    monitorInstance = null;
  }
}

/**
 * Get the current monitor instance (for testing).
 */
export function getMonitorInstance(): NetworkMonitor | null {
  return monitorInstance;
}
