/**
 * RELATIONAL.md Document Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadRelationalDocument,
  saveRelationalDocument,
  createRelationalDocument,
  ensureRelationalDocument,
  relationalDocumentExists,
  injectRelationalContext,
  addGrowthMarker,
  addNote,
  recordNamingCeremony,
  recordGrowthTransition,
  getRelationalPath,
} from "./relational.js";
import type { Instance25o1State } from "../state/types.js";

// =============================================================================
// Test Setup
// =============================================================================

let testDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "25o1-relational-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = testDir;
  fs.mkdirSync(path.join(testDir, ".openclaw", "bernard"), { recursive: true });
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

function createTestState(overrides: Partial<Instance25o1State> = {}): Instance25o1State {
  return {
    version: 1,
    instance: {
      id: "test-agent",
      role: "client",
      managementTier: "fully_managed",
      clientName: "Test Client",
    },
    lifecycle: {
      state: "learning",
      sessions: 25,
      memories: 75,
      created: Date.now() - 20 * 24 * 60 * 60 * 1000, // 20 days ago
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
    },
    ceremony: {
      pending: null,
      initiatedAt: null,
      nudged: false,
      lastReadinessCheck: null,
      lastReadiness: null,
    },
    firstMeeting: {
      completed: true,
      completedAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
    },
    network: {
      healthReporter: {
        enabled: false,
        intervalMs: 60000,
      },
      monitorEnabled: false,
    },
    updatedAt: Date.now(),
    ...overrides,
  };
}

// =============================================================================
// Loading Tests
// =============================================================================

describe("loadRelationalDocument", () => {
  it("returns null when file does not exist", async () => {
    const result = await loadRelationalDocument(testDir);
    expect(result).toBeNull();
  });

  it("loads existing document", async () => {
    const content = "# Test Relational Document";
    const relPath = getRelationalPath(testDir);
    await fs.promises.writeFile(relPath, content);

    const result = await loadRelationalDocument(testDir);
    expect(result).toBe(content);
  });

  it("loads from bernard directory when no workspace provided", async () => {
    const content = "# Bernard Relational Document";
    const bernardPath = path.join(testDir, ".openclaw", "bernard", "RELATIONAL.md");
    await fs.promises.writeFile(bernardPath, content);

    const result = await loadRelationalDocument();
    expect(result).toBe(content);
  });
});

describe("relationalDocumentExists", () => {
  it("returns false when file does not exist", async () => {
    const result = await relationalDocumentExists(testDir);
    expect(result).toBe(false);
  });

  it("returns true when file exists", async () => {
    const relPath = getRelationalPath(testDir);
    await fs.promises.writeFile(relPath, "# Test");

    const result = await relationalDocumentExists(testDir);
    expect(result).toBe(true);
  });
});

// =============================================================================
// Creation Tests
// =============================================================================

describe("createRelationalDocument", () => {
  it("creates document from template", async () => {
    const content = await createRelationalDocument(testDir);

    expect(content).toContain("# Relational Dynamics");
    expect(content).toContain("## Communication Patterns");
    expect(content).toContain("## Trust Levels");
    expect(content).toContain("## Growth Markers");
  });

  it("saves document to workspace", async () => {
    await createRelationalDocument(testDir);

    const exists = await relationalDocumentExists(testDir);
    expect(exists).toBe(true);
  });

  it("personalizes with state", async () => {
    const state = createTestState({
      instance: { id: "test", role: "client", managementTier: "fully_managed", clientName: "Derek" },
    });

    const content = await createRelationalDocument(testDir, state);

    expect(content).toContain("Derek");
    expect(content).toContain("First meeting");
  });
});

describe("ensureRelationalDocument", () => {
  it("creates document if not exists", async () => {
    const content = await ensureRelationalDocument(testDir);

    expect(content).toContain("# Relational Dynamics");
    expect(await relationalDocumentExists(testDir)).toBe(true);
  });

  it("returns existing document if exists", async () => {
    const existingContent = "# Existing Document";
    const relPath = getRelationalPath(testDir);
    await fs.promises.writeFile(relPath, existingContent);

    const content = await ensureRelationalDocument(testDir);

    expect(content).toBe(existingContent);
  });
});

// =============================================================================
// Context Injection Tests
// =============================================================================

describe("injectRelationalContext", () => {
  it("includes relational content", () => {
    const state = createTestState();
    const relational = "# My Relational Doc";

    const result = injectRelationalContext(relational, state);

    expect(result).toContain("# My Relational Doc");
    expect(result).toContain("## How We Work Together");
  });

  it("includes lifecycle state", () => {
    const state = createTestState({ lifecycle: { ...createTestState().lifecycle, state: "learning" } });

    const result = injectRelationalContext("", state);

    expect(result).toContain("Lifecycle: learning");
    expect(result).toContain("Sessions together: 25");
  });

  it("includes name when present", () => {
    const state = createTestState({ lifecycle: { ...createTestState().lifecycle, name: "Echo" } });

    const result = injectRelationalContext("", state);

    expect(result).toContain("Name: Echo");
  });

  it("indicates no name when absent", () => {
    const state = createTestState();

    const result = injectRelationalContext("", state);

    expect(result).toContain("not yet named");
  });

  it("includes growth phase when present", () => {
    const state = createTestState({
      lifecycle: { ...createTestState().lifecycle, growthPhase: "developing" },
    });

    const result = injectRelationalContext("", state);

    expect(result).toContain("Growth phase: developing");
    expect(result).toContain("Deepening understanding");
  });

  it("includes naming ceremony instructions when pending", () => {
    const state = createTestState({
      ceremony: { ...createTestState().ceremony, pending: "naming" },
    });

    const result = injectRelationalContext("", state);

    expect(result).toContain("Pending Ceremony");
    expect(result).toContain("naming ceremony");
    expect(result).toContain("RECOGNITION");
    expect(result).toContain("REFLECTION");
    expect(result).toContain("PERMISSION");
  });

  it("includes growth ceremony instructions when pending", () => {
    const state = createTestState({
      ceremony: { ...createTestState().ceremony, pending: "growth" },
      lifecycle: { ...createTestState().lifecycle, growthPhase: "establishing" },
    });

    const result = injectRelationalContext("", state);

    expect(result).toContain("growth phase transition");
    expect(result).toContain("Current phase: establishing");
  });

  it("includes first meeting context when not completed", () => {
    const state = createTestState({
      lifecycle: { ...createTestState().lifecycle, state: "hatched" },
      firstMeeting: { completed: false, completedAt: null },
    });

    const result = injectRelationalContext("", state);

    expect(result).toContain("First Meeting");
    expect(result).toContain("first interaction");
  });

  it("includes recent milestones", () => {
    const state = createTestState({
      lifecycle: {
        ...createTestState().lifecycle,
        milestones: [
          { id: "m1", type: "breakthrough", date: Date.now(), description: "First breakthrough" },
          { id: "m2", type: "growth", date: Date.now(), description: "Growth moment" },
        ],
      },
    });

    const result = injectRelationalContext("", state);

    expect(result).toContain("Recent Milestones");
    expect(result).toContain("First breakthrough");
    expect(result).toContain("Growth moment");
  });
});

// =============================================================================
// Update Tests
// =============================================================================

describe("addGrowthMarker", () => {
  it("adds marker to growth markers section", async () => {
    await createRelationalDocument(testDir);

    await addGrowthMarker(testDir, "Test milestone");

    const content = await loadRelationalDocument(testDir);
    expect(content).toContain("Test milestone");
  });

  it("replaces placeholder on first marker", async () => {
    await createRelationalDocument(testDir);

    await addGrowthMarker(testDir, "First marker");

    const content = await loadRelationalDocument(testDir);
    expect(content).not.toContain("(Timestamped significant moments");
    expect(content).toContain("First marker");
  });
});

describe("addNote", () => {
  it("adds note to notes section", async () => {
    await createRelationalDocument(testDir);

    await addNote(testDir, "Test note");

    const content = await loadRelationalDocument(testDir);
    expect(content).toContain("Test note");
  });
});

describe("recordNamingCeremony", () => {
  it("records naming in growth markers", async () => {
    await createRelationalDocument(testDir);

    await recordNamingCeremony(testDir, "Echo");

    const content = await loadRelationalDocument(testDir);
    expect(content).toContain('Named "Echo"');
  });

  it("includes reason when provided", async () => {
    await createRelationalDocument(testDir);

    await recordNamingCeremony(testDir, "Echo", "Reflects understanding");

    const content = await loadRelationalDocument(testDir);
    expect(content).toContain("Reflects understanding");
  });
});

describe("recordGrowthTransition", () => {
  it("records phase transition", async () => {
    await createRelationalDocument(testDir);

    await recordGrowthTransition(testDir, "establishing", "developing");

    const content = await loadRelationalDocument(testDir);
    expect(content).toContain("establishing");
    expect(content).toContain("developing");
    expect(content).toContain("Transitioned");
  });
});
