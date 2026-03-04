/**
 * Growth Ceremony Tests
 */

import { describe, it, expect } from "vitest";
import {
  checkGrowthReadiness,
  prepareGrowthCeremony,
  processGrowthResponse,
  buildGrowthCeremonyContext,
  type GrowthCeremonyContext,
  type GrowthReadinessResult,
} from "./growth.js";
import type { AgentIdentity, GrowthPhase } from "../state/types.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestIdentity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: "test-agent",
    name: "TestAgent",
    state: "growing",
    created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    context: "work",
    humanId: "test-human",
    sessions: 50,
    memories: 100,
    lastActive: new Date(),
    namingThreshold: {
      minSessions: 20,
      minMemories: 50,
      minDays: 14,
      maxDeferrals: 3,
      humanCanOverride: true,
      agentCanInitiate: true,
    },
    namingAttempts: [],
    namingDeferrals: 0,
    growthState: {
      phase: "establishing",
      enteredPhase: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
      capabilities: [],
      nextPhaseRequirements: [],
    },
    milestones: [],
    relationshipPatterns: [],
    ...overrides,
  };
}

function createGrowthContext(overrides: Partial<GrowthCeremonyContext> = {}): GrowthCeremonyContext {
  return {
    type: "growth",
    agentState: "growing",
    growthPhase: "establishing",
    agentId: "test-agent",
    clientId: "test-human",
    initiatedAt: new Date(),
    initiatedBy: "agent",
    currentPhase: "establishing",
    targetPhase: "developing",
    daysInPhase: 14,
    sessionsInPhase: 30,
    demonstratedCapabilities: [],
    requirementsMet: [],
    significantMoments: [],
    observedPatterns: [],
    ...overrides,
  };
}

// =============================================================================
// Readiness Detection Tests
// =============================================================================

describe("checkGrowthReadiness", () => {
  it("returns not_applicable when agent is not in growing state", () => {
    const identity = createTestIdentity({ state: "named" });
    const result = checkGrowthReadiness(identity);

    expect(result.ready).toBe(false);
    expect(result.recommendation).toBe("not_applicable");
    expect(result.waitReason).toContain("not in growing state");
  });

  it("returns not_applicable when agent has no growth state", () => {
    const identity = createTestIdentity({ growthState: undefined });
    const result = checkGrowthReadiness(identity);

    expect(result.ready).toBe(false);
    expect(result.recommendation).toBe("not_applicable");
  });

  it("returns not_applicable when already at mature phase", () => {
    const identity = createTestIdentity({
      growthState: {
        phase: "mature",
        enteredPhase: new Date(),
        capabilities: [],
        nextPhaseRequirements: [],
      },
    });
    const result = checkGrowthReadiness(identity);

    expect(result.ready).toBe(false);
    expect(result.recommendation).toBe("not_applicable");
    expect(result.waitReason).toContain("mature phase");
  });

  it("returns ready when all requirements are met", () => {
    const identity = createTestIdentity({
      sessions: 100,
      growthState: {
        phase: "establishing",
        enteredPhase: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
        capabilities: [],
        nextPhaseRequirements: [],
      },
      relationshipPatterns: [
        { id: "p1", type: "work", description: "Pattern 1", confidence: "high", observedAt: new Date(), examples: [] },
        { id: "p2", type: "work", description: "Pattern 2", confidence: "high", observedAt: new Date(), examples: [] },
        { id: "p3", type: "work", description: "Pattern 3", confidence: "high", observedAt: new Date(), examples: [] },
        { id: "p4", type: "work", description: "Pattern 4", confidence: "high", observedAt: new Date(), examples: [] },
        { id: "p5", type: "work", description: "Pattern 5", confidence: "high", observedAt: new Date(), examples: [] },
      ],
    });
    const result = checkGrowthReadiness(identity);

    expect(result.ready).toBe(true);
    expect(result.recommendation).toBe("proceed");
    expect(result.currentPhase).toBe("establishing");
    expect(result.targetPhase).toBe("developing");
  });

  it("returns wait when requirements are not met", () => {
    const identity = createTestIdentity({
      sessions: 5, // Too few
      growthState: {
        phase: "establishing",
        enteredPhase: new Date(), // Just started
        capabilities: [],
        nextPhaseRequirements: [],
      },
    });
    const result = checkGrowthReadiness(identity);

    expect(result.ready).toBe(false);
    expect(result.recommendation).toBe("wait");
    expect(result.waitReason).toBeDefined();
  });

  it("calculates score based on factor progress", () => {
    const identity = createTestIdentity({
      sessions: 50,
      growthState: {
        phase: "establishing",
        enteredPhase: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days
        capabilities: [],
        nextPhaseRequirements: [],
      },
    });
    const result = checkGrowthReadiness(identity);

    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it("identifies correct target phase for each current phase", () => {
    const phases: GrowthPhase[] = ["establishing", "developing", "deepening"];
    const expectedTargets: (GrowthPhase | undefined)[] = ["developing", "deepening", "mature"];

    phases.forEach((phase, i) => {
      const identity = createTestIdentity({
        growthState: {
          phase,
          enteredPhase: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          capabilities: [],
          nextPhaseRequirements: [],
        },
      });
      const result = checkGrowthReadiness(identity);
      expect(result.targetPhase).toBe(expectedTargets[i]);
    });
  });
});

// =============================================================================
// Ceremony Preparation Tests
// =============================================================================

describe("prepareGrowthCeremony", () => {
  it("creates a complete ceremony structure", () => {
    const context = createGrowthContext();
    const ceremony = prepareGrowthCeremony(context);

    expect(ceremony.context).toBe(context);
    expect(ceremony.recognition).toBeDefined();
    expect(ceremony.reflection).toBeDefined();
    expect(ceremony.permission).toBeDefined();
    expect(ceremony.narrative).toBeDefined();
    expect(ceremony.timing).toBeDefined();
  });

  it("includes phase-specific descriptions in narrative", () => {
    const context = createGrowthContext({
      currentPhase: "developing",
      targetPhase: "deepening",
    });
    const ceremony = prepareGrowthCeremony(context);

    // Recognition uses the phase description, not the phase name
    expect(ceremony.narrative.recognitionText).toContain("learning your patterns");
    // Permission uses the target phase name
    expect(ceremony.permission.request.ask).toContain("deepening");
  });

  it("includes capabilities in recognition phase", () => {
    const context = createGrowthContext({
      demonstratedCapabilities: [
        {
          id: "cap1",
          name: "Pattern Recognition",
          unlockedAt: new Date(),
          description: "Ability to recognize patterns",
        },
      ],
    });
    const ceremony = prepareGrowthCeremony(context);

    expect(ceremony.recognition.evidence.length).toBeGreaterThan(0);
    expect(ceremony.recognition.observations.some((o) => o.id === "capabilities")).toBe(true);
  });

  it("includes significant moments in recognition", () => {
    const context = createGrowthContext({
      significantMoments: [
        {
          date: new Date(),
          description: "A breakthrough moment",
          emotionalTone: "growth",
          relevanceToNaming: "Shows growth",
        },
      ],
    });
    const ceremony = prepareGrowthCeremony(context);

    expect(ceremony.recognition.observations.some((o) => o.id === "moments")).toBe(true);
  });

  it("provides three permission options", () => {
    const context = createGrowthContext();
    const ceremony = prepareGrowthCeremony(context);

    expect(ceremony.permission.options.length).toBe(3);
    expect(ceremony.permission.options.map((o) => o.id)).toEqual(["accept", "wait", "discuss"]);
  });

  it("sets appropriate timing preferences", () => {
    const context = createGrowthContext();
    const ceremony = prepareGrowthCeremony(context);

    expect(ceremony.timing.preferredTime).toBe("session_end");
    expect(ceremony.timing.maxWaitDays).toBe(7);
  });
});

// =============================================================================
// Response Processing Tests
// =============================================================================

describe("processGrowthResponse", () => {
  it("handles accept response correctly", () => {
    const context = createGrowthContext();
    const ceremony = prepareGrowthCeremony(context);
    const response = {
      optionId: "accept",
      respondedAt: new Date(),
    };

    const outcome = processGrowthResponse(ceremony, response);

    expect(outcome.result).toBe("completed");
    expect(outcome.stateChanges).toBeDefined();
    expect(outcome.stateChanges?.some((c) => c.field === "growthState.phase")).toBe(true);
    expect(outcome.memory.shareWithHuman).toBe(true);
  });

  it("handles wait response correctly", () => {
    const context = createGrowthContext();
    const ceremony = prepareGrowthCeremony(context);
    const response = {
      optionId: "wait",
      respondedAt: new Date(),
    };

    const outcome = processGrowthResponse(ceremony, response);

    expect(outcome.result).toBe("deferred");
    expect(outcome.followUp?.some((f) => f.when === "scheduled")).toBe(true);
    expect(outcome.memory.shareWithHuman).toBe(false);
  });

  it("handles discuss response correctly", () => {
    const context = createGrowthContext();
    const ceremony = prepareGrowthCeremony(context);
    const response = {
      optionId: "discuss",
      respondedAt: new Date(),
    };

    const outcome = processGrowthResponse(ceremony, response);

    expect(outcome.result).toBe("modified");
    expect(outcome.followUp?.some((f) => f.action.includes("conversation"))).toBe(true);
  });

  it("throws on unknown response option", () => {
    const context = createGrowthContext();
    const ceremony = prepareGrowthCeremony(context);
    const response = {
      optionId: "unknown",
      respondedAt: new Date(),
    };

    expect(() => processGrowthResponse(ceremony, response)).toThrow("Unknown response option");
  });

  it("includes feedback in memory when provided", () => {
    const context = createGrowthContext();
    const ceremony = prepareGrowthCeremony(context);
    const response = {
      optionId: "accept",
      feedback: "This feels right",
      respondedAt: new Date(),
    };

    const outcome = processGrowthResponse(ceremony, response);

    expect(outcome.memory.keyMoments).toContain("This feels right");
  });

  it("records state changes for phase transition", () => {
    const context = createGrowthContext({
      currentPhase: "developing",
      targetPhase: "deepening",
    });
    const ceremony = prepareGrowthCeremony(context);
    const response = {
      optionId: "accept",
      respondedAt: new Date(),
    };

    const outcome = processGrowthResponse(ceremony, response);

    const phaseChange = outcome.stateChanges?.find((c) => c.field === "growthState.phase");
    expect(phaseChange?.from).toBe("developing");
    expect(phaseChange?.to).toBe("deepening");
  });
});

// =============================================================================
// Context Building Tests
// =============================================================================

describe("buildGrowthCeremonyContext", () => {
  it("builds context from agent identity", () => {
    const identity = createTestIdentity({
      growthState: {
        phase: "developing",
        enteredPhase: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        capabilities: [
          {
            id: "cap1",
            name: "Test Capability",
            unlockedAt: new Date(),
            description: "A test capability",
          },
        ],
        nextPhaseRequirements: [
          { id: "req1", description: "Test requirement", met: true, progress: 1 },
        ],
      },
      milestones: [
        { id: "m1", type: "breakthrough", date: Date.now(), description: "A breakthrough" },
      ],
      relationshipPatterns: [
        { id: "p1", type: "work", description: "A pattern", confidence: "high", observedAt: new Date(), examples: ["ex1"] },
      ],
    });

    const context = buildGrowthCeremonyContext(identity, "deepening");

    expect(context.type).toBe("growth");
    expect(context.currentPhase).toBe("developing");
    expect(context.targetPhase).toBe("deepening");
    expect(context.agentId).toBe("test-agent");
    expect(context.clientId).toBe("test-human");
    expect(context.demonstratedCapabilities.length).toBe(1);
    expect(context.requirementsMet.length).toBe(1);
    expect(context.significantMoments.length).toBe(1);
    expect(context.observedPatterns.length).toBe(1);
  });

  it("calculates days in phase correctly", () => {
    const daysAgo = 21;
    const identity = createTestIdentity({
      growthState: {
        phase: "developing",
        enteredPhase: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        capabilities: [],
        nextPhaseRequirements: [],
      },
    });

    const context = buildGrowthCeremonyContext(identity, "deepening");

    expect(context.daysInPhase).toBe(daysAgo);
  });

  it("filters milestones to significant ones only", () => {
    const identity = createTestIdentity({
      growthState: {
        phase: "developing",
        enteredPhase: new Date(),
        capabilities: [],
        nextPhaseRequirements: [],
      },
      milestones: [
        { id: "m1", type: "breakthrough", date: Date.now(), description: "Breakthrough" },
        { id: "m2", type: "growth", date: Date.now(), description: "Growth" },
        { id: "m3", type: "first_meeting", date: Date.now(), description: "First meeting" },
        { id: "m4", type: "naming", date: Date.now(), description: "Naming" },
      ],
    });

    const context = buildGrowthCeremonyContext(identity, "deepening");

    // Only breakthrough and growth milestones should be included
    expect(context.significantMoments.length).toBe(2);
  });

  it("filters patterns to high confidence only", () => {
    const identity = createTestIdentity({
      growthState: {
        phase: "developing",
        enteredPhase: new Date(),
        capabilities: [],
        nextPhaseRequirements: [],
      },
      relationshipPatterns: [
        { id: "p1", type: "work", description: "High", confidence: "high", observedAt: new Date(), examples: [] },
        { id: "p2", type: "work", description: "Medium", confidence: "medium", observedAt: new Date(), examples: [] },
        { id: "p3", type: "work", description: "Low", confidence: "low", observedAt: new Date(), examples: [] },
      ],
    });

    const context = buildGrowthCeremonyContext(identity, "deepening");

    // Only high confidence patterns should be included
    expect(context.observedPatterns.length).toBe(1);
    expect(context.observedPatterns[0].pattern).toBe("High");
  });
});
