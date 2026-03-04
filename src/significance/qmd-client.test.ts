/**
 * Tests for QMD client — pattern detection, contradiction detection,
 * and observation persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  queryQMDContext,
  trackPatternObservation,
  isPatternConfirmed,
} from "./qmd-client.js";
import type { QMDMemory } from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "qmd-test-"));
}

function makeMemory(content: string, relevance = 0.7): QMDMemory {
  return {
    content,
    source: "test",
    timestamp: Date.now(),
    relevance,
  };
}

// =============================================================================
// trackPatternObservation (persistence)
// =============================================================================

describe("trackPatternObservation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates observation file if it doesn't exist", async () => {
    await trackPatternObservation(
      { type: "user_message", content: "Hello world", timestamp: 1000 },
      tmpDir
    );

    const filePath = path.join(tmpDir, ".25o1-observations.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].content).toBe("Hello world");
    expect(data[0].timestamp).toBe(1000);
  });

  it("appends to existing observations", async () => {
    await trackPatternObservation(
      { type: "user_message", content: "First", timestamp: 1000 },
      tmpDir
    );
    await trackPatternObservation(
      { type: "user_message", content: "Second", timestamp: 2000 },
      tmpDir
    );

    const filePath = path.join(tmpDir, ".25o1-observations.json");
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data).toHaveLength(2);
    expect(data[0].content).toBe("First");
    expect(data[1].content).toBe("Second");
  });

  it("trims to MAX_OBSERVATIONS keeping most recent", async () => {
    // Write 500 observations directly
    const filePath = path.join(tmpDir, ".25o1-observations.json");
    const existing = Array.from({ length: 500 }, (_, i) => ({
      type: "user_message",
      content: `Observation ${i}`,
      timestamp: i,
    }));
    fs.writeFileSync(filePath, JSON.stringify(existing));

    // Add one more — should trim to 500 (keeping 499 old + 1 new)
    await trackPatternObservation(
      { type: "user_message", content: "The newest", timestamp: 9999 },
      tmpDir
    );

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data).toHaveLength(500);
    expect(data[data.length - 1].content).toBe("The newest");
    // First old observation should be dropped
    expect(data[0].content).toBe("Observation 1");
  });

  it("handles corrupt observation file gracefully", async () => {
    const filePath = path.join(tmpDir, ".25o1-observations.json");
    fs.writeFileSync(filePath, "not valid json!!!");

    // Should not throw, should overwrite with fresh data
    await trackPatternObservation(
      { type: "user_message", content: "Fresh start", timestamp: 1000 },
      tmpDir
    );

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].content).toBe("Fresh start");
  });
});

// =============================================================================
// queryQMDContext (integration — no OpenClaw memory initialized)
// =============================================================================

describe("queryQMDContext", () => {
  it("returns empty memories/contradictions/patterns when QMD client is not initialized", async () => {
    // QMD client not initialized → queryMemories returns []
    // Gaps may still appear because entity extraction is local (not QMD-dependent)
    const ctx = await queryQMDContext("Hello Sarah, how are you?");

    expect(ctx.memories).toEqual([]);
    expect(ctx.contradictions).toEqual([]);
    expect(ctx.patterns).toEqual([]);
    // Gaps may exist — entity extraction works without memories
  });

  it("returns gaps for entities without memory context", async () => {
    // Even without memories, gap detection should identify entities
    const ctx = await queryQMDContext("I talked to Marcus about the project");

    // Marcus should show up as a gap (no memories to provide context)
    const entityNames = ctx.gaps.map(g => g.entity);
    expect(entityNames.some(e => e.includes("Marcus"))).toBe(true);
  });
});

// =============================================================================
// isPatternConfirmed
// =============================================================================

describe("isPatternConfirmed", () => {
  it("requires at least 3 occurrences", () => {
    expect(isPatternConfirmed(1)).toBe(false);
    expect(isPatternConfirmed(2)).toBe(false);
    expect(isPatternConfirmed(3)).toBe(true);
    expect(isPatternConfirmed(10)).toBe(true);
  });
});
