/**
 * Network Module Exports
 *
 * Bernard's network monitoring system for managing 25o1 instances.
 */

// Types
export type {
  StatusReport,
  ServiceStatuses,
  ServiceStatus,
  QmdStatus,
  AgentServiceStatus,
  ChannelStatus,
  CronJobStatus,
  SystemStatus,
  ResourceUsage,
  NetworkStatus,
  MacOSStatus,
  ActivityMetrics,
  Issue,
  IssueComponent,
  MonitorConfig,
} from "./types.js";

export { DEFAULT_MONITOR_CONFIG } from "./types.js";

// Reporter (client-side)
export {
  StatusReporter,
  startHealthReporter,
  stopHealthReporter,
  type ReporterConfig,
  type ReporterHandle,
} from "./reporter.js";

// Handlers (gateway methods)
export {
  handleHealthReport,
  handleNetworkStatus,
  handleInstanceStatus,
  handleCeremonyStatus,
  handleAcknowledgeAlert,
  handleFlagInstance,
  getLateInstances,
  getCriticalInstances,
  getInstancesNeedingAttention,
  type IncomingHealthReport,
} from "./handlers.js";

// Monitor (Bernard-side)
export {
  NetworkMonitor,
  startNetworkMonitor,
  stopNetworkMonitor,
  getMonitorInstance,
  DEFAULT_MONITOR_CONFIG as DEFAULT_NETWORK_MONITOR_CONFIG,
  type MonitorConfig as NetworkMonitorConfig,
  type MonitorHandle,
  type ScanResult,
  type NetworkStatus as MonitorNetworkStatus,
  type InstanceSummary,
} from "./monitor.js";

// Repair system
export {
  RepairSystem,
  getRepairSystem,
  initRepairSystem,
  shutdownRepairSystem,
  getAvailableRepairActions,
  getRepairAction,
  DEFAULT_REPAIR_CONFIG,
  type RepairConfig,
  type RepairAction,
  type RepairResult,
  type RepairPlan,
  type InstanceConnection,
} from "./repair.js";

// SSH Key management
export {
  KeyManager,
  getKeyManager,
  initKeyManager,
  getDefaultKeysDir,
  DEFAULT_KEY_CONFIG,
  type KeyPair,
  type KeyInfo,
  type KeyManagerConfig,
  type KeyRotationResult,
} from "./keys.js";

// State snapshot & rollback
export {
  SnapshotManager,
  getSnapshotManager,
  initSnapshotManager,
  DEFAULT_SNAPSHOT_CONFIG,
  type StateSnapshot,
  type ProcessSnapshot,
  type ConfigFileBackup,
  type ServiceSnapshot,
  type SystemSnapshot,
  type SnapshotConfig,
  type RollbackResult,
} from "./snapshot.js";

// Customer notifications (through companion)
export {
  NotificationManager,
  getNotificationManager,
  tryGetNotificationManager,
  initNotificationManager,
  type NotificationType,
  type NotificationContext,
  type CompanionMessage,
  type NotificationConfig,
} from "./notification.js";
