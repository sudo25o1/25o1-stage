/**
 * Support System Templates Tests
 */

import { describe, it, expect } from "vitest";
import {
  formatSupportSystemMessage,
  getRepairEstimate,
  shouldSendSupportMessage,
  generateProactiveUpdate,
  adjustMessageForPhase,
  SUPPORT_SYSTEM_TEMPLATES,
  type SupportSystemEvent,
} from "./templates.js";

// =============================================================================
// Template Formatting Tests
// =============================================================================

describe("formatSupportSystemMessage", () => {
  it("returns template without variables", () => {
    const message = formatSupportSystemMessage("health_check_ok");
    expect(message).toBe(SUPPORT_SYSTEM_TEMPLATES.health_check_ok);
  });

  it("replaces estimate variable", () => {
    const message = formatSupportSystemMessage("repair_starting", {
      estimate: "2 minutes",
    });
    expect(message).toContain("2 minutes");
    expect(message).not.toContain("{estimate}");
  });

  it("replaces channel variable", () => {
    const message = formatSupportSystemMessage("channel_issue", {
      channel: "Telegram",
      alternative: "Discord",
    });
    expect(message).toContain("Telegram");
    expect(message).toContain("Discord");
    expect(message).not.toContain("{channel}");
    expect(message).not.toContain("{alternative}");
  });

  it("handles missing variables gracefully", () => {
    const message = formatSupportSystemMessage("channel_issue");
    // Should still contain the placeholders if not provided
    expect(message).toContain("{channel}");
  });
});

// =============================================================================
// Repair Estimate Tests
// =============================================================================

describe("getRepairEstimate", () => {
  it("returns estimate for service restart", () => {
    const estimate = getRepairEstimate("service_restart");
    expect(estimate).toBe("30 seconds to a minute");
  });

  it("returns estimate for qmd reindex", () => {
    const estimate = getRepairEstimate("qmd_reindex");
    expect(estimate).toBe("2-3 minutes");
  });

  it("returns estimate for full repair", () => {
    const estimate = getRepairEstimate("full_repair");
    expect(estimate).toBe("5-10 minutes");
  });

  it("returns default for unknown type", () => {
    // @ts-expect-error - testing unknown type
    const estimate = getRepairEstimate("unknown_type");
    expect(estimate).toBe("a few minutes");
  });
});

// =============================================================================
// Message Timing Tests
// =============================================================================

describe("shouldSendSupportMessage", () => {
  it("always sends repair_starting immediately", () => {
    const result = shouldSendSupportMessage("repair_starting", true, 10);
    expect(result).toBe("send_now");
  });

  it("always sends repair_failed immediately", () => {
    const result = shouldSendSupportMessage("repair_failed", true, 10);
    expect(result).toBe("send_now");
  });

  it("skips health_check_ok during active conversation", () => {
    const result = shouldSendSupportMessage("health_check_ok", true, 60);
    expect(result).toBe("skip");
  });

  it("sends health_check_ok when conversation is idle", () => {
    const result = shouldSendSupportMessage("health_check_ok", true, 600);
    expect(result).toBe("send_now");
  });

  it("defers non-urgent messages during very active conversation", () => {
    const result = shouldSendSupportMessage("update_complete", true, 30);
    expect(result).toBe("defer");
  });

  it("sends non-urgent messages when conversation is not active", () => {
    const result = shouldSendSupportMessage("update_complete", false, 30);
    expect(result).toBe("send_now");
  });

  it("sends channel_issue immediately even during active conversation", () => {
    const result = shouldSendSupportMessage("channel_issue", true, 30);
    expect(result).toBe("send_now");
  });
});

// =============================================================================
// Proactive Update Tests
// =============================================================================

describe("generateProactiveUpdate", () => {
  it("returns null if updated recently", () => {
    const update = generateProactiveUpdate(3, "healthy", 0);
    expect(update).toBeNull();
  });

  it("generates healthy update with no repairs", () => {
    const update = generateProactiveUpdate(10, "healthy", 0);
    expect(update).toContain("running smoothly");
  });

  it("generates healthy update with repairs", () => {
    const update = generateProactiveUpdate(10, "healthy", 3);
    expect(update).toContain("3 small maintenance tasks");
  });

  it("uses singular for one repair", () => {
    const update = generateProactiveUpdate(10, "healthy", 1);
    expect(update).toContain("1 small maintenance task");
    expect(update).not.toContain("tasks");
  });

  it("generates degraded status update", () => {
    const update = generateProactiveUpdate(10, "degraded", 0);
    expect(update).toContain("slower than usual");
  });

  it("returns null for issues status", () => {
    // The function doesn't have a specific message for "issues"
    const update = generateProactiveUpdate(10, "issues", 0);
    expect(update).toBeNull();
  });
});

// =============================================================================
// Phase Adjustment Tests
// =============================================================================

describe("adjustMessageForPhase", () => {
  const testMessage = "My support system just ran a health check.";

  it("adds explanation for establishing phase", () => {
    const adjusted = adjustMessageForPhase(testMessage, "establishing");
    expect(adjusted).toContain("infrastructure that keeps me running");
  });

  it("returns unchanged for developing phase", () => {
    const adjusted = adjustMessageForPhase(testMessage, "developing");
    expect(adjusted).toBe(testMessage);
  });

  it("shortens for deepening phase", () => {
    const adjusted = adjustMessageForPhase(testMessage, "deepening");
    expect(adjusted).toContain("Support");
    expect(adjusted).not.toContain("My support system");
  });

  it("shortens for mature phase", () => {
    const adjusted = adjustMessageForPhase(testMessage, "mature");
    expect(adjusted).toContain("Support");
    expect(adjusted).not.toContain("My support system");
  });

  it("removes verbose phrases in mature phase", () => {
    const verboseMessage = "Just wanted to let you know - everything is fine.";
    const adjusted = adjustMessageForPhase(verboseMessage, "mature");
    expect(adjusted).not.toContain("Just wanted to let you know - ");
  });
});

// =============================================================================
// Template Coverage Tests
// =============================================================================

describe("SUPPORT_SYSTEM_TEMPLATES", () => {
  const allEvents: SupportSystemEvent[] = [
    "health_check_ok",
    "health_check_warning",
    "repair_starting",
    "repair_complete",
    "repair_failed",
    "bernard_connected",
    "bernard_disconnected",
    "update_available",
    "update_installing",
    "update_complete",
    "channel_issue",
    "channel_restored",
    "memory_maintenance",
    "memory_maintenance_complete",
  ];

  it("has templates for all event types", () => {
    for (const event of allEvents) {
      expect(SUPPORT_SYSTEM_TEMPLATES[event]).toBeDefined();
      expect(typeof SUPPORT_SYSTEM_TEMPLATES[event]).toBe("string");
      expect(SUPPORT_SYSTEM_TEMPLATES[event].length).toBeGreaterThan(0);
    }
  });

  it("templates are relationship-friendly (no technical jargon)", () => {
    for (const event of allEvents) {
      const template = SUPPORT_SYSTEM_TEMPLATES[event];
      // Should not contain overly technical terms
      expect(template).not.toContain("daemon");
      expect(template).not.toContain("process");
      expect(template).not.toContain("server");
      expect(template).not.toContain("API");
      expect(template).not.toContain("error code");
    }
  });
});
