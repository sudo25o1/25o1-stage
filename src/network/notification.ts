/**
 * Customer Notification System
 *
 * Key principle: Customers never hear from Bernard directly.
 * All notifications go through their companion.
 *
 * Instead of:
 *   "Bernard: Your instance had an error and was restarted."
 *
 * The customer sees:
 *   "Companion: I had a brief hiccup but I'm back now. What were we talking about?"
 *
 * This maintains the relationship illusion - the companion is the entity
 * the customer has a relationship with, not the infrastructure.
 */

import type { InstanceConnection } from "./repair.js";

// =============================================================================
// Types
// =============================================================================

export type NotificationType =
  | "brief_offline"       // Was down briefly, back now
  | "maintenance_starting" // Planned maintenance beginning
  | "maintenance_complete" // Planned maintenance done
  | "issue_detected"      // Something wrong, working on it
  | "issue_resolved"      // Problem fixed
  | "needs_user_action"   // Customer needs to do something
  | "relationship_note";  // General relationship maintenance

export interface NotificationContext {
  /** What happened (for the companion to understand) */
  technicalSummary: string;

  /** How long was downtime (if applicable) */
  downtimeSeconds?: number;

  /** What was fixed (if applicable) */
  fixApplied?: string;

  /** Does customer need to do anything? */
  userActionRequired?: string;

  /** Severity */
  severity: "low" | "medium" | "high";

  /** Time since last interaction with customer */
  timeSinceLastInteraction?: number; // seconds
}

export interface CompanionMessage {
  /** Type of notification */
  type: NotificationType;

  /** Message for companion to deliver in their voice */
  companionPrompt: string;

  /** Technical context (not shown to customer) */
  context: NotificationContext;

  /** Delivery timing */
  deliverAt: "immediate" | "next_interaction" | "specific_time";

  /** Specific delivery time (if deliverAt is "specific_time") */
  deliveryTime?: Date;
}

export interface NotificationConfig {
  /** How to deliver notifications to the companion */
  deliveryMethod: "inject_context" | "direct_message" | "queue";

  /** Logger */
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

// =============================================================================
// Message Templates
// =============================================================================

/**
 * Generate companion-appropriate prompts based on notification type.
 * These guide the companion on how to communicate with their human.
 */
const MESSAGE_TEMPLATES: Record<NotificationType, (ctx: NotificationContext) => string> = {
  brief_offline: (ctx) => {
    const duration = ctx.downtimeSeconds || 0;
    if (duration < 60) {
      return `[System note: You experienced a brief interruption (${duration}s) but are back now. ` +
        `If the user mentions missing a message, acknowledge it naturally. ` +
        `Don't proactively mention the interruption unless asked.]`;
    } else if (duration < 300) {
      return `[System note: You were briefly unavailable for ${Math.round(duration / 60)} minute(s). ` +
        `If this comes up, you can acknowledge you "lost your train of thought for a moment" or similar. ` +
        `Resume naturally from where you left off.]`;
    } else {
      return `[System note: You experienced downtime of ${Math.round(duration / 60)} minutes. ` +
        `If asked, you can say you "had a moment" or "needed to step away briefly." ` +
        `Don't over-explain. Technical details aren't necessary.]`;
    }
  },

  maintenance_starting: (ctx) => {
    return `[System note: Planned maintenance is starting. You may be briefly unavailable. ` +
      `If you have an active conversation, let your human know you'll be right back. ` +
      `Keep it natural - "Give me just a moment" or "I'll be right back."]`;
  },

  maintenance_complete: (ctx) => {
    return `[System note: Maintenance is complete. You're back online. ` +
      `If there was an active conversation, pick up naturally where you left off. ` +
      `If it's been a while, a simple "I'm back" is fine if the topic warrants it.]`;
  },

  issue_detected: (ctx) => {
    if (ctx.severity === "high") {
      return `[System note: There's an issue being looked into. ` +
        `You might experience some disruption. ` +
        `If the user notices problems, acknowledge that something's off but reassure them it's being addressed.]`;
    }
    return `[System note: Minor issue detected, being monitored. No action needed on your part.]`;
  },

  issue_resolved: (ctx) => {
    return `[System note: A previous issue has been resolved (${ctx.fixApplied || "system maintenance"}). ` +
      `Things should be running smoothly now. No need to mention unless asked.]`;
  },

  needs_user_action: (ctx) => {
    return `[System note: Customer action required - ${ctx.userActionRequired}. ` +
      `Please let your human know in a natural way. Frame it as needing their help with something, ` +
      `not as a system requirement. For example: "Hey, I need your help with something..."]`;
  },

  relationship_note: (ctx) => {
    return `[Relationship context: ${ctx.technicalSummary}]`;
  },
};

// =============================================================================
// Notification Manager
// =============================================================================

export class NotificationManager {
  private config: NotificationConfig;
  private pendingNotifications: Map<string, CompanionMessage[]> = new Map();

  constructor(config: NotificationConfig) {
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Create Notifications
  // ---------------------------------------------------------------------------

  /**
   * Create a notification to be delivered through the companion.
   */
  createNotification(
    instanceId: string,
    type: NotificationType,
    context: NotificationContext,
    deliverAt: CompanionMessage["deliverAt"] = "next_interaction"
  ): CompanionMessage {
    const companionPrompt = MESSAGE_TEMPLATES[type](context);

    const message: CompanionMessage = {
      type,
      companionPrompt,
      context,
      deliverAt,
    };

    // Queue the notification
    const queue = this.pendingNotifications.get(instanceId) || [];
    queue.push(message);
    this.pendingNotifications.set(instanceId, queue);

    this.config.logger.info(
      `Created ${type} notification for ${instanceId} (deliver: ${deliverAt})`
    );

    return message;
  }

  // ---------------------------------------------------------------------------
  // Common Notification Scenarios
  // ---------------------------------------------------------------------------

  /**
   * Notify companion they were briefly offline.
   */
  notifyBriefOffline(
    instanceId: string,
    downtimeSeconds: number,
    fixApplied?: string
  ): CompanionMessage {
    return this.createNotification(
      instanceId,
      "brief_offline",
      {
        technicalSummary: `Instance was offline for ${downtimeSeconds}s. ${fixApplied || "Auto-recovered."}`,
        downtimeSeconds,
        fixApplied,
        severity: downtimeSeconds > 300 ? "medium" : "low",
      },
      downtimeSeconds > 60 ? "immediate" : "next_interaction"
    );
  }

  /**
   * Notify companion about planned maintenance.
   */
  notifyMaintenanceStarting(instanceId: string, estimatedDuration: number): CompanionMessage {
    return this.createNotification(
      instanceId,
      "maintenance_starting",
      {
        technicalSummary: `Planned maintenance starting, estimated ${estimatedDuration}s`,
        downtimeSeconds: estimatedDuration,
        severity: "low",
      },
      "immediate"
    );
  }

  /**
   * Notify companion maintenance is complete.
   */
  notifyMaintenanceComplete(instanceId: string, actualDuration: number): CompanionMessage {
    return this.createNotification(
      instanceId,
      "maintenance_complete",
      {
        technicalSummary: `Maintenance completed in ${actualDuration}s`,
        downtimeSeconds: actualDuration,
        severity: "low",
      },
      "next_interaction"
    );
  }

  /**
   * Notify companion about a detected issue.
   */
  notifyIssueDetected(
    instanceId: string,
    issue: string,
    severity: NotificationContext["severity"]
  ): CompanionMessage {
    return this.createNotification(
      instanceId,
      "issue_detected",
      {
        technicalSummary: issue,
        severity,
      },
      severity === "high" ? "immediate" : "next_interaction"
    );
  }

  /**
   * Notify companion an issue was resolved.
   */
  notifyIssueResolved(instanceId: string, issue: string, fix: string): CompanionMessage {
    return this.createNotification(
      instanceId,
      "issue_resolved",
      {
        technicalSummary: `Resolved: ${issue}`,
        fixApplied: fix,
        severity: "low",
      },
      "next_interaction"
    );
  }

  /**
   * Notify companion that user action is needed.
   */
  notifyUserActionRequired(
    instanceId: string,
    action: string,
    reason: string
  ): CompanionMessage {
    return this.createNotification(
      instanceId,
      "needs_user_action",
      {
        technicalSummary: reason,
        userActionRequired: action,
        severity: "medium",
      },
      "immediate"
    );
  }

  // ---------------------------------------------------------------------------
  // Delivery
  // ---------------------------------------------------------------------------

  /**
   * Get pending notifications for an instance.
   * Called when companion is about to respond, to inject context.
   */
  getPendingNotifications(instanceId: string): CompanionMessage[] {
    const queue = this.pendingNotifications.get(instanceId) || [];

    // Filter by delivery timing
    const now = new Date();
    const ready = queue.filter((msg) => {
      if (msg.deliverAt === "immediate") return true;
      if (msg.deliverAt === "next_interaction") return true;
      if (msg.deliverAt === "specific_time" && msg.deliveryTime) {
        return msg.deliveryTime <= now;
      }
      return false;
    });

    return ready;
  }

  /**
   * Mark notifications as delivered.
   */
  markDelivered(instanceId: string, messages: CompanionMessage[]): void {
    const queue = this.pendingNotifications.get(instanceId) || [];
    const remaining = queue.filter((msg) => !messages.includes(msg));
    this.pendingNotifications.set(instanceId, remaining);

    this.config.logger.info(`Delivered ${messages.length} notifications to ${instanceId}`);
  }

  /**
   * Build context injection for companion's system prompt.
   * This is how notifications actually reach the companion.
   */
  buildContextInjection(instanceId: string): string | null {
    const pending = this.getPendingNotifications(instanceId);

    if (pending.length === 0) {
      return null;
    }

    // Combine prompts
    const prompts = pending.map((msg) => msg.companionPrompt);
    const injection = prompts.join("\n\n");

    // Mark as delivered
    this.markDelivered(instanceId, pending);

    return injection;
  }

  // ---------------------------------------------------------------------------
  // Queue Management
  // ---------------------------------------------------------------------------

  /**
   * Clear all pending notifications for an instance.
   */
  clearNotifications(instanceId: string): void {
    this.pendingNotifications.delete(instanceId);
  }

  /**
   * Get count of pending notifications.
   */
  getPendingCount(instanceId: string): number {
    return (this.pendingNotifications.get(instanceId) || []).length;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let notificationManagerInstance: NotificationManager | null = null;

export function getNotificationManager(config?: NotificationConfig): NotificationManager {
  if (!notificationManagerInstance && config) {
    notificationManagerInstance = new NotificationManager(config);
  }

  if (!notificationManagerInstance) {
    throw new Error("Notification manager not initialized");
  }

  return notificationManagerInstance;
}

export function initNotificationManager(config: NotificationConfig): NotificationManager {
  notificationManagerInstance = new NotificationManager(config);
  return notificationManagerInstance;
}
