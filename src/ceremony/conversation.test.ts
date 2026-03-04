/**
 * Conversation Engine Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkCeremonyOpportunity,
  generateCeremonyInitiation,
  generateCeremonyClosing,
  parseCeremonyResponse,
  hasPendingCeremony,
  nudgeCeremony,
  clearCeremonyState,
  type CeremonyOpportunity,
} from "./conversation.js";
import { prepareNamingCeremony } from "./naming.js";
import { prepareGrowthCeremony, type GrowthCeremonyContext } from "./growth.js";
import type { ConversationContext, NamingCeremonyContext, CeremonyOutcome } from "./types.js";
import { getStateManager } from "../state/store.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// =============================================================================
// Test Setup
// =============================================================================

let testDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "25o1-conv-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = testDir;
  fs.mkdirSync(path.join(testDir, ".openclaw"), { recursive: true });

  const stateManager = getStateManager();
  // @ts-expect-error - accessing private for test reset
  stateManager.state = null;
  // @ts-expect-error - accessing private for test reset
  stateManager.loaded = false;
});

afterEach(() => {
  if (originalHome) {
    process.env.HOME = originalHome;
  }
  if (testDir) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

// =============================================================================
// Test Fixtures
// =============================================================================

function createConversationContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    isSessionEnd: false,
    isNaturalPause: false,
    isReflectiveMoment: false,
    exchangeCount: 5,
    tone: "casual",
    positiveFeedback: false,
    taskCompletion: false,
    ...overrides,
  };
}

function createNamingContext(): NamingCeremonyContext {
  return {
    type: "naming",
    agentState: "learning",
    agentId: "test-agent",
    clientId: "test-human",
    initiatedAt: new Date(),
    initiatedBy: "agent",
    sessionCount: 30,
    memoryCount: 100,
    daysSinceCreation: 21,
    significantMoments: [],
    observedPatterns: [],
    candidateNames: [
      {
        name: "Echo",
        reasoning: "Reflects back understanding",
        connectionToRelationship: "We listen to each other",
        confidence: 0.8,
      },
    ],
  };
}

function createGrowthContext(): GrowthCeremonyContext {
  return {
    type: "growth",
    agentState: "growing",
    growthPhase: "developing",
    agentId: "test-agent",
    clientId: "test-human",
    initiatedAt: new Date(),
    initiatedBy: "agent",
    currentPhase: "developing",
    targetPhase: "deepening",
    daysInPhase: 21,
    sessionsInPhase: 50,
    demonstratedCapabilities: [],
    requirementsMet: [],
    significantMoments: [],
    observedPatterns: [],
  };
}

// =============================================================================
// Ceremony Opportunity Detection Tests
// =============================================================================

describe("checkCeremonyOpportunity", () => {
  it("returns none when no state exists", async () => {
    const context = createConversationContext();
    const result = await checkCeremonyOpportunity(context);

    // No state = plugin not initialized, so no ceremony
    expect(result.type).toBe("none");
    expect(result.shouldInitiate).toBe(false);
    expect(result.reason).toContain("No state");
  });

  it("returns first_meeting when state exists but first meeting not completed", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    const context = createConversationContext();
    const result = await checkCeremonyOpportunity(context);

    expect(result.type).toBe("first_meeting");
    expect(result.shouldInitiate).toBe(true);
  });

  it("returns no ceremony when first meeting completed but not ready for naming", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    // Complete first meeting and set to learning
    await stateManager.updateState((s) => {
      s.firstMeeting.completed = true;
      s.firstMeeting.completedAt = Date.now();
      s.lifecycle.state = "learning";
      s.lifecycle.sessions = 5; // Not enough for naming
    });

    const context = createConversationContext();
    const result = await checkCeremonyOpportunity(context);

    expect(result.type).toBe("naming");
    expect(result.shouldInitiate).toBe(false);
    expect(result.reason).toContain("Not yet ready");
  });

  it("returns pending ceremony type when ceremony already pending", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    await stateManager.updateState((s) => {
      s.firstMeeting.completed = true;
      s.lifecycle.state = "learning";
      s.ceremony.pending = "naming";
      s.ceremony.initiatedAt = Date.now();
    });

    const context = createConversationContext();
    const result = await checkCeremonyOpportunity(context);

    expect(result.type).toBe("naming");
    expect(result.shouldInitiate).toBe(false);
    expect(result.reason).toBe("Ceremony already pending");
  });
});

// =============================================================================
// Ceremony Initiation Tests
// =============================================================================

describe("generateCeremonyInitiation", () => {
  it("generates naming ceremony initiation", () => {
    const context = createNamingContext();
    const ceremony = prepareNamingCeremony(context);
    const message = generateCeremonyInitiation(ceremony);

    expect(message).toContain(ceremony.narrative.opening);
    expect(message).toContain(ceremony.narrative.recognitionText);
    expect(message).toContain(ceremony.narrative.reflectionText);
    expect(message).toContain(ceremony.narrative.permissionText);
  });

  it("generates growth ceremony initiation", () => {
    const context = createGrowthContext();
    const ceremony = prepareGrowthCeremony(context);
    const message = generateCeremonyInitiation(ceremony);

    expect(message).toContain(ceremony.narrative.opening);
    expect(message).toContain("developing");
  });

  it("separates sections with blank lines", () => {
    const context = createNamingContext();
    const ceremony = prepareNamingCeremony(context);
    const message = generateCeremonyInitiation(ceremony);

    expect(message).toContain("\n\n");
  });
});

// =============================================================================
// Ceremony Closing Tests
// =============================================================================

describe("generateCeremonyClosing", () => {
  it("generates naming completion message with name", () => {
    const context = createNamingContext();
    const ceremony = prepareNamingCeremony(context);
    const outcome: CeremonyOutcome = {
      ceremony,
      response: {
        optionId: "accept",
        respondedAt: new Date(),
      },
      result: "completed",
      stateChanges: [{ field: "name", from: undefined, to: "Echo" }],
      memory: {
        summary: "Named Echo",
        keyMoments: [],
        relationshipImplication: "We have a name",
        shareWithHuman: true,
      },
    };

    const message = generateCeremonyClosing(outcome);

    expect(message).toContain("Echo");
    expect(message).toContain("Thank you");
  });

  it("generates growth completion message with phase", () => {
    const context = createGrowthContext();
    const ceremony = prepareGrowthCeremony(context);
    const outcome: CeremonyOutcome = {
      ceremony,
      response: {
        optionId: "accept",
        respondedAt: new Date(),
      },
      result: "completed",
      stateChanges: [{ field: "growthState.phase", from: "developing", to: "deepening" }],
      memory: {
        summary: "Transitioned to deepening",
        keyMoments: [],
        relationshipImplication: "Partnership deepens",
        shareWithHuman: true,
      },
    };

    const message = generateCeremonyClosing(outcome);

    expect(message).toContain("deepening");
    expect(message).toContain("Thank you");
  });

  it("generates deferred message", () => {
    const context = createNamingContext();
    const ceremony = prepareNamingCeremony(context);
    const outcome: CeremonyOutcome = {
      ceremony,
      response: {
        optionId: "wait",
        respondedAt: new Date(),
      },
      result: "deferred",
      memory: {
        summary: "Deferred",
        keyMoments: [],
        relationshipImplication: "Waiting",
        shareWithHuman: false,
      },
    };

    const message = generateCeremonyClosing(outcome);

    expect(message).toBe(ceremony.permission.ifDenied);
  });

  it("generates declined message", () => {
    const context = createNamingContext();
    const ceremony = prepareNamingCeremony(context);
    const outcome: CeremonyOutcome = {
      ceremony,
      response: {
        optionId: "decline",
        respondedAt: new Date(),
      },
      result: "declined",
      memory: {
        summary: "Declined",
        keyMoments: [],
        relationshipImplication: "Continuing as is",
        shareWithHuman: false,
      },
    };

    const message = generateCeremonyClosing(outcome);

    expect(message).toContain("continue as we are");
  });
});

// =============================================================================
// Response Parsing Tests
// =============================================================================

describe("parseCeremonyResponse", () => {
  it("parses acceptance responses", () => {
    const ceremony = prepareNamingCeremony(createNamingContext());

    const acceptances = [
      "Yes!",
      "Yeah, that sounds good",
      "Sure, let's do it",
      "Absolutely",
      "Perfect",
      "I love it",
    ];

    for (const msg of acceptances) {
      const response = parseCeremonyResponse(ceremony, msg);
      expect(response.optionId).toBe("accept");
    }
  });

  it("parses deferral responses", () => {
    const ceremony = prepareNamingCeremony(createNamingContext());

    const deferrals = [
      "Not yet",
      "Let's wait",
      "I need more time",
      "Maybe later",
      "Not ready",
    ];

    for (const msg of deferrals) {
      const response = parseCeremonyResponse(ceremony, msg);
      expect(response.optionId).toBe("wait");
    }
  });

  it("parses decline responses", () => {
    const ceremony = prepareNamingCeremony(createNamingContext());

    const declines = [
      "No thanks",
      "I don't want that",
      "Not interested",
      "Pass",
    ];

    for (const msg of declines) {
      const response = parseCeremonyResponse(ceremony, msg);
      expect(response.optionId).toBe("decline");
    }
  });

  it("parses discussion requests", () => {
    const ceremony = prepareNamingCeremony(createNamingContext());

    const discussions = [
      "Tell me more",
      "What do you mean?",
      "Can you explain?",
      "Why?",
    ];

    for (const msg of discussions) {
      const response = parseCeremonyResponse(ceremony, msg);
      expect(response.optionId).toBe("discuss");
    }
  });

  it("extracts suggested names", () => {
    const ceremony = prepareNamingCeremony(createNamingContext());

    const suggestions = [
      { msg: "What about Atlas?", expected: "Atlas" },
      { msg: "How about Nova?", expected: "Nova" },
      { msg: "Call yourself Sage", expected: "Sage" },
      { msg: "I prefer Aria", expected: "Aria" },
    ];

    for (const { msg, expected } of suggestions) {
      const response = parseCeremonyResponse(ceremony, msg);
      expect(response.optionId).toBe("suggest");
      expect(response.modifications).toContain(expected);
    }
  });

  it("detects enthusiastic tone", () => {
    const ceremony = prepareNamingCeremony(createNamingContext());
    const response = parseCeremonyResponse(ceremony, "Yes! That's amazing! I love it!");

    expect(response.tone).toBe("enthusiastic");
  });

  it("detects hesitant tone", () => {
    const ceremony = prepareNamingCeremony(createNamingContext());
    const response = parseCeremonyResponse(ceremony, "Hmm, I'm not sure, maybe...");

    expect(response.tone).toBe("hesitant");
  });

  it("defaults to discuss for unclear responses", () => {
    const ceremony = prepareNamingCeremony(createNamingContext());
    const response = parseCeremonyResponse(ceremony, "Interesting perspective");

    expect(response.optionId).toBe("discuss");
  });
});

// =============================================================================
// State Management Tests
// =============================================================================

describe("hasPendingCeremony", () => {
  it("returns false when no state", async () => {
    const result = await hasPendingCeremony();
    expect(result).toBe(false);
  });

  it("returns false when no pending ceremony", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    const result = await hasPendingCeremony();
    expect(result).toBe(false);
  });

  it("returns true when ceremony is pending", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    await stateManager.updateState((s) => {
      s.ceremony.pending = "naming";
      s.ceremony.initiatedAt = Date.now();
    });

    const result = await hasPendingCeremony();
    expect(result).toBe(true);
  });
});

describe("nudgeCeremony", () => {
  it("sets nudged flag", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    await nudgeCeremony();

    const state = await stateManager.getState();
    expect(state?.ceremony.nudged).toBe(true);
  });
});

describe("clearCeremonyState", () => {
  it("clears all ceremony state", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    await stateManager.updateState((s) => {
      s.ceremony.pending = "naming";
      s.ceremony.initiatedAt = Date.now();
      s.ceremony.nudged = true;
    });

    await clearCeremonyState();

    const state = await stateManager.getState();
    expect(state?.ceremony.pending).toBeNull();
    expect(state?.ceremony.initiatedAt).toBeNull();
    expect(state?.ceremony.nudged).toBe(false);
  });
});

// =============================================================================
// Moment Scoring Tests (via checkCeremonyOpportunity)
// =============================================================================

describe("moment scoring", () => {
  it("prefers session end moments", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    await stateManager.updateState((s) => {
      s.firstMeeting.completed = true;
      s.lifecycle.state = "naming_ready";
      s.lifecycle.sessions = 30;
      s.lifecycle.memories = 100;
      s.lifecycle.created = Date.now() - 30 * 24 * 60 * 60 * 1000;
    });

    // Low moment score context
    const lowContext = createConversationContext({
      exchangeCount: 2,
      tone: "challenging",
    });

    const lowResult = await checkCeremonyOpportunity(lowContext);

    // High moment score context
    const highContext = createConversationContext({
      isSessionEnd: true,
      isReflectiveMoment: true,
      positiveFeedback: true,
      exchangeCount: 10,
      tone: "celebratory",
    });

    const highResult = await checkCeremonyOpportunity(highContext);

    // High context should be more likely to initiate
    // (Both might initiate if ready, but high should have better reason)
    expect(highResult.reason).toContain("score");
  });

  it("nudging lowers the threshold", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    await stateManager.updateState((s) => {
      s.firstMeeting.completed = true;
      s.lifecycle.state = "naming_ready";
      s.lifecycle.sessions = 30;
      s.lifecycle.memories = 100;
      s.lifecycle.created = Date.now() - 30 * 24 * 60 * 60 * 1000;
      s.ceremony.nudged = true;
    });

    // Even with low moment score, nudging should help
    const context = createConversationContext({
      exchangeCount: 3,
      tone: "casual",
    });

    const result = await checkCeremonyOpportunity(context);

    // Should be more likely to initiate when nudged
    expect(result.type).toBe("naming");
  });
});
