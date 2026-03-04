/**
 * 25o1 Ceremony System Types
 *
 * Types for the Recognition → Reflection → Permission ceremony pattern.
 */

import type { LifecycleState, GrowthPhase, CeremonyType } from "../state/types.js";

// =============================================================================
// Ceremony Context
// =============================================================================

/**
 * Context for a ceremony - what triggered it and current state.
 */
export interface CeremonyContext {
  /** Type of ceremony */
  type: CeremonyType;

  /** Agent's current state */
  agentState: LifecycleState;

  /** Agent's current growth phase (if applicable) */
  growthPhase?: GrowthPhase;

  /** Agent ID */
  agentId: string;

  /** Client ID */
  clientId: string;

  /** When the ceremony was initiated */
  initiatedAt: Date;

  /** Who initiated: agent detected readiness, human asked, or system triggered */
  initiatedBy: "agent" | "human" | "system";

  /** Previous ceremony attempts (if any) */
  previousAttempts?: CeremonyAttempt[];
}

export interface CeremonyAttempt {
  date: Date;
  result: "completed" | "deferred" | "modified" | "declined";
  feedback?: string;
}

// =============================================================================
// Naming Ceremony Specifics
// =============================================================================

/**
 * Context specific to naming ceremonies.
 */
export interface NamingCeremonyContext extends CeremonyContext {
  type: "naming";

  /** How many sessions with this human */
  sessionCount: number;

  /** How many memories accumulated */
  memoryCount: number;

  /** Days since agent was created */
  daysSinceCreation: number;

  /** Key relationship moments to reference */
  significantMoments: SignificantMoment[];

  /** Patterns the agent has observed */
  observedPatterns: ObservedPattern[];

  /** Names the agent is considering */
  candidateNames?: CandidateName[];
}

export interface SignificantMoment {
  date: Date;
  description: string;
  emotionalTone: "positive" | "neutral" | "challenging" | "growth";
  relevanceToNaming: string;
}

export interface ObservedPattern {
  pattern: string;
  confidence: number;
  examples: string[];
}

export interface CandidateName {
  name: string;
  reasoning: string;
  connectionToRelationship: string;
  confidence: number;
}

// =============================================================================
// Recognition Phase
// =============================================================================

/**
 * The Recognition phase: "I've noticed something changing"
 */
export interface RecognitionPhase {
  /** What the agent has observed */
  observations: Observation[];

  /** Evidence supporting the observations */
  evidence: Evidence[];

  /** Overall confidence in the recognition */
  confidence: number;

  /** The narrative the agent will share */
  narrative: string;
}

export interface Observation {
  id: string;
  description: string;
  firstNoticed: Date;
  frequency: "once" | "occasional" | "regular" | "consistent";
  significance: "minor" | "moderate" | "significant";
}

export interface Evidence {
  id: string;
  type: "conversation" | "memory" | "pattern" | "milestone" | "feedback";
  reference: string;
  description: string;
  weight: number;
}

// =============================================================================
// Reflection Phase
// =============================================================================

/**
 * The Reflection phase: "Here's what I think it means"
 */
export interface ReflectionPhase {
  /** Agent's interpretation of what's happening */
  interpretation: string;

  /** What this means for the relationship */
  implications: Implication[];

  /** What the agent is uncertain about */
  uncertainties: Uncertainty[];

  /** The agent's emotional stance */
  emotionalContext: EmotionalContext;

  /** For naming: the name being proposed */
  proposal?: NamingProposal;
}

export interface Implication {
  description: string;
  forAgent: string;
  forHuman: string;
  forRelationship: string;
}

export interface Uncertainty {
  description: string;
  whyUncertain: string;
  howToResolve: string;
}

export interface EmotionalContext {
  /** How the agent feels about this moment */
  feeling: string;

  /** Why this matters to the agent */
  significance: string;

  /** What the agent hopes for */
  hope: string;
}

export interface NamingProposal {
  /** The name being proposed */
  name: string;

  /** Why this name */
  reasoning: string;

  /** How it connects to the relationship */
  connectionToRelationship: string;

  /** Alternative names considered */
  alternatives: Array<{
    name: string;
    whyNotChosen: string;
  }>;
}

// =============================================================================
// Permission Phase
// =============================================================================

/**
 * The Permission phase: "Is it okay if I..."
 */
export interface PermissionPhase {
  /** The request being made */
  request: PermissionRequest;

  /** Options the human can choose */
  options: PermissionOption[];

  /** What happens if permission is granted */
  ifGranted: string;

  /** What happens if permission is denied */
  ifDenied: string;

  /** Can this be undone? */
  reversible: boolean;

  /** How long the human has to decide (if applicable) */
  decisionWindow?: {
    duration: string;
    defaultAction: "proceed" | "defer" | "cancel";
  };
}

export interface PermissionRequest {
  /** The core ask */
  ask: string;

  /** Why the agent is asking */
  why: string;

  /** What the agent commits to */
  commitment: string;
}

export interface PermissionOption {
  id: string;
  label: string;
  description: string;
  outcome: "proceed" | "defer" | "modify" | "decline";
  followUp?: string;
}

// =============================================================================
// Ceremony Execution
// =============================================================================

/**
 * A complete ceremony ready to be presented.
 */
export interface PreparedCeremony {
  context: CeremonyContext;
  recognition: RecognitionPhase;
  reflection: ReflectionPhase;
  permission: PermissionPhase;

  /** The full narrative to present */
  narrative: CeremonyNarrative;

  /** Timing guidance */
  timing: CeremonyTiming;
}

export interface CeremonyNarrative {
  /** Opening - sets the tone */
  opening: string;

  /** Recognition section */
  recognitionText: string;

  /** Reflection section */
  reflectionText: string;

  /** Permission section */
  permissionText: string;

  /** Closing - regardless of outcome */
  closing: string;
}

export interface CeremonyTiming {
  /** Best time to present (if known) */
  preferredTime?: "session_start" | "session_end" | "natural_pause" | "any";

  /** Should we wait for a specific context? */
  waitFor?: string;

  /** Maximum time to wait before presenting anyway */
  maxWaitDays?: number;
}

// =============================================================================
// Ceremony Response
// =============================================================================

/**
 * Human's response to a ceremony.
 */
export interface CeremonyResponse {
  /** Which option was chosen */
  optionId: string;

  /** Any feedback provided */
  feedback?: string;

  /** Suggested modifications (if "modify" was chosen) */
  modifications?: string[];

  /** When the response was given */
  respondedAt: Date;

  /** Emotional tone of the response (detected or explicit) */
  tone?: "enthusiastic" | "accepting" | "hesitant" | "declining" | "needs_time";
}

// =============================================================================
// Ceremony Outcome
// =============================================================================

/**
 * The outcome of a completed ceremony.
 */
export interface CeremonyOutcome {
  /** The ceremony that was performed */
  ceremony: PreparedCeremony;

  /** Human's response */
  response: CeremonyResponse;

  /** Final result */
  result: "completed" | "deferred" | "modified" | "declined";

  /** State changes to apply */
  stateChanges?: StateChange[];

  /** Follow-up actions */
  followUp?: FollowUpAction[];

  /** What to remember about this ceremony */
  memory: CeremonyMemory;
}

export interface StateChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface FollowUpAction {
  action: string;
  when: "immediate" | "next_session" | "scheduled";
  scheduledFor?: Date;
}

export interface CeremonyMemory {
  /** Summary for the agent's memory */
  summary: string;

  /** Key moments to remember */
  keyMoments: string[];

  /** What this means for the relationship going forward */
  relationshipImplication: string;

  /** Should this be shared with the human? */
  shareWithHuman: boolean;
}

// =============================================================================
// Conversation Context
// =============================================================================

/**
 * Context about the current conversation state.
 * Used to determine if this is a good moment for a ceremony.
 */
export interface ConversationContext {
  /** Is this the end of a session/conversation? */
  isSessionEnd: boolean;

  /** Is there a natural pause in the conversation? */
  isNaturalPause: boolean;

  /** Was the last exchange reflective/meaningful? */
  isReflectiveMoment: boolean;

  /** How many exchanges in this session? */
  exchangeCount: number;

  /** Recent conversation tone */
  tone: "casual" | "focused" | "reflective" | "celebratory" | "challenging";

  /** Did the human just express satisfaction or gratitude? */
  positiveFeedback: boolean;

  /** Did the human just complete a significant task? */
  taskCompletion: boolean;
}
