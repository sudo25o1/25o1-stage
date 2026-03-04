/**
 * 25o1 Agent Lifecycle State Machine
 *
 * Core state machine for agent lifecycle management.
 * Handles state transitions, validation, and persistence.
 */

import { randomBytes } from "node:crypto";
import type {
  AgentIdentity,
  AgentState,
  AgentContext,
  GrowthPhase,
  StateTransition,
  TransitionTrigger,
  NamingThreshold,
  Milestone,
  Pattern,
  HealthStatus,
  RepairTrigger,
} from "../state/types.js";
import { DEFAULT_NAMING_THRESHOLD, GROWTH_PHASE_ORDER } from "../state/types.js";
import { getStateManager } from "../state/store.js";

// =============================================================================
// State Transition Rules
// =============================================================================

interface TransitionRule {
  from: AgentState | AgentState[];
  to: AgentState;
  trigger: TransitionTrigger;
  guard?: (agent: AgentIdentity) => boolean;
  action?: (agent: AgentIdentity) => void;
}

const TRANSITION_RULES: TransitionRule[] = [
  // Hatched -> Learning (first session)
  {
    from: "hatched",
    to: "learning",
    trigger: "session_start",
  },

  // Learning -> Naming Ready (threshold met)
  {
    from: "learning",
    to: "naming_ready",
    trigger: "threshold_met",
    guard: (agent) => checkNamingThreshold(agent),
  },

  // Naming Ready -> Learning (agent says "not yet")
  {
    from: "naming_ready",
    to: "learning",
    trigger: "not_yet",
    action: (agent) => {
      agent.namingDeferrals++;
      // Slightly raise the bar for next time
      agent.namingThreshold.minSessions += 5;
    },
  },

  // Naming Ready -> Named (ceremony complete)
  {
    from: "naming_ready",
    to: "named",
    trigger: "ceremony_complete",
  },

  // Named -> Growing (automatic after naming)
  {
    from: "named",
    to: "growing",
    trigger: "session_start",
    action: (agent) => {
      // Initialize growth state
      agent.growthState = {
        phase: "establishing",
        enteredPhase: new Date(),
        capabilities: [],
        nextPhaseRequirements: [],
      };
    },
  },

  // Growing -> Growing (milestone reached, stays in growing)
  {
    from: "growing",
    to: "growing",
    trigger: "milestone_reached",
  },

  // Growing -> Repairing (relationship needs attention)
  {
    from: "growing",
    to: "repairing",
    trigger: "repair_needed",
  },

  // Repairing -> Growing (repair complete)
  {
    from: "repairing",
    to: "growing",
    trigger: "repair_complete",
  },

  // Growing -> Renaming (identity reconsideration)
  {
    from: "growing",
    to: "renaming",
    trigger: "rename_requested",
  },

  // Renaming -> Growing (rename complete)
  {
    from: "renaming",
    to: "growing",
    trigger: "rename_complete",
  },

  // Growing -> Retiring (relationship winding down)
  {
    from: "growing",
    to: "retiring",
    trigger: "retire_initiated",
  },

  // Retiring -> Archived
  {
    from: "retiring",
    to: "archived",
    trigger: "archive",
  },

  // Retiring -> Dormant
  {
    from: "retiring",
    to: "dormant",
    trigger: "dormant",
  },

  // Retiring -> Rebirth
  {
    from: "retiring",
    to: "rebirth",
    trigger: "rebirth",
  },

  // Dormant -> Growing (reactivation)
  {
    from: "dormant",
    to: "growing",
    trigger: "session_start",
  },

  // Any state -> Corrupted (corruption detected)
  {
    from: [
      "hatched",
      "learning",
      "naming_ready",
      "named",
      "growing",
      "repairing",
      "renaming",
      "retiring",
      "dormant",
    ],
    to: "corrupted",
    trigger: "corruption_detected",
  },

  // Corrupted -> Previous state (recovery)
  {
    from: "corrupted",
    to: "learning", // Default recovery target
    trigger: "recovery_complete",
  },

  // Admin override (can force any transition)
  {
    from: [
      "hatched",
      "learning",
      "naming_ready",
      "named",
      "growing",
      "repairing",
      "renaming",
      "retiring",
      "archived",
      "dormant",
      "corrupted",
      "rebirth",
    ],
    to: "learning", // Placeholder - actual target set by admin
    trigger: "admin_override",
  },
];

// =============================================================================
// Agent Lifecycle Class
// =============================================================================

export class AgentLifecycle {
  private agent: AgentIdentity;
  private transitionHistory: StateTransition[] = [];

  constructor(agent: AgentIdentity) {
    this.agent = agent;
  }

  // ---------------------------------------------------------------------------
  // State Access
  // ---------------------------------------------------------------------------

  getState(): AgentState {
    return this.agent.state;
  }

  getAgent(): AgentIdentity {
    return this.agent;
  }

  getGrowthPhase(): GrowthPhase | undefined {
    return this.agent.growthState?.phase;
  }

  getTransitionHistory(): StateTransition[] {
    return [...this.transitionHistory];
  }

  // ---------------------------------------------------------------------------
  // State Transitions
  // ---------------------------------------------------------------------------

  /**
   * Attempt a state transition.
   * Returns true if transition succeeded, false if not allowed.
   */
  transition(trigger: TransitionTrigger, metadata?: Record<string, unknown>): boolean {
    const rule = this.findTransitionRule(trigger);

    if (!rule) {
      return false;
    }

    // Check guard condition
    if (rule.guard && !rule.guard(this.agent)) {
      return false;
    }

    // Record the transition
    const transition: StateTransition = {
      from: this.agent.state,
      to: rule.to,
      trigger,
      timestamp: new Date(),
      metadata,
    };
    this.transitionHistory.push(transition);

    // Execute action
    if (rule.action) {
      rule.action(this.agent);
    }

    // Update state
    this.agent.state = rule.to;

    return true;
  }

  /**
   * Force a state transition (admin override).
   * Bypasses guards but still records the transition.
   */
  forceTransition(targetState: AgentState, reason: string, adminId: string): StateTransition {
    const transition: StateTransition = {
      from: this.agent.state,
      to: targetState,
      trigger: "admin_override",
      timestamp: new Date(),
      metadata: { reason, adminId },
    };
    this.transitionHistory.push(transition);
    this.agent.state = targetState;
    return transition;
  }

  /**
   * Check if a transition is allowed from current state.
   */
  canTransition(trigger: TransitionTrigger): boolean {
    const rule = this.findTransitionRule(trigger);
    if (!rule) {
      return false;
    }
    if (rule.guard && !rule.guard(this.agent)) {
      return false;
    }
    return true;
  }

  private findTransitionRule(trigger: TransitionTrigger): TransitionRule | undefined {
    return TRANSITION_RULES.find((rule) => {
      const fromStates = Array.isArray(rule.from) ? rule.from : [rule.from];
      return fromStates.includes(this.agent.state) && rule.trigger === trigger;
    });
  }

  // ---------------------------------------------------------------------------
  // Naming
  // ---------------------------------------------------------------------------

  /**
   * Check if agent is ready for naming ceremony.
   */
  isNamingReady(): boolean {
    return checkNamingThreshold(this.agent);
  }

  /**
   * Record a naming attempt.
   */
  recordNamingAttempt(
    proposedName: string,
    reason: string,
    outcome: "accepted" | "rejected_by_agent" | "rejected_by_human" | "validation_failed",
    feedback?: string,
  ): void {
    this.agent.namingAttempts.push({
      date: new Date(),
      proposedName,
      reason,
      outcome,
      humanFeedback: feedback,
    });
  }

  /**
   * Complete the naming ceremony.
   */
  completeCeremony(name: string, reason: string): boolean {
    if (this.agent.state !== "naming_ready") {
      return false;
    }

    this.agent.name = name;
    this.agent.ceremonyDate = new Date();
    this.agent.ceremonyReason = reason;

    // Update the agent ID to match the name
    const oldId = this.agent.id;
    this.agent.id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

    this.transition("ceremony_complete", { oldId, newId: this.agent.id });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Growth
  // ---------------------------------------------------------------------------

  /**
   * Transition to the next growth phase.
   */
  advancePhase(): boolean {
    if (this.agent.state !== "growing" || !this.agent.growthState) {
      return false;
    }

    const currentIndex = GROWTH_PHASE_ORDER.indexOf(this.agent.growthState.phase);
    if (currentIndex >= GROWTH_PHASE_ORDER.length - 1) {
      return false; // Already at highest phase
    }

    const nextPhase = GROWTH_PHASE_ORDER[currentIndex + 1];
    this.agent.growthState.phase = nextPhase;
    this.agent.growthState.enteredPhase = new Date();
    this.agent.growthState.capabilities = [];
    this.agent.growthState.nextPhaseRequirements = [];

    return true;
  }

  /**
   * Regress to the previous growth phase.
   */
  regressPhase(): boolean {
    if (this.agent.state !== "growing" || !this.agent.growthState) {
      return false;
    }

    const currentIndex = GROWTH_PHASE_ORDER.indexOf(this.agent.growthState.phase);
    if (currentIndex <= 0) {
      return false; // Already at lowest phase
    }

    const prevPhase = GROWTH_PHASE_ORDER[currentIndex - 1];
    this.agent.growthState.phase = prevPhase;
    this.agent.growthState.enteredPhase = new Date();

    return true;
  }

  // ---------------------------------------------------------------------------
  // Milestones
  // ---------------------------------------------------------------------------

  /**
   * Record a milestone.
   */
  recordMilestone(milestone: Omit<Milestone, "id" | "date">): Milestone {
    const full: Milestone = {
      ...milestone,
      id: generateId("milestone"),
      date: Date.now(),
    };
    this.agent.milestones.push(full);
    this.transition("milestone_reached", { milestoneId: full.id });
    return full;
  }

  // ---------------------------------------------------------------------------
  // Patterns
  // ---------------------------------------------------------------------------

  /**
   * Record an observed pattern.
   */
  recordPattern(pattern: Omit<Pattern, "id" | "observedAt">): Pattern {
    const full: Pattern = {
      ...pattern,
      id: generateId("pattern"),
      observedAt: new Date(),
    };
    this.agent.relationshipPatterns.push(full);
    return full;
  }

  /**
   * Confirm an existing pattern (increases confidence).
   */
  confirmPattern(patternId: string): boolean {
    const pattern = this.agent.relationshipPatterns.find((p) => p.id === patternId);
    if (!pattern) {
      return false;
    }

    pattern.lastConfirmed = new Date();
    if (pattern.confidence === "low") {
      pattern.confidence = "medium";
    } else if (pattern.confidence === "medium") {
      pattern.confidence = "high";
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Repair
  // ---------------------------------------------------------------------------

  /**
   * Enter repair state.
   */
  enterRepair(trigger: RepairTrigger): boolean {
    if (this.agent.state !== "growing") {
      return false;
    }

    this.agent.repairContext = {
      enteredAt: new Date(),
      trigger,
      previousPhase: this.agent.growthState?.phase,
      repairAttempts: [],
    };

    return this.transition("repair_needed");
  }

  /**
   * Record a repair attempt.
   */
  recordRepairAttempt(
    approach: "acknowledge" | "discuss" | "recalibrate" | "step_back",
    outcome: "improved" | "unchanged" | "worsened",
    notes: string,
  ): void {
    if (!this.agent.repairContext) {
      return;
    }

    this.agent.repairContext.repairAttempts.push({
      date: new Date(),
      approach,
      outcome,
      notes,
    });
  }

  /**
   * Exit repair state.
   */
  exitRepair(resolution: "restored" | "recalibrated" | "regressed" | "ended"): boolean {
    if (this.agent.state !== "repairing" || !this.agent.repairContext) {
      return false;
    }

    this.agent.repairContext.exitedAt = new Date();
    this.agent.repairContext.resolution = resolution;

    if (resolution === "ended") {
      return this.transition("retire_initiated");
    }

    // Handle regression before transitioning back to growing
    if (resolution === "regressed" && this.agent.growthState) {
      const currentIndex = GROWTH_PHASE_ORDER.indexOf(this.agent.growthState.phase);
      if (currentIndex > 0) {
        const prevPhase = GROWTH_PHASE_ORDER[currentIndex - 1];
        this.agent.growthState.phase = prevPhase;
        this.agent.growthState.enteredPhase = new Date();
      }
    }

    return this.transition("repair_complete");
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  /**
   * Update health status.
   */
  updateHealth(status: HealthStatus): void {
    this.agent.healthStatus = status;
    this.agent.lastHealthCheck = new Date();

    if (status.memoryIntegrity === "corrupted" || status.stateConsistency === "inconsistent") {
      this.agent.corruptionReason = status.lastError || "Health check failed";
      this.transition("corruption_detected");
    }
  }

  // ---------------------------------------------------------------------------
  // Session Tracking
  // ---------------------------------------------------------------------------

  /**
   * Record a new session.
   */
  recordSession(): void {
    this.agent.sessions++;
    this.agent.lastActive = new Date();

    // Trigger session_start transition if applicable
    if (this.agent.state === "hatched") {
      this.transition("session_start");
    } else if (this.agent.state === "named") {
      this.transition("session_start");
    } else if (this.agent.state === "dormant") {
      this.transition("session_start");
    }

    // Check if naming threshold is now met
    if (this.agent.state === "learning" && this.isNamingReady()) {
      this.transition("threshold_met");
    }
  }

  /**
   * Record a new memory.
   */
  recordMemory(): void {
    this.agent.memories++;

    // Check if naming threshold is now met
    if (this.agent.state === "learning" && this.isNamingReady()) {
      this.transition("threshold_met");
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new agent identity.
 */
export function createAgent(
  humanId: string,
  context: AgentContext = "personal",
  options?: Partial<{
    namingThreshold: Partial<NamingThreshold>;
    migrationNote: string;
    initialSessions: number;
    initialMemories: number;
  }>,
): AgentIdentity {
  const id = generateAgentId();
  const now = new Date();

  return {
    id,
    state: "hatched",
    created: now,
    context,
    humanId,

    sessions: options?.initialSessions ?? 0,
    memories: options?.initialMemories ?? 0,
    lastActive: now,

    namingThreshold: {
      ...DEFAULT_NAMING_THRESHOLD,
      ...options?.namingThreshold,
    },
    namingAttempts: [],
    namingDeferrals: 0,

    milestones: [],
    relationshipPatterns: [],

    migrationNote: options?.migrationNote,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

export function checkNamingThreshold(agent: AgentIdentity): boolean {
  const threshold = agent.namingThreshold;
  const daysSinceCreation = Math.floor(
    (Date.now() - agent.created.getTime()) / (1000 * 60 * 60 * 24),
  );

  return (
    agent.sessions >= threshold.minSessions &&
    agent.memories >= threshold.minMemories &&
    daysSinceCreation >= threshold.minDays
  );
}

function generateAgentId(): string {
  const bytes = randomBytes(4);
  return `agent-${bytes.toString("hex")}`;
}

function generateId(prefix: string): string {
  const bytes = randomBytes(4);
  return `${prefix}-${bytes.toString("hex")}`;
}