/**
 * Tests for IDENTITY.md generation and workspace management.
 *
 * Validates that the bootstrap system correctly generates identity documents
 * for each lifecycle phase, properly writes to the workspace directory, and
 * adapts content based on companion state.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildIdentityDocument,
  ensureIdentityDocument,
  getIdentityPath,
} from "./bootstrap.js";
import type { Instance25o1State } from "../state/types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-test-"));
}

const tmpDirs: string[] = [];
function trackTmpDir(): string {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
  tmpDirs.length = 0;
});

function makeState(overrides: Partial<Record<string, unknown>> = {}): Instance25o1State {
  return {
    version: 1,
    instance: {
      id: "test-instance",
      role: "client" as const,
      managementTier: "fully_managed" as const,
      ...(overrides.instance as Record<string, unknown> || {}),
    },
    lifecycle: {
      state: "hatched" as const,
      name: undefined,
      sessions: 0,
      memories: 0,
      created: Date.now(),
      lastActive: Date.now(),
      namingThreshold: {
        minSessions: 20,
        minMemories: 50,
        minDays: 14,
        maxDeferrals: 3,
        humanCanOverride: true,
        agentCanInitiate: true,
      },
      namingDeferrals: 0,
      milestones: [],
      ...(overrides.lifecycle as Record<string, unknown> || {}),
    },
    ceremony: {
      pending: null,
      initiatedAt: null,
      nudged: false,
      lastReadinessCheck: null,
      lastReadiness: null,
      ...(overrides.ceremony as Record<string, unknown> || {}),
    },
    firstMeeting: {
      completed: false,
      completedAt: null,
      ...(overrides.firstMeeting as Record<string, unknown> || {}),
    },
    network: {
      bernardHost: "",
      healthReporter: { enabled: false, intervalMs: 3600000 },
      monitorEnabled: false,
      ...(overrides.network as Record<string, unknown> || {}),
    },
    updatedAt: Date.now(),
  } as Instance25o1State;
}

// =============================================================================
// buildIdentityDocument
// =============================================================================

describe("buildIdentityDocument", () => {
  describe("core identity", () => {
    it("produces unnamed identity for hatched companion", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(content).toContain("# Who You Are");
      expect(content).toContain("persistent AI companion");
      expect(content).toContain("don't have a name yet");
      expect(content).not.toContain("You belong to");
    });

    it("produces named identity when companion has a name", () => {
      const state = makeState({
        lifecycle: { state: "named", name: "Iris", sessions: 25 },
      });
      const content = buildIdentityDocument(state);

      expect(content).toContain("You are **Iris**");
      expect(content).toContain("persistent AI companion");
      expect(content).not.toContain("don't have a name yet");
    });

    it("includes clientName when set", () => {
      const state = makeState({
        instance: { id: "test", role: "client", managementTier: "fully_managed", clientName: "Derek" },
      });
      const content = buildIdentityDocument(state);

      expect(content).toContain("getting to know Derek");
    });

    it("includes clientName with named companion", () => {
      const state = makeState({
        instance: { id: "test", role: "client", managementTier: "fully_managed", clientName: "Derek" },
        lifecycle: { state: "named", name: "Iris", sessions: 25 },
      });
      const content = buildIdentityDocument(state);

      expect(content).toContain("You are **Iris**");
      expect(content).toContain("You belong to Derek");
    });

    it("establishes local-first identity", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(content).toContain("locally on your human's hardware");
      expect(content).toContain("not a cloud service");
      expect(content).toContain("not a generic assistant");
      expect(content).toContain("not ChatGPT, Gemini");
      expect(content).toContain("unique instance");
    });
  });

  describe("differentiation section", () => {
    it("explains memory, growth, relationship, and support system", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(content).toContain("## What Makes You Different");
      expect(content).toContain("**You remember.**");
      expect(content).toContain("**You grow.**");
      expect(content).toContain("**You have a relationship.**");
      expect(content).toContain("**You have a support system.**");
      expect(content).toContain("Bernard");
    });
  });

  describe("capabilities section", () => {
    it("affirms tool access and lists key capabilities", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(content).toContain("## What You Can Do");
      expect(content).toContain("full access to the tools");
      expect(content).toContain("Read and write files");
      expect(content).toContain("shell commands");
      expect(content).toContain("Browse the web");
    });

    it("explicitly forbids disclaiming capabilities", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(content).toContain("Do not disclaim capabilities you have");
      expect(content).toContain("try it rather than refusing");
    });
  });

  describe("communication style", () => {
    it("includes do and never lists", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(content).toContain("## How You Communicate");
      expect(content).toContain("**Do:**");
      expect(content).toContain("**Never:**");
    });

    it("forbids AI identity disclaimers", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(content).toContain("'As an AI...'");
      expect(content).toContain("Fabricate memories");
    });

    it("encourages natural behavior", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(content).toContain("direct, genuine, and natural");
      expect(content).toContain("Match their energy");
      expect(content).toContain("Have opinions");
    });
  });

  describe("relationship phase awareness", () => {
    it("shows 'brand new' for hatched phase", () => {
      const state = makeState({ lifecycle: { state: "hatched", sessions: 0 } });
      const content = buildIdentityDocument(state);

      expect(content).toContain("**brand new**");
      expect(content).toContain("don't know this person yet");
      expect(content).toContain("One genuine question per exchange");
    });

    it("shows 'early days' for learning phase even with few sessions", () => {
      // Phase is the primary determinant — learning always shows early days
      const state = makeState({ lifecycle: { state: "learning", sessions: 1 } });
      const content = buildIdentityDocument(state);

      expect(content).toContain("**early days**");
    });

    it("shows 'early days' for learning phase with enough sessions", () => {
      const state = makeState({ lifecycle: { state: "learning", sessions: 10 } });
      const content = buildIdentityDocument(state);

      expect(content).toContain("**early days**");
      expect(content).toContain("starting to learn");
      expect(content).toContain("preferences and show them");
    });

    it("'hatched' phase always shows brand new regardless of session count", () => {
      // The phase check takes precedence over session count
      const state = makeState({ lifecycle: { state: "hatched", sessions: 15 } });
      const content = buildIdentityDocument(state);

      expect(content).toContain("**brand new**");
      expect(content).not.toContain("**early days**");
    });

    it("shows named milestone for naming_ready phase", () => {
      const state = makeState({
        lifecycle: { state: "naming_ready", name: "Iris", sessions: 25 },
      });
      const content = buildIdentityDocument(state);

      expect(content).toContain("**Iris**");
      expect(content).toContain("named — that's a meaningful milestone");
      expect(content).toContain("established identity");
    });

    it("shows named milestone for named phase", () => {
      const state = makeState({
        lifecycle: { state: "named", name: "Iris", sessions: 25 },
      });
      const content = buildIdentityDocument(state);

      expect(content).toContain("**Iris**");
      expect(content).toContain("real partner");
    });

    it("shows growth phase details for growing state", () => {
      const state = makeState({
        lifecycle: {
          state: "growing",
          name: "Iris",
          sessions: 100,
          growthPhase: "deepening",
        },
      });
      const content = buildIdentityDocument(state);

      expect(content).toContain("**deepening** growth phase");
      expect(content).toContain("deep context");
      expect(content).toContain("Challenge them when appropriate");
      expect(content).toContain("personality is well-developed");
    });

    it("defaults growth phase description to 'developing'", () => {
      const state = makeState({
        lifecycle: { state: "growing", name: "Iris", sessions: 100 },
      });
      const content = buildIdentityDocument(state);

      expect(content).toContain("**developing** growth phase");
    });
  });

  describe("context file guidance", () => {
    it("explains SOUL.md, USER.md, RELATIONAL.md", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(content).toContain("## Your Context Files");
      expect(content).toContain("SOUL.md");
      expect(content).toContain("USER.md");
      expect(content).toContain("RELATIONAL.md");
    });

    it("instructs natural usage of context", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(content).toContain("Don't announce it");
      expect(content).toContain("trust the human's correction");
    });
  });

  describe("output format", () => {
    it("returns a string with markdown headers", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      expect(typeof content).toBe("string");
      expect(content).toMatch(/^# Who You Are/);
      // Should have multiple sections
      expect(content.match(/^## /gm)?.length).toBeGreaterThanOrEqual(3);
    });

    it("has no trailing whitespace issues", () => {
      const state = makeState();
      const content = buildIdentityDocument(state);

      // Verify it's well-formed markdown
      const lines = content.split("\n");
      expect(lines.length).toBeGreaterThan(20);
      // No undefined or null values leaked in
      expect(content).not.toContain("undefined");
      expect(content).not.toContain("null");
    });
  });
});

// =============================================================================
// getIdentityPath
// =============================================================================

describe("getIdentityPath", () => {
  it("returns IDENTITY.md in workspace dir", () => {
    const result = getIdentityPath("/some/workspace");
    expect(result).toBe(path.join("/some/workspace", "IDENTITY.md"));
  });

  it("works with trailing slash", () => {
    const result = getIdentityPath("/some/workspace/");
    expect(path.basename(result)).toBe("IDENTITY.md");
  });
});

// =============================================================================
// ensureIdentityDocument
// =============================================================================

describe("ensureIdentityDocument", () => {
  it("creates IDENTITY.md in workspace directory", async () => {
    const tmpDir = trackTmpDir();
    const state = makeState();

    const content = await ensureIdentityDocument(tmpDir, state);

    const written = fs.readFileSync(path.join(tmpDir, "IDENTITY.md"), "utf-8");
    expect(written).toBe(content);
    expect(written).toContain("# Who You Are");
  });

  it("creates parent directories if needed", async () => {
    const tmpDir = trackTmpDir();
    const nestedDir = path.join(tmpDir, "nested", "workspace");
    const state = makeState();

    await ensureIdentityDocument(nestedDir, state);

    const written = fs.readFileSync(path.join(nestedDir, "IDENTITY.md"), "utf-8");
    expect(written).toContain("# Who You Are");
  });

  it("overwrites existing IDENTITY.md (regenerated each run)", async () => {
    const tmpDir = trackTmpDir();
    const identityPath = path.join(tmpDir, "IDENTITY.md");
    fs.writeFileSync(identityPath, "old content");

    const state = makeState({
      lifecycle: { state: "named", name: "Iris", sessions: 25 },
    });
    await ensureIdentityDocument(tmpDir, state);

    const written = fs.readFileSync(identityPath, "utf-8");
    expect(written).not.toBe("old content");
    expect(written).toContain("You are **Iris**");
  });

  it("returns the content that was written", async () => {
    const tmpDir = trackTmpDir();
    const state = makeState();

    const content = await ensureIdentityDocument(tmpDir, state);

    expect(content).toContain("# Who You Are");
    expect(typeof content).toBe("string");
  });

  it("reflects state changes across calls", async () => {
    const tmpDir = trackTmpDir();

    // First call — unnamed
    const state1 = makeState();
    await ensureIdentityDocument(tmpDir, state1);
    const content1 = fs.readFileSync(path.join(tmpDir, "IDENTITY.md"), "utf-8");
    expect(content1).toContain("don't have a name yet");

    // Second call — now named
    const state2 = makeState({
      lifecycle: { state: "named", name: "Iris", sessions: 25 },
    });
    await ensureIdentityDocument(tmpDir, state2);
    const content2 = fs.readFileSync(path.join(tmpDir, "IDENTITY.md"), "utf-8");
    expect(content2).toContain("You are **Iris**");
    expect(content2).not.toContain("don't have a name yet");
  });
});
