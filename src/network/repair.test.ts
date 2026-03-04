/**
 * Repair System Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  RepairSystem,
  getAvailableRepairActions,
  getRepairAction,
  DEFAULT_REPAIR_CONFIG,
  type RepairAction,
  type InstanceConnection,
} from "./repair.js";
import type { PersistedIssue } from "../state/types.js";

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

function createConnection(
  instanceId: string,
  managementTier: "fully_managed" | "remote_managed" | "self_managed" = "fully_managed"
): InstanceConnection {
  return {
    instanceId,
    host: `${instanceId}.local`,
    user: "admin",
    keyPath: "~/.ssh/test_key",
    managementTier,
  };
}

function createIssue(
  component: string,
  severity: "info" | "warning" | "critical" = "critical",
  canSelfRepair = true
): PersistedIssue {
  return {
    id: `issue-${Date.now()}`,
    component,
    severity,
    description: `${component} issue`,
    canSelfRepair,
    detectedAt: Date.now(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("RepairSystem", () => {
  describe("constructor", () => {
    it("should create with default config", () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      expect(system).toBeDefined();
    });

    it("should allow config overrides", () => {
      const logger = createMockLogger();
      const system = new RepairSystem({
        logger,
        sshUser: "custom",
        sshTimeout: 60000,
      });
      expect(system).toBeDefined();
    });
  });

  describe("connection management", () => {
    it("should register instance connection", () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      const connection = createConnection("client-1");

      system.registerInstance(connection);

      expect(system.getConnection("client-1")).toEqual(connection);
      expect(logger.info).toHaveBeenCalledWith(
        "Registered instance client-1 at client-1.local"
      );
    });

    it("should unregister instance connection", () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      const connection = createConnection("client-1");

      system.registerInstance(connection);
      system.unregisterInstance("client-1");

      expect(system.getConnection("client-1")).toBeUndefined();
    });

    it("should return undefined for unknown instance", () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });

      expect(system.getConnection("unknown")).toBeUndefined();
    });
  });

  describe("createRepairPlan", () => {
    it("should create plan for gateway issue", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      system.registerInstance(createConnection("client-1"));

      const issues = [createIssue("gateway")];
      const plan = await system.createRepairPlan("client-1", issues);

      expect(plan.instanceId).toBe("client-1");
      expect(plan.issues).toEqual(issues);
      expect(plan.actions.length).toBeGreaterThan(0);
      expect(plan.actions[0].component).toBe("gateway");
      expect(plan.requiresApproval).toBe(false); // fully_managed
    });

    it("should create plan for QMD issue", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      system.registerInstance(createConnection("client-1"));

      const issues = [createIssue("qmd")];
      const plan = await system.createRepairPlan("client-1", issues);

      expect(plan.actions.length).toBeGreaterThan(0);
      expect(plan.actions[0].component).toBe("qmd");
    });

    it("should create plan for system sleep issue", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      system.registerInstance(createConnection("client-1"));

      const issue = createIssue("system");
      issue.description = "sleep prevention not active";
      const plan = await system.createRepairPlan("client-1", [issue]);

      expect(plan.actions.length).toBeGreaterThan(0);
    });

    it("should require approval for remote_managed instances", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      system.registerInstance(createConnection("client-1", "remote_managed"));

      const issues = [createIssue("gateway")];
      const plan = await system.createRepairPlan("client-1", issues);

      expect(plan.requiresApproval).toBe(true);
    });

    it("should require approval for unknown instances", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });

      const issues = [createIssue("gateway")];
      const plan = await system.createRepairPlan("unknown", issues);

      expect(plan.requiresApproval).toBe(true);
    });

    it("should not duplicate actions for same component", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      system.registerInstance(createConnection("client-1"));

      const issues = [
        createIssue("gateway"),
        createIssue("gateway"), // Duplicate
      ];
      const plan = await system.createRepairPlan("client-1", issues);

      // Should only have one gateway action
      const gatewayActions = plan.actions.filter((a) => a.component === "gateway");
      expect(gatewayActions.length).toBe(1);
    });

    it("should skip non-repairable issues", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      system.registerInstance(createConnection("client-1"));

      const issues = [createIssue("gateway", "critical", false)]; // canSelfRepair = false
      const plan = await system.createRepairPlan("client-1", issues);

      expect(plan.actions.length).toBe(0);
    });

    it("should calculate estimated duration", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      system.registerInstance(createConnection("client-1"));

      const issues = [createIssue("gateway"), createIssue("qmd")];
      const plan = await system.createRepairPlan("client-1", issues);

      expect(plan.estimatedDuration).toBeGreaterThan(0);
    });
  });

  describe("executeRepair", () => {
    it("should fail for unknown instance", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });

      const action = getRepairAction("restart_gateway")!;
      const result = await system.executeRepair("unknown", action);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No connection registered");
    });

    it("should fail for self_managed instance", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });
      system.registerInstance(createConnection("client-1", "self_managed"));

      const action = getRepairAction("restart_gateway")!;
      const result = await system.executeRepair("client-1", action);

      expect(result.success).toBe(false);
      expect(result.error).toContain("self-managed");
    });

    // Note: Actual SSH execution tests would require mocking child_process
    // These are integration tests that would run against real instances
  });

  describe("executePlan", () => {
    it("should return empty results for empty plan", async () => {
      const logger = createMockLogger();
      const system = new RepairSystem({ logger });

      const plan = {
        instanceId: "client-1",
        issues: [],
        actions: [],
        requiresApproval: false,
        estimatedDuration: 0,
      };

      const results = await system.executePlan(plan);
      expect(results).toEqual([]);
    });
  });
});

describe("getAvailableRepairActions", () => {
  it("should return all available actions", () => {
    const actions = getAvailableRepairActions();

    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.id === "restart_gateway")).toBe(true);
    expect(actions.some((a) => a.id === "restart_qmd")).toBe(true);
    expect(actions.some((a) => a.id === "reindex_qmd")).toBe(true);
    expect(actions.some((a) => a.id === "enable_sleep_prevention")).toBe(true);
    expect(actions.some((a) => a.id === "clear_disk_space")).toBe(true);
    expect(actions.some((a) => a.id === "update_openclaw")).toBe(true);
    expect(actions.some((a) => a.id === "full_restart")).toBe(true);
  });
});

describe("getRepairAction", () => {
  it("should return action by id", () => {
    const action = getRepairAction("restart_gateway");

    expect(action).toBeDefined();
    expect(action?.id).toBe("restart_gateway");
    expect(action?.name).toBe("Restart Gateway");
    expect(action?.component).toBe("gateway");
    expect(action?.commands.length).toBeGreaterThan(0);
  });

  it("should return undefined for unknown action", () => {
    const action = getRepairAction("unknown_action");
    expect(action).toBeUndefined();
  });
});

describe("DEFAULT_REPAIR_CONFIG", () => {
  it("should have reasonable defaults", () => {
    expect(DEFAULT_REPAIR_CONFIG.sshUser).toBe("admin");
    expect(DEFAULT_REPAIR_CONFIG.sshKeyPath).toContain(".ssh/25o1_network");
    // Should be an absolute path (no tilde — Node's spawn won't expand ~)
    expect(DEFAULT_REPAIR_CONFIG.sshKeyPath).not.toContain("~");
    expect(DEFAULT_REPAIR_CONFIG.sshTimeout).toBe(30000);
  });
});

describe("RepairAction structure", () => {
  it("should have required fields", () => {
    const actions = getAvailableRepairActions();

    for (const action of actions) {
      expect(action.id).toBeDefined();
      expect(action.name).toBeDefined();
      expect(action.description).toBeDefined();
      expect(action.component).toBeDefined();
      expect(Array.isArray(action.commands)).toBe(true);
      expect(action.commands.length).toBeGreaterThan(0);
      expect(typeof action.requiresReboot).toBe("boolean");
      expect(typeof action.estimatedDuration).toBe("number");
    }
  });

  it("restart_gateway should have proper commands", () => {
    const action = getRepairAction("restart_gateway")!;

    expect(action.commands.some((c) => c.includes("pkill"))).toBe(true);
    expect(action.commands.some((c) => c.includes("openclaw gateway"))).toBe(true);
    expect(action.requiresReboot).toBe(false);
  });

  it("restart_qmd should have proper commands", () => {
    const action = getRepairAction("restart_qmd")!;

    expect(action.commands.some((c) => c.includes("pkill"))).toBe(true);
    expect(action.commands.some((c) => c.includes("qmd"))).toBe(true);
    expect(action.requiresReboot).toBe(false);
  });

  it("full_restart should restart all services", () => {
    const action = getRepairAction("full_restart")!;

    expect(action.commands.some((c) => c.includes("openclaw"))).toBe(true);
    expect(action.commands.some((c) => c.includes("qmd"))).toBe(true);
    expect(action.estimatedDuration).toBeGreaterThan(10);
  });
});
