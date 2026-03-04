/**
 * 25o1 Network Monitoring Types
 *
 * Defines the status reporting, alerting, and repair interfaces
 * for Bernard's network monitoring system.
 *
 * Privacy principle: Bernard sees system health, not conversation content.
 */

// =============================================================================
// Status Reports (Hourly from each instance)
// =============================================================================

export interface StatusReport {
  /** Unique instance identifier */
  instanceId: string;

  /** Client this instance serves */
  clientId: string;

  /** When this report was generated */
  timestamp: Date;

  /** Overall health assessment */
  health: "healthy" | "degraded" | "critical" | "offline";

  /** Core service status */
  services: ServiceStatuses;

  /** System resource status */
  system: SystemStatus;

  /** Client activity (no content, just metrics) */
  activity: ActivityMetrics;

  /** Self-diagnosed issues */
  issues: Issue[];
}

export interface ServiceStatuses {
  gateway: ServiceStatus;
  qmd: QmdStatus;
  agent: AgentServiceStatus;
  channels: ChannelStatus[];
  cron: CronJobStatus[];
}

export interface ServiceStatus {
  running: boolean;
  pid?: number;
  uptime?: number; // seconds
  lastError?: string;
  lastErrorTime?: Date;
}

export interface QmdStatus extends ServiceStatus {
  /** Number of documents indexed */
  documentCount: number;

  /** Last successful sync */
  lastSync?: Date;

  /** Index health */
  indexHealthy: boolean;

  /** Needs reindex? */
  needsReindex: boolean;
}

export interface AgentServiceStatus {
  /** Agent lifecycle state */
  state: string; // AgentState from lifecycle

  /** Agent name (if named) */
  name?: string;

  /** Last activity */
  lastActive: Date;

  /** Memory system healthy */
  memoryHealthy: boolean;

  /** Relationship health indicator */
  relationshipHealth: "healthy" | "needs_attention" | "critical";
}

export interface ChannelStatus {
  /** Channel name (whatsapp, telegram, etc.) */
  name: string;

  /** Is channel connected? */
  connected: boolean;

  /** Last message received */
  lastMessageReceived?: Date;

  /** Last message sent */
  lastMessageSent?: Date;

  /** Error count in last 24h */
  errorCount24h: number;

  /** Last error */
  lastError?: string;
}

export interface CronJobStatus {
  /** Job name */
  name: string;

  /** Is job scheduled? */
  scheduled: boolean;

  /** Last run time */
  lastRun?: Date;

  /** Last run successful? */
  lastSuccess: boolean;

  /** Next scheduled run */
  nextRun?: Date;

  /** Last error if failed */
  lastError?: string;
}

// =============================================================================
// System Status
// =============================================================================

export interface SystemStatus {
  /** Is the system awake (not sleeping)? */
  awake: boolean;

  /** Is sleep prevention active? */
  sleepPrevented: boolean;

  /** System uptime in seconds */
  uptime: number;

  /** Memory status */
  memory: ResourceUsage;

  /** Disk status */
  disk: ResourceUsage;

  /** Network status */
  network: NetworkStatus;

  /** macOS specific */
  macos?: MacOSStatus;
}

export interface ResourceUsage {
  used: number; // bytes
  total: number; // bytes
  percentage: number; // 0-100
  pressure: "normal" | "warning" | "critical";
}

export interface NetworkStatus {
  /** Can reach network monitor? */
  networkReachable: boolean;

  /** Latency to network monitor in ms */
  networkLatency?: number;

  /** Can reach internet? */
  internetReachable: boolean;

  /** Local IP */
  localIp?: string;
}

export interface MacOSStatus {
  /** Power source */
  powerSource: "ac" | "battery";

  /** Battery percentage if on battery */
  batteryPercent?: number;

  /** Thermal state */
  thermalState: "nominal" | "fair" | "serious" | "critical";
}

// =============================================================================
// Activity Metrics (Privacy-preserving)
// =============================================================================

export interface ActivityMetrics {
  /** Last user interaction (no content) */
  lastInteraction: Date;

  /** Sessions in last 24h */
  sessions24h: number;

  /** Tokens used today */
  tokensToday: number;

  /** Token limit (if set) */
  tokenLimit?: number;

  /** Token limit exceeded? */
  tokenLimitExceeded: boolean;

  /** Errors in last 24h */
  errors24h: number;
}

// =============================================================================
// Issues (Self-Diagnosed)
// =============================================================================

export interface Issue {
  /** Unique issue ID */
  id: string;

  /** Which component */
  component: IssueComponent;

  /** Severity */
  severity: "info" | "warning" | "critical";

  /** Human-readable description */
  description: string;

  /** Can the instance fix this itself? */
  canSelfRepair: boolean;

  /** Suggested fix (if known) */
  suggestedFix?: string;

  /** When detected */
  detectedAt: Date;

  /** Has self-repair been attempted? */
  selfRepairAttempted: boolean;

  /** Self-repair result */
  selfRepairResult?: "success" | "failed" | "pending";
}

export type IssueComponent =
  | "gateway"
  | "qmd"
  | "agent"
  | "channel"
  | "cron"
  | "system"
  | "memory"
  | "disk"
  | "network"
  | "dependency";

// =============================================================================
// Configuration
// =============================================================================

export interface MonitorConfig {
  /** How often instances report (seconds) */
  reportInterval: number;

  /** How long before instance considered offline (seconds) */
  offlineThreshold: number;

  /** Network monitor endpoint for receiving reports */
  networkEndpoint: string;

  /** SSH config for repairs */
  sshConfig: {
    user: string;
    keyPath: string;
    timeout: number;
  };

  /** Alert thresholds */
  thresholds: {
    memoryWarning: number; // percentage
    memoryCritical: number;
    diskWarning: number;
    diskCritical: number;
    errorRateWarning: number; // errors per hour
    errorRateCritical: number;
  };
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  reportInterval: 3600, // 1 hour
  offlineThreshold: 7200, // 2 hours (missed 2 reports)
  networkEndpoint: "http://network.local:25001/status",
  sshConfig: {
    user: "admin",
    keyPath: "~/.ssh/25o1_network",
    timeout: 30000,
  },
  thresholds: {
    memoryWarning: 80,
    memoryCritical: 95,
    diskWarning: 85,
    diskCritical: 95,
    errorRateWarning: 10,
    errorRateCritical: 50,
  },
};