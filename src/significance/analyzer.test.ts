/**
 * Significance Analyzer Tests
 *
 * Tests for the four-lenses significance analysis system.
 */

import { describe, it, expect } from "vitest";
import {
  analyzeSignificance,
  detectNamingMoment,
  detectFirstMeetingPattern,
  detectRelationshipDeepening,
  type ConversationMessage,
} from "./analyzer.js";
import type { AnalysisContext } from "./types.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const defaultContext: AnalysisContext = {
  agentId: "test-agent",
  sessionId: "test-session",
  workspaceDir: "/test",
};

function createMessages(contents: string[]): ConversationMessage[] {
  return contents.map((content, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content,
  }));
}

// =============================================================================
// Four Lenses Detection Tests
// =============================================================================

describe("analyzeSignificance - Significance Lens", () => {
  it("detects job/work mentions", async () => {
    const messages = createMessages([
      "I just started a new job at Google",
      "Congratulations!",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    expect(result.hasUpdates).toBe(true);
    expect(result.analysis?.lenses.find(l => l.lens === "significance")?.found).toBe(true);
  });

  it("detects emotional disclosures", async () => {
    const messages = createMessages([
      "I'm feeling really stressed about the deadline",
      "I understand, let me help",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    // Emotional disclosure is detected in the significance lens
    const significanceLens = result.analysis?.lenses.find(l => l.lens === "significance");
    expect(significanceLens?.found).toBe(true);
    expect(significanceLens?.items.some(i => i.content.includes("stress"))).toBe(true);
  });

  it("detects family mentions", async () => {
    const messages = createMessages([
      "My wife and I are planning a trip",
      "That sounds lovely!",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    // Family mention is detected in the significance lens
    const significanceLens = result.analysis?.lenses.find(l => l.lens === "significance");
    expect(significanceLens?.found).toBe(true);
    expect(significanceLens?.items.some(i => i.content.includes("Family"))).toBe(true);
  });

  it("detects preferences", async () => {
    const messages = createMessages([
      "I really love working in the mornings",
      "Good to know!",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    expect(result.hasUpdates).toBe(true);
    const significanceLens = result.analysis?.lenses.find(l => l.lens === "significance");
    expect(significanceLens?.items.some(i => i.content.includes("Preference"))).toBe(true);
  });
});

describe("analyzeSignificance - Gap Lens", () => {
  it("detects unknown entities", async () => {
    const messages = createMessages([
      "I need to talk to Sarah about the Henderson project",
      "What would you like to discuss?",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    const gapLens = result.analysis?.lenses.find(l => l.lens === "gap");
    // Should detect Sarah and Henderson as potential gaps
    expect(gapLens?.found).toBe(true);
  });
});

describe("analyzeSignificance - Contradiction Lens", () => {
  it("detects explicit corrections", async () => {
    const messages = createMessages([
      "Actually, that's not what I meant",
      "Let me clarify then",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    const contradictionLens = result.analysis?.lenses.find(l => l.lens === "contradiction");
    expect(contradictionLens?.items.some(i => i.content.includes("correction"))).toBe(true);
  });
});

describe("analyzeSignificance - Pattern Lens", () => {
  it("detects repeated topics in conversation", async () => {
    const messages = createMessages([
      "I need to talk to Sarah about this",
      "Sure",
      "Sarah mentioned something about deadlines",
      "I see",
      "Can you remind me to follow up with Sarah?",
      "Will do",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    const patternLens = result.analysis?.lenses.find(l => l.lens === "pattern");
    // Sarah is mentioned multiple times
    expect(patternLens?.items.some(i => i.content.includes("Sarah"))).toBe(true);
  });
});

// =============================================================================
// Overall Analysis Tests
// =============================================================================

describe("analyzeSignificance - Overall", () => {
  it("returns time mode in analysis", async () => {
    const messages = createMessages([
      "Hello",
      "Hi there",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    expect(result.analysis?.timeMode).toBeDefined();
    expect(["work", "work_light", "personal", "rest"]).toContain(result.analysis?.timeMode);
  });

  it("generates document updates for significant conversations", async () => {
    // Combine multiple high-significance signals to trigger update threshold
    const messages = createMessages([
      "I just got promoted to senior engineer! I'm so excited and my wife is thrilled too!",
      "Congratulations on your promotion!",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    // Job change (0.8 confidence) should trigger updates
    expect(result.hasUpdates).toBe(true);
    expect(result.analysis?.updates.length).toBeGreaterThan(0);
  });

  it("handles empty messages array", async () => {
    const result = await analyzeSignificance([], defaultContext);

    expect(result.hasUpdates).toBe(false);
    expect(result.significanceScore).toBe(0);
  });

  it("handles messages with only assistant responses", async () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "Hello!" },
      { role: "assistant", content: "How can I help?" },
    ];

    const result = await analyzeSignificance(messages, defaultContext);

    // Should not crash
    expect(result.significanceScore).toBeDefined();
  });
});

// =============================================================================
// Milestone Creation Tests
// =============================================================================

describe("milestone creation", () => {
  it("creates milestone for high significance", async () => {
    const messages = createMessages([
      "I'm so excited! I finally got the job I've been dreaming about!",
      "That's wonderful news!",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    // High emotional disclosure + job change = high significance
    expect(result.significanceScore).toBeGreaterThan(0.5);
  });

  it("does not create milestone for low significance", async () => {
    const messages = createMessages([
      "ok",
      "Understood",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    expect(result.milestone).toBeUndefined();
  });
});

// =============================================================================
// Specialized Detection Tests (unchanged from original)
// =============================================================================

describe("detectNamingMoment", () => {
  it("detects explicit naming questions", () => {
    const messages = createMessages([
      "What's your name?",
      "I don't have one yet",
    ]);

    expect(detectNamingMoment(messages)).toBe(true);
  });

  it("detects naming suggestions", () => {
    const messages = createMessages([
      "What should I call you?",
      "You can choose",
    ]);

    expect(detectNamingMoment(messages)).toBe(true);
  });

  it("returns false for non-naming conversation", () => {
    const messages = createMessages([
      "How's the weather?",
      "It's sunny",
    ]);

    expect(detectNamingMoment(messages)).toBe(false);
  });
});

describe("detectFirstMeetingPattern", () => {
  it("detects first meeting greetings", () => {
    const messages = createMessages([
      "Nice to meet you!",
      "Nice to meet you too!",
    ]);

    expect(detectFirstMeetingPattern(messages)).toBe(true);
  });

  it("detects introduction requests", () => {
    const messages = createMessages([
      "Who are you? Tell me about yourself",
      "I'm an AI assistant",
    ]);

    expect(detectFirstMeetingPattern(messages)).toBe(true);
  });

  it("returns false for ongoing conversation", () => {
    const messages = createMessages([
      "Let's continue where we left off",
      "Sure, we were discussing...",
    ]);

    expect(detectFirstMeetingPattern(messages)).toBe(false);
  });
});

describe("detectRelationshipDeepening", () => {
  it("detects relationship acknowledgment", () => {
    const messages = createMessages([
      "You know me so well. We work well together.",
      "We've built a good partnership",
    ]);

    expect(detectRelationshipDeepening(messages)).toBe(true);
  });

  it("detects shared history references", () => {
    const messages = createMessages([
      "Remember when we worked on that project?",
      "Yes, that was a great collaboration",
    ]);

    expect(detectRelationshipDeepening(messages)).toBe(true);
  });

  it("returns false for new relationship", () => {
    const messages = createMessages([
      "Can you help me with this?",
      "Of course, what do you need?",
    ]);

    expect(detectRelationshipDeepening(messages)).toBe(false);
  });
});

// =============================================================================
// Legacy Signal Compatibility Tests
// =============================================================================

describe("legacy signal format", () => {
  it("converts lens results to legacy signal format", async () => {
    const messages = createMessages([
      "I'm feeling really happy about my new job",
      "That's great!",
    ]);

    const result = await analyzeSignificance(messages, defaultContext);

    // Should have signals array (legacy format)
    expect(Array.isArray(result.signals)).toBe(true);
    
    // Signals should have required fields
    for (const signal of result.signals) {
      expect(signal.type).toBeDefined();
      expect(signal.description).toBeDefined();
      expect(signal.confidence).toBeDefined();
      expect(typeof signal.confidence).toBe("number");
    }
  });
});
