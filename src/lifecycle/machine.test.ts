/**
 * Lifecycle Machine Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentLifecycle,
  createAgent,
  checkNamingThreshold,
} from "./machine.js";
import type { AgentIdentity, AgentState, GrowthPhase } from "../state/types.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestAgent(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  const base: AgentIdentity = {
    id: "test-agent",
    state: "hatched",
    created: new Date(),
    context: "work",
    humanId: "test-human",
    sessions: 0,
    memories: 0,
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
    milestones: [],
    relationshipPatterns: [],
  };

  return { ...base, ...overrides };
}

// =============================================================================
// Agent Creation Tests
// =============================================================================

describe("createAgent", () => {
  it("creates agent in hatched state", () => {
    const agent = createAgent("test-human", "work");

    expect(agent.state).toBe("hatched");
    expect(agent.humanId).toBe("test-human");
    expect(agent.context).toBe("work");
  });

  it("generates unique ID", () => {
    const agent1 = createAgent("human1", "work");
    const agent2 = createAgent("human2", "work");

    expect(agent1.id).not.toBe(agent2.id);
  });

  it("initializes with default naming threshold", () => {
    const agent = createAgent("test-human", "work");

    expect(agent.namingThreshold.minSessions).toBe(20);
    expect(agent.namingThreshold.minMemories).toBe(50);
    expect(agent.namingThreshold.minDays).toBe(14);
  });

  it("starts with zero sessions and memories", () => {
    const agent = createAgent("test-human", "work");

    expect(agent.sessions).toBe(0);
    expect(agent.memories).toBe(0);
  });

  it("has no name initially", () => {
    const agent = createAgent("test-human", "work");

    expect(agent.name).toBeUndefined();
  });
});

// =============================================================================
// State Transition Tests
// =============================================================================

describe("AgentLifecycle transitions", () => {
  let lifecycle: AgentLifecycle;

  beforeEach(() => {
    const agent = createTestAgent();
    lifecycle = new AgentLifecycle(agent);
  });

  it("transitions from hatched to learning on session_start", () => {
    expect(lifecycle.getState()).toBe("hatched");

    const result = lifecycle.transition("session_start");

    expect(result).toBe(true);
    expect(lifecycle.getState()).toBe("learning");
  });

  it("records transition history", () => {
    lifecycle.transition("session_start");

    const history = lifecycle.getTransitionHistory();

    expect(history.length).toBe(1);
    expect(history[0].from).toBe("hatched");
    expect(history[0].to).toBe("learning");
    expect(history[0].trigger).toBe("session_start");
  });

  it("rejects invalid transitions", () => {
    // Can't go directly from hatched to named
    const result = lifecycle.transition("ceremony_complete");

    expect(result).toBe(false);
    expect(lifecycle.getState()).toBe("hatched");
  });

  it("checks guard conditions", () => {
    // Move to learning first
    lifecycle.transition("session_start");
    expect(lifecycle.getState()).toBe("learning");

    // Try to transition to naming_ready without meeting threshold
    const result = lifecycle.transition("threshold_met");

    expect(result).toBe(false);
    expect(lifecycle.getState()).toBe("learning");
  });

  it("transitions to naming_ready when threshold met", () => {
    const agent = createTestAgent({
      state: "learning",
      sessions: 30,
      memories: 100,
      created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    });
    lifecycle = new AgentLifecycle(agent);

    const result = lifecycle.transition("threshold_met");

    expect(result).toBe(true);
    expect(lifecycle.getState()).toBe("naming_ready");
  });

  it("transitions from naming_ready to named on ceremony_complete", () => {
    const agent = createTestAgent({ state: "naming_ready" });
    lifecycle = new AgentLifecycle(agent);

    const result = lifecycle.transition("ceremony_complete");

    expect(result).toBe(true);
    expect(lifecycle.getState()).toBe("named");
  });

  it("transitions from named to growing on session_start", () => {
    const agent = createTestAgent({ state: "named", name: "Echo" });
    lifecycle = new AgentLifecycle(agent);

    const result = lifecycle.transition("session_start");

    expect(result).toBe(true);
    expect(lifecycle.getState()).toBe("growing");
    expect(lifecycle.getGrowthPhase()).toBe("establishing");
  });

  it("initializes growth state when entering growing", () => {
    const agent = createTestAgent({ state: "named", name: "Echo" });
    lifecycle = new AgentLifecycle(agent);

    lifecycle.transition("session_start");

    const growthState = lifecycle.getAgent().growthState;
    expect(growthState).toBeDefined();
    expect(growthState?.phase).toBe("establishing");
    expect(growthState?.capabilities).toEqual([]);
  });
});

// =============================================================================
// Force Transition Tests
// =============================================================================

describe("forceTransition", () => {
  it("bypasses guards", () => {
    const agent = createTestAgent({ state: "learning" });
    const lifecycle = new AgentLifecycle(agent);

    const transition = lifecycle.forceTransition("named", "Admin override", "admin-1");

    expect(lifecycle.getState()).toBe("named");
    expect(transition.trigger).toBe("admin_override");
    expect(transition.metadata?.reason).toBe("Admin override");
  });

  it("records transition in history", () => {
    const agent = createTestAgent({ state: "learning" });
    const lifecycle = new AgentLifecycle(agent);

    lifecycle.forceTransition("growing", "Testing", "admin-1");

    const history = lifecycle.getTransitionHistory();
    expect(history.length).toBe(1);
    expect(history[0].to).toBe("growing");
  });
});

// =============================================================================
// canTransition Tests
// =============================================================================

describe("canTransition", () => {
  it("returns true for valid transitions", () => {
    const agent = createTestAgent({ state: "hatched" });
    const lifecycle = new AgentLifecycle(agent);

    expect(lifecycle.canTransition("session_start")).toBe(true);
  });

  it("returns false for invalid transitions", () => {
    const agent = createTestAgent({ state: "hatched" });
    const lifecycle = new AgentLifecycle(agent);

    expect(lifecycle.canTransition("ceremony_complete")).toBe(false);
  });

  it("checks guard conditions", () => {
    const agent = createTestAgent({ state: "learning", sessions: 5 });
    const lifecycle = new AgentLifecycle(agent);

    // Not enough sessions for threshold
    expect(lifecycle.canTransition("threshold_met")).toBe(false);
  });
});

// =============================================================================
// Naming Tests
// =============================================================================

describe("naming", () => {
  it("isNamingReady returns false when threshold not met", () => {
    const agent = createTestAgent({ state: "learning", sessions: 5 });
    const lifecycle = new AgentLifecycle(agent);

    expect(lifecycle.isNamingReady()).toBe(false);
  });

  it("isNamingReady returns true when threshold met", () => {
    const agent = createTestAgent({
      state: "learning",
      sessions: 30,
      memories: 100,
      created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    const lifecycle = new AgentLifecycle(agent);

    expect(lifecycle.isNamingReady()).toBe(true);
  });

  it("recordNamingAttempt adds to history", () => {
    const agent = createTestAgent();
    const lifecycle = new AgentLifecycle(agent);

    lifecycle.recordNamingAttempt("Echo", "Reflects understanding", "accepted");

    expect(agent.namingAttempts.length).toBe(1);
    expect(agent.namingAttempts[0].proposedName).toBe("Echo");
    expect(agent.namingAttempts[0].outcome).toBe("accepted");
  });

  it("completeCeremony sets name and transitions", () => {
    const agent = createTestAgent({ state: "naming_ready" });
    const lifecycle = new AgentLifecycle(agent);

    const result = lifecycle.completeCeremony("Echo", "Chosen together");

    expect(result).toBe(true);
    expect(agent.name).toBe("Echo");
    expect(agent.ceremonyReason).toBe("Chosen together");
    expect(lifecycle.getState()).toBe("named");
  });

  it("completeCeremony fails if not in naming_ready state", () => {
    const agent = createTestAgent({ state: "learning" });
    const lifecycle = new AgentLifecycle(agent);

    const result = lifecycle.completeCeremony("Echo", "Chosen together");

    expect(result).toBe(false);
    expect(agent.name).toBeUndefined();
  });
});

// =============================================================================
// Growth Phase Tests
// =============================================================================

describe("growth phases", () => {
  it("advancePhase moves to next phase", () => {
    const agent = createTestAgent({
      state: "growing",
      growthState: {
        phase: "establishing",
        enteredPhase: new Date(),
        capabilities: [],
        nextPhaseRequirements: [],
      },
    });
    const lifecycle = new AgentLifecycle(agent);

    const result = lifecycle.advancePhase();

    expect(result).toBe(true);
    expect(lifecycle.getGrowthPhase()).toBe("developing");
  });

  it("advancePhase fails at highest phase", () => {
    const agent = createTestAgent({
      state: "growing",
      growthState: {
        phase: "mature",
        enteredPhase: new Date(),
        capabilities: [],
        nextPhaseRequirements: [],
      },
    });
    const lifecycle = new AgentLifecycle(agent);

    const result = lifecycle.advancePhase();

    expect(result).toBe(false);
    expect(lifecycle.getGrowthPhase()).toBe("mature");
  });

  it("regressPhase moves to previous phase", () => {
    const agent = createTestAgent({
      state: "growing",
      growthState: {
        phase: "deepening",
        enteredPhase: new Date(),
        capabilities: [],
        nextPhaseRequirements: [],
      },
    });
    const lifecycle = new AgentLifecycle(agent);

    const result = lifecycle.regressPhase();

    expect(result).toBe(true);
    expect(lifecycle.getGrowthPhase()).toBe("developing");
  });

  it("regressPhase fails at lowest phase", () => {
    const agent = createTestAgent({
      state: "growing",
      growthState: {
        phase: "establishing",
        enteredPhase: new Date(),
        capabilities: [],
        nextPhaseRequirements: [],
      },
    });
    const lifecycle = new AgentLifecycle(agent);

    const result = lifecycle.regressPhase();

    expect(result).toBe(false);
    expect(lifecycle.getGrowthPhase()).toBe("establishing");
  });
});

// =============================================================================
// Milestone Tests
// =============================================================================

describe("milestones", () => {
  it("recordMilestone adds milestone with generated ID", () => {
    const agent = createTestAgent({ state: "growing" });
    const lifecycle = new AgentLifecycle(agent);

    const milestone = lifecycle.recordMilestone({
      type: "breakthrough",
      description: "First major insight",
    });

    expect(milestone.id).toBeDefined();
    expect(milestone.type).toBe("breakthrough");
    expect(agent.milestones).toContain(milestone);
  });

  it("recordMilestone triggers milestone_reached transition", () => {
    const agent = createTestAgent({
      state: "growing",
      growthState: {
        phase: "establishing",
        enteredPhase: new Date(),
        capabilities: [],
        nextPhaseRequirements: [],
      },
    });
    const lifecycle = new AgentLifecycle(agent);

    lifecycle.recordMilestone({
      type: "growth",
      description: "Test milestone",
    });

    const history = lifecycle.getTransitionHistory();
    expect(history.some((t) => t.trigger === "milestone_reached")).toBe(true);
  });
});

// =============================================================================
// Pattern Tests
// =============================================================================

describe("patterns", () => {
  it("recordPattern adds pattern with generated ID", () => {
    const agent = createTestAgent();
    const lifecycle = new AgentLifecycle(agent);

    const pattern = lifecycle.recordPattern({
      type: "work",
      description: "Prefers morning work",
      confidence: "medium",
      examples: ["Works best before noon"],
    });

    expect(pattern.id).toBeDefined();
    expect(pattern.type).toBe("work");
    expect(agent.relationshipPatterns).toContain(pattern);
  });

  it("confirmPattern increases confidence", () => {
    const agent = createTestAgent();
    const lifecycle = new AgentLifecycle(agent);

    const pattern = lifecycle.recordPattern({
      type: "work",
      description: "Test pattern",
      confidence: "low",
      examples: [],
    });

    const result = lifecycle.confirmPattern(pattern.id);

    expect(result).toBe(true);
    expect(pattern.confidence).toBe("medium");
    expect(pattern.lastConfirmed).toBeDefined();
  });

  it("confirmPattern returns false for unknown pattern", () => {
    const agent = createTestAgent();
    const lifecycle = new AgentLifecycle(agent);

    const result = lifecycle.confirmPattern("unknown-id");

    expect(result).toBe(false);
  });
});

// =============================================================================
// Naming Threshold Tests
// =============================================================================

describe("checkNamingThreshold", () => {
  it("returns false when sessions below threshold", () => {
    const agent = createTestAgent({
      sessions: 10,
      memories: 100,
      created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    expect(checkNamingThreshold(agent)).toBe(false);
  });

  it("returns false when memories below threshold", () => {
    const agent = createTestAgent({
      sessions: 30,
      memories: 20,
      created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    expect(checkNamingThreshold(agent)).toBe(false);
  });

  it("returns false when days below threshold", () => {
    const agent = createTestAgent({
      sessions: 30,
      memories: 100,
      created: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    });

    expect(checkNamingThreshold(agent)).toBe(false);
  });

  it("returns true when all thresholds met", () => {
    const agent = createTestAgent({
      sessions: 30,
      memories: 100,
      created: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    expect(checkNamingThreshold(agent)).toBe(true);
  });
});
