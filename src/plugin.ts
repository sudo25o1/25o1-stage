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
  loadSoulDocument,
  ensureSoulDocument,
  getSoulContext,
  recordNamingInSoul,
} from "./documents/soul.js";
import {
  addUserFact,
  loadUserDocument,
  getUserContext,
} from "./documents/user.js";
import type { UsagePatterns } from "./state/types.js";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Detect the tone of a message for ceremony moment scoring.
 */
function detectMessageTone(content: string): "casual" | "celebratory" | "reflective" | "challenging" | "focused" {
  const lower = content.toLowerCase();

  if (/(!{2,}|\b(amazing|incredible|awesome|wooo|yay|hell yeah|fantastic|celebration|celebrate|congrats)\b)/.test(lower)) {
    return "celebratory";
  }
  if (/\b(thinking about|reflecting|looking back|realized|appreciate|grateful|meaningful|journey)\b/.test(lower)) {
    return "reflective";
  }
  if (/\b(frustrated|annoyed|stuck|confused|broken|failing|wrong|issue|problem|bug|error)\b/.test(lower)) {
    return "challenging";
  }

  return "casual";
}

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

        // Inject SOUL.md identity context
        try {
          const soulContent = await ensureSoulDocument(context.workspaceDir, currentState);
          const soulContext = getSoulContext(soulContent);
          if (soulContext) {
            contextParts.push(soulContext);
            contextParts.push("");
          }
        } catch (err) {
          api.logger.warn(`Failed to load SOUL.md: ${err}`);
        }

        // Inject USER.md knowledge context
        try {
          const userContent = await loadUserDocument(context.workspaceDir);
          const userContext = getUserContext(userContent);
          if (userContext) {
            contextParts.push(userContext);
            contextParts.push("");
          }
        } catch (err) {
          api.logger.warn(`Failed to load USER.md: ${err}`);
        }

        // Add relational context (relationship state, lifecycle, ceremonies)
        if (relational) {
          contextParts.push(injectRelationalContext(relational, currentState));
        }

        // Add significance context (time mode, memories, gaps, questions)
        contextParts.push("");
        contextParts.push("---");
        contextParts.push("");
        contextParts.push(formatContextForPrompt(significanceContext));

        // Track workspace dir for ceremony outcomes that lack workspace context
        if (context.workspaceDir && context.workspaceDir !== currentState.lastWorkspaceDir) {
          stateManager.updateState((s) => {
            s.lastWorkspaceDir = context.workspaceDir;
          }).catch(() => { /* non-critical */ });
        }
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
        // OpenClaw messages can have string or array content blocks
        const rawMessages = event.messages || [];
        const messages: ConversationMessage[] = rawMessages
          .filter((m) => {
            const msg = m as { role?: string };
            // Only process user and assistant messages, skip tool/toolResult/system
            return msg.role === "user" || msg.role === "assistant";
          })
          .map((m) => {
            const msg = m as { role?: string; content?: unknown };
            // Extract text from content - handle both string and array formats
            let content = "";
            if (typeof msg.content === "string") {
              content = msg.content;
            } else if (Array.isArray(msg.content)) {
              // OpenClaw uses content blocks: [{type: "text", text: "..."}, ...]
              content = (msg.content as Array<{ type?: string; text?: string }>)
                .filter((block) => block.type === "text" && typeof block.text === "string")
                .map((block) => block.text!)
                .join("\n");
            }
            return {
              role: msg.role as "user" | "assistant",
              content,
            };
          })
          .filter((m) => m.content.length > 0);
        
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
                
                if (update.document === "RELATIONAL.md") {
                  if (update.type === "add") {
                    await addGrowthMarker(context.workspaceDir, update.content);
                  }
                } else if (update.document === "USER.md") {
                  // Write learned facts about the human
                  await addUserFact(
                    context.workspaceDir,
                    update.section || "Notes",
                    update.content,
                    update.type === "update" ? "update" : "add",
                  );
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

        // Use persisted workspace dir for ceremony recordings (message context doesn't carry it)
        const workspaceDir = currentState.lastWorkspaceDir;

        // Check if this is a response to a pending ceremony
        if (currentState.ceremony.pending) {
          const ceremonyType = currentState.ceremony.pending;
          const previousPhase = currentState.lifecycle.growthPhase;
          
          const result = await processCeremonyResponse(messageEvent, currentState);
          if (result.handled) {
            await stateManager.updateState((s) => {
              s.ceremony.pending = null;
              s.ceremony.initiatedAt = null;
              s.ceremony.candidateNames = undefined; // Clear persisted names
              if (result.newState) {
                s.lifecycle.state = result.newState;
              }
              if (result.name) {
                s.lifecycle.name = result.name;
              }
            });

            // Record ceremony outcomes in documents
            try {
              if (ceremonyType === "naming" && result.name) {
                await recordNamingCeremony(workspaceDir, result.name);
                // Also update SOUL.md with the new name
                await recordNamingInSoul(result.name, undefined, workspaceDir);
              } else if (ceremonyType === "growth" && result.newState === "growing") {
                const newState = await stateManager.getState();
                if (newState?.lifecycle.growthPhase && previousPhase) {
                  await recordGrowthTransition(
                    workspaceDir,
                    previousPhase,
                    newState.lifecycle.growthPhase
                  );
                }
              }
            } catch (err) {
              api.logger.warn(`Failed to record ceremony in documents: ${err}`);
            }
          }
        }

        // Build real ConversationContext from message signals
        const content = event.content.toLowerCase();
        const conversationContext: ConversationContext = {
          // Detect natural pauses (short messages after longer exchanges)
          isSessionEnd: false,
          isNaturalPause: /^(thanks|thank you|that's all|got it|perfect|okay|ok|cheers|bye)\b/i.test(content),
          // Detect reflective moments
          isReflectiveMoment: /\b(thinking about|reflecting|looking back|realized|grateful|appreciate)\b/i.test(content),
          // Use session count as a proxy for exchange depth
          exchangeCount: Math.max(currentState.lifecycle.sessions, 3),
          // Detect tone from message content
          tone: detectMessageTone(event.content),
          // Detect positive feedback
          positiveFeedback: /\b(thank|thanks|awesome|great job|nice|well done|perfect|love it|amazing|brilliant)\b/i.test(content),
          // Detect task completion signals
          taskCompletion: /\b(done|finished|complete|shipped|deployed|merged|fixed|resolved|solved|that works)\b/i.test(content),
        };

        const opportunity = await checkCeremonyOpportunity(conversationContext);
        if (opportunity.shouldInitiate && opportunity.type !== "none") {
          await stateManager.updateState((s) => {
            s.ceremony.pending = opportunity.type === "none" ? null : opportunity.type;
            s.ceremony.initiatedAt = Date.now();
            // Persist candidate names so they survive across sessions
            if (opportunity.ceremony?.context?.type === "naming") {
              const namingCtx = opportunity.ceremony.context as { candidateNames?: Array<{ name: string; reasoning: string; connectionToRelationship: string; confidence: number }> };
              if (namingCtx.candidateNames) {
                s.ceremony.candidateNames = namingCtx.candidateNames;
              }
            }
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
