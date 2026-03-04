/**
 * Network Gateway Handlers
 *
 * Handlers for gateway methods that Bernard (primary) exposes
 * for client instances to report to.
 *
 * All state is persisted - no in-memory Maps.
 */

import { randomBytes } from "node:crypto";
import type { GatewayRequestHandlerOptions } from "openclaw/plugin-sdk";
import { getStateManager } from "../state/store.js";
import type {
  PersistedHealthReport,
  PersistedIssue,
  NetworkAlert,
  InstanceHealth,
} from "../state/types.js";

// =============================================================================
// Types (incoming from client)
// =============================================================================

export interface IncomingHealthReport {
  instanceId: string;
  clientId: string;
  timestamp: string;
  health: InstanceHealth;
  services: {
    gateway: { running: boolean; uptime?: number };
    qmd: { running: boolean; documentCount: number; indexHealthy: boolean };
    agent: { state: string; name?: string; lastActive: string };
  };
  system: {
    awake: boolean;
    sleepPrevented: boolean;
    uptime: number;
    memory: { percentage: number; pressure: string };
    disk: { percentage: number; pressure: string };
    network?: { networkReachable?: boolean; networkLatency?: number };
  };
  issues: Array<{
    id: string;
    component: string;
    severity: "info" | "warning" | "critical";
    description: string;
    canSelfRepair: boolean;
    suggestedFix?: string;
    detectedAt: string;
  }>;
}

// =============================================================================
// Constants
// =============================================================================

const OFFLINE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours (missed 2 hourly reports)
const MAX_ALERTS = 100; // Keep last 100 alerts

// =============================================================================
// Handlers
// =============================================================================

/**
 * Handle health report from a client instance.
 * Only available on primary (Bernard).
 */
export async function handleHealthReport(opts: GatewayRequestHandlerOptions): Promise<void> {
  const report = opts.params as unknown as IncomingHealthReport;

  if (!report || !report.instanceId) {
    opts.respond(false, undefined, { code: "INVALID_REPORT", message: "Invalid report" });
    return;
  }

  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state || state.instance.role !== "primary") {
    opts.respond(false, undefined, { code: "NOT_PRIMARY", message: "Not primary instance" });
    return;
  }

  const now = Date.now();
  const persistedReport = convertToPersistedReport(report, now);
  const criticalIssues = persistedReport.issues.filter((i) => i.severity === "critical");

  // Update state with the new report
  await stateManager.updateState((s) => {
    // Initialize network monitor state if needed
    if (!s.networkMonitor) {
      s.networkMonitor = {
        instances: {},
        lastSeen: {},
        needsAttention: [],
        alerts: [],
        lastScan: null,
      };
    }

    const monitor = s.networkMonitor;
    const instanceId = report.instanceId;
    const previousReport = monitor.instances[instanceId];
    const wasOffline = previousReport
      ? now - (monitor.lastSeen[instanceId] || 0) > OFFLINE_THRESHOLD_MS
      : false;

    // Store the report
    monitor.instances[instanceId] = persistedReport;
    monitor.lastSeen[instanceId] = now;

    // Update needs attention list
    if (persistedReport.health === "critical" || criticalIssues.length > 0) {
      if (!monitor.needsAttention.includes(instanceId)) {
        monitor.needsAttention.push(instanceId);
      }
    } else if (persistedReport.health === "healthy") {
      monitor.needsAttention = monitor.needsAttention.filter((id) => id !== instanceId);
    }

    // Generate alerts for state changes
    if (wasOffline && persistedReport.health !== "offline") {
      // Instance came back online
      addAlert(monitor, {
        instanceId,
        type: "recovered",
        message: `Instance ${instanceId} is back online`,
      });
    }

    if (criticalIssues.length > 0 && !previousReport?.issues.some((i) => i.severity === "critical")) {
      // New critical issues
      addAlert(monitor, {
        instanceId,
        type: "critical",
        message: `Instance ${instanceId} has ${criticalIssues.length} critical issue(s): ${criticalIssues.map((i) => i.description).join(", ")}`,
      });
    }
  });

  opts.respond(true, {
    received: report.timestamp,
    criticalIssues: criticalIssues.length,
    acknowledged: true,
  });
}

/**
 * Get status of all known instances.
 * Only available on primary (Bernard).
 */
export async function handleNetworkStatus(opts: GatewayRequestHandlerOptions): Promise<void> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state || state.instance.role !== "primary") {
    opts.respond(false, undefined, { code: "NOT_PRIMARY", message: "Not primary instance" });
    return;
  }

  const monitor = state.networkMonitor;
  if (!monitor) {
    opts.respond(true, {
      timestamp: new Date().toISOString(),
      networkHealth: "unknown",
      instanceCount: 0,
      instances: [],
      needsAttention: [],
    });
    return;
  }

  const now = Date.now();
  const instances = Object.entries(monitor.instances).map(([id, report]) => {
    const lastSeen = monitor.lastSeen[id] || 0;
    const age = now - lastSeen;
    const isOffline = age > OFFLINE_THRESHOLD_MS;

    return {
      instanceId: id,
      clientId: report.clientId,
      clientName: report.clientName,
      health: isOffline ? "offline" : report.health,
      lastReport: new Date(lastSeen).toISOString(),
      lastReportAge: Math.floor(age / 1000),
      isOffline,
      agentName: report.services.agent.name,
      agentState: report.services.agent.state,
      activeIssues: report.issues.length,
      criticalIssues: report.issues.filter((i) => i.severity === "critical").length,
    };
  });

  const networkHealth = calculateNetworkHealth(instances);

  opts.respond(true, {
    timestamp: new Date().toISOString(),
    networkHealth,
    instanceCount: instances.length,
    instances,
    needsAttention: monitor.needsAttention,
    recentAlerts: monitor.alerts.slice(-10),
  });
}

/**
 * Get detailed status for a specific instance.
 */
export async function handleInstanceStatus(opts: GatewayRequestHandlerOptions): Promise<void> {
  const instanceId = opts.params?.instanceId as string;

  if (!instanceId) {
    opts.respond(false, undefined, { code: "MISSING_PARAM", message: "instanceId required" });
    return;
  }

  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state || state.instance.role !== "primary") {
    opts.respond(false, undefined, { code: "NOT_PRIMARY", message: "Not primary instance" });
    return;
  }

  const monitor = state.networkMonitor;
  if (!monitor || !monitor.instances[instanceId]) {
    opts.respond(false, undefined, { code: "NOT_FOUND", message: "Instance not found" });
    return;
  }

  const report = monitor.instances[instanceId];
  const lastSeen = monitor.lastSeen[instanceId] || 0;
  const now = Date.now();
  const isOffline = now - lastSeen > OFFLINE_THRESHOLD_MS;

  opts.respond(true, {
    instanceId,
    clientId: report.clientId,
    clientName: report.clientName,
    health: isOffline ? "offline" : report.health,
    lastSeen: new Date(lastSeen).toISOString(),
    lastSeenAge: Math.floor((now - lastSeen) / 1000),
    isOffline,
    services: report.services,
    system: report.system,
    issues: report.issues,
    alerts: monitor.alerts.filter((a) => a.instanceId === instanceId).slice(-10),
  });
}

/**
 * Get ceremony status for a specific instance.
 * Only available on primary (Bernard).
 */
export async function handleCeremonyStatus(opts: GatewayRequestHandlerOptions): Promise<void> {
  const instanceId = opts.params?.instanceId as string;

  if (!instanceId) {
    opts.respond(false, undefined, { code: "MISSING_PARAM", message: "instanceId required" });
    return;
  }

  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state || state.instance.role !== "primary") {
    opts.respond(false, undefined, { code: "NOT_PRIMARY", message: "Not primary instance" });
    return;
  }

  const monitor = state.networkMonitor;
  if (!monitor || !monitor.instances[instanceId]) {
    opts.respond(false, undefined, { code: "NOT_FOUND", message: "Instance not found" });
    return;
  }

  const report = monitor.instances[instanceId];

  opts.respond(true, {
    instanceId,
    agentState: report.services.agent.state,
    agentName: report.services.agent.name,
    lastActive: new Date(report.services.agent.lastActive).toISOString(),
  });
}

/**
 * Acknowledge an alert.
 */
export async function handleAcknowledgeAlert(opts: GatewayRequestHandlerOptions): Promise<void> {
  const alertId = opts.params?.alertId as string;

  if (!alertId) {
    opts.respond(false, undefined, { code: "MISSING_PARAM", message: "alertId required" });
    return;
  }

  const stateManager = getStateManager();

  await stateManager.updateState((s) => {
    if (!s.networkMonitor) return;

    const alert = s.networkMonitor.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledgedAt = Date.now();
    }
  });

  opts.respond(true, { acknowledged: true });
}

/**
 * Mark an instance as needing attention (manual flag).
 */
export async function handleFlagInstance(opts: GatewayRequestHandlerOptions): Promise<void> {
  const instanceId = opts.params?.instanceId as string;
  const flag = opts.params?.flag as boolean;

  if (!instanceId) {
    opts.respond(false, undefined, { code: "MISSING_PARAM", message: "instanceId required" });
    return;
  }

  const stateManager = getStateManager();

  await stateManager.updateState((s) => {
    if (!s.networkMonitor) return;

    if (flag) {
      if (!s.networkMonitor.needsAttention.includes(instanceId)) {
        s.networkMonitor.needsAttention.push(instanceId);
      }
    } else {
      s.networkMonitor.needsAttention = s.networkMonitor.needsAttention.filter(
        (id) => id !== instanceId
      );
    }
  });

  opts.respond(true, { flagged: flag });
}

// =============================================================================
// Helper Functions
// =============================================================================

function convertToPersistedReport(
  incoming: IncomingHealthReport,
  receivedAt: number
): PersistedHealthReport {
  return {
    instanceId: incoming.instanceId,
    clientId: incoming.clientId,
    receivedAt,
    health: incoming.health,
    services: {
      gateway: incoming.services.gateway,
      qmd: incoming.services.qmd,
      agent: {
        state: incoming.services.agent.state,
        name: incoming.services.agent.name,
        lastActive: new Date(incoming.services.agent.lastActive).getTime(),
      },
    },
    system: {
      awake: incoming.system.awake,
      sleepPrevented: incoming.system.sleepPrevented,
      uptime: incoming.system.uptime,
      memory: incoming.system.memory,
      disk: incoming.system.disk,
      network: {
        reachable: incoming.system.network?.networkReachable ?? true,
        latency: incoming.system.network?.networkLatency,
      },
    },
    issues: incoming.issues.map((i) => ({
      id: i.id,
      component: i.component,
      severity: i.severity,
      description: i.description,
      canSelfRepair: i.canSelfRepair,
      suggestedFix: i.suggestedFix,
      detectedAt: new Date(i.detectedAt).getTime(),
    })),
  };
}

function addAlert(
  monitor: { alerts: NetworkAlert[] },
  alert: Omit<NetworkAlert, "id" | "createdAt">
): void {
  const newAlert: NetworkAlert = {
    id: `alert-${randomBytes(4).toString("hex")}`,
    createdAt: Date.now(),
    ...alert,
  };

  monitor.alerts.push(newAlert);

  // Keep only the last MAX_ALERTS
  if (monitor.alerts.length > MAX_ALERTS) {
    monitor.alerts = monitor.alerts.slice(-MAX_ALERTS);
  }
}

function calculateNetworkHealth(
  instances: Array<{ health: InstanceHealth; criticalIssues: number }>
): "healthy" | "degraded" | "critical" | "unknown" {
  if (instances.length === 0) {
    return "unknown";
  }

  const hasOffline = instances.some((i) => i.health === "offline");
  const hasCritical = instances.some((i) => i.health === "critical" || i.criticalIssues > 0);
  const hasDegraded = instances.some((i) => i.health === "degraded");
  const allHealthy = instances.every((i) => i.health === "healthy");

  if (hasOffline || hasCritical) {
    return "critical";
  }
  if (hasDegraded) {
    return "degraded";
  }
  if (allHealthy) {
    return "healthy";
  }
  return "degraded";
}

// =============================================================================
// Utility Functions (for use by monitor)
// =============================================================================

/**
 * Get all instances that are late on their health reports.
 */
export async function getLateInstances(): Promise<string[]> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state?.networkMonitor) {
    return [];
  }

  const now = Date.now();
  return Object.entries(state.networkMonitor.lastSeen)
    .filter(([_, lastSeen]) => now - lastSeen > OFFLINE_THRESHOLD_MS)
    .map(([id]) => id);
}

/**
 * Get all instances with critical issues.
 */
export async function getCriticalInstances(): Promise<string[]> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state?.networkMonitor) {
    return [];
  }

  return Object.entries(state.networkMonitor.instances)
    .filter(([_, report]) => report.issues.some((i) => i.severity === "critical"))
    .map(([id]) => id);
}

/**
 * Get instances that need attention.
 */
export async function getInstancesNeedingAttention(): Promise<string[]> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  return state?.networkMonitor?.needsAttention || [];
}
