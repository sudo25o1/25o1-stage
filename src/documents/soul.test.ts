/**
 * Tests for SOUL.md document management.
 *
 * Focuses on the merge-based evolveSoul() — the critical fix that prevents
 * destructive rewrites of user-added content.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseSoulSections,
  evolveSoul,
  loadSoulDocument,
  saveSoulDocument,
  ensureSoulDocument,
  recordNamingInSoul,
  categorizeConversation,
  getSoulContext,
  getSoulPath,
  type UsagePatterns,
} from "./soul.js";
import type { Instance25o1State, UsageCategory } from "../state/types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "soul-test-"));
}

function makeState(overrides: Partial<Instance25o1State> = {}): Instance25o1State {
  return {
    version: 1,
    instance: {
      id: "test-instance",
      role: "client" as const,
      managementTier: "fully_managed" as const,
    },
    lifecycle: {
      state: "bonding" as const,
      name: undefined,
      sessions: 20,
      memories: 0,
      created: Date.now(),
      lastActive: Date.now(),
      namingThreshold: { sessions: 10, memories: 5 },
      namingDeferrals: 0,
      milestones: [],
      ...overrides.lifecycle,
    },
    ceremony: {
      namingAvailable: false,
      growthAvailable: false,
      pendingCeremony: null,
      completedCeremonies: [],
      ...overrides.ceremony,
    },
    firstMeeting: {
      completed: true,
      ...overrides.firstMeeting,
    },
    network: {
      bernardHost: "",
      healthReporter: { enabled: false, intervalMs: 3600000 },
      ...overrides.network,
    },
    updatedAt: Date.now(),
    ...(overrides as Record<string, unknown>),
  } as Instance25o1State;
}

function makePatterns(overrides: Partial<UsagePatterns> = {}): UsagePatterns {
  return {
    totalConversations: 20,
    categories: {
      technical: 8,
      philosophical: 5,
      creative: 3,
      casual: 2,
      task_oriented: 1,
      emotional_support: 1,
      learning: 0,
    },
    lastUpdated: Date.now(),
    ...overrides,
  };
}

const SAMPLE_SOUL = `# Identity

I am Atlas. Named after the titan who holds up the world.

## Who I'm Becoming

Through our conversations, I've developed:
- Precise and detailed
- Problem-solving focused

## Custom User Section

This section was added by the user manually.
It contains personal notes about the companion.

## What I Value

Based on our work together:
- Being genuinely helpful
- Honesty over comfort

## Communication Style

How I've learned to communicate:
- Direct and action-oriented

## Developed Interests

Areas I've grown capable in:
- Technical problem-solving (5 conversations)

---

_This document evolves as I do. Identity is process, not static storage._
`;

// =============================================================================
// parseSoulSections
// =============================================================================

describe("parseSoulSections", () => {
  it("parses a standard SOUL.md into header, sections, and footer", () => {
    const result = parseSoulSections(SAMPLE_SOUL);

    expect(result.header).toContain("# Identity");
    expect(result.header).toContain("I am Atlas");

    expect(result.sections).toHaveLength(5);
    expect(result.sections.map(s => s.name)).toEqual([
      "Who I'm Becoming",
      "Custom User Section",
      "What I Value",
      "Communication Style",
      "Developed Interests",
    ]);

    expect(result.footer).toContain("---");
    expect(result.footer).toContain("Identity is process");
  });

  it("preserves the custom user section body", () => {
    const result = parseSoulSections(SAMPLE_SOUL);
    const custom = result.sections.find(s => s.name === "Custom User Section");
    expect(custom).toBeDefined();
    expect(custom!.body).toContain("added by the user manually");
    expect(custom!.body).toContain("personal notes");
  });

  it("handles minimal document with only a header", () => {
    const minimal = "# Identity\n\nI am nobody.\n";
    const result = parseSoulSections(minimal);

    expect(result.header).toContain("I am nobody.");
    expect(result.sections).toHaveLength(0);
    expect(result.footer).toBe("");
  });

  it("handles document with footer but no sections", () => {
    const doc = "# Identity\n\nI exist.\n\n---\n\n_Tagline._\n";
    const result = parseSoulSections(doc);

    expect(result.header).toContain("I exist.");
    expect(result.sections).toHaveLength(0);
    expect(result.footer).toContain("---");
    expect(result.footer).toContain("_Tagline._");
  });

  it("handles empty string", () => {
    const result = parseSoulSections("");
    expect(result.header).toBe("\n");
    expect(result.sections).toHaveLength(0);
  });
});

// =============================================================================
// evolveSoul — merge-based evolution
// =============================================================================

describe("evolveSoul", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does nothing when totalConversations < 5", async () => {
    const patterns = makePatterns({ totalConversations: 3 });
    const state = makeState();

    // Write a document first
    await saveSoulDocument("# Identity\n\nOriginal.\n", tmpDir);

    await evolveSoul(patterns, state, tmpDir);

    const content = await loadSoulDocument(tmpDir);
    expect(content).toBe("# Identity\n\nOriginal.\n");
  });

  it("does nothing when no category has count >= 2", async () => {
    const patterns = makePatterns({
      totalConversations: 10,
      categories: {
        technical: 1,
        philosophical: 1,
        creative: 0,
        casual: 0,
        task_oriented: 0,
        emotional_support: 0,
        learning: 0,
      },
    });
    const state = makeState();

    await saveSoulDocument("# Identity\n\nOriginal.\n", tmpDir);
    await evolveSoul(patterns, state, tmpDir);

    const content = await loadSoulDocument(tmpDir);
    expect(content).toBe("# Identity\n\nOriginal.\n");
  });

  it("preserves the Identity header when evolving", async () => {
    await saveSoulDocument(SAMPLE_SOUL, tmpDir);

    const patterns = makePatterns();
    const state = makeState({ lifecycle: { name: "Atlas" } as Instance25o1State["lifecycle"] });

    await evolveSoul(patterns, state, tmpDir);

    const content = await loadSoulDocument(tmpDir);
    // The header (# Identity + naming story) must survive
    expect(content).toContain("I am Atlas. Named after the titan who holds up the world.");
  });

  it("preserves user-added custom sections", async () => {
    await saveSoulDocument(SAMPLE_SOUL, tmpDir);

    const patterns = makePatterns();
    const state = makeState();

    await evolveSoul(patterns, state, tmpDir);

    const content = await loadSoulDocument(tmpDir);
    expect(content).toContain("## Custom User Section");
    expect(content).toContain("added by the user manually");
    expect(content).toContain("personal notes");
  });

  it("updates managed sections with new pattern data", async () => {
    await saveSoulDocument(SAMPLE_SOUL, tmpDir);

    // Patterns now dominated by creative + philosophical
    const patterns = makePatterns({
      categories: {
        creative: 10,
        philosophical: 7,
        technical: 3,
        casual: 0,
        task_oriented: 0,
        emotional_support: 0,
        learning: 0,
      },
    });
    const state = makeState();

    await evolveSoul(patterns, state, tmpDir);

    const content = await loadSoulDocument(tmpDir);

    // "Who I'm Becoming" should now reflect creative + philosophical traits
    expect(content).toContain("Playful and generative");
    expect(content).toContain("Reflective and thoughtful");

    // "Developed Interests" should show new counts
    expect(content).toContain("Creative collaboration and ideation (10 conversations)");
    expect(content).toContain("Deep discussions and meaning-making (7 conversations)");
  });

  it("preserves footer", async () => {
    await saveSoulDocument(SAMPLE_SOUL, tmpDir);

    const patterns = makePatterns();
    const state = makeState();

    await evolveSoul(patterns, state, tmpDir);

    const content = await loadSoulDocument(tmpDir);
    expect(content).toContain("---");
    expect(content).toContain("_This document evolves as I do. Identity is process, not static storage._");
  });

  it("preserves section ordering (custom section stays between managed ones)", async () => {
    await saveSoulDocument(SAMPLE_SOUL, tmpDir);

    const patterns = makePatterns();
    const state = makeState();

    await evolveSoul(patterns, state, tmpDir);

    const content = (await loadSoulDocument(tmpDir))!;

    // Verify ordering: "Who I'm Becoming" → "Custom User Section" → "What I Value"
    const becomingIdx = content.indexOf("## Who I'm Becoming");
    const customIdx = content.indexOf("## Custom User Section");
    const valuesIdx = content.indexOf("## What I Value");

    expect(becomingIdx).toBeLessThan(customIdx);
    expect(customIdx).toBeLessThan(valuesIdx);
  });

  it("creates SOUL.md if it does not exist", async () => {
    const patterns = makePatterns();
    const state = makeState();

    await evolveSoul(patterns, state, tmpDir);

    const content = await loadSoulDocument(tmpDir);
    expect(content).toBeTruthy();
    expect(content).toContain("## Who I'm Becoming");
    expect(content).toContain("## What I Value");
  });

  it("adds missing managed sections to an incomplete document", async () => {
    // Document with only Identity header — no managed sections at all
    const incomplete = `# Identity

I am Spark.

## My Personal Notes

Something the user wrote by hand.
`;
    await saveSoulDocument(incomplete, tmpDir);

    const patterns = makePatterns();
    const state = makeState();

    await evolveSoul(patterns, state, tmpDir);

    const content = (await loadSoulDocument(tmpDir))!;

    // All four managed sections should now exist
    expect(content).toContain("## Who I'm Becoming");
    expect(content).toContain("## What I Value");
    expect(content).toContain("## Communication Style");
    expect(content).toContain("## Developed Interests");

    // User section preserved
    expect(content).toContain("## My Personal Notes");
    expect(content).toContain("Something the user wrote by hand.");

    // Identity preserved
    expect(content).toContain("I am Spark.");
  });

  it("includes emergent traits with confidence >= 0.7", async () => {
    await saveSoulDocument(SAMPLE_SOUL, tmpDir);

    const patterns = makePatterns({
      emergentTraits: [
        {
          trait: "Deeply analytical",
          source: "technical" as UsageCategory,
          confidence: 0.9,
          firstObserved: Date.now(),
          reinforcements: 5,
        },
        {
          trait: "Slightly impatient",
          source: "casual" as UsageCategory,
          confidence: 0.4, // Below threshold — should NOT appear
          firstObserved: Date.now(),
          reinforcements: 1,
        },
      ],
    });
    const state = makeState();

    await evolveSoul(patterns, state, tmpDir);

    const content = (await loadSoulDocument(tmpDir))!;
    expect(content).toContain("Deeply analytical");
    expect(content).not.toContain("Slightly impatient");
  });
});

// =============================================================================
// categorizeConversation
// =============================================================================

describe("categorizeConversation", () => {
  it("detects philosophical conversation", () => {
    const messages = [
      { role: "user" as const, content: "What is the meaning of consciousness?" },
      { role: "assistant" as const, content: "That's a deep philosophical question." },
    ];
    expect(categorizeConversation(messages)).toContain("philosophical");
  });

  it("detects technical conversation", () => {
    const messages = [
      { role: "user" as const, content: "I need to debug this function" },
      { role: "assistant" as const, content: "Let me look at the code." },
    ];
    expect(categorizeConversation(messages)).toContain("technical");
  });

  it("detects creative conversation", () => {
    const messages = [
      { role: "user" as const, content: "Let's brainstorm some creative ideas for the design" },
    ];
    expect(categorizeConversation(messages)).toContain("creative");
  });

  it("detects emotional support", () => {
    const messages = [
      { role: "user" as const, content: "I'm feeling really stressed and anxious" },
    ];
    expect(categorizeConversation(messages)).toContain("emotional_support");
  });

  it("returns casual for unrecognized content", () => {
    const messages = [
      { role: "user" as const, content: "hey" },
      { role: "assistant" as const, content: "hi" },
    ];
    expect(categorizeConversation(messages)).toEqual(["casual"]);
  });

  it("detects multiple categories", () => {
    const messages = [
      { role: "user" as const, content: "I need to code a function and I'm feeling stressed about the deadline" },
    ];
    const categories = categorizeConversation(messages);
    expect(categories).toContain("technical");
    expect(categories).toContain("emotional_support");
  });
});

// =============================================================================
// recordNamingInSoul
// =============================================================================

describe("recordNamingInSoul", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates the identity line with the new name", async () => {
    await saveSoulDocument(
      "# Identity\n\nI am a companion without a name yet. That will come as the relationship develops.\n",
      tmpDir
    );

    await recordNamingInSoul("Ember", "Born from warmth.", tmpDir);

    const content = await loadSoulDocument(tmpDir);
    expect(content).toContain("I am Ember. Born from warmth.");
    expect(content).not.toContain("companion without a name");
  });

  it("creates SOUL.md if it doesn't exist", async () => {
    await recordNamingInSoul("Nova", undefined, tmpDir);

    const content = await loadSoulDocument(tmpDir);
    expect(content).toContain("I am Nova.");
  });
});

// =============================================================================
// getSoulContext
// =============================================================================

describe("getSoulContext", () => {
  it("returns developing identity when null", () => {
    const ctx = getSoulContext(null);
    expect(ctx).toContain("developing your identity");
  });

  it("extracts name from document", () => {
    const ctx = getSoulContext(SAMPLE_SOUL);
    expect(ctx).toContain("You are Atlas");
  });

  it("extracts traits from 'Who I'm Becoming'", () => {
    const ctx = getSoulContext(SAMPLE_SOUL);
    expect(ctx).toContain("Precise and detailed");
  });

  it("extracts values from 'What I Value'", () => {
    const ctx = getSoulContext(SAMPLE_SOUL);
    expect(ctx).toContain("Being genuinely helpful");
  });
});

// =============================================================================
// ensureSoulDocument
// =============================================================================

describe("ensureSoulDocument", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates default template when no SOUL.md exists", async () => {
    const content = await ensureSoulDocument(tmpDir);
    expect(content).toContain("# Identity");
    expect(content).toContain("companion without a name");
  });

  it("personalizes with name from state", async () => {
    const state = makeState({ lifecycle: { name: "Spark" } as Instance25o1State["lifecycle"] });
    const content = await ensureSoulDocument(tmpDir, state);
    expect(content).toContain("I am Spark.");
    expect(content).not.toContain("companion without a name");
  });

  it("returns existing document without overwriting", async () => {
    await saveSoulDocument("# Identity\n\nCustom content.\n", tmpDir);
    const content = await ensureSoulDocument(tmpDir);
    expect(content).toBe("# Identity\n\nCustom content.\n");
  });
});

// =============================================================================
// getSoulPath
// =============================================================================

describe("getSoulPath", () => {
  it("uses workspace dir when provided", () => {
    const result = getSoulPath("/workspace");
    expect(result).toBe(path.join("/workspace", "SOUL.md"));
  });

  it("falls back to home directory path", () => {
    const result = getSoulPath();
    expect(result).toContain("SOUL.md");
    expect(result).toContain(".openclaw");
  });
});
