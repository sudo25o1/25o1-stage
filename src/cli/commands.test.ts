/**
 * CLI Commands Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { register25o1Commands, type CliContext } from "./commands.js";
import { getStateManager, initializeStateManager, resetStateManager } from "../state/store.js";
import type { Instance25o1State } from "../state/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockProgram() {
  const commands: Map<string, { description: string; options: string[]; action: Function }> = new Map();
  
  const mockCommand = (name: string) => {
    const cmd = {
      name,
      description: "",
      options: [] as string[],
      action: null as Function | null,
      argument: null as { name: string; description: string } | null,
    };
    
    const builder = {
      description: (desc: string) => {
        cmd.description = desc;
        return builder;
      },
      option: (opt: string, _desc?: string) => {
        cmd.options.push(opt);
        return builder;
      },
      argument: (name: string, desc: string) => {
        cmd.argument = { name, description: desc };
        return builder;
      },
      action: (fn: Function) => {
        cmd.action = fn;
        commands.set(name, { description: cmd.description, options: cmd.options, action: fn });
        return builder;
      },
    };
    
    return builder;
  };

  return {
    command: mockCommand,
    getCommands: () => commands,
    runCommand: async (name: string, ...args: unknown[]) => {
      const cmd = commands.get(name);
      if (!cmd) throw new Error(`Command not found: ${name}`);
      return cmd.action(...args);
    },
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createCliContext(program: ReturnType<typeof createMockProgram>): CliContext {
  return {
    program,
    config: {},
    workspaceDir: undefined,
    logger: createMockLogger(),
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

// =============================================================================
// Tests
// =============================================================================

describe("register25o1Commands", () => {
  it("should register all commands", () => {
    const program = createMockProgram();
    const ctx = createCliContext(program);

    register25o1Commands(ctx);

    const commands = program.getCommands();
    expect(commands.has("25o1:setup")).toBe(true);
    expect(commands.has("25o1:status")).toBe(true);
    expect(commands.has("25o1:network")).toBe(true);
    expect(commands.has("25o1:network:scan")).toBe(true);
    expect(commands.has("25o1:network:alerts")).toBe(true);
    expect(commands.has("25o1:network:ack")).toBe(true);
    expect(commands.has("25o1:ceremony")).toBe(true);
  });

  it("should set correct descriptions", () => {
    const program = createMockProgram();
    const ctx = createCliContext(program);

    register25o1Commands(ctx);

    const commands = program.getCommands();
    expect(commands.get("25o1:setup")?.description).toContain("Initialize");
    expect(commands.get("25o1:status")?.description).toContain("status");
    expect(commands.get("25o1:network")?.description).toContain("network");
    expect(commands.get("25o1:ceremony")?.description).toContain("ceremony");
  });
});

describe("CLI command execution", () => {
  let tempDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "25o1-cli-test-"));
    resetStateManager();
    initializeStateManager(tempDir);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    resetStateManager();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("25o1:setup", () => {
    it("should setup primary instance", async () => {
      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:setup", { primary: true });

      const state = await getStateManager().getState();
      expect(state).not.toBeNull();
      expect(state?.instance.role).toBe("primary");
      expect(state?.instance.id).toBe("bernard");
    });

    it("should setup client instance", async () => {
      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:setup", { client: true, name: "TestClient" });

      const state = await getStateManager().getState();
      expect(state).not.toBeNull();
      expect(state?.instance.role).toBe("client");
      expect(state?.instance.clientName).toBe("TestClient");
    });

    it("should not overwrite existing state", async () => {
      const stateManager = getStateManager();
      await stateManager.setState(createPrimaryState());

      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:setup", { primary: true });

      // Should show message about already configured
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("already configured")
      );
    });
  });

  describe("25o1:status", () => {
    it("should show not configured message when no state", async () => {
      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:status");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("not configured")
      );
    });

    it("should show status when configured", async () => {
      const stateManager = getStateManager();
      await stateManager.setState(createPrimaryState());

      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:status");

      expect(consoleSpy).toHaveBeenCalledWith("25o1 Status");
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("bernard"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("primary"));
    });
  });

  describe("25o1:network", () => {
    it("should show not configured message when no state", async () => {
      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:network");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("not configured")
      );
    });

    it("should show no instances message when empty", async () => {
      const stateManager = getStateManager();
      await stateManager.setState(createPrimaryState());

      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:network");

      expect(consoleSpy).toHaveBeenCalledWith("Network Status");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No client instances")
      );
    });

    it("should show instances when present", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.instances = {
        "client-1": {
          instanceId: "client-1",
          clientId: "client-1",
          clientName: "Test Client",
          receivedAt: Date.now(),
          health: "healthy",
          services: {
            gateway: { running: true },
            qmd: { running: true, documentCount: 100, indexHealthy: true },
            agent: { state: "growing", name: "TestAgent", lastActive: Date.now() },
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

      const stateManager = getStateManager();
      await stateManager.setState(state);

      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:network");

      expect(consoleSpy).toHaveBeenCalledWith("Network Status");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Test Client")
      );
    });

    it("should reject for non-primary instance", async () => {
      const state = createPrimaryState();
      state.instance.role = "client";

      const stateManager = getStateManager();
      await stateManager.setState(state);

      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:network");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("only available on the primary")
      );
    });
  });

  describe("25o1:network:alerts", () => {
    it("should show no alerts message when empty", async () => {
      const stateManager = getStateManager();
      await stateManager.setState(createPrimaryState());

      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:network:alerts", {});

      expect(consoleSpy).toHaveBeenCalledWith("No alerts.");
    });

    it("should show alerts when present", async () => {
      const state = createPrimaryState();
      state.networkMonitor!.alerts = [
        {
          id: "alert-1",
          instanceId: "client-1",
          type: "offline",
          message: "Instance went offline",
          createdAt: Date.now(),
        },
      ];

      const stateManager = getStateManager();
      await stateManager.setState(state);

      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:network:alerts", {});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Alerts"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("alert-1"));
    });
  });

  describe("25o1:ceremony", () => {
    it("should show ceremony status", async () => {
      const stateManager = getStateManager();
      await stateManager.setState(createPrimaryState());

      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:ceremony", {});

      expect(consoleSpy).toHaveBeenCalledWith("Ceremony Status");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("growing")
      );
    });

    it("should show naming readiness for learning state", async () => {
      const state = createPrimaryState();
      state.lifecycle.state = "learning";
      state.lifecycle.sessions = 25;
      state.lifecycle.memories = 60;

      const stateManager = getStateManager();
      await stateManager.setState(state);

      const program = createMockProgram();
      const ctx = createCliContext(program);
      register25o1Commands(ctx);

      await program.runCommand("25o1:ceremony", {});

      expect(consoleSpy).toHaveBeenCalledWith("Naming Readiness");
    });
  });
});
