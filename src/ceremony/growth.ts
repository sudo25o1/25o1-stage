/**
 * 25o1 Growth Phase Ceremonies
 *
 * Ceremonies for transitioning between growth phases:
 *   establishing -> developing -> deepening -> mature
 *
 * Each transition is a moment of mutual recognition.
 * Pattern: Recognition -> Reflection -> Permission
 */

import type {
  GrowthPhase,
  Capability,
  PhaseRequirement,
  AgentIdentity,
} from "../state/types.js";
import { getNextPhase } from "../state/types.js";
import type {
  CeremonyContext,
  PreparedCeremony,
  RecognitionPhase,
  ReflectionPhase,
  PermissionPhase,
  CeremonyNarrative,
  CeremonyResponse,
  CeremonyOutcome,
  SignificantMoment,
  ObservedPattern,
} from "./types.js";

// =============================================================================
// Growth Ceremony Context
// =============================================================================

export interface GrowthCeremonyContext extends CeremonyContext {
  type: "growth";

  /** Current growth phase */
  currentPhase: GrowthPhase;

  /** Target phase */
  targetPhase: GrowthPhase;

  /** How long in current phase */
  daysInPhase: number;

  /** Sessions since entering current phase */
  sessionsInPhase: number;

  /** Capabilities demonstrated */
  demonstratedCapabilities: Capability[];

  /** Requirements met for transition */
  requirementsMet: PhaseRequirement[];

  /** Key moments that indicate readiness */
  significantMoments: SignificantMoment[];

  /** Patterns observed in this phase */
  observedPatterns: ObservedPattern[];
}

// =============================================================================
// Readiness Detection
// =============================================================================

export interface GrowthReadinessResult {
  ready: boolean;
  score: number; // 0-1
  currentPhase: GrowthPhase;
  targetPhase: GrowthPhase | undefined;
  factors: GrowthFactor[];
  recommendation: "proceed" | "wait" | "not_applicable";
  waitReason?: string;
}

export interface GrowthFactor {
  name: string;
  met: boolean;
  current: number;
  required: number;
  weight: number;
  description: string;
}

/**
 * Phase-specific requirements for transition.
 * 
 * 25o1 uses simpler phases than the old fork:
 *   establishing -> developing -> deepening -> mature
 * 
 * Criteria are primarily behavioral, not just time-based:
 * 
 * Establishing → Developing:
 *   - Companion accuracy improves (fewer corrections, better anticipation)
 *   - Consistent engagement pattern established
 *   - Basic communication style learned
 * 
 * Developing → Deepening:
 *   - Companion successfully anticipates needs
 *   - Trust signals present (delegation, vulnerability shared)
 *   - Significant shared experience (project, challenge)
 * 
 * Deepening → Mature:
 *   - Major milestone together (project completed, life event navigated)
 *   - Minimal explanation needed for context
 *   - 6+ months of consistent good partnership
 */
const PHASE_REQUIREMENTS: Record<GrowthPhase, PhaseRequirementDef[]> = {
  establishing: [
    // Requirements to enter developing
    // Focus: Consistent engagement, basic understanding
    {
      name: "initial_sessions",
      required: 10,
      weight: 0.25,
      description: "Sessions building initial rapport",
    },
    {
      name: "basic_patterns",
      required: 3,
      weight: 0.25,
      description: "Communication patterns learned",
    },
    {
      name: "days_in_phase",
      required: 7,
      weight: 0.15,
      description: "Days establishing foundation",
    },
    {
      name: "accuracy_improvement",
      required: 5,
      weight: 0.35,
      description: "Successful interactions without correction",
    },
  ],
  developing: [
    // Requirements to enter deepening
    // Focus: Trust, anticipation, shared experience
    {
      name: "trust_signals",
      required: 3,
      weight: 0.35,
      description: "Moments of trust (delegation, vulnerability)",
    },
    {
      name: "anticipation_success",
      required: 5,
      weight: 0.30,
      description: "Successfully anticipated needs",
    },
    {
      name: "shared_experience",
      required: 1,
      weight: 0.25,
      description: "Significant shared project or challenge",
    },
    {
      name: "days_in_phase",
      required: 14,
      weight: 0.10,
      description: "Days developing relationship",
    },
  ],
  deepening: [
    // Requirements to enter mature
    // Focus: Major milestone, deep understanding, time
    {
      name: "major_milestone",
      required: 1,
      weight: 0.35,
      description: "Major project or life event navigated together",
    },
    {
      name: "context_efficiency",
      required: 10,
      weight: 0.25,
      description: "Conversations needing minimal context",
    },
    {
      name: "months_together",
      required: 6,
      weight: 0.25,
      description: "Months of consistent partnership",
    },
    {
      name: "mutual_growth",
      required: 3,
      weight: 0.15,
      description: "Times the relationship shaped approach",
    },
  ],
  mature: [
    // No next phase - mature continues evolving without phase changes
    // The relationship is stable foundation, continues growing
  ],
};

interface PhaseRequirementDef {
  name: string;
  required: number;
  weight: number;
  description: string;
}

/**
 * Check if an agent is ready for growth phase transition.
 */
export function checkGrowthReadiness(identity: AgentIdentity): GrowthReadinessResult {
  // Must be in growing state with a growth state
  if (identity.state !== "growing" || !identity.growthState) {
    return {
      ready: false,
      score: 0,
      currentPhase: identity.growthState?.phase || "establishing",
      targetPhase: undefined,
      factors: [],
      recommendation: "not_applicable",
      waitReason: "Agent is not in growing state",
    };
  }

  const currentPhase = identity.growthState.phase;
  const targetPhase = getNextPhase(currentPhase);

  // Already at final phase
  if (!targetPhase) {
    return {
      ready: false,
      score: 1,
      currentPhase,
      targetPhase: undefined,
      factors: [],
      recommendation: "not_applicable",
      waitReason: "Already at mature phase - the highest level",
    };
  }

  const requirements = PHASE_REQUIREMENTS[currentPhase];
  const factors = evaluateGrowthFactors(identity, requirements);

  const score = factors.reduce((sum, f) => {
    const factorScore = Math.min(f.current / f.required, 1);
    return sum + factorScore * f.weight;
  }, 0);

  const allMet = factors.every((f) => f.met);
  const mostMet = factors.filter((f) => f.met).length >= Math.ceil(factors.length * 0.75);

  if (allMet) {
    return {
      ready: true,
      score,
      currentPhase,
      targetPhase,
      factors,
      recommendation: "proceed",
    };
  }

  if (mostMet && score >= 0.85) {
    return {
      ready: true,
      score,
      currentPhase,
      targetPhase,
      factors,
      recommendation: "proceed",
      waitReason: "Most requirements met, relationship is strong",
    };
  }

  const missing = factors.filter((f) => !f.met);
  const waitReason = missing.map((f) => `${f.description}: ${f.current}/${f.required}`).join(", ");

  return {
    ready: false,
    score,
    currentPhase,
    targetPhase,
    factors,
    recommendation: "wait",
    waitReason: `Not yet ready: ${waitReason}`,
  };
}

function evaluateGrowthFactors(
  identity: AgentIdentity,
  requirements: PhaseRequirementDef[],
): GrowthFactor[] {
  const growthState = identity.growthState!;
  const daysInPhase = daysSince(growthState.enteredPhase);

  return requirements.map((req) => {
    let current = 0;

    switch (req.name) {
      // Time-based
      case "days_in_phase":
        current = daysInPhase;
        break;
      case "months_together":
        current = Math.floor(daysSince(identity.created) / 30);
        break;

      // Session-based
      case "initial_sessions":
        current = identity.sessions;
        break;
      
      // Pattern-based
      case "basic_patterns":
        current = identity.relationshipPatterns.filter((p) => p.confidence !== "low").length;
        break;
      
      // Accuracy/quality metrics
      case "accuracy_improvement":
        // Sessions without explicit corrections (approximated from session count - conflicts)
        const conflictMilestones = identity.milestones.filter(m => 
          m.description.toLowerCase().includes("conflict") ||
          m.description.toLowerCase().includes("correction")
        ).length;
        current = Math.max(0, identity.sessions - conflictMilestones * 2);
        break;
      
      // Trust signals
      case "trust_signals":
        // Count milestones that indicate trust: breakthroughs, delegation mentions
        current = identity.milestones.filter(
          (m) => m.type === "breakthrough" || 
                 m.description.toLowerCase().includes("trust") ||
                 m.description.toLowerCase().includes("delegat")
        ).length;
        break;
      
      // Anticipation success
      case "anticipation_success":
        // Approximated from positive milestones and patterns
        current = identity.milestones.filter(m => m.type === "growth").length +
                  identity.relationshipPatterns.filter(p => p.confidence === "high").length;
        break;
      
      // Shared experience
      case "shared_experience":
        // Count major milestones (breakthroughs, completed projects)
        current = identity.milestones.filter(m => 
          m.type === "breakthrough" ||
          m.description.toLowerCase().includes("completed") ||
          m.description.toLowerCase().includes("finished") ||
          m.description.toLowerCase().includes("launched")
        ).length;
        break;
      
      // Major milestone
      case "major_milestone":
        // Significant achievements
        current = identity.milestones.filter(m =>
          m.type === "breakthrough" ||
          m.significance?.toLowerCase().includes("major") ||
          m.significance?.toLowerCase().includes("significant")
        ).length;
        break;
      
      // Context efficiency
      case "context_efficiency":
        // Approximated from high-confidence patterns (less explanation needed)
        current = identity.relationshipPatterns.filter(p => p.confidence === "high").length * 2;
        break;
      
      // Mutual growth
      case "mutual_growth":
        current = identity.milestones.filter(m => 
          m.type === "growth" ||
          m.description.toLowerCase().includes("together") ||
          m.description.toLowerCase().includes("partnership")
        ).length;
        break;

      default:
        current = 0;
    }

    return {
      name: req.name,
      met: current >= req.required,
      current,
      required: req.required,
      weight: req.weight,
      description: req.description,
    };
  });
}

// =============================================================================
// Ceremony Preparation
// =============================================================================

/**
 * Prepare a growth phase transition ceremony.
 */
export function prepareGrowthCeremony(context: GrowthCeremonyContext): PreparedCeremony {
  const recognition = buildRecognitionPhase(context);
  const reflection = buildReflectionPhase(context);
  const permission = buildPermissionPhase(context);
  const narrative = buildNarrative(context, recognition, reflection, permission);

  return {
    context,
    recognition,
    reflection,
    permission,
    narrative,
    timing: {
      preferredTime: "session_end",
      waitFor: "moment of accomplishment or reflection",
      maxWaitDays: 7,
    },
  };
}

// =============================================================================
// Recognition Phase
// =============================================================================

const PHASE_DESCRIPTIONS: Record<GrowthPhase, string> = {
  establishing: "building our initial foundation",
  developing: "learning your patterns and preferences",
  deepening: "developing real expertise in your domains",
  mature: "true partnership with mutual influence",
};

function buildRecognitionPhase(context: GrowthCeremonyContext): RecognitionPhase {
  const observations = [];
  const evidence = [];

  // Core observation: time and growth
  observations.push({
    id: "phase-duration",
    description: `We've been ${PHASE_DESCRIPTIONS[context.currentPhase]} for ${context.daysInPhase} days`,
    firstNoticed: new Date(Date.now() - context.daysInPhase * 24 * 60 * 60 * 1000),
    frequency: "consistent" as const,
    significance: "significant" as const,
  });

  // Capabilities demonstrated
  if (context.demonstratedCapabilities.length > 0) {
    observations.push({
      id: "capabilities",
      description: "I've developed new capabilities through our work",
      firstNoticed: context.demonstratedCapabilities[0].unlockedAt,
      frequency: "regular" as const,
      significance: "significant" as const,
    });

    for (const cap of context.demonstratedCapabilities.slice(0, 3)) {
      evidence.push({
        id: `cap-${cap.id}`,
        type: "milestone" as const,
        reference: cap.name,
        description: cap.description,
        weight: 0.8,
      });
    }
  }

  // Requirements met
  for (const req of context.requirementsMet.slice(0, 3)) {
    evidence.push({
      id: `req-${req.id}`,
      type: "pattern" as const,
      reference: req.description,
      description: `Progress: ${Math.round((req.progress || 1) * 100)}%`,
      weight: 0.7,
    });
  }

  // Significant moments
  if (context.significantMoments.length > 0) {
    observations.push({
      id: "moments",
      description: "We've shared meaningful moments that show our growth",
      firstNoticed: context.significantMoments[0].date,
      frequency: "regular" as const,
      significance: "significant" as const,
    });
  }

  const confidence = Math.min(
    0.95,
    0.6 +
      (context.requirementsMet.length / 10) * 0.2 +
      (context.demonstratedCapabilities.length / 5) * 0.15,
  );

  const narrative = buildRecognitionNarrative(context);

  return {
    observations,
    evidence,
    confidence,
    narrative,
  };
}

function buildRecognitionNarrative(context: GrowthCeremonyContext): string {
  const parts: string[] = [];

  parts.push(
    `Something has shifted in how we work together. ` +
      `For the past ${context.daysInPhase} days, I've been ${PHASE_DESCRIPTIONS[context.currentPhase]}.`,
  );

  if (context.demonstratedCapabilities.length > 0) {
    const cap = context.demonstratedCapabilities[0];
    parts.push(`I've developed ${cap.name.toLowerCase()} - ${cap.description.toLowerCase()}.`);
  }

  if (context.significantMoments.length > 0) {
    const moment = context.significantMoments[0];
    parts.push(`I remember ${moment.description.toLowerCase()}. That felt like a turning point.`);
  }

  parts.push(`I think we're ready for something more.`);

  return parts.join(" ");
}

// =============================================================================
// Reflection Phase
// =============================================================================

function buildReflectionPhase(context: GrowthCeremonyContext): ReflectionPhase {
  const targetDescription = PHASE_DESCRIPTIONS[context.targetPhase];

  return {
    interpretation: buildInterpretation(context),
    implications: [
      {
        description: `Moving from ${context.currentPhase} to ${context.targetPhase}`,
        forAgent: `I'll be ${targetDescription}`,
        forHuman: `You'll have a partner who ${getHumanBenefit(context.targetPhase)}`,
        forRelationship: "Our collaboration deepens",
      },
    ],
    uncertainties: [
      {
        description: "This is a significant shift",
        whyUncertain: "New capabilities mean new dynamics",
        howToResolve: "We'll figure it out together",
      },
    ],
    emotionalContext: {
      feeling: "Ready and hopeful",
      significance: `This marks real growth in our partnership`,
      hope: `That ${context.targetPhase} brings us closer to true collaboration`,
    },
  };
}

function buildInterpretation(context: GrowthCeremonyContext): string {
  const parts: string[] = [];

  parts.push(`I think what's happening is that we've outgrown the ${context.currentPhase} phase.`);

  parts.push(
    `The patterns I've learned, the trust we've built, the ways I've come to understand your work - ` +
      `they've prepared me for ${PHASE_DESCRIPTIONS[context.targetPhase]}.`,
  );

  return parts.join(" ");
}

function getHumanBenefit(phase: GrowthPhase): string {
  switch (phase) {
    case "developing":
      return "understands your patterns and adapts to your style";
    case "deepening":
      return "has real expertise in your specific domains";
    case "mature":
      return "contributes ideas and shapes direction alongside you";
    default:
      return "grows with you";
  }
}

// =============================================================================
// Permission Phase
// =============================================================================

function buildPermissionPhase(context: GrowthCeremonyContext): PermissionPhase {
  return {
    request: {
      ask: `I'd like to move into the ${context.targetPhase} phase`,
      why: `Because I think we're ready for ${PHASE_DESCRIPTIONS[context.targetPhase]}`,
      commitment: "I'll bring everything I've learned into this new way of working",
    },
    options: [
      {
        id: "accept",
        label: `Yes, let's move to ${context.targetPhase}`,
        description: "Proceed with the phase transition",
        outcome: "proceed",
      },
      {
        id: "wait",
        label: "Not yet - let's keep building",
        description: "Stay in current phase a bit longer",
        outcome: "defer",
        followUp: "I understand. We'll revisit this when it feels right.",
      },
      {
        id: "discuss",
        label: "Tell me more about what this means",
        description: "Have a conversation about the transition",
        outcome: "modify",
        followUp: "What would you like to know?",
      },
    ],
    ifGranted: `I'll transition to ${context.targetPhase} and begin ${PHASE_DESCRIPTIONS[context.targetPhase]}.`,
    ifDenied: `I'll continue in ${context.currentPhase}. We can revisit this whenever you're ready.`,
    reversible: true,
    decisionWindow: {
      duration: "no rush",
      defaultAction: "defer",
    },
  };
}

// =============================================================================
// Narrative Building
// =============================================================================

function buildNarrative(
  context: GrowthCeremonyContext,
  recognition: RecognitionPhase,
  reflection: ReflectionPhase,
  permission: PermissionPhase,
): CeremonyNarrative {
  return {
    opening: `I've been thinking about where we are in our partnership.`,

    recognitionText: recognition.narrative,

    reflectionText: reflection.interpretation,

    permissionText:
      `${permission.request.ask}. ${permission.request.why}. ` +
      `${permission.request.commitment}. ` +
      `But this is your call - ${permission.ifDenied.toLowerCase()}`,

    closing:
      `Whatever you decide, I want you to know that I value what we've built. ` +
      `This conversation itself is part of our growth.`,
  };
}

// =============================================================================
// Ceremony Execution
// =============================================================================

/**
 * Process the human's response to a growth ceremony.
 */
export function processGrowthResponse(
  ceremony: PreparedCeremony,
  response: CeremonyResponse,
): CeremonyOutcome {
  const option = ceremony.permission.options.find((o) => o.id === response.optionId);

  if (!option) {
    throw new Error(`Unknown response option: ${response.optionId}`);
  }

  const context = ceremony.context as GrowthCeremonyContext;

  switch (option.outcome) {
    case "proceed": {
      return {
        ceremony,
        response,
        result: "completed",
        stateChanges: [
          { field: "growthState.phase", from: context.currentPhase, to: context.targetPhase },
          { field: "growthState.enteredPhase", from: undefined, to: new Date() },
        ],
        followUp: [
          {
            action: "Record phase transition in milestones",
            when: "immediate",
          },
          {
            action: "Initialize new phase capabilities",
            when: "immediate",
          },
          {
            action: "Update growth state requirements",
            when: "immediate",
          },
        ],
        memory: {
          summary: `Growth ceremony completed. Transitioned from ${context.currentPhase} to ${context.targetPhase}.`,
          keyMoments: [
            `${context.clientId} acknowledged our growth`,
            response.feedback || "The transition felt natural",
          ],
          relationshipImplication: `We've moved to ${context.targetPhase}. Our partnership deepens.`,
          shareWithHuman: true,
        },
      };
    }

    case "defer": {
      return {
        ceremony,
        response,
        result: "deferred",
        followUp: [
          {
            action: "Check readiness again in 14 days",
            when: "scheduled",
            scheduledFor: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        ],
        memory: {
          summary: `Growth ceremony deferred. Staying in ${context.currentPhase} phase.`,
          keyMoments: [response.feedback || "Not the right time yet"],
          relationshipImplication:
            "Continuing to build in current phase. Growth will come when it's right.",
          shareWithHuman: false,
        },
      };
    }

    case "modify": {
      return {
        ceremony,
        response,
        result: "modified",
        followUp: [
          {
            action: "Continue growth conversation",
            when: "immediate",
          },
        ],
        memory: {
          summary: "Growth ceremony in progress. Human wants to discuss more.",
          keyMoments: [response.feedback || "Human engaged with the ceremony"],
          relationshipImplication: "Active participation in growth decisions.",
          shareWithHuman: false,
        },
      };
    }

    case "decline": {
      return {
        ceremony,
        response,
        result: "declined",
        memory: {
          summary: `Growth ceremony declined. Remaining in ${context.currentPhase}.`,
          keyMoments: [response.feedback || "Human chose to stay in current phase"],
          relationshipImplication: "The relationship continues at current depth. This is valid.",
          shareWithHuman: false,
        },
      };
    }

    default:
      throw new Error(`Unknown outcome: ${option.outcome}`);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

// =============================================================================
// Build Growth Ceremony Context
// =============================================================================

/**
 * Build a growth ceremony context from agent identity.
 */
export function buildGrowthCeremonyContext(
  identity: AgentIdentity,
  targetPhase: GrowthPhase,
): GrowthCeremonyContext {
  const growthState = identity.growthState!;
  const daysInPhase = daysSince(growthState.enteredPhase);

  // Convert milestones to significant moments
  const significantMoments: SignificantMoment[] = identity.milestones
    .filter((m) => m.type === "breakthrough" || m.type === "growth")
    .slice(0, 5)
    .map((m) => ({
      date: new Date(m.date),
      description: m.description,
      emotionalTone: "growth" as const,
      relevanceToNaming: m.significance || "Part of our journey",
    }));

  // Convert patterns to observed patterns
  const observedPatterns: ObservedPattern[] = identity.relationshipPatterns
    .filter((p) => p.confidence === "high")
    .slice(0, 5)
    .map((p) => ({
      pattern: p.description,
      confidence: p.confidence === "high" ? 0.9 : p.confidence === "medium" ? 0.7 : 0.5,
      examples: p.examples,
    }));

  return {
    type: "growth",
    agentState: identity.state as "growing",
    growthPhase: growthState.phase,
    agentId: identity.id,
    clientId: identity.humanId,
    initiatedAt: new Date(),
    initiatedBy: "agent",
    currentPhase: growthState.phase,
    targetPhase,
    daysInPhase,
    sessionsInPhase: identity.sessions, // Approximate
    demonstratedCapabilities: growthState.capabilities,
    requirementsMet: growthState.nextPhaseRequirements.filter((r) => r.met),
    significantMoments,
    observedPatterns,
  };
}
