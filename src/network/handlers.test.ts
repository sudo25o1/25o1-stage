/**
 * Network Handlers Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  handleHealthReport,
  handleNetworkStatus,
  handleInstanceStatus,
  handleAcknowledgeAlert,
  handleFlagInstance,
  getLateInstances,
  getCriticalInstances,
  getInstancesNeedingAttention,
  type IncomingHealthReport,
} from "./handlers.js";
import { getStateManager, initializeStateManager, resetStateManager } from "../state/store.js";
import type { Instance25o1State } from "../state/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockOpts(params: Record<string, unknown> = {}) {
  const respond = vi.fn();
  return {
    req: { type: "req" as const, id: "test-1", method: "test", params: {} },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {} as never,
  };
}

function createPrimaryState(): Instance25o1State {
  return {
    version: 1,
    instance: {
      id: "bernard",
      role: "primary",
      managementTier: "fully_managed",
    },
    lifecycle: {
      state: "growing",
      name: "Bernard",
      growthPhase: "mature",
      sessions: 100,
      memories: 500,
      created: Date.now() - 90 * 24 * 60 * 60 * 1000,
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
      completedAt: Date.now() - 90 * 24 * 60 * 60 * 1000,
    },
    network: {
      healthReporter: { enabled: false, intervalMs: 3600000 },
      monitorEnabled: true,
    },
    networkMonitor: {
      instances: {},
      lastSeen: {},
      needsAttention: [],
      alerts: [],
      lastScan: null,
    },
    updatedAt: Date.now(),
  };
}

function createHealthReport(instanceId: string): IncomingHealthReport {
  return {
    instanceId,
    clientId: instanceId,
    timestamp: new Date().toISOString(),
    health: "healthy",
    services: {
      gateway: { running: true, uptime: 3600 },
      qmd: { running: true, documentCount: 100, indexHealthy: true },
      agent: { state: "growing", name: "TestAgent", lastActive: new Date().toISOString() },
    },
    system: {
      awake: true,
      sleepPrevented: true,
      uptime: 86400,
      memory: { percentage: 45, pressure: "normal" },
      disk: { percentage: 60, pressure: "normal" },
    },
    issues: [],
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("handleHealthReport", () => {
  let tempDir: string;
  let stateManager: ReturnType<typeof getStateManager>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "25o1-handlers-test-"));
    resetStateManager();
    initializeStateManager(tempDir);
    stateManager = getStateManager();
  });

  afterEach(async () => {
    resetStateManager();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should reject invalid report", async () => {
    const state = createPrimaryState();
    await stateManager.setState(state);

    const opts = createMockOpts({});
    await handleHealthReport(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REPORT" })
    );
  });

  it("should reject if not primary", async () => {
    // No state = not primary
    const opts = createMockOpts(createHealthReport("client-1") as unknown as Record<string, unknown>);
    await handleHealthReport(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "NOT_PRIMARY" })
    );
  });

  it("should accept valid health report", async () => {
    const state = createPrimaryState();
    await stateManager.setState(state);

    const report = createHealthReport("client-1");
    const opts = createMockOpts(report as unknown as Record<string, unknown>);
    await handleHealthReport(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        received: report.timestamp,
        criticalIssues: 0,
        acknowledged: true,
      })
    );

    // Check state was updated
    const updatedState = await stateManager.getState();
    expect(updatedState?.networkMonitor?.instances["client-1"]).toBeDefined();
    expect(updatedState?.networkMonitor?.lastSeen["client-1"]).toBeDefined();
  });

  it("should generate alert for critical issues", async () => {
    const state = createPrimaryState();
    await stateManager.setState(state);

    const report = createHealthReport("client-1");
    report.health = "critical";
    report.issues = [
      {
        id: "issue-1",
        component: "gateway",
        severity: "critical",
        description: "Gateway not running",
        canSelfRepair: true,
        detectedAt: new Date().toISOString(),
      },
    ];

    const opts = createMockOpts(report as unknown as Record<string, unknown>);
    await handleHealthReport(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ criticalIssues: 1 })
    );

    // Check alert was generated
    const updatedState = await stateManager.getState();
    expect(updatedState?.networkMonitor?.alerts).toHaveLength(1);
    expect(updatedState?.networkMonitor?.alerts[0].type).toBe("critical");
  });
});

describe("handleNetworkStatus", () => {
  let tempDir: string;
  let stateManager: ReturnType<typeof getStateManager>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "25o1-handlers-test-"));
    resetStateManager();
    initializeStateManager(tempDir);
    stateManager = getStateManager();
  });

  afterEach(async () => {
    resetStateManager();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should reject if not primary", async () => {
    const opts = createMockOpts();
    await handleNetworkStatus(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "NOT_PRIMARY" })
    );
  });

  it("should return empty status when no instances", async () => {
    const state = createPrimaryState();
    await stateManager.setState(state);

    const opts = createMockOpts();
    await handleNetworkStatus(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        networkHealth: "unknown",
        instanceCount: 0,
        instances: [],
      })
    );
  });

  it("should return status with instances", async () => {
    const state = createPrimaryState();
    state.networkMonitor!.instances = {
      "client-1": {
        instanceId: "client-1",
        clientId: "client-1",
        receivedAt: Date.now(),
        health: "healthy",
        services: {
          gateway: { running: true },
          qmd: { running: true, documentCount: 100, indexHealthy: true },
          agent: { state: "growing", name: "Test", lastActive: Date.now() },
        },
        system: {
          awake: true,
          sleepPrevented: true,
          uptime: 3600,
          memory: { percentage: 50, pressure: "normal" },
          disk: { percentage: 60, pressure: "normal" },
          network: { reachable: true },
        },
        issues: [],
      },
    };
    state.networkMonitor!.lastSeen = { "client-1": Date.now() };
    await stateManager.setState(state);

    const opts = createMockOpts();
    await handleNetworkStatus(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        networkHealth: "healthy",
        instanceCount: 1,
      })
    );
  });
});

describe("handleInstanceStatus", () => {
  let tempDir: string;
  let stateManager: ReturnType<typeof getStateManager>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "25o1-handlers-test-"));
    resetStateManager();
    initializeStateManager(tempDir);
    stateManager = getStateManager();
  });

  afterEach(async () => {
    resetStateManager();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should require instanceId", async () => {
    const state = createPrimaryState();
    await stateManager.setState(state);

    const opts = createMockOpts();
    await handleInstanceStatus(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "MISSING_PARAM" })
    );
  });

  it("should return not found for unknown instance", async () => {
    const state = createPrimaryState();
    await stateManager.setState(state);

    const opts = createMockOpts({ instanceId: "unknown" });
    await handleInstanceStatus(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });
});

describe("handleAcknowledgeAlert", () => {
  let tempDir: string;
  let stateManager: ReturnType<typeof getStateManager>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "25o1-handlers-test-"));
    resetStateManager();
    initializeStateManager(tempDir);
    stateManager = getStateManager();
  });

  afterEach(async () => {
    resetStateManager();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should require alertId", async () => {
    const opts = createMockOpts();
    await handleAcknowledgeAlert(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "MISSING_PARAM" })
    );
  });

  it("should acknowledge alert", async () => {
    const state = createPrimaryState();
    state.networkMonitor!.alerts = [
      {
        id: "alert-1",
        instanceId: "client-1",
        type: "offline",
        message: "Test",
        createdAt: Date.now(),
      },
    ];
    await stateManager.setState(state);

    const opts = createMockOpts({ alertId: "alert-1" });
    await handleAcknowledgeAlert(opts);

    expect(opts.respond).toHaveBeenCalledWith(true, { acknowledged: true });

    const updatedState = await stateManager.getState();
    expect(updatedState?.networkMonitor?.alerts[0].acknowledgedAt).toBeDefined();
  });
});

describe("handleFlagInstance", () => {
  let tempDir: string;
  let stateManager: ReturnType<typeof getStateManager>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "25o1-handlers-test-"));
    resetStateManager();
    initializeStateManager(tempDir);
    stateManager = getStateManager();
  });

  afterEach(async () => {
    resetStateManager();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should require instanceId", async () => {
    const opts = createMockOpts();
    await handleFlagInstance(opts);

    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "MISSING_PARAM" })
    );
  });

  it("should flag instance", async () => {
    const state = createPrimaryState();
    await stateManager.setState(state);

    const opts = createMockOpts({ instanceId: "client-1", flag: true });
    await handleFlagInstance(opts);

    expect(opts.respond).toHaveBeenCalledWith(true, { flagged: true });

    const updatedState = await stateManager.getState();
    expect(updatedState?.networkMonitor?.needsAttention).toContain("client-1");
  });

  it("should unflag instance", async () => {
    const state = createPrimaryState();
    state.networkMonitor!.needsAttention = ["client-1"];
    await stateManager.setState(state);

    const opts = createMockOpts({ instanceId: "client-1", flag: false });
    await handleFlagInstance(opts);

    expect(opts.respond).toHaveBeenCalledWith(true, { flagged: false });

    const updatedState = await stateManager.getState();
    expect(updatedState?.networkMonitor?.needsAttention).not.toContain("client-1");
  });
});

describe("utility functions", () => {
  let tempDir: string;
  let stateManager: ReturnType<typeof getStateManager>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "25o1-handlers-test-"));
    resetStateManager();
    initializeStateManager(tempDir);
    stateManager = getStateManager();
  });

  afterEach(async () => {
    resetStateManager();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("getLateInstances", () => {
    it("should return empty when no state", async () => {
      const result = await getLateInstances();
      expect(result).toEqual([]);
    });

    it("should return late instances", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.lastSeen = {
        "client-1": Date.now() - 3 * 60 * 60 * 1000, // 3 hours ago
        "client-2": Date.now(), // Now
      };
      await stateManager.setState(state);

      const result = await getLateInstances();
      expect(result).toEqual(["client-1"]);
    });
  });

  describe("getCriticalInstances", () => {
    it("should return empty when no state", async () => {
      const result = await getCriticalInstances();
      expect(result).toEqual([]);
    });

    it("should return instances with critical issues", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.instances = {
        "client-1": {
          instanceId: "client-1",
          clientId: "client-1",
          receivedAt: Date.now(),
          health: "critical",
          services: {
            gateway: { running: false },
            qmd: { running: true, documentCount: 100, indexHealthy: true },
            agent: { state: "growing", lastActive: Date.now() },
          },
          system: {
            awake: true,
            sleepPrevented: true,
            uptime: 3600,
            memory: { percentage: 50, pressure: "normal" },
            disk: { percentage: 60, pressure: "normal" },
            network: { reachable: true },
          },
          issues: [
            {
              id: "issue-1",
              component: "gateway",
              severity: "critical",
              description: "Gateway not running",
              canSelfRepair: true,
              detectedAt: Date.now(),
            },
          ],
        },
      };
      await stateManager.setState(state);

      const result = await getCriticalInstances();
      expect(result).toEqual(["client-1"]);
    });
  });

  describe("getInstancesNeedingAttention", () => {
    it("should return empty when no state", async () => {
      const result = await getInstancesNeedingAttention();
      expect(result).toEqual([]);
    });

    it("should return flagged instances", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.needsAttention = ["client-1", "client-2"];
      await stateManager.setState(state);

      const result = await getInstancesNeedingAttention();
      expect(result).toEqual(["client-1", "client-2"]);
    });
  });
});
