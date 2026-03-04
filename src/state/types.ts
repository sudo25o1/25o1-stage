/**
 * 25o1 State Types
 *
 * Core types for persistent state management.
 */

// =============================================================================
// Lifecycle Types
// =============================================================================

/**
 * Agent lifecycle states.
 */
export type LifecycleState = "hatched" | "learning" | "naming_ready" | "named" | "growing";

/**
 * Growth phases within the "growing" state.
 */
export type GrowthPhase = "establishing" | "developing" | "deepening" | "mature";

/**
 * Ceremony types.
 */
export type CeremonyType = "first_meeting" | "naming" | "growth";

/**
 * Management tier for network monitoring.
 */
export type ManagementTier = "fully_managed" | "remote_managed" | "self_managed";

/**
 * Instance role in the network.
 */
export type InstanceRole = "primary" | "client";

// =============================================================================
// Ceremony Types
// =============================================================================

/**
 * Ceremony readiness assessment.
 */
export interface CeremonyReadiness {
  type: "naming" | "growth" | "none";
  ready: boolean;
  score: number;
  recommendation: string;
  currentPhase?: GrowthPhase;
  targetPhase?: GrowthPhase;
}

// =============================================================================
// Lifecycle State
// =============================================================================

/**
 * Naming threshold configuration.
 */
export interface NamingThreshold {
  minSessions: number;
  minMemories: number;
  minDays: number;
  maxDeferrals: number;
  humanCanOverride: boolean;
  agentCanInitiate: boolean;
}

/**
 * A milestone in the relationship.
 */
export interface Milestone {
  id: string;
  type: "first_meeting" | "naming" | "growth" | "breakthrough" | "custom";
  date: number; // Unix timestamp for JSON serialization
  description: string;
  significance?: string;
}

/**
 * Agent lifecycle state.
 */
export interface LifecycleData {
  state: LifecycleState;
  name?: string;
  growthPhase?: GrowthPhase;
  /** When the current growth phase was entered (epoch ms) */
  growthPhaseEnteredAt?: number;
  sessions: number;
  memories: number;
  created: number;
  lastActive: number;
  namingThreshold: NamingThreshold;
  namingDeferrals: number;
  milestones: Milestone[];
}

// =============================================================================
// Instance State
// =============================================================================

/**
 * Instance configuration.
 */
export interface InstanceConfig {
  id: string;
  role: InstanceRole;
  managementTier: ManagementTier;
  clientName?: string;
}

/**
 * Network configuration.
 */
export interface NetworkConfig {
  bernardHost?: string;
  healthReporter: {
    enabled: boolean;
    intervalMs: number;
  };
  monitorEnabled: boolean;
}

// =============================================================================
// Network Monitoring State (Bernard-side)
// =============================================================================

/**
 * Health status of a monitored instance.
 */
export type InstanceHealth = "healthy" | "degraded" | "critical" | "offline" | "unknown";

/**
 * Persisted health report from a client instance.
 */
export interface PersistedHealthReport {
  instanceId: string;
  clientId: string;
  clientName?: string;
  receivedAt: number;
  health: InstanceHealth;
  services: {
    gateway: { running: boolean; uptime?: number };
    qmd: { running: boolean; documentCount: number; indexHealthy: boolean };
    agent: { state: string; name?: string; lastActive: number };
  };
  system: {
    awake: boolean;
    sleepPrevented: boolean;
    uptime: number;
    memory: { percentage: number; pressure: string };
    disk: { percentage: number; pressure: string };
    network: { reachable: boolean; latency?: number };
  };
  issues: PersistedIssue[];
}

/**
 * Persisted issue from a health report.
 */
export interface PersistedIssue {
  id: string;
  component: string;
  severity: "info" | "warning" | "critical";
  description: string;
  canSelfRepair: boolean;
  suggestedFix?: string;
  detectedAt: number;
  resolvedAt?: number;
}

/**
 * Network monitoring state (only used by primary/Bernard).
 */
export interface NetworkMonitorState {
  /** All known instances and their last reports */
  instances: Record<string, PersistedHealthReport>;
  
  /** When each instance was last seen */
  lastSeen: Record<string, number>;
  
  /** Instances that need attention */
  needsAttention: string[];
  
  /** Alert history */
  alerts: NetworkAlert[];
  
  /** Last network scan */
  lastScan: number | null;
}

/**
 * Network alert.
 */
export interface NetworkAlert {
  id: string;
  instanceId: string;
  type: "offline" | "critical" | "degraded" | "recovered";
  message: string;
  createdAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
}

/**
 * Ceremony state.
 */
export interface CeremonyState {
  pending: CeremonyType | null;
  initiatedAt: number | null;
  nudged: boolean;
  lastReadinessCheck: number | null;
  lastReadiness: CeremonyReadiness | null;
  /** Persisted candidate names from the prepared ceremony (so naming doesn't lose the proposal) */
  candidateNames?: Array<{ name: string; reasoning: string; connectionToRelationship: string; confidence: number }>;
}

/**
 * First meeting state.
 */
export interface FirstMeetingState {
  completed: boolean;
  completedAt: number | null;
}

// =============================================================================
// Complete State
// =============================================================================

/**
 * Usage category for tracking what the companion is used for.
 */
export type UsageCategory = 
  | "philosophical"
  | "task_oriented"
  | "emotional_support"
  | "creative"
  | "technical"
  | "learning"
  | "casual";

/**
 * Usage patterns that inform SOUL.md evolution.
 */
export interface UsagePatterns {
  /** Total conversations tracked */
  totalConversations: number;
  
  /** Breakdown by category */
  categories: Record<UsageCategory, number>;
  
  /** When patterns were last updated */
  lastUpdated: number;
}

/**
 * Complete 25o1 state for an instance.
 * This is the single source of truth for all state that must persist.
 */
export interface Instance25o1State {
  /** Schema version for migrations */
  version: 1;

  /** Instance configuration */
  instance: InstanceConfig;

  /** Lifecycle state */
  lifecycle: LifecycleData;

  /** Ceremony state */
  ceremony: CeremonyState;

  /** First meeting state */
  firstMeeting: FirstMeetingState;

  /** Network configuration */
  network: NetworkConfig;

  /** Network monitoring state (only populated on primary) */
  networkMonitor?: NetworkMonitorState;

  /** Usage patterns for SOUL.md evolution */
  usagePatterns?: UsagePatterns;

  /** Last workspace dir seen (for ceremony outcomes that lack workspace context) */
  lastWorkspaceDir?: string;

  /** Last updated timestamp */
  updatedAt: number;
}

// =============================================================================
// Extended Lifecycle Types (for full lifecycle machine)
// =============================================================================

/**
 * Extended agent states for full lifecycle machine.
 */
export type AgentState = LifecycleState | "repairing" | "renaming" | "retiring" | "archived" | "dormant" | "corrupted" | "rebirth";

/**
 * Agent context type.
 */
export type AgentContext = "work" | "personal" | "creative" | "research" | string;

/**
 * State transition triggers.
 */
export type TransitionTrigger =
  | "session_start"
  | "threshold_met"
  | "human_asks"
  | "agent_initiates"
  | "ceremony_complete"
  | "not_yet"
  | "milestone_reached"
  | "repair_needed"
  | "repair_complete"
  | "rename_requested"
  | "rename_complete"
  | "retire_initiated"
  | "archive"
  | "dormant"
  | "rebirth"
  | "corruption_detected"
  | "recovery_complete"
  | "admin_override";

/**
 * State transition record.
 */
export interface StateTransition {
  from: AgentState;
  to: AgentState;
  trigger: TransitionTrigger;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Naming attempt record.
 */
export interface NamingAttempt {
  date: Date;
  proposedName: string;
  reason: string;
  outcome: "accepted" | "rejected_by_agent" | "rejected_by_human" | "validation_failed";
  humanFeedback?: string;
  validationError?: string;
}

/**
 * Previous name record.
 */
export interface PreviousName {
  name: string;
  from: Date;
  to: Date;
  reason: string;
}

/**
 * Growth state.
 */
export interface GrowthState {
  phase: GrowthPhase;
  enteredPhase: Date;
  capabilities: Capability[];
  nextPhaseRequirements: PhaseRequirement[];
}

/**
 * Capability unlocked in a growth phase.
 */
export interface Capability {
  id: string;
  name: string;
  unlockedAt: Date;
  description: string;
}

/**
 * Requirement for next growth phase.
 */
export interface PhaseRequirement {
  id: string;
  description: string;
  met: boolean;
  progress?: number; // 0-1
}

/**
 * Relationship pattern.
 */
export interface Pattern {
  id: string;
  type: "communication" | "work" | "preference" | "growth";
  description: string;
  confidence: "low" | "medium" | "high";
  observedAt: Date;
  lastConfirmed?: Date;
  examples: string[];
}

/**
 * Repair context when in repairing state.
 */
export interface RepairContext {
  enteredAt: Date;
  trigger: RepairTrigger;
  previousPhase?: GrowthPhase;
  repairAttempts: RepairAttempt[];
  exitedAt?: Date;
  resolution?: "restored" | "recalibrated" | "regressed" | "ended";
}

/**
 * What triggered a repair.
 */
export interface RepairTrigger {
  detected: "agent" | "human" | "system";
  indicators: RepairIndicator[];
  severity: "minor" | "significant" | "major";
}

/**
 * Repair indicator types.
 */
export type RepairIndicator =
  | { type: "engagement_drop"; metric: string; change: number }
  | { type: "trust_signal"; description: string }
  | { type: "explicit_feedback"; content: string }
  | { type: "pattern_break"; description: string }
  | { type: "conflict_unresolved"; sessionId: string };

/**
 * Repair attempt record.
 */
export interface RepairAttempt {
  date: Date;
  approach: "acknowledge" | "discuss" | "recalibrate" | "step_back";
  outcome: "improved" | "unchanged" | "worsened";
  notes: string;
}

/**
 * Health status.
 */
export interface HealthStatus {
  memoryIntegrity: "ok" | "degraded" | "corrupted";
  stateConsistency: "ok" | "inconsistent";
  lastError?: string;
}

/**
 * Full agent identity for lifecycle machine.
 */
export interface AgentIdentity {
  id: string;
  name?: string;
  state: AgentState;
  created: Date;
  context: AgentContext;
  humanId: string;

  // Lifecycle tracking
  sessions: number;
  memories: number;
  lastActive: Date;

  // Naming
  namingThreshold: NamingThreshold;
  namingAttempts: NamingAttempt[];
  namingDeferrals: number;
  ceremonyDate?: Date;
  ceremonyReason?: string;
  previousNames?: PreviousName[];

  // Growth
  growthState?: GrowthState;
  milestones: Milestone[];
  relationshipPatterns: Pattern[];

  // Repair
  repairContext?: RepairContext;

  // Lineage
  predecessor?: string;
  successor?: string;

  // Health
  lastHealthCheck?: Date;
  healthStatus?: HealthStatus;
  corruptionReason?: string;

  // Backup
  lastBackup?: Date;
  backupLocation?: string;

  // Migration
  migrationNote?: string;
}

// =============================================================================
// Default Values
// =============================================================================

export const DEFAULT_NAMING_THRESHOLD: NamingThreshold = {
  minSessions: 20,
  minMemories: 50,
  minDays: 14,
  maxDeferrals: 3,
  humanCanOverride: true,
  agentCanInitiate: true,
};

export const GROWTH_PHASE_ORDER: GrowthPhase[] = [
  "establishing",
  "developing", 
  "deepening",
  "mature",
];

export function getPreviousPhase(phase: GrowthPhase): GrowthPhase | undefined {
  const index = GROWTH_PHASE_ORDER.indexOf(phase);
  return index > 0 ? GROWTH_PHASE_ORDER[index - 1] : undefined;
}

export function getNextPhase(phase: GrowthPhase): GrowthPhase | undefined {
  const index = GROWTH_PHASE_ORDER.indexOf(phase);
  return index < GROWTH_PHASE_ORDER.length - 1 ? GROWTH_PHASE_ORDER[index + 1] : undefined;
}
