/**
 * First Meeting Ceremony Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isFirstMeeting,
  recordFirstMeetingComplete,
  generateFirstMeetingMessage,
  generateAbbreviatedFirstMeeting,
  adjustForChannel,
  checkFirstMeetingCompletion,
  analyzeFirstMeeting,
  generateFirstMeetingContext,
  type FirstMeetingContext,
} from "./first-meeting.js";
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
  // Create a temp directory for test state
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "25o1-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = testDir;

  // Create .openclaw directory
  fs.mkdirSync(path.join(testDir, ".openclaw"), { recursive: true });

  // Reset state manager
  const stateManager = getStateManager();
  // @ts-expect-error - accessing private for test reset
  stateManager.state = null;
  // @ts-expect-error - accessing private for test reset
  stateManager.loaded = false;
});

afterEach(() => {
  // Restore HOME
  if (originalHome) {
    process.env.HOME = originalHome;
  }

  // Clean up temp directory
  if (testDir) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

// =============================================================================
// Test Fixtures
// =============================================================================

function createContext(overrides: Partial<FirstMeetingContext> = {}): FirstMeetingContext {
  return {
    agentId: "test-agent",
    channel: "telegram",
    is25o1Instance: true,
    ...overrides,
  };
}

// =============================================================================
// First Meeting Detection Tests
// =============================================================================

describe("isFirstMeeting", () => {
  it("returns true when no state exists", async () => {
    const result = await isFirstMeeting("test-agent");
    expect(result).toBe(true);
  });

  it("returns true when state exists but first meeting not completed", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    const result = await isFirstMeeting("test-agent");
    expect(result).toBe(true);
  });

  it("returns false when first meeting is completed", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    await recordFirstMeetingComplete("test-agent");

    const result = await isFirstMeeting("test-agent");
    expect(result).toBe(false);
  });
});

// =============================================================================
// First Meeting Recording Tests
// =============================================================================

describe("recordFirstMeetingComplete", () => {
  it("marks first meeting as completed", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    await recordFirstMeetingComplete("test-agent");

    const state = await stateManager.getState();
    expect(state?.firstMeeting.completed).toBe(true);
    expect(state?.firstMeeting.completedAt).toBeDefined();
  });

  it("adds first meeting milestone", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    await recordFirstMeetingComplete("test-agent");

    const state = await stateManager.getState();
    const milestone = state?.lifecycle.milestones.find((m) => m.type === "first_meeting");
    expect(milestone).toBeDefined();
    expect(milestone?.description).toBe("First meeting completed");
  });

  it("transitions state from hatched to learning", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    const stateBefore = await stateManager.getState();
    expect(stateBefore?.lifecycle.state).toBe("hatched");

    await recordFirstMeetingComplete("test-agent");

    const stateAfter = await stateManager.getState();
    expect(stateAfter?.lifecycle.state).toBe("learning");
  });

  it("clears ceremony.pending when first meeting completes", async () => {
    const stateManager = getStateManager();
    await stateManager.initialize("test-agent", {
      role: "client",
      managementTier: "fully_managed",
    });

    // Simulate stuck state: ceremony.pending still set
    await stateManager.updateState((s) => {
      s.ceremony.pending = "first_meeting";
      s.ceremony.initiatedAt = Date.now() - 86400000; // 1 day ago
    });

    const stateBefore = await stateManager.getState();
    expect(stateBefore?.ceremony.pending).toBe("first_meeting");

    await recordFirstMeetingComplete("test-agent");

    const stateAfter = await stateManager.getState();
    expect(stateAfter?.ceremony.pending).toBeNull();
    expect(stateAfter?.ceremony.initiatedAt).toBeNull();
  });
});

// =============================================================================
// Message Generation Tests
// =============================================================================

describe("generateFirstMeetingMessage", () => {
  it("generates basic first meeting message", () => {
    const context = createContext();
    const message = generateFirstMeetingMessage(context);

    expect(message).toContain("AI companion");
    expect(message).toContain("name");
  });

  it("varies greeting based on time of day - morning", () => {
    const context = createContext({ currentHour: 9 });
    const message = generateFirstMeetingMessage(context);

    expect(message).toContain("Hi");
    expect(message).toContain("working on");
  });

  it("varies greeting based on time of day - evening", () => {
    const context = createContext({ currentHour: 20 });
    const message = generateFirstMeetingMessage(context);

    expect(message).toContain("Hey");
    expect(message).toContain("evening");
  });

  it("excludes support system from user-facing message (now in context)", () => {
    const context = createContext({ is25o1Instance: true });
    const message = generateFirstMeetingMessage(context);

    // Support system info is now in the context injection, not the user message
    expect(message).not.toContain("support system");
  });

  it("asks a relevant question", () => {
    const context = createContext();
    const message = generateFirstMeetingMessage(context);

    // Should end with a question
    expect(message).toMatch(/\?$/);
  });
});

describe("generateAbbreviatedFirstMeeting", () => {
  it("generates a message with core elements", () => {
    const context = createContext();
    const message = generateAbbreviatedFirstMeeting(context);

    expect(message).toContain("AI companion");
    expect(message).toContain("name");
  });

  it("includes human name when provided", () => {
    const context = createContext({ humanName: "Derek" });
    const message = generateAbbreviatedFirstMeeting(context);

    expect(message).toContain("Hi Derek!");
  });

  it("mentions local Mac Mini for 25o1 instances", () => {
    const context = createContext({ is25o1Instance: true });
    const message = generateAbbreviatedFirstMeeting(context);

    expect(message).toContain("Mac Mini");
    expect(message).toContain("locally");
  });

  it("ends with call to action", () => {
    const context = createContext();
    const message = generateAbbreviatedFirstMeeting(context);

    expect(message).toContain("What would you like to work on?");
  });
});

// =============================================================================
// Channel Adjustment Tests
// =============================================================================

describe("adjustForChannel", () => {
  it("adjusts greeting for Discord", () => {
    const message = "Hi! I'm your new AI companion.";
    const adjusted = adjustForChannel(message, "discord");

    expect(adjusted).toContain("Hey!");
    expect(adjusted).not.toContain("Hi!");
  });

  it("leaves message unchanged for other channels", () => {
    const message = "Hi! I'm your new AI companion.";

    expect(adjustForChannel(message, "telegram")).toBe(message);
    expect(adjustForChannel(message, "slack")).toBe(message);
    expect(adjustForChannel(message, "unknown")).toBe(message);
  });
});

// =============================================================================
// First Meeting Completion Tests
// =============================================================================

describe("checkFirstMeetingCompletion", () => {
  it("does not complete for empty messages", () => {
    const result = checkFirstMeetingCompletion([]);
    
    expect(result.shouldComplete).toBe(false);
    expect(result.reason).toContain("No user messages");
  });

  it("does not complete for trivial exchanges", () => {
    const messages = [
      { role: "user" as const, content: "test" },
      { role: "assistant" as const, content: "Hello! How can I help?" },
    ];
    
    const result = checkFirstMeetingCompletion(messages);
    
    expect(result.shouldComplete).toBe(false);
    expect(result.reason).toContain("trivial");
  });

  it("does not complete for just hello", () => {
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "Hi there!" },
    ];
    
    const result = checkFirstMeetingCompletion(messages);
    
    expect(result.shouldComplete).toBe(false);
  });

  it("completes when user shares work context", () => {
    const messages = [
      { role: "user" as const, content: "Hey, I'm working on a new project" },
      { role: "assistant" as const, content: "That sounds interesting! What kind of project?" },
      { role: "user" as const, content: "A web app for tracking tasks" },
      { role: "assistant" as const, content: "Nice! What stack are you using?" },
    ];
    
    const result = checkFirstMeetingCompletion(messages);
    
    expect(result.shouldComplete).toBe(true);
    expect(result.learnedFacts.length).toBeGreaterThan(0);
  });

  it("completes when user shares emotional state", () => {
    const messages = [
      { role: "user" as const, content: "I'm feeling pretty stressed about a deadline" },
      { role: "assistant" as const, content: "I hear you. What's the deadline for?" },
      { role: "user" as const, content: "A presentation next week" },
      { role: "assistant" as const, content: "We can work through it together." },
    ];
    
    const result = checkFirstMeetingCompletion(messages);
    
    expect(result.shouldComplete).toBe(true);
    expect(result.learnedFacts).toContain("Shared emotional state");
  });

  it("requires enough exchange even with substance", () => {
    const messages = [
      { role: "user" as const, content: "I work at a tech company" },
      { role: "assistant" as const, content: "Interesting!" },
    ];
    
    const result = checkFirstMeetingCompletion(messages);
    
    // Has substance but not enough exchange
    expect(result.shouldComplete).toBe(false);
    expect(result.reason).toContain("waiting for more exchange");
  });

  it("extracts vibe observations", () => {
    const messages = [
      { role: "user" as const, content: "Hey! So excited to try this out! I've been wanting an AI assistant for ages!" },
      { role: "assistant" as const, content: "Happy to be here!" },
      { role: "user" as const, content: "Can you help me organize my thoughts on a project? It's pretty complex!" },
      { role: "assistant" as const, content: "Absolutely, tell me more." },
    ];
    
    const result = checkFirstMeetingCompletion(messages);
    
    expect(result.vibeObservations).toContain("Expressive");
  });
});

// =============================================================================
// First Meeting Analysis Tests
// =============================================================================

describe("analyzeFirstMeeting", () => {
  it("detects concise communication style", () => {
    const messages = [
      { role: "user" as const, content: "Hi" },
      { role: "assistant" as const, content: "Hello!" },
      { role: "user" as const, content: "Help with code" },
      { role: "assistant" as const, content: "Sure, what code?" },
    ];
    
    const result = analyzeFirstMeeting(messages);
    
    expect(result.communicationStyle.verbosity).toBe("concise");
  });

  it("detects detailed communication style", () => {
    const messages = [
      { role: "user" as const, content: "Hello! I'm really excited to work with you. I've been building this application for about three months now and I'm running into some challenges with the architecture. Specifically, I'm wondering about how to structure the data layer to handle real-time updates efficiently." },
      { role: "assistant" as const, content: "That's a great question!" },
    ];
    
    const result = analyzeFirstMeeting(messages);
    
    expect(result.communicationStyle.verbosity).toBe("detailed");
  });

  it("detects casual formality", () => {
    const messages = [
      { role: "user" as const, content: "hey yeah gonna need some help lol" },
      { role: "assistant" as const, content: "What's up?" },
    ];
    
    const result = analyzeFirstMeeting(messages);
    
    expect(result.communicationStyle.formality).toBe("casual");
  });

  it("detects formal communication", () => {
    const messages = [
      { role: "user" as const, content: "Thank you for your assistance. I would appreciate your help with a matter." },
      { role: "assistant" as const, content: "Of course." },
    ];
    
    const result = analyzeFirstMeeting(messages);
    
    expect(result.communicationStyle.formality).toBe("formal");
  });

  it("detects expressive style", () => {
    const messages = [
      { role: "user" as const, content: "This is amazing! I love it! Can't wait to see what we can do!" },
      { role: "assistant" as const, content: "Let's do it!" },
    ];
    
    const result = analyzeFirstMeeting(messages);
    
    expect(result.communicationStyle.expressiveness).toBe("expressive");
  });

  it("generates RELATIONAL.md content", () => {
    const messages = [
      { role: "user" as const, content: "Quick question about code" },
      { role: "assistant" as const, content: "Sure" },
    ];
    
    const result = analyzeFirstMeeting(messages);
    
    expect(result.relationalContent).toContain("Communication Patterns");
    expect(result.relationalContent).toContain("Preferences");
  });
});

// =============================================================================
// First Meeting Context Generation Tests
// =============================================================================

describe("generateFirstMeetingContext", () => {
  it("generates context with time awareness", () => {
    const context = createContext({ currentHour: 9 });
    const result = generateFirstMeetingContext(context);
    
    expect(result).toContain("First Meeting");
    expect(result).toContain("9:00 AM");
    expect(result).toContain("work");
  });

  it("includes 25o1 instance info", () => {
    const context = createContext({
      is25o1Instance: true,
      clientName: "TestClient",
    });
    const result = generateFirstMeetingContext(context);
    
    expect(result).toContain("locally");
    expect(result).toContain("Bernard");
  });

  it("includes guidance on how to behave", () => {
    const context = createContext();
    const result = generateFirstMeetingContext(context);
    
    expect(result).toContain("ONE good question");
    expect(result).toContain("Listen more than you talk");
    expect(result).toContain("NOT to do");
  });
});
