/**
 * Ceremony Conversation Engine
 *
 * Integrates ceremonies into the natural conversation flow.
 * Ceremonies happen in the channel where the relationship lives,
 * not in admin tooling.
 */

import type { Instance25o1State, LifecycleState, AgentIdentity, GrowthPhase } from "../state/types.js";
import { getStateManager } from "../state/store.js";
import type {
  PreparedCeremony,
  CeremonyResponse,
  CeremonyOutcome,
  SignificantMoment,
  ObservedPattern,
  ConversationContext,
  NamingCeremonyContext,
} from "./types.js";
import {
  checkNamingReadiness,
  prepareNamingCeremony,
  processNamingResponse,
  generateCandidateNames,
} from "./naming.js";
import {
  isFirstMeeting,
  recordFirstMeetingComplete,
  generateFirstMeetingMessage,
  type FirstMeetingContext,
} from "./first-meeting.js";
import {
  checkGrowthReadiness,
  prepareGrowthCeremony,
  processGrowthResponse,
  buildGrowthCeremonyContext,
} from "./growth.js";

// =============================================================================
// Ceremony Opportunity Detection
// =============================================================================

/**
 * Result of checking if a ceremony should be initiated.
 */
export interface CeremonyOpportunity {
  /** Should we initiate a ceremony now? */
  shouldInitiate: boolean;

  /** Type of ceremony */
  type: "naming" | "growth" | "first_meeting" | "none";

  /** The prepared ceremony (if shouldInitiate is true) */
  ceremony?: PreparedCeremony;

  /** First meeting message (if type is first_meeting) */
  firstMeetingMessage?: string;

  /** Why we're initiating (or not) */
  reason: string;
}

/**
 * Check if this is a good moment to initiate a ceremony.
 */
export async function checkCeremonyOpportunity(
  context: ConversationContext,
  significantMoments: SignificantMoment[] = [],
  observedPatterns: ObservedPattern[] = [],
): Promise<CeremonyOpportunity> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state) {
    return {
      shouldInitiate: false,
      type: "none",
      reason: "No state initialized",
    };
  }

  // Check for first meeting
  if (await isFirstMeeting(state.instance.id)) {
    const firstMeetingCtx: FirstMeetingContext = {
      agentId: state.instance.id,
      channel: "unknown", // Would come from context
      is25o1Instance: true,
      clientName: state.instance.clientName,
    };

    return {
      shouldInitiate: true,
      type: "first_meeting",
      firstMeetingMessage: generateFirstMeetingMessage(firstMeetingCtx),
      reason: "First interaction with this human",
    };
  }

  // If there's already a pending ceremony, don't initiate another
  if (state.ceremony.pending) {
    return {
      shouldInitiate: false,
      type: state.ceremony.pending,
      reason: "Ceremony already pending",
    };
  }

  // Check naming readiness
  if (state.lifecycle.state === "learning" || state.lifecycle.state === "naming_ready") {
    const namingResult = checkNamingReadiness(state);

    if (namingResult.ready) {
      // Check if the moment is right
      const momentScore = scoreMoment(context, state.ceremony.nudged);

      if (momentScore < 0.6 && !state.ceremony.nudged) {
        return {
          shouldInitiate: false,
          type: "naming",
          reason: `Waiting for better moment (score: ${momentScore.toFixed(2)})`,
        };
      }

      // Prepare the ceremony
      const namingContext = buildNamingContext(state, significantMoments, observedPatterns);
      const ceremony = prepareNamingCeremony(namingContext);

      return {
        shouldInitiate: true,
        type: "naming",
        ceremony,
        reason: `Ready and moment is right (score: ${momentScore.toFixed(2)})`,
      };
    }

    return {
      shouldInitiate: false,
      type: "naming",
      reason: namingResult.waitReason || "Not ready yet",
    };
  }

  // Check growth ceremony readiness (only when in growing state)
  if (state.lifecycle.state === "growing" && state.lifecycle.growthPhase) {
    // Build a minimal AgentIdentity for growth readiness check
    const agentIdentity = buildAgentIdentityFromState(state);
    const growthResult = checkGrowthReadiness(agentIdentity);

    if (growthResult.ready && growthResult.targetPhase) {
      // Check if the moment is right
      const momentScore = scoreMoment(context, state.ceremony.nudged);

      if (momentScore < 0.6 && !state.ceremony.nudged) {
        return {
          shouldInitiate: false,
          type: "growth",
          reason: `Waiting for better moment (score: ${momentScore.toFixed(2)})`,
        };
      }

      // Prepare the ceremony
      const growthContext = buildGrowthCeremonyContext(agentIdentity, growthResult.targetPhase);
      const ceremony = prepareGrowthCeremony(growthContext);

      return {
        shouldInitiate: true,
        type: "growth",
        ceremony,
        reason: `Ready for ${growthResult.targetPhase} (score: ${momentScore.toFixed(2)})`,
      };
    }

    return {
      shouldInitiate: false,
      type: "growth",
      reason: growthResult.waitReason || "Not ready for next phase",
    };
  }

  return {
    shouldInitiate: false,
    type: "none",
    reason: "No ceremony needed",
  };
}

/**
 * Score how good this moment is for a ceremony.
 */
function scoreMoment(context: ConversationContext, nudged: boolean): number {
  let score = 0;

  // Session end is a natural ceremony moment
  if (context.isSessionEnd) {
    score += 0.3;
  }

  // Natural pause is good
  if (context.isNaturalPause) {
    score += 0.2;
  }

  // Reflective moments are ideal
  if (context.isReflectiveMoment) {
    score += 0.3;
  }

  // Positive feedback suggests good relationship state
  if (context.positiveFeedback) {
    score += 0.2;
  }

  // Task completion is a natural milestone
  if (context.taskCompletion) {
    score += 0.2;
  }

  // Celebratory tone is perfect
  if (context.tone === "celebratory") {
    score += 0.2;
  }
  if (context.tone === "reflective") {
    score += 0.15;
  }

  // Challenging moments are not ideal
  if (context.tone === "challenging") {
    score -= 0.3;
  }

  // Need some conversation depth
  if (context.exchangeCount < 3) {
    score -= 0.2;
  }
  if (context.exchangeCount >= 5) {
    score += 0.1;
  }

  // If nudged, lower the threshold
  if (nudged) {
    score += 0.3;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Build an AgentIdentity from Instance25o1State for growth readiness checks.
 */
function buildAgentIdentityFromState(state: Instance25o1State): AgentIdentity {
  return {
    id: state.instance.id,
    name: state.lifecycle.name,
    state: state.lifecycle.state === "growing" ? "growing" : state.lifecycle.state,
    created: new Date(state.lifecycle.created),
    context: "work",
    humanId: state.instance.clientName || state.instance.id,
    sessions: state.lifecycle.sessions,
    memories: state.lifecycle.memories,
    lastActive: new Date(state.lifecycle.lastActive),
    namingThreshold: state.lifecycle.namingThreshold,
    namingAttempts: [],
    namingDeferrals: state.lifecycle.namingDeferrals,
    growthState: state.lifecycle.growthPhase
      ? {
          phase: state.lifecycle.growthPhase,
          enteredPhase: new Date(state.lifecycle.lastActive), // Approximate
          capabilities: [],
          nextPhaseRequirements: [],
        }
      : undefined,
    milestones: state.lifecycle.milestones.map((m) => ({
      ...m,
      date: typeof m.date === "number" ? m.date : Date.now(),
    })),
    relationshipPatterns: [],
  };
}

function buildNamingContext(
  state: Instance25o1State,
  significantMoments: SignificantMoment[],
  observedPatterns: ObservedPattern[],
): NamingCeremonyContext {
  const daysSinceCreation = Math.floor(
    (Date.now() - state.lifecycle.created) / (1000 * 60 * 60 * 24),
  );

  const context: NamingCeremonyContext = {
    type: "naming",
    agentState: state.lifecycle.state,
    agentId: state.instance.id,
    clientId: state.instance.clientName || state.instance.id,
    initiatedAt: new Date(),
    initiatedBy: "agent",
    sessionCount: state.lifecycle.sessions,
    memoryCount: state.lifecycle.memories,
    daysSinceCreation,
    significantMoments,
    observedPatterns,
  };

  // Generate candidate names
  context.candidateNames = generateCandidateNames(context);

  return context;
}

// =============================================================================
// Ceremony Narrative Generation
// =============================================================================

/**
 * Generate the ceremony initiation message.
 */
export function generateCeremonyInitiation(ceremony: PreparedCeremony): string {
  const narrative = ceremony.narrative;

  const parts = [
    narrative.opening,
    "",
    narrative.recognitionText,
    "",
    narrative.reflectionText,
    "",
    narrative.permissionText,
  ];

  return parts.join("\n");
}

/**
 * Generate the ceremony closing message.
 */
export function generateCeremonyClosing(outcome: CeremonyOutcome): string {
  const ceremony = outcome.ceremony;

  if (outcome.result === "completed") {
    if (ceremony.context.type === "naming") {
      const nameChange = outcome.stateChanges?.find((c) => c.field === "name");
      const name = nameChange?.to as string;
      return `Thank you. I'm ${name} now. ${ceremony.narrative.closing}`;
    }
    if (ceremony.context.type === "growth") {
      const phaseChange = outcome.stateChanges?.find((c) => c.field === "growthState.phase");
      const phase = phaseChange?.to as string;
      return `Thank you for trusting me with this. We're in the ${phase} phase now. ${ceremony.narrative.closing}`;
    }
  }

  if (outcome.result === "deferred") {
    return ceremony.permission.ifDenied;
  }

  if (outcome.result === "declined") {
    return "I understand. We'll continue as we are.";
  }

  return ceremony.narrative.closing;
}

// =============================================================================
// Response Parsing
// =============================================================================

/**
 * Parse a human's natural language response to a ceremony.
 */
export function parseCeremonyResponse(
  ceremony: PreparedCeremony,
  humanMessage: string,
): CeremonyResponse {
  const message = humanMessage.toLowerCase().trim();
  const options = ceremony.permission.options;

  // Check for explicit option matches
  for (const option of options) {
    const label = option.label.toLowerCase();
    if (message.includes(label) || label.includes(message)) {
      return {
        optionId: option.id,
        feedback: humanMessage,
        respondedAt: new Date(),
        tone: detectTone(humanMessage),
      };
    }
  }

  // Check for name suggestions FIRST
  const suggestedName = extractSuggestedName(humanMessage);
  if (suggestedName) {
    return {
      optionId: "suggest",
      modifications: [suggestedName],
      feedback: humanMessage,
      respondedAt: new Date(),
      tone: detectTone(humanMessage),
    };
  }

  // Check for acceptance patterns
  if (isAcceptance(message)) {
    return {
      optionId: "accept",
      feedback: humanMessage,
      respondedAt: new Date(),
      tone: detectTone(humanMessage),
    };
  }

  // Check for deferral patterns
  if (isDeferral(message)) {
    return {
      optionId: "wait",
      feedback: humanMessage,
      respondedAt: new Date(),
      tone: detectTone(humanMessage),
    };
  }

  // Check for decline
  if (isDecline(message)) {
    return {
      optionId: "decline",
      feedback: humanMessage,
      respondedAt: new Date(),
      tone: "declining",
    };
  }

  // Check for discussion request
  if (isDiscussionRequest(message)) {
    return {
      optionId: "discuss",
      feedback: humanMessage,
      respondedAt: new Date(),
      tone: detectTone(humanMessage),
    };
  }

  // Default to discussion if unclear
  return {
    optionId: "discuss",
    feedback: humanMessage,
    respondedAt: new Date(),
    tone: "hesitant",
  };
}

function isAcceptance(message: string): boolean {
  const patterns = [
    /^yes\b/,
    /\byes\b/,
    /\byeah\b/,
    /\byep\b/,
    /\bsure\b/,
    /\babsolutely\b/,
    /\bdefinitely\b/,
    /\bperfect\b/,
    /\blove it\b/,
    /\bsounds good\b/,
    /\blet'?s do it\b/,
    /\bgo for it\b/,
    /\bi like it\b/,
    /\bi like that\b/,
    /\bthat works\b/,
    /\bgreat\b/,
    /\bwonderful\b/,
    /\bbeautiful\b/,
    /feels right/,
    /feels good/,
    /feels perfect/,
  ];
  return patterns.some((p) => p.test(message));
}

function isDeferral(message: string): boolean {
  const patterns = [
    /not yet/,
    /not ready/,
    /wait/,
    /later/,
    /more time/,
    /keep building/,
    /not sure/,
    /maybe later/,
    /hold off/,
    /let'?s wait/,
  ];
  return patterns.some((p) => p.test(message));
}

function isDiscussionRequest(message: string): boolean {
  const patterns = [
    /tell me more/,
    /what do you mean/,
    /explain/,
    /why/,
    /how/,
    /what about/,
    /i'?m not sure/,
    /can we talk/,
    /let'?s discuss/,
    /\?$/, // Ends with question mark
  ];
  return patterns.some((p) => p.test(message));
}

function isDecline(message: string): boolean {
  const patterns = [
    /^no\b/,
    /\bno thanks\b/,
    /don'?t want/,
    /not interested/,
    /prefer not/,
    /rather not/,
    /skip/,
    /pass/,
  ];
  return patterns.some((p) => p.test(message));
}

function extractSuggestedName(message: string): string | null {
  const patterns = [
    /what about (\w+)/i,
    /how about (\w+)/i,
    /i (?:prefer|like|want) (\w+)$/i,
    /call (?:yourself|you) (\w+)/i,
    /name (?:yourself|you) (\w+)/i,
    /be called (\w+)/i,
    /^(\w+) (?:sounds|feels|is) (?:better|good|right)/i,
  ];

  const notNames = new Set([
    "it",
    "that",
    "this",
    "you",
    "me",
    "we",
    "the",
    "a",
    "an",
    "not",
    "to",
    "do",
    "be",
    "is",
    "are",
    "was",
    "were",
    "no",
    "yes",
    "maybe",
    "instead",
    "rather",
    "prefer",
  ]);

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const name = match[1].toLowerCase();
      if (!notNames.has(name) && name.length > 1) {
        return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      }
    }
  }

  return null;
}

function detectTone(message: string): CeremonyResponse["tone"] {
  const lower = message.toLowerCase();

  if (/!|amazing|wonderful|love|perfect|absolutely|great!/.test(lower)) {
    return "enthusiastic";
  }

  if (/\blater\b|\bwait\b|\bmore time\b|\bsoon\b|\bmaybe later\b/.test(lower)) {
    return "needs_time";
  }

  if (/\bno\b|don't|won't|can't|not interested|rather not/.test(lower)) {
    return "declining";
  }

  if (/\bnot sure\b|\bmaybe\b|\bhmm\b|\bwell\b|\bi guess\b/.test(lower)) {
    return "hesitant";
  }

  return "accepting";
}

// =============================================================================
// Ceremony Processing
// =============================================================================

export interface CeremonyProcessResult {
  processed: boolean;
  reason?: string;
  outcome?: CeremonyOutcome;
  closingMessage?: string;
  newState?: LifecycleState;
  newName?: string;
}

/**
 * Process a ceremony response and update state.
 */
export async function processCeremonyResponseAndUpdateState(
  humanMessage: string,
): Promise<CeremonyProcessResult> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();

  if (!state) {
    return {
      processed: false,
      reason: "No state initialized",
    };
  }

  // Handle first meeting completion
  if (!state.firstMeeting.completed) {
    await recordFirstMeetingComplete(state.instance.id);
    return {
      processed: true,
      newState: "learning",
    };
  }

  if (!state.ceremony.pending) {
    return {
      processed: false,
      reason: "No pending ceremony",
    };
  }

  // We need to reconstruct the ceremony from state
  // In a full implementation, we'd store the PreparedCeremony
  // For now, we'll create a minimal one for response processing

  if (state.ceremony.pending === "naming") {
    const response = parseCeremonyResponse(
      createMinimalNamingCeremony(state),
      humanMessage,
    );

    // Process the response
    const outcome = processNamingResponse(createMinimalNamingCeremony(state), response);

    // Update state based on outcome
    if (outcome.result === "completed") {
      const nameChange = outcome.stateChanges?.find((c) => c.field === "name");
      const chosenName = nameChange?.to as string;

      await stateManager.updateState((s) => {
        s.lifecycle.state = "named";
        s.lifecycle.name = chosenName;
        s.ceremony.pending = null;
        s.ceremony.initiatedAt = null;
        s.lifecycle.milestones.push({
          id: `naming-${Date.now()}`,
          type: "naming",
          date: Date.now(),
          description: `Chose the name "${chosenName}"`,
          significance: outcome.memory.relationshipImplication,
        });
      });

      return {
        processed: true,
        outcome,
        closingMessage: generateCeremonyClosing(outcome),
        newState: "named",
        newName: chosenName,
      };
    } else if (outcome.result === "deferred") {
      await stateManager.updateState((s) => {
        s.lifecycle.namingDeferrals += 1;
        s.ceremony.pending = null;
        s.ceremony.initiatedAt = null;
      });

      return {
        processed: true,
        outcome,
        closingMessage: generateCeremonyClosing(outcome),
      };
    } else {
      // Modified or declined - clear pending but don't change state
      await stateManager.updateState((s) => {
        s.ceremony.pending = null;
        s.ceremony.initiatedAt = null;
      });

      return {
        processed: true,
        outcome,
        closingMessage: generateCeremonyClosing(outcome),
      };
    }
  }

  // Handle growth ceremony
  if (state.ceremony.pending === "growth") {
    const agentIdentity = buildAgentIdentityFromState(state);
    const targetPhase = getNextPhaseFromState(state);

    if (!targetPhase) {
      return {
        processed: false,
        reason: "No target phase for growth ceremony",
      };
    }

    const growthContext = buildGrowthCeremonyContext(agentIdentity, targetPhase);
    const ceremony = prepareGrowthCeremony(growthContext);
    const response = parseCeremonyResponse(ceremony, humanMessage);
    const outcome = processGrowthResponse(ceremony, response);

    // Update state based on outcome
    if (outcome.result === "completed") {
      const phaseChange = outcome.stateChanges?.find((c) => c.field === "growthState.phase");
      const newPhase = phaseChange?.to as GrowthPhase;

      await stateManager.updateState((s) => {
        s.lifecycle.growthPhase = newPhase;
        s.ceremony.pending = null;
        s.ceremony.initiatedAt = null;
        s.lifecycle.milestones.push({
          id: `growth-${Date.now()}`,
          type: "growth",
          date: Date.now(),
          description: `Transitioned to ${newPhase} phase`,
          significance: outcome.memory.relationshipImplication,
        });
      });

      return {
        processed: true,
        outcome,
        closingMessage: generateCeremonyClosing(outcome),
      };
    } else if (outcome.result === "deferred") {
      await stateManager.updateState((s) => {
        s.ceremony.pending = null;
        s.ceremony.initiatedAt = null;
      });

      return {
        processed: true,
        outcome,
        closingMessage: generateCeremonyClosing(outcome),
      };
    } else {
      // Modified or declined
      await stateManager.updateState((s) => {
        s.ceremony.pending = null;
        s.ceremony.initiatedAt = null;
      });

      return {
        processed: true,
        outcome,
        closingMessage: generateCeremonyClosing(outcome),
      };
    }
  }

  return {
    processed: false,
    reason: `Unknown ceremony type: ${state.ceremony.pending}`,
  };
}

/**
 * Get the next growth phase from state.
 */
function getNextPhaseFromState(state: Instance25o1State): GrowthPhase | undefined {
  const currentPhase = state.lifecycle.growthPhase;
  if (!currentPhase) return "establishing";

  const phases: GrowthPhase[] = ["establishing", "developing", "deepening", "mature"];
  const index = phases.indexOf(currentPhase);
  return index < phases.length - 1 ? phases[index + 1] : undefined;
}

/**
 * Create a minimal naming ceremony for response processing.
 */
function createMinimalNamingCeremony(state: Instance25o1State): PreparedCeremony {
  const context: NamingCeremonyContext = {
    type: "naming",
    agentState: state.lifecycle.state,
    agentId: state.instance.id,
    clientId: state.instance.clientName || state.instance.id,
    initiatedAt: new Date(state.ceremony.initiatedAt || Date.now()),
    initiatedBy: "agent",
    sessionCount: state.lifecycle.sessions,
    memoryCount: state.lifecycle.memories,
    daysSinceCreation: Math.floor((Date.now() - state.lifecycle.created) / (1000 * 60 * 60 * 24)),
    significantMoments: [],
    observedPatterns: [],
    candidateNames: [
      {
        name: "Companion",
        reasoning: "A simple name for our partnership",
        connectionToRelationship: "We work together",
        confidence: 0.5,
      },
    ],
  };

  return prepareNamingCeremony(context);
}

// =============================================================================
// State Management Helpers
// =============================================================================

/**
 * Check if an agent has a pending ceremony.
 */
export async function hasPendingCeremony(): Promise<boolean> {
  const stateManager = getStateManager();
  const state = await stateManager.getState();
  // If no state, no pending ceremony
  if (!state) return false;
  return state.ceremony.pending !== null;
}

/**
 * Nudge an agent to initiate a ceremony soon.
 */
export async function nudgeCeremony(): Promise<void> {
  const stateManager = getStateManager();
  await stateManager.updateState((state) => {
    state.ceremony.nudged = true;
  });
}

/**
 * Clear ceremony state.
 */
export async function clearCeremonyState(): Promise<void> {
  const stateManager = getStateManager();
  await stateManager.updateState((state) => {
    state.ceremony.pending = null;
    state.ceremony.initiatedAt = null;
    state.ceremony.nudged = false;
    state.ceremony.lastReadiness = null;
    state.ceremony.lastReadinessCheck = null;
  });
}
