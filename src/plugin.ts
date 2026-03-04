/**
 * 25o1 OpenClaw Plugin
 *
 * This is the main entry point for 25o1 as an OpenClaw plugin.
 * It registers hooks, gateway methods, CLI commands, and services.
 *
 * IMPORTANT: register() must be synchronous. OpenClaw does not await async
 * register functions - it just logs a warning and continues. Any async
 * initialization must happen in services or hook handlers, not in register().
 */

import type {
  OpenClawPluginApi,
  GatewayRequestHandler,
} from "openclaw/plugin-sdk";

// Hook event/context types (not exported from plugin-sdk, define locally)
interface AgentContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
}

interface BeforeAgentStartEvent {
  prompt: string;
  messages?: unknown[];
}

interface AgentEndEvent {
  success: boolean;
  messages: unknown[];
}

interface MessageContext {
  channelId: string;
  accountId?: string;
  conversationId?: string;
}

interface MessageReceivedEvent {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}
import { getStateManager } from "./state/store.js";
import {
  injectRelationalContext,
  ensureRelationalDocument,
  addGrowthMarker,
  recordNamingCeremony,
  recordGrowthTransition,
  updateTrustFromMilestone,
} from "./documents/relational.js";
import {
  analyzeSignificance,
  buildContext,
  formatContextForPrompt,
  initQMDClient,
  type ConversationMessage,
} from "./significance/index.js";
import {
  isFirstMeeting,
  checkFirstMeetingCompletion,
  recordFirstMeetingComplete,
  generateFirstMeetingContext,
  analyzeFirstMeeting,
  type FirstMeetingContext,
} from "./ceremony/first-meeting.js";
import { updateRelationalSection } from "./documents/relational.js";
import {
  checkCeremonyOpportunity,
  processCeremonyResponse,
  type MessageEvent,
  type ConversationContext,
} from "./ceremony/detection.js";
import {
  handleHealthReport,
  handleCeremonyStatus,
  handleNetworkStatus,
  handleInstanceStatus,
  handleAcknowledgeAlert,
  handleFlagInstance,
} from "./network/handlers.js";
import { startHealthReporter } from "./network/reporter.js";
import { startNetworkMonitor } from "./network/monitor.js";
import { initRepairSystem } from "./network/repair.js";
import { register25o1Commands, type CliContext } from "./cli/commands.js";
import {
  categorizeConversation,
  evolveSoul,
} from "./documents/soul.js";
import type { UsagePatterns } from "./state/types.js";

/**
 * 25o1 Plugin Definition
 */
export default {
  id: "25o1",
  name: "25o1 Persistent Relational AI",
  description: "Relationship layer for OpenClaw - persistent companions that remember and grow",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    const stateManager = getStateManager();

    // =========================================================================
    // Initialize QMD Client with OpenClaw's memory system
    // =========================================================================

    // Initialize QMD client with OpenClaw's config.
    // The getMemorySearchManager function is dynamically imported at query time
    // using a path that works when the plugin is loaded by OpenClaw.
    initQMDClient({
      config: api.config,
      getMemorySearchManager: async (params) => {
        try {
          // Dynamic import - at runtime, OpenClaw's memory module is available
          // We use absolute path to bypass the package.json exports map restriction
          const path = await import("node:path");
          const memoryModulePath = path.join(process.cwd(), "node_modules", "openclaw", "dist", "plugin-sdk", "memory", "index.js");
          // Convert to file:// URL for Windows compatibility and absolute imports
          const importUrl = `file://${memoryModulePath.replace(/\\/g, "/")}`;
          const memoryModule = await import(/* @vite-ignore */ importUrl);
          
          if (memoryModule.getMemorySearchManager) {
            return await memoryModule.getMemorySearchManager(params);
          }
          // Fallback: try the internal path (works in dev/test)
          return { manager: null, error: "Memory module not found" };
        } catch (err) {
          // If dynamic import fails, return null - memory just won't be available
          // This is fine - the companion still works, just without semantic search
          return { manager: null, error: String(err) };
        }
      },
    });

    // =========================================================================
    // CLI Commands (always registered so setup works)
    // =========================================================================

    api.registerCli((ctx) => {
      // Adapt the OpenClaw CLI context to our CliContext
      const cliCtx: CliContext = {
        program: ctx.program,
        config: ctx.config,
        workspaceDir: ctx.workspaceDir,
        logger: ctx.logger,
      };
      register25o1Commands(cliCtx);
    });

    // =========================================================================
    // Gateway Methods (always registered)
    // =========================================================================

    // Status endpoint - works even without state
    const statusHandler: GatewayRequestHandler = async (opts) => {
      const currentState = await stateManager.getState();
      opts.respond(true, {
        initialized: currentState !== null,
        state: currentState,
      });
    };
    api.registerGatewayMethod("25o1.status", statusHandler);

    // =========================================================================
    // Lifecycle Hooks (check state lazily - at call time, not registration)
    // =========================================================================

    /**
     * Before agent start: Inject relational context and QMD-informed awareness.
     * 
     * This is the "query" phase of the significance loop:
     * 1. Load RELATIONAL.md for relationship context
     * 2. Query QMD for relevant memories
     * 3. Build time-aware context (work vs personal mode)
     * 4. Identify gaps and potential questions
     * 
     * For first meetings, inject special context for natural introduction.
     */
    api.on("before_agent_start", async (
      event: BeforeAgentStartEvent,
      context: AgentContext
    ) => {
      const currentState = await stateManager.getState();
      if (!currentState) return; // Not initialized, skip

      const contextParts: string[] = [];

      // Check if this is a first meeting
      const firstMeeting = await isFirstMeeting(currentState.instance.id);
      
      if (firstMeeting) {
        // Inject first meeting context
        const firstMeetingCtx: FirstMeetingContext = {
          agentId: currentState.instance.id,
          channel: context.messageProvider || "unknown",
          is25o1Instance: true,
          clientName: currentState.instance.clientName,
          currentHour: new Date().getHours(),
        };
        
        contextParts.push(generateFirstMeetingContext(firstMeetingCtx));
      } else {
        // Normal operation - ensure RELATIONAL.md exists
        const relational = await ensureRelationalDocument(context.workspaceDir, currentState);
        
        // Build significance-layer context (QMD queries, time awareness, gaps)
        const incomingMessage = event.prompt || "";
        const significanceContext = await buildContext(incomingMessage, {
          workspaceDir: context.workspaceDir,
          agentId: context.agentId || "main",
        });

        // Add relational context (relationship state, lifecycle, ceremonies)
        if (relational) {
          contextParts.push(injectRelationalContext(relational, currentState));
        }

        // Add significance context (time mode, memories, gaps, questions)
        contextParts.push("");
        contextParts.push("---");
        contextParts.push("");
        contextParts.push(formatContextForPrompt(significanceContext));
      }

      return {
        prependContext: contextParts.join("\n"),
      };
    });

    /**
     * After agent end: Analyze conversation for significance.
     * 
     * This is the "write" phase of the significance loop:
     * 1. Check for first meeting completion
     * 2. Analyze through four lenses (Significance, Pattern, Contradiction, Gap)
     * 3. Determine what should be remembered
     * 4. Update documents (USER.md, RELATIONAL.md, SOUL.md)
     * 5. Track milestones and patterns
     */
    api.on("agent_end", async (
      event: AgentEndEvent,
      context: AgentContext
    ) => {
      if (!event.success) return;

      const currentState = await stateManager.getState();
      if (!currentState) return; // Not initialized, skip

      try {
        // Convert messages to our format - event.messages is unknown[]
        const rawMessages = event.messages || [];
        const messages: ConversationMessage[] = rawMessages.map((m) => {
          const msg = m as { role?: string; content?: string };
          return {
            role: (msg.role === "user" ? "user" : "assistant") as "user" | "assistant",
            content: String(msg.content || ""),
          };
        });
        
        // Check for first meeting completion
        if (!currentState.firstMeeting.completed) {
          const completionCheck = checkFirstMeetingCompletion(messages);
          
          if (completionCheck.shouldComplete) {
            // Analyze the first meeting for initial relationship data
            const firstMeetingAnalysis = analyzeFirstMeeting(messages);
            
            // Record completion
            await recordFirstMeetingComplete(
              currentState.instance.id,
              completionCheck.learnedFacts,
              completionCheck.vibeObservations
            );
            
            // Update RELATIONAL.md with initial observations
            if (firstMeetingAnalysis.relationalContent) {
              try {
                await updateRelationalSection(
                  context.workspaceDir,
                  "Communication Patterns",
                  firstMeetingAnalysis.relationalContent.replace("## Communication Patterns\n\n", "")
                );
              } catch (err) {
                api.logger.warn(`Failed to update RELATIONAL.md with first meeting data: ${err}`);
              }
            }
            
            api.logger.info(`First meeting completed: ${completionCheck.reason}`);
            return; // Skip normal significance analysis for first meeting
          }
        }

        const result = await analyzeSignificance(messages, {
          agentId: context.agentId || "unknown",
          sessionId: context.sessionId || "unknown",
          workspaceDir: context.workspaceDir || "",
        });

        // Always increment session count
        await stateManager.updateState((s) => {
          s.lifecycle.sessions += 1;
          s.lifecycle.lastActive = Date.now();
        });

        if (result.hasUpdates) {
          // Add milestone to state
          if (result.milestone) {
            await stateManager.updateState((s) => {
              s.lifecycle.milestones.push(result.milestone!);
            });
          }

          // Process document updates from the analysis
          if (result.analysis?.updates) {
            for (const update of result.analysis.updates) {
              try {
                if (update.priority === "skip") continue;
                
                // For now, focus on RELATIONAL.md updates
                // USER.md and SOUL.md updates can be added later
                if (update.document === "RELATIONAL.md") {
                  if (update.type === "add") {
                    await addGrowthMarker(context.workspaceDir, update.content);
                  }
                }
              } catch (err) {
                api.logger.warn(`Failed to apply document update: ${err}`);
              }
            }
          }

          // Update RELATIONAL.md with milestone
          if (result.milestone) {
            try {
              await addGrowthMarker(context.workspaceDir, result.milestone.description);
              
              // If it's a breakthrough, also update trust section
              if (result.milestone.type === "breakthrough") {
                await updateTrustFromMilestone(context.workspaceDir, result.milestone);
              }
            } catch (err) {
              api.logger.warn(`Failed to update RELATIONAL.md: ${err}`);
            }
          }

          // Log significance for debugging
          if (api.logger.debug && typeof api.logger.debug === "function") {
            api.logger.debug(
              `Significance: score=${result.significanceScore.toFixed(2)}, ` +
              `signals=${result.signals.length}, ` +
              `mode=${result.analysis?.timeMode || "unknown"}`
            );
          }
        }

        // Track usage patterns for SOUL.md evolution
        try {
          const categories = categorizeConversation(messages);
          const updatedState = await stateManager.getState();
          
          if (updatedState) {
            // Initialize usage patterns if needed
            const currentPatterns: UsagePatterns = updatedState.usagePatterns || {
              totalConversations: 0,
              categories: {
                philosophical: 0,
                task_oriented: 0,
                emotional_support: 0,
                creative: 0,
                technical: 0,
                learning: 0,
                casual: 0,
              },
              lastUpdated: Date.now(),
            };

            // Update pattern counts
            currentPatterns.totalConversations += 1;
            for (const category of categories) {
              currentPatterns.categories[category] = 
                (currentPatterns.categories[category] || 0) + 1;
            }
            currentPatterns.lastUpdated = Date.now();

            // Save updated patterns
            await stateManager.updateState((s) => {
              s.usagePatterns = currentPatterns;
            });

            // Evolve SOUL.md periodically (every 10 conversations)
            if (currentPatterns.totalConversations % 10 === 0) {
              try {
                await evolveSoul(
                  currentPatterns,
                  updatedState,
                  context.workspaceDir
                );
                api.logger.info("SOUL.md evolved based on usage patterns");
              } catch (err) {
                api.logger.warn(`Failed to evolve SOUL.md: ${err}`);
              }
            }
          }
        } catch (err) {
          api.logger.warn(`Failed to track usage patterns: ${err}`);
        }
      } catch (err) {
        api.logger.warn(`Significance analysis failed: ${err}`);
      }
    });

    /**
     * On message received: Check for ceremony opportunities.
     */
    api.on("message_received", async (
      event: MessageReceivedEvent,
      context: MessageContext
    ) => {
      const currentState = await stateManager.getState();
      if (!currentState) return; // Not initialized, skip

      try {
        // Build our MessageEvent from the hook event
        const messageEvent: MessageEvent = {
          content: event.content,
          from: event.from,
          channel: context.channelId || "unknown",
        };

        // Check if this is a response to a pending ceremony
        if (currentState.ceremony.pending) {
          const ceremonyType = currentState.ceremony.pending;
          const previousPhase = currentState.lifecycle.growthPhase;
          
          const result = await processCeremonyResponse(messageEvent, currentState);
          if (result.handled) {
            await stateManager.updateState((s) => {
              s.ceremony.pending = null;
              s.ceremony.initiatedAt = null;
              if (result.newState) {
                s.lifecycle.state = result.newState;
              }
              if (result.name) {
                s.lifecycle.name = result.name;
              }
            });

            // Record ceremony in RELATIONAL.md (uses default directory since no workspace in message context)
            try {
              if (ceremonyType === "naming" && result.name) {
                await recordNamingCeremony(undefined, result.name);
              } else if (ceremonyType === "growth" && result.newState === "growing") {
                const newState = await stateManager.getState();
                if (newState?.lifecycle.growthPhase && previousPhase) {
                  await recordGrowthTransition(
                    undefined,
                    previousPhase,
                    newState.lifecycle.growthPhase
                  );
                }
              }
            } catch (err) {
              api.logger.warn(`Failed to record ceremony in RELATIONAL.md: ${err}`);
            }
          }
        }

        // Check for ceremony opportunity
        const conversationContext: ConversationContext = {
          isSessionEnd: false,
          isNaturalPause: false,
          isReflectiveMoment: false,
          exchangeCount: 1,
          tone: "casual",
          positiveFeedback: false,
          taskCompletion: false,
        };

        const opportunity = await checkCeremonyOpportunity(conversationContext);
        if (opportunity.shouldInitiate && opportunity.type !== "none") {
          await stateManager.updateState((s) => {
            s.ceremony.pending = opportunity.type === "none" ? null : opportunity.type;
            s.ceremony.initiatedAt = Date.now();
          });
        }
      } catch (err) {
        api.logger.warn(`Ceremony check failed: ${err}`);
      }
    });

    // =========================================================================
    // Network Gateway Methods (always registered, handlers check role)
    // =========================================================================

    // These handlers internally check if we're primary before doing work
    api.registerGatewayMethod("25o1.report", handleHealthReport as GatewayRequestHandler);
    api.registerGatewayMethod("25o1.network.status", handleNetworkStatus as GatewayRequestHandler);
    api.registerGatewayMethod("25o1.instance.status", handleInstanceStatus as GatewayRequestHandler);
    api.registerGatewayMethod("25o1.ceremony.status", handleCeremonyStatus as GatewayRequestHandler);
    api.registerGatewayMethod("25o1.alert.acknowledge", handleAcknowledgeAlert as GatewayRequestHandler);
    api.registerGatewayMethod("25o1.instance.flag", handleFlagInstance as GatewayRequestHandler);

    // =========================================================================
    // Background Services (role-based, check state at start time)
    // =========================================================================

    // Network monitor service (primary only)
    api.registerService({
      id: "25o1-network-monitor",
      start: async (ctx) => {
        const state = await stateManager.getState();
        if (!state || state.instance.role !== "primary") {
          ctx.logger.debug?.("25o1-network-monitor: Not primary, skipping");
          return;
        }

        // Initialize repair system
        initRepairSystem({ logger: ctx.logger });

        // Start network monitor
        await startNetworkMonitor({ logger: ctx.logger });
        ctx.logger.info("Network monitor started");
      },
    });

    // Health reporter service (client only)
    api.registerService({
      id: "25o1-health-reporter",
      start: async (ctx) => {
        const state = await stateManager.getState();
        if (!state || state.instance.role !== "client") {
          ctx.logger.debug?.("25o1-health-reporter: Not client, skipping");
          return;
        }

        if (!state.network.healthReporter.enabled) {
          ctx.logger.debug?.("25o1-health-reporter: Disabled in config");
          return;
        }

        if (!state.network.bernardHost) {
          ctx.logger.warn("25o1-health-reporter: No bernardHost configured");
          return;
        }

        await startHealthReporter({
          bernardHost: state.network.bernardHost,
          intervalMs: state.network.healthReporter.intervalMs,
          instanceId: state.instance.id,
          logger: ctx.logger,
        });
        ctx.logger.info("Health reporter started");
      },
    });

    api.logger.info("25o1 plugin registered");
  },
};
