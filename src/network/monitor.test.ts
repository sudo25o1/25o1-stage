/**
 * Network Monitor Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NetworkMonitor, DEFAULT_MONITOR_CONFIG } from "./monitor.js";
import { getStateManager, initializeStateManager, resetStateManager } from "../state/store.js";
import type { Instance25o1State, PersistedHealthReport } from "../state/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

function createHealthyReport(instanceId: string, clientId: string): PersistedHealthReport {
  return {
    instanceId,
    clientId,
    receivedAt: Date.now(),
    health: "healthy",
    services: {
      gateway: { running: true, uptime: 3600 },
      qmd: { running: true, documentCount: 100, indexHealthy: true },
      agent: { state: "growing", name: "TestAgent", lastActive: Date.now() },
    },
    system: {
      awake: true,
      sleepPrevented: true,
      uptime: 86400,
      memory: { percentage: 45, pressure: "normal" },
      disk: { percentage: 60, pressure: "normal" },
      network: { reachable: true, latency: 50 },
    },
    issues: [],
  };
}

function createCriticalReport(instanceId: string, clientId: string): PersistedHealthReport {
  return {
    instanceId,
    clientId,
    receivedAt: Date.now(),
    health: "critical",
    services: {
      gateway: { running: false },
      qmd: { running: true, documentCount: 100, indexHealthy: true },
      agent: { state: "growing", name: "TestAgent", lastActive: Date.now() },
    },
    system: {
      awake: true,
      sleepPrevented: true,
      uptime: 86400,
      memory: { percentage: 45, pressure: "normal" },
      disk: { percentage: 60, pressure: "normal" },
      network: { reachable: true, latency: 50 },
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
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("NetworkMonitor", () => {
  let tempDir: string;
  let stateManager: ReturnType<typeof getStateManager>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "25o1-monitor-test-"));
    // Reset and reinitialize with temp dir
    resetStateManager();
    initializeStateManager(tempDir);
    stateManager = getStateManager();
  });

  afterEach(async () => {
    resetStateManager();
    try {
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (e) {
      // Ignore cleanup errors in tests if file is locked
    }
  });

  describe("constructor", () => {
    it("should use default config values", () => {
      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      expect(monitor).toBeDefined();
    });

    it("should allow config overrides", () => {
      const logger = createMockLogger();
      const monitor = new NetworkMonitor({
        logger,
        scanIntervalMs: 1000,
        offlineThresholdMs: 5000,
      });

      expect(monitor).toBeDefined();
    });
  });

  describe("getStatus", () => {
    it("should return unknown status when no state", async () => {
      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const status = await monitor.getStatus();

      expect(status.health).toBe("unknown");
      expect(status.instanceCount).toBe(0);
    });

    it("should return healthy status when all instances healthy", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.instances = {
        "client-1": createHealthyReport("client-1", "client-1"),
        "client-2": createHealthyReport("client-2", "client-2"),
      };
      state.networkMonitor!.lastSeen = {
        "client-1": Date.now(),
        "client-2": Date.now(),
      };
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const status = await monitor.getStatus();

      expect(status.health).toBe("healthy");
      expect(status.instanceCount).toBe(2);
      expect(status.healthyCount).toBe(2);
    });

    it("should return critical status when instance is offline", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.instances = {
        "client-1": createHealthyReport("client-1", "client-1"),
      };
      // Last seen 3 hours ago (past offline threshold)
      state.networkMonitor!.lastSeen = {
        "client-1": Date.now() - 3 * 60 * 60 * 1000,
      };
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const status = await monitor.getStatus();

      expect(status.health).toBe("critical");
      expect(status.offlineCount).toBe(1);
    });

    it("should return critical status when instance has critical issues", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.instances = {
        "client-1": createCriticalReport("client-1", "client-1"),
      };
      state.networkMonitor!.lastSeen = {
        "client-1": Date.now(),
      };
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const status = await monitor.getStatus();

      expect(status.health).toBe("critical");
      expect(status.criticalCount).toBe(1);
    });
  });

  describe("getInstances", () => {
    it("should return empty array when no instances", async () => {
      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const instances = await monitor.getInstances();

      expect(instances).toEqual([]);
    });

    it("should return instance summaries", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.instances = {
        "client-1": createHealthyReport("client-1", "client-1"),
      };
      state.networkMonitor!.lastSeen = {
        "client-1": Date.now(),
      };
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const instances = await monitor.getInstances();

      expect(instances).toHaveLength(1);
      expect(instances[0].instanceId).toBe("client-1");
      expect(instances[0].health).toBe("healthy");
      expect(instances[0].isOffline).toBe(false);
    });

    it("should mark stale instances", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.instances = {
        "client-1": createHealthyReport("client-1", "client-1"),
      };
      // Last seen 100 minutes ago (past stale threshold of 90 minutes)
      state.networkMonitor!.lastSeen = {
        "client-1": Date.now() - 100 * 60 * 1000,
      };
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const instances = await monitor.getInstances();

      expect(instances[0].isStale).toBe(true);
      expect(instances[0].isOffline).toBe(false);
    });
  });

  describe("scan", () => {
    it("should throw if not primary instance", async () => {
      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      await expect(monitor.scan()).rejects.toThrow("Not primary instance");
    });

    it("should scan and return results", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.instances = {
        "client-1": createHealthyReport("client-1", "client-1"),
      };
      state.networkMonitor!.lastSeen = {
        "client-1": Date.now(),
      };
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const result = await monitor.scan();

      expect(result.instancesScanned).toBe(1);
      expect(result.healthy).toBe(1);
      expect(result.offline).toBe(0);
      expect(result.alertsGenerated).toBe(0);
    });

    it("should detect offline instances and generate alerts", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.instances = {
        "client-1": createHealthyReport("client-1", "client-1"),
      };
      // Last seen 3 hours ago
      state.networkMonitor!.lastSeen = {
        "client-1": Date.now() - 3 * 60 * 60 * 1000,
      };
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const result = await monitor.scan();

      expect(result.offline).toBe(1);
      expect(result.alertsGenerated).toBe(1);

      // Check alert was persisted
      const updatedState = await stateManager.getState();
      expect(updatedState?.networkMonitor?.alerts).toHaveLength(1);
      expect(updatedState?.networkMonitor?.alerts[0].type).toBe("offline");
    });

    it("should update lastScan timestamp", async () => {
      const state = createPrimaryState();
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const before = Date.now();
      await monitor.scan();
      const after = Date.now();

      const updatedState = await stateManager.getState();
      expect(updatedState?.networkMonitor?.lastScan).toBeGreaterThanOrEqual(before);
      expect(updatedState?.networkMonitor?.lastScan).toBeLessThanOrEqual(after);
    });
  });

  describe("alerts", () => {
    it("should get alerts", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.alerts = [
        {
          id: "alert-1",
          instanceId: "client-1",
          type: "offline",
          message: "Instance offline",
          createdAt: Date.now(),
        },
      ];
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const alerts = await monitor.getAlerts();

      expect(alerts).toHaveLength(1);
      expect(alerts[0].id).toBe("alert-1");
    });

    it("should filter alerts by instanceId", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.alerts = [
        {
          id: "alert-1",
          instanceId: "client-1",
          type: "offline",
          message: "Instance offline",
          createdAt: Date.now(),
        },
        {
          id: "alert-2",
          instanceId: "client-2",
          type: "critical",
          message: "Critical issue",
          createdAt: Date.now(),
        },
      ];
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const alerts = await monitor.getAlerts({ instanceId: "client-1" });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].instanceId).toBe("client-1");
    });

    it("should filter unacknowledged alerts", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.alerts = [
        {
          id: "alert-1",
          instanceId: "client-1",
          type: "offline",
          message: "Instance offline",
          createdAt: Date.now(),
          acknowledgedAt: Date.now(),
        },
        {
          id: "alert-2",
          instanceId: "client-2",
          type: "critical",
          message: "Critical issue",
          createdAt: Date.now(),
        },
      ];
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const alerts = await monitor.getAlerts({ unacknowledgedOnly: true });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].id).toBe("alert-2");
    });

    it("should acknowledge alert", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.alerts = [
        {
          id: "alert-1",
          instanceId: "client-1",
          type: "offline",
          message: "Instance offline",
          createdAt: Date.now(),
        },
      ];
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const result = await monitor.acknowledgeAlert("alert-1");

      expect(result).toBe(true);

      const updatedState = await stateManager.getState();
      expect(updatedState?.networkMonitor?.alerts[0].acknowledgedAt).toBeDefined();
    });

    it("should resolve alert", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.alerts = [
        {
          id: "alert-1",
          instanceId: "client-1",
          type: "offline",
          message: "Instance offline",
          createdAt: Date.now(),
        },
      ];
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({ logger });

      const result = await monitor.resolveAlert("alert-1");

      expect(result).toBe(true);

      const updatedState = await stateManager.getState();
      expect(updatedState?.networkMonitor?.alerts[0].resolvedAt).toBeDefined();
    });
  });

  describe("lifecycle", () => {
    it("should start and stop", async () => {
      const state = createPrimaryState();
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({
        logger,
        scanIntervalMs: 100000, // Long interval so we don't trigger scans
      });

      monitor.start();
      expect(logger.info).toHaveBeenCalledWith("Network monitor started");

      monitor.stop();
      expect(logger.info).toHaveBeenCalledWith("Network monitor stopped");
    });

    it("should warn if already running", async () => {
      const state = createPrimaryState();
      await stateManager.setState(state);

      const logger = createMockLogger();
      const monitor = new NetworkMonitor({
        logger,
        scanIntervalMs: 100000,
      });

      monitor.start();
      monitor.start(); // Second start

      expect(logger.warn).toHaveBeenCalledWith("Network monitor already running");

      monitor.stop();
    });
  });
});

describe("DEFAULT_MONITOR_CONFIG", () => {
  it("should have reasonable defaults", () => {
    expect(DEFAULT_MONITOR_CONFIG.scanIntervalMs).toBe(5 * 60 * 1000); // 5 minutes
    expect(DEFAULT_MONITOR_CONFIG.offlineThresholdMs).toBe(2 * 60 * 60 * 1000); // 2 hours
    expect(DEFAULT_MONITOR_CONFIG.staleThresholdMs).toBe(90 * 60 * 1000); // 90 minutes
    expect(DEFAULT_MONITOR_CONFIG.autoRepairEnabled).toBe(true);
  });
});
