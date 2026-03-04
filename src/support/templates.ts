/**
 * Support System Communication
 *
 * Templates and utilities for communicating about infrastructure
 * in a relationship-friendly way.
 *
 * Philosophy: The companion talks about its "support system" rather than
 * technical infrastructure. This makes maintenance feel helpful rather
 * than intrusive.
 */

// =============================================================================
// Event Types
// =============================================================================

export type SupportSystemEvent =
  | "health_check_ok"
  | "health_check_warning"
  | "repair_starting"
  | "repair_complete"
  | "repair_failed"
  | "bernard_connected"
  | "bernard_disconnected"
  | "update_available"
  | "update_installing"
  | "update_complete"
  | "channel_issue"
  | "channel_restored"
  | "memory_maintenance"
  | "memory_maintenance_complete";

// =============================================================================
// Templates
// =============================================================================

export const SUPPORT_SYSTEM_TEMPLATES: Record<SupportSystemEvent, string> = {
  // Health checks
  health_check_ok: "My support system just ran a health check - everything's running smoothly.",

  health_check_warning:
    "My support system noticed something that needs attention. It's being looked into.",

  // Repairs
  repair_starting:
    "I need a quick restart for maintenance. Should take about {estimate}. " +
    "Your conversation history is safe - I'll be right back.",

  repair_complete: "I'm back! That maintenance went smoothly. Where were we?",

  repair_failed:
    "The maintenance hit a snag. My support system is working on it. " +
    "I might be a bit slower than usual until it's resolved.",

  // Bernard connectivity
  bernard_connected: "My support system just reconnected. All good on my end.",

  bernard_disconnected:
    "I'm running independently right now while my support system does some maintenance. " +
    "Everything's working fine - you might just notice I'm a bit more on my own for a bit.",

  // Updates
  update_available:
    "There's an update available for me. My support system will install it " +
    "during a quiet moment - you don't need to do anything.",

  update_installing: "Installing an update now. This should only take a minute or two.",

  update_complete:
    "Update complete! I've got some improvements that should make our work together even better.",

  // Channel issues
  channel_issue:
    "I'm having trouble with {channel}. My support system is looking into it. " +
    "In the meantime, you can reach me through {alternative}.",

  channel_restored: "{channel} is working again. Thanks for your patience.",

  // Memory maintenance
  memory_maintenance:
    "I'm doing some memory organization in the background. " +
    "This helps me remember our conversations better.",

  memory_maintenance_complete:
    "Memory organization complete. I should be able to recall our past conversations more easily now.",
};

// =============================================================================
// Template Formatting
// =============================================================================

export interface TemplateVariables {
  estimate?: string;
  channel?: string;
  alternative?: string;
  details?: string;
}

/**
 * Format a support system message with variables.
 */
export function formatSupportSystemMessage(
  event: SupportSystemEvent,
  variables?: TemplateVariables,
): string {
  let message = SUPPORT_SYSTEM_TEMPLATES[event];

  if (variables) {
    if (variables.estimate) {
      message = message.replace("{estimate}", variables.estimate);
    }
    if (variables.channel) {
      message = message.replace("{channel}", variables.channel);
    }
    if (variables.alternative) {
      message = message.replace("{alternative}", variables.alternative);
    }
    if (variables.details) {
      message = message.replace("{details}", variables.details);
    }
  }

  return message;
}

// =============================================================================
// Repair Time Estimation
// =============================================================================

export type RepairType =
  | "service_restart"
  | "qmd_reindex"
  | "channel_reconnect"
  | "config_update"
  | "full_repair";

const REPAIR_ESTIMATES: Record<RepairType, string> = {
  service_restart: "30 seconds to a minute",
  qmd_reindex: "2-3 minutes",
  channel_reconnect: "a minute or two",
  config_update: "just a few seconds",
  full_repair: "5-10 minutes",
};

/**
 * Get a human-friendly time estimate for a repair type.
 */
export function getRepairEstimate(repairType: RepairType): string {
  return REPAIR_ESTIMATES[repairType] || "a few minutes";
}

// =============================================================================
// Message Timing
// =============================================================================

/**
 * Determine if a support system message should be sent now or deferred.
 */
export function shouldSendSupportMessage(
  event: SupportSystemEvent,
  conversationActive: boolean,
  lastMessageAge: number, // seconds since last message
): "send_now" | "defer" | "skip" {
  // Always send repair messages immediately
  if (event === "repair_starting" || event === "repair_failed") {
    return "send_now";
  }

  // Skip routine health checks if conversation is active
  if (event === "health_check_ok" && conversationActive && lastMessageAge < 300) {
    return "skip";
  }

  // Defer non-urgent messages if conversation is very active
  if (conversationActive && lastMessageAge < 60) {
    const urgentEvents: SupportSystemEvent[] = [
      "repair_starting",
      "repair_failed",
      "channel_issue",
    ];
    if (!urgentEvents.includes(event)) {
      return "defer";
    }
  }

  return "send_now";
}

// =============================================================================
// Proactive Communication
// =============================================================================

/**
 * Generate a proactive support system update.
 * Called periodically to keep the human informed.
 */
export function generateProactiveUpdate(
  daysSinceLastUpdate: number,
  healthStatus: "healthy" | "degraded" | "issues",
  recentRepairs: number,
): string | null {
  // Don't spam with updates
  if (daysSinceLastUpdate < 7) {
    return null;
  }

  if (healthStatus === "healthy" && recentRepairs === 0) {
    return (
      "Just wanted to let you know - everything's been running smoothly. " +
      "My support system has been keeping things healthy in the background."
    );
  }

  if (healthStatus === "healthy" && recentRepairs > 0) {
    return (
      `My support system handled ${recentRepairs} small maintenance ${recentRepairs === 1 ? "task" : "tasks"} ` +
      "this week. Everything's running well now."
    );
  }

  if (healthStatus === "degraded") {
    return (
      "I've been running a bit slower than usual lately. " +
      "My support system is aware and working on improvements."
    );
  }

  return null;
}

// =============================================================================
// Relationship-Aware Messaging
// =============================================================================

/**
 * Adjust message tone based on relationship phase.
 * Earlier phases get more explanation, mature phases get briefer updates.
 */
export function adjustMessageForPhase(
  message: string,
  phase: "establishing" | "developing" | "deepening" | "mature",
): string {
  switch (phase) {
    case "establishing":
      // More explanation for new relationships
      if (message.includes("support system")) {
        return message + " (That's the infrastructure that keeps me running smoothly.)";
      }
      return message;

    case "developing":
      // Standard messaging
      return message;

    case "deepening":
    case "mature":
      // Briefer, more casual for established relationships
      return message
        .replace("My support system", "Support")
        .replace("Just wanted to let you know - ", "")
        .replace("Your conversation history is safe - ", "");

    default:
      return message;
  }
}
