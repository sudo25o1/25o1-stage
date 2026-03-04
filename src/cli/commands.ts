/**
 * 25o1 CLI Commands
 *
 * Commands for setup, status, and network management.
 */

import { getStateManager } from "../state/store.js";
import type { Instance25o1State, InstanceRole, ManagementTier } from "../state/types.js";

// =============================================================================
// Types
// =============================================================================

// Use a loose type for CLI context to avoid commander version mismatches
export interface CliContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: any;
  config: unknown;
  workspaceDir?: string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

// =============================================================================
// Command Registration
// =============================================================================

/**
 * Register 25o1 CLI commands.
 */
export function register25o1Commands(ctx: CliContext): void {
  const { program } = ctx;

  // Setup command
  program
    .command("25o1:setup")
    .description("Initialize 25o1 on this machine")
    .option("--primary", "Configure as primary instance (Bernard)")
    .option("--client", "Configure as client instance")
    .option("--name <name>", "Client name (for client instances)")
    .option("--bernard-host <host>", "Bernard host URL (for client instances)")
    .action(async (options: Record<string, unknown>) => {
      await setupCommand(options);
    });

  // Status command
  program
    .command("25o1:status")
    .description("Show 25o1 status")
    .action(async () => {
      await statusCommand();
    });

  // Network command (primary only)
  program
    .command("25o1:network")
    .description("Show network status (primary only)")
    .action(async () => {
      await networkCommand();
    });

  // Network scan command
  program
    .command("25o1:network:scan")
    .description("Trigger a network scan (primary only)")
    .action(async () => {
      await networkScanCommand();
    });

  // Network alerts command
  program
    .command("25o1:network:alerts")
    .description("Show network alerts (primary only)")
    .option("--all", "Show all alerts including acknowledged")
    .action(async (options: Record<string, unknown>) => {
      await networkAlertsCommand(options);
    });

  // Acknowledge alert command
  program
    .command("25o1:network:ack")
    .description("Acknowledge an alert")
    .argument("<alertId>", "Alert ID to acknowledge")
    .action(async (alertId: string) => {
      await acknowledgeAlertCommand(alertId);
    });

  // Ceremony command
  program
    .command("25o1:ceremony")
    .description("Check ceremony readiness")
    .option("--force", "Force ceremony initiation")
    .action(async (options: Record<string, unknown>) => {
      await ceremonyCommand(options);
    });
}

// =============================================================================
// Command Implementations
// =============================================================================

async function setupCommand(options: Record<string, unknown>): Promise<void> {
  const stateManager = getStateManager();
  const existingState = await stateManager.getState();

  if (existingState) {
    // eslint-disable-next-line no-console
    console.log("25o1 is already configured on this machine.");
    // eslint-disable-next-line no-console
    console.log(`  Instance ID: ${existingState.instance.id}`);
    // eslint-disable-next-line no-console
    console.log(`  Role: ${existingState.instance.role}`);
    // eslint-disable-next-line no-console
    console.log(`  State: ${existingState.lifecycle.state}`);
    // eslint-disable-next-line no-console
    console.log("\nTo reconfigure, delete ~/.openclaw/25o1-state.json and run setup again.");
    return;
  }

  // Determine role
  let role: InstanceRole;
  if (options.primary) {
    role = "primary";
  } else if (options.client) {
    role = "client";
  } else {
    // Interactive prompt would go here
    // eslint-disable-next-line no-console
    console.log("Please specify --primary or --client");
    return;
  }

  // Determine management tier (for clients)
  const managementTier: ManagementTier = "fully_managed";

  // Generate instance ID
  const instanceId = role === "primary" ? "bernard" : `client-${Date.now().toString(36)}`;

  // Create initial state
  const initialState: Instance25o1State = {
    version: 1,
    instance: {
      id: instanceId,
      role,
      managementTier,
      clientName: options.name as string | undefined,
    },
    lifecycle: {
      state: "hatched",
      sessions: 0,
      memories: 0,
      created: Date.now(),
      lastActive: Date.now(),
      namingThreshold: {
        minSessions: 20,
        minMemories: 50,
        minDays: 14,
        maxDeferrals: 3,
        humanCanOverride: true,
        agentCanInitiate: true,
      },
      namingDeferrals: 0,
      milestones: [],
    },
    ceremony: {
      pending: null,
      initiatedAt: null,
      nudged: false,
      lastReadinessCheck: null,
      lastReadiness: null,
    },
    firstMeeting: {
      completed: false,
      completedAt: null,
    },
    network: {
      bernardHost: role === "client" ? (options["bernard-host"] as string) : undefined,
      healthReporter: {
        enabled: role === "client",
        intervalMs: 60 * 60 * 1000, // 1 hour
      },
      monitorEnabled: role === "primary",
    },
    updatedAt: Date.now(),
  };

  await stateManager.setState(initialState);

  // eslint-disable-next-line no-console
  console.log("25o1 configured successfully!");
  // eslint-disable-next-line no-console
  console.log(`  Instance ID: ${instanceId}`);
  // eslint-disable-next-line no-console
  console.log(`  Role: ${role}`);

  if (role === "primary") {
    // eslint-disable-next-line no-console
    console.log("\nBernard is ready. Network monitoring is enabled.");
  } else {
    // eslint-disable-next-line no-console
    console.log(`\nClient instance configured.`);
    if (initialState.network.bernardHost) {
      // eslint-disable-next-line no-console
      console.log(`  Reporting to: ${initialState.network.bernardHost}`);
    } else {
      // eslint-disable-next-line no-console
      console.log("  Warning: No Bernard host configured. Run with --bernard-host to set.");
    }
  }
}

async function statusCommand(): Promise<void> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state) {
    // eslint-disable-next-line no-console
    console.log("25o1 is not configured. Run '25o1:setup' to initialize.");
    return;
  }

  // eslint-disable-next-line no-console
  console.log("25o1 Status");
  // eslint-disable-next-line no-console
  console.log("===========");
  // eslint-disable-next-line no-console
  console.log(`Instance ID: ${state.instance.id}`);
  // eslint-disable-next-line no-console
  console.log(`Role: ${state.instance.role}`);
  // eslint-disable-next-line no-console
  console.log(`Management Tier: ${state.instance.managementTier}`);
  // eslint-disable-next-line no-console
  console.log();
  // eslint-disable-next-line no-console
  console.log("Lifecycle");
  // eslint-disable-next-line no-console
  console.log("---------");
  // eslint-disable-next-line no-console
  console.log(`State: ${state.lifecycle.state}`);
  if (state.lifecycle.name) {
    // eslint-disable-next-line no-console
    console.log(`Name: ${state.lifecycle.name}`);
  }
  if (state.lifecycle.growthPhase) {
    // eslint-disable-next-line no-console
    console.log(`Growth Phase: ${state.lifecycle.growthPhase}`);
  }
  // eslint-disable-next-line no-console
  console.log(`Sessions: ${state.lifecycle.sessions}`);
  // eslint-disable-next-line no-console
  console.log(`Memories: ${state.lifecycle.memories}`);
  // eslint-disable-next-line no-console
  console.log(`Created: ${new Date(state.lifecycle.created).toISOString()}`);
  // eslint-disable-next-line no-console
  console.log(`Last Active: ${new Date(state.lifecycle.lastActive).toISOString()}`);
  // eslint-disable-next-line no-console
  console.log();
  // eslint-disable-next-line no-console
  console.log("Ceremony");
  // eslint-disable-next-line no-console
  console.log("--------");
  // eslint-disable-next-line no-console
  console.log(`First Meeting: ${state.firstMeeting.completed ? "Completed" : "Pending"}`);
  // eslint-disable-next-line no-console
  console.log(`Pending Ceremony: ${state.ceremony.pending || "None"}`);
  // eslint-disable-next-line no-console
  console.log();
  // eslint-disable-next-line no-console
  console.log("Network");
  // eslint-disable-next-line no-console
  console.log("-------");
  if (state.instance.role === "primary") {
    // eslint-disable-next-line no-console
    console.log("Monitor: Enabled (primary)");
  } else {
    // eslint-disable-next-line no-console
    console.log(`Health Reporter: ${state.network.healthReporter.enabled ? "Enabled" : "Disabled"}`);
    // eslint-disable-next-line no-console
    console.log(`Bernard Host: ${state.network.bernardHost || "Not configured"}`);
  }
}

async function networkCommand(): Promise<void> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state) {
    // eslint-disable-next-line no-console
    console.log("25o1 is not configured. Run '25o1:setup' to initialize.");
    return;
  }

  if (state.instance.role !== "primary") {
    // eslint-disable-next-line no-console
    console.log("Network status is only available on the primary instance (Bernard).");
    return;
  }

  const monitor = state.networkMonitor;

  // eslint-disable-next-line no-console
  console.log("Network Status");
  // eslint-disable-next-line no-console
  console.log("==============");

  if (!monitor || Object.keys(monitor.instances).length === 0) {
    // eslint-disable-next-line no-console
    console.log("No client instances registered yet.");
    // eslint-disable-next-line no-console
    console.log("\nClients will appear here once they start reporting.");
    return;
  }

  const now = Date.now();
  const OFFLINE_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours

  // Calculate health counts
  let healthy = 0;
  let degraded = 0;
  let critical = 0;
  let offline = 0;

  const instances = Object.entries(monitor.instances).map(([id, report]) => {
    const lastSeen = monitor.lastSeen[id] || 0;
    const age = now - lastSeen;
    const isOffline = age > OFFLINE_THRESHOLD;

    let health = report.health;
    if (isOffline) {
      health = "offline";
      offline++;
    } else if (health === "critical") {
      critical++;
    } else if (health === "degraded") {
      degraded++;
    } else {
      healthy++;
    }

    return {
      id,
      clientName: report.clientName || report.clientId,
      health,
      agentName: report.services.agent.name,
      agentState: report.services.agent.state,
      lastSeen: new Date(lastSeen),
      age,
      issues: report.issues.length,
      criticalIssues: report.issues.filter((i) => i.severity === "critical").length,
    };
  });

  // Overall health
  const totalInstances = instances.length;
  let networkHealth = "healthy";
  if (offline > 0 || critical > 0) {
    networkHealth = "critical";
  } else if (degraded > 0) {
    networkHealth = "degraded";
  }

  const healthIcon = networkHealth === "healthy" ? "✓" : networkHealth === "degraded" ? "!" : "✗";
  // eslint-disable-next-line no-console
  console.log(`\nNetwork Health: ${healthIcon} ${networkHealth.toUpperCase()}`);
  // eslint-disable-next-line no-console
  console.log(`Total Instances: ${totalInstances}`);
  // eslint-disable-next-line no-console
  console.log(`  Healthy: ${healthy}  Degraded: ${degraded}  Critical: ${critical}  Offline: ${offline}`);

  if (monitor.lastScan) {
    const scanAge = Math.floor((now - monitor.lastScan) / 60000);
    // eslint-disable-next-line no-console
    console.log(`Last Scan: ${scanAge} minutes ago`);
  }

  // Instance table
  // eslint-disable-next-line no-console
  console.log("\nInstances");
  // eslint-disable-next-line no-console
  console.log("---------");

  for (const inst of instances) {
    const statusIcon = inst.health === "healthy" ? "✓" : inst.health === "offline" ? "○" : "✗";
    const ageStr = formatAge(inst.age);
    const issueStr = inst.criticalIssues > 0 ? ` [${inst.criticalIssues} critical]` : inst.issues > 0 ? ` [${inst.issues} issues]` : "";

    // eslint-disable-next-line no-console
    console.log(`  ${statusIcon} ${inst.clientName}`);
    // eslint-disable-next-line no-console
    console.log(`    Agent: ${inst.agentName || "(unnamed)"} (${inst.agentState})`);
    // eslint-disable-next-line no-console
    console.log(`    Health: ${inst.health}${issueStr}`);
    // eslint-disable-next-line no-console
    console.log(`    Last seen: ${ageStr}`);
  }

  // Alerts
  const unacknowledgedAlerts = monitor.alerts.filter((a) => !a.acknowledgedAt);
  if (unacknowledgedAlerts.length > 0) {
    // eslint-disable-next-line no-console
    console.log("\nUnacknowledged Alerts");
    // eslint-disable-next-line no-console
    console.log("---------------------");
    for (const alert of unacknowledgedAlerts.slice(-5)) {
      const alertAge = formatAge(now - alert.createdAt);
      // eslint-disable-next-line no-console
      console.log(`  [${alert.type}] ${alert.message} (${alertAge})`);
    }
    if (unacknowledgedAlerts.length > 5) {
      // eslint-disable-next-line no-console
      console.log(`  ... and ${unacknowledgedAlerts.length - 5} more`);
    }
  }

  // Needs attention
  if (monitor.needsAttention.length > 0) {
    // eslint-disable-next-line no-console
    console.log("\nNeeds Attention");
    // eslint-disable-next-line no-console
    console.log("---------------");
    for (const id of monitor.needsAttention) {
      // eslint-disable-next-line no-console
      console.log(`  - ${id}`);
    }
  }
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function ceremonyCommand(options: Record<string, unknown>): Promise<void> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state) {
    // eslint-disable-next-line no-console
    console.log("25o1 is not configured. Run '25o1:setup' to initialize.");
    return;
  }

  // eslint-disable-next-line no-console
  console.log("Ceremony Status");
  // eslint-disable-next-line no-console
  console.log("===============");
  // eslint-disable-next-line no-console
  console.log(`Current State: ${state.lifecycle.state}`);
  // eslint-disable-next-line no-console
  console.log(`First Meeting: ${state.firstMeeting.completed ? "Completed" : "Pending"}`);
  // eslint-disable-next-line no-console
  console.log(`Pending Ceremony: ${state.ceremony.pending || "None"}`);
  // eslint-disable-next-line no-console
  console.log();

  if (state.lifecycle.state === "learning") {
    const { checkNamingReadiness } = await import("../ceremony/detection.js");
    const readiness = checkNamingReadiness(state);
    // eslint-disable-next-line no-console
    console.log("Naming Readiness");
    // eslint-disable-next-line no-console
    console.log("----------------");
    // eslint-disable-next-line no-console
    console.log(`Ready: ${readiness.ready ? "Yes" : "No"}`);
    // eslint-disable-next-line no-console
    console.log(`Score: ${(readiness.score * 100).toFixed(0)}%`);
    // eslint-disable-next-line no-console
    console.log(`Status: ${readiness.recommendation}`);
  }

  if (options.force) {
    // eslint-disable-next-line no-console
    console.log("\n--force not yet implemented");
  }
}

// =============================================================================
// Network Management Commands
// =============================================================================

async function networkScanCommand(): Promise<void> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state) {
    // eslint-disable-next-line no-console
    console.log("25o1 is not configured. Run '25o1:setup' to initialize.");
    return;
  }

  if (state.instance.role !== "primary") {
    // eslint-disable-next-line no-console
    console.log("Network scan is only available on the primary instance (Bernard).");
    return;
  }

  // eslint-disable-next-line no-console
  console.log("Triggering network scan...");

  const { NetworkMonitor } = await import("../network/monitor.js");
  const monitor = new NetworkMonitor({
    logger: {
      info: (msg) => console.log(`[INFO] ${msg}`),
      warn: (msg) => console.log(`[WARN] ${msg}`),
      error: (msg) => console.log(`[ERROR] ${msg}`),
    },
  });

  try {
    const result = await monitor.scan();
    // eslint-disable-next-line no-console
    console.log("\nScan Results");
    // eslint-disable-next-line no-console
    console.log("------------");
    // eslint-disable-next-line no-console
    console.log(`Instances scanned: ${result.instancesScanned}`);
    // eslint-disable-next-line no-console
    console.log(`  Healthy: ${result.healthy}`);
    // eslint-disable-next-line no-console
    console.log(`  Degraded: ${result.degraded}`);
    // eslint-disable-next-line no-console
    console.log(`  Critical: ${result.critical}`);
    // eslint-disable-next-line no-console
    console.log(`  Offline: ${result.offline}`);
    // eslint-disable-next-line no-console
    console.log(`Alerts generated: ${result.alertsGenerated}`);
    // eslint-disable-next-line no-console
    console.log(`Repairs triggered: ${result.repairsTriggered}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Scan failed: ${error}`);
  }
}

async function networkAlertsCommand(options: Record<string, unknown>): Promise<void> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state) {
    // eslint-disable-next-line no-console
    console.log("25o1 is not configured. Run '25o1:setup' to initialize.");
    return;
  }

  if (state.instance.role !== "primary") {
    // eslint-disable-next-line no-console
    console.log("Network alerts are only available on the primary instance (Bernard).");
    return;
  }

  const monitor = state.networkMonitor;
  if (!monitor || monitor.alerts.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No alerts.");
    return;
  }

  const showAll = options.all === true;
  const alerts = showAll
    ? monitor.alerts
    : monitor.alerts.filter((a) => !a.acknowledgedAt);

  if (alerts.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No unacknowledged alerts.");
    // eslint-disable-next-line no-console
    console.log("Use --all to see all alerts.");
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`Alerts (${alerts.length})`);
  // eslint-disable-next-line no-console
  console.log("======");

  const now = Date.now();
  for (const alert of alerts.slice(-20)) {
    const age = formatAge(now - alert.createdAt);
    const ackStatus = alert.acknowledgedAt ? " [ACK]" : "";
    const resolvedStatus = alert.resolvedAt ? " [RESOLVED]" : "";
    // eslint-disable-next-line no-console
    console.log(`\n[${alert.id}] ${alert.type.toUpperCase()}${ackStatus}${resolvedStatus}`);
    // eslint-disable-next-line no-console
    console.log(`  Instance: ${alert.instanceId}`);
    // eslint-disable-next-line no-console
    console.log(`  Message: ${alert.message}`);
    // eslint-disable-next-line no-console
    console.log(`  Created: ${age}`);
  }

  if (alerts.length > 20) {
    // eslint-disable-next-line no-console
    console.log(`\n... and ${alerts.length - 20} more alerts`);
  }
}

async function acknowledgeAlertCommand(alertId: string): Promise<void> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state) {
    // eslint-disable-next-line no-console
    console.log("25o1 is not configured. Run '25o1:setup' to initialize.");
    return;
  }

  if (!state.networkMonitor) {
    // eslint-disable-next-line no-console
    console.log("No network monitor state.");
    return;
  }

  const alert = state.networkMonitor.alerts.find((a) => a.id === alertId);
  if (!alert) {
    // eslint-disable-next-line no-console
    console.log(`Alert not found: ${alertId}`);
    return;
  }

  if (alert.acknowledgedAt) {
    // eslint-disable-next-line no-console
    console.log(`Alert already acknowledged.`);
    return;
  }

  await stateManager.updateState((s) => {
    if (!s.networkMonitor) return;
    const a = s.networkMonitor.alerts.find((x) => x.id === alertId);
    if (a) {
      a.acknowledgedAt = Date.now();
    }
  });

  // eslint-disable-next-line no-console
  console.log(`Alert ${alertId} acknowledged.`);
}
