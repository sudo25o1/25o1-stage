/**
 * Context Builder
 *
 * Builds the context to inject into system prompts before the companion responds.
 * This is the "query" phase of the significance loop.
 */

import type {
  InjectedContext,
  TimeMode,
  QMDContext,
  GapItem,
  ContradictionItem,
} from "./types.js";
import { getTimeMode, getTimeModeGuidance } from "./types.js";
import { queryQMDContext } from "./qmd-client.js";

// =============================================================================
// Main Context Builder
// =============================================================================

/**
 * Build context to inject into the system prompt.
 * 
 * This is called in before_agent_start to give the companion:
 * - Time-of-day awareness
 * - Relevant memories from QMD
 * - Knowledge gaps to potentially fill
 * - Questions it might naturally ask
 * - Active patterns to be aware of
 * - Any contradictions to handle
 */
export async function buildContext(
  message: string,
  options: {
    workspaceDir?: string;
    agentId?: string;
    currentHour?: number;
  } = {}
): Promise<InjectedContext> {
  // Get current time mode
  const hour = options.currentHour ?? new Date().getHours();
  const mode = getTimeMode(hour);
  const guidance = getTimeModeGuidance(mode);

  // Query QMD for relevant context
  const qmdContext = await queryQMDContext(message, {
    workspaceDir: options.workspaceDir,
    agentId: options.agentId,
  });

  // Build potential questions (one at most, based on gaps and time mode)
  const potentialQuestions = buildPotentialQuestions(qmdContext.gaps, mode);

  // Format memories for injection
  const relevantMemories = qmdContext.memories
    .filter(m => m.relevance > 0.5)
    .slice(0, 5)
    .map(m => m.content);

  // Format active patterns
  const activePatterns = qmdContext.patterns
    .filter(p => p.confidence > 0.6)
    .map(p => p.description);

  return {
    timeMode: {
      mode,
      guidance,
      hour,
    },
    relevantMemories,
    knowledgeGaps: qmdContext.gaps,
    potentialQuestions,
    activePatterns,
    contradictions: qmdContext.contradictions,
  };
}

// =============================================================================
// Question Generation
// =============================================================================

/**
 * Build potential follow-up questions based on gaps and time mode.
 * Returns at most one question - we don't want to interrogate.
 */
function buildPotentialQuestions(gaps: GapItem[], mode: TimeMode): string[] {
  if (gaps.length === 0) return [];

  // Sort gaps by priority
  const sortedGaps = [...gaps].sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  // Pick at most one gap to potentially ask about
  const topGap = sortedGaps[0];
  
  // Adjust question framing based on time mode
  const question = frameQuestionForMode(topGap, mode);
  
  return question ? [question] : [];
}

/**
 * Frame a gap-filling question appropriately for the time mode.
 */
function frameQuestionForMode(gap: GapItem, mode: TimeMode): string | null {
  // Don't ask new questions during rest mode
  if (mode === "rest") return null;

  const { entity, suggestedQuestion } = gap;

  switch (mode) {
    case "work":
      // Direct, efficient framing
      if (entity.match(/^[A-Z]/)) {
        return `Is ${entity} related to what you're working on?`;
      }
      return `What's the context on ${entity.toLowerCase()}?`;

    case "work_light":
      // Slightly softer
      if (entity.match(/^[A-Z]/)) {
        return `You mentioned ${entity} - should I know more about that?`;
      }
      return suggestedQuestion;

    case "personal":
      // More curious, relationship-oriented
      if (entity.match(/^[A-Z]/)) {
        return `Who's ${entity}?`;
      }
      return `Tell me more about ${entity.toLowerCase()} when you get a chance.`;

    default:
      return suggestedQuestion;
  }
}

// =============================================================================
// Context Formatting
// =============================================================================

/**
 * Format the injected context as a string for the system prompt.
 */
export function formatContextForPrompt(context: InjectedContext): string {
  const parts: string[] = [];

  // Time mode awareness
  parts.push("## Current Mode");
  parts.push(`Time: ${formatHour(context.timeMode.hour)}`);
  parts.push(`Mode: ${context.timeMode.mode}`);
  parts.push(`Guidance: ${context.timeMode.guidance}`);

  // Relevant memories (if any)
  if (context.relevantMemories.length > 0) {
    parts.push("");
    parts.push("## What You Remember");
    parts.push("Based on this conversation, here's relevant context you have:");
    for (const memory of context.relevantMemories) {
      parts.push(`- ${memory}`);
    }
  }

  // Active patterns (if any)
  if (context.activePatterns.length > 0) {
    parts.push("");
    parts.push("## Patterns You've Noticed");
    for (const pattern of context.activePatterns) {
      parts.push(`- ${pattern}`);
    }
  }

  // Knowledge gaps (awareness, not interrogation)
  if (context.knowledgeGaps.length > 0) {
    parts.push("");
    parts.push("## Things You Don't Know Yet");
    parts.push("(Don't interrogate - just be aware. Ask naturally if it fits.)");
    for (const gap of context.knowledgeGaps.slice(0, 3)) {
      parts.push(`- ${gap.entity}: no context yet`);
    }
  }

  // Potential question (if any)
  if (context.potentialQuestions.length > 0) {
    parts.push("");
    parts.push("## Potential Follow-up");
    parts.push("If natural, you might ask:");
    parts.push(`- ${context.potentialQuestions[0]}`);
    parts.push("(Only if it flows naturally - don't force it)");
  }

  // Contradictions to handle
  if (context.contradictions.length > 0) {
    parts.push("");
    parts.push("## Contradictions to Note");
    for (const c of context.contradictions) {
      parts.push(`- Previously: "${c.previous}"`);
      parts.push(`  Now: "${c.current}"`);
      parts.push(`  Handle with: ${formatHandling(c.handling)}`);
    }
  }

  return parts.join("\n");
}

/**
 * Format hour for display.
 */
function formatHour(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${period}`;
}

/**
 * Format contradiction handling guidance.
 */
function formatHandling(handling: ContradictionItem["handling"]): string {
  switch (handling) {
    case "absorb_silently":
      return "Just update your understanding, don't mention it";
    case "light_acknowledgment":
      return "Brief acknowledgment like 'Oh interesting, I thought...'";
    case "genuine_curiosity":
      return "Ask about it: 'That's different from before - did something change?'";
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if context has anything meaningful to inject.
 */
export function hasSignificantContext(context: InjectedContext): boolean {
  return (
    context.relevantMemories.length > 0 ||
    context.activePatterns.length > 0 ||
    context.contradictions.length > 0
  );
}
