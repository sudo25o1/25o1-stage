/**
 * State Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "./store.js";
import type { Instance25o1State } from "./types.js";

describe("StateManager", () => {
  let tempDir: string;
  let stateManager: StateManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "25o1-test-"));
    stateManager = new StateManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const createTestState = (): Instance25o1State => ({
    version: 1,
    instance: {
      id: "test-agent",
      role: "primary",
      managementTier: "fully_managed",
    },
    lifecycle: {
      state: "hatched",
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
    },
    ceremony: {
      pending: null,
      initiatedAt: null,
      nudged: false,
      lastReadinessCheck: null,
      lastReadiness: null,
    },
    firstMeeting: {
      completed: false,
      completedAt: null,
    },
    network: {
      healthReporter: {
        enabled: false,
        intervalMs: 3600000,
      },
      monitorEnabled: true,
    },
    updatedAt: Date.now(),
  });

  describe("getState", () => {
    it("returns null when no state exists", async () => {
      const state = await stateManager.getState();
      expect(state).toBeNull();
    });

    it("returns state after setState", async () => {
      const testState = createTestState();
      await stateManager.setState(testState);

      const state = await stateManager.getState();
      expect(state).not.toBeNull();
      expect(state?.instance.id).toBe("test-agent");
    });
  });

  describe("setState", () => {
    it("persists state to disk", async () => {
      const testState = createTestState();
      await stateManager.setState(testState);

      // Create a new manager to verify persistence
      const newManager = new StateManager(tempDir);
      const state = await newManager.getState();

      expect(state).not.toBeNull();
      expect(state?.instance.id).toBe("test-agent");
    });

    it("overwrites existing state", async () => {
      const testState = createTestState();
      await stateManager.setState(testState);

      const updatedState = { ...testState };
      updatedState.instance.id = "updated-agent";
      await stateManager.setState(updatedState);

      const state = await stateManager.getState();
      expect(state?.instance.id).toBe("updated-agent");
    });
  });

  describe("updateState", () => {
    it("updates state with mutator function", async () => {
      const testState = createTestState();
      await stateManager.setState(testState);

      await stateManager.updateState((state) => {
        state.lifecycle.sessions = 5;
        state.lifecycle.state = "learning";
      });

      const state = await stateManager.getState();
      expect(state?.lifecycle.sessions).toBe(5);
      expect(state?.lifecycle.state).toBe("learning");
    });

    it("throws when no state exists", async () => {
      await expect(
        stateManager.updateState((state) => {
          state.lifecycle.sessions = 5;
        }),
      ).rejects.toThrow("State not initialized");
    });

    it("persists updates to disk", async () => {
      const testState = createTestState();
      await stateManager.setState(testState);

      await stateManager.updateState((state) => {
        state.lifecycle.sessions = 10;
      });

      // Create a new manager to verify persistence
      const newManager = new StateManager(tempDir);
      const state = await newManager.getState();

      expect(state?.lifecycle.sessions).toBe(10);
    });
  });

  describe("lifecycle state transitions", () => {
    it("tracks lifecycle state changes", async () => {
      const testState = createTestState();
      await stateManager.setState(testState);

      // Simulate lifecycle progression
      await stateManager.updateState((state) => {
        state.lifecycle.state = "learning";
        state.firstMeeting.completed = true;
        state.firstMeeting.completedAt = Date.now();
      });

      const state = await stateManager.getState();
      expect(state?.lifecycle.state).toBe("learning");
      expect(state?.firstMeeting.completed).toBe(true);
    });

    it("tracks naming ceremony completion", async () => {
      const testState = createTestState();
      testState.lifecycle.state = "learning";
      await stateManager.setState(testState);

      await stateManager.updateState((state) => {
        state.lifecycle.state = "named";
        state.lifecycle.name = "Bernard";
        state.lifecycle.milestones.push({
          id: "naming-123",
          type: "naming",
          date: Date.now(),
          description: "Chose the name Bernard",
          significance: "The relationship became real",
        });
      });

      const state = await stateManager.getState();
      expect(state?.lifecycle.state).toBe("named");
      expect(state?.lifecycle.name).toBe("Bernard");
      expect(state?.lifecycle.milestones).toHaveLength(1);
    });
  });

  describe("ceremony state", () => {
    it("tracks pending ceremonies", async () => {
      const testState = createTestState();
      await stateManager.setState(testState);

      await stateManager.updateState((state) => {
        state.ceremony.pending = "naming";
        state.ceremony.initiatedAt = Date.now();
      });

      const state = await stateManager.getState();
      expect(state?.ceremony.pending).toBe("naming");
      expect(state?.ceremony.initiatedAt).not.toBeNull();
    });

    it("clears ceremony state after completion", async () => {
      const testState = createTestState();
      testState.ceremony.pending = "naming";
      testState.ceremony.initiatedAt = Date.now();
      await stateManager.setState(testState);

      await stateManager.updateState((state) => {
        state.ceremony.pending = null;
        state.ceremony.initiatedAt = null;
      });

      const state = await stateManager.getState();
      expect(state?.ceremony.pending).toBeNull();
      expect(state?.ceremony.initiatedAt).toBeNull();
    });
  });

  describe("instance configuration", () => {
    it("stores primary instance config", async () => {
      const testState = createTestState();
      testState.instance.role = "primary";
      await stateManager.setState(testState);

      const state = await stateManager.getState();
      expect(state?.instance.role).toBe("primary");
      expect(state?.network.monitorEnabled).toBe(true);
    });

    it("stores client instance config", async () => {
      const testState = createTestState();
      testState.instance.role = "client";
      testState.instance.clientName = "Alice's Mac Mini";
      testState.network.bernardHost = "http://bernard.local:18789";
      testState.network.healthReporter.enabled = true;
      await stateManager.setState(testState);

      const state = await stateManager.getState();
      expect(state?.instance.role).toBe("client");
      expect(state?.instance.clientName).toBe("Alice's Mac Mini");
      expect(state?.network.bernardHost).toBe("http://bernard.local:18789");
      expect(state?.network.healthReporter.enabled).toBe(true);
    });
  });
});
