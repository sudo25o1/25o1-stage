/**
 * Significance Analyzer
 *
 * The core analysis engine that runs after conversations to detect
 * significant moments and determine what should be remembered.
 *
 * Philosophy: A good partner notices things, asks questions, revisits
 * stories, and learns continuously. Not interrogating. Not ignoring.
 * Natural attention.
 */

import type { Milestone } from "../state/types.js";
import type {
  ConversationMessage,
  AnalysisContext,
  SignificanceAnalysis,
  DocumentUpdate,
  LensResult,
  TimeMode,
} from "./types.js";
import { getTimeMode } from "./types.js";
import { queryQMDContext } from "./qmd-client.js";
import {
  analyzeWithFourLenses,
  calculateSignificanceScore,
  shouldUpdateDocuments,
} from "./four-lenses.js";

// =============================================================================
// Types (re-exported for backwards compatibility)
// =============================================================================

export type { ConversationMessage, AnalysisContext };

export interface SignificanceResult {
  hasUpdates: boolean;
  milestone?: Milestone;
  significanceScore: number;
  signals: SignificanceSignal[];
  /** Full analysis from four lenses */
  analysis?: SignificanceAnalysis;
}

export interface SignificanceSignal {
  type: SignalType;
  description: string;
  confidence: number;
  evidence?: string;
}

export type SignalType =
  | "breakthrough"
  | "trust"
  | "vulnerability"
  | "growth"
  | "conflict"
  | "resolution"
  | "gratitude"
  | "delegation"
  | "collaboration"
  | "personal_share";

// =============================================================================
// Main Analysis Function
// =============================================================================

/**
 * Analyze a conversation for significance using the four lenses.
 * 
 * This is called in agent_end to:
 * 1. Query QMD for context
 * 2. Analyze through Significance, Pattern, Contradiction, Gap lenses
 * 3. Determine what should be written to documents
 * 4. Return updates and any milestones
 */
export async function analyzeSignificance(
  messages: ConversationMessage[],
  context: AnalysisContext,
): Promise<SignificanceResult> {
  // Get current time mode
  const hour = new Date().getHours();
  const timeMode = getTimeMode(hour);

  // Query QMD for context about this conversation
  const qmdContext = await queryQMDContext(
    messages.map(m => m.content).join(" "),
    { workspaceDir: context.workspaceDir }
  );

  // Analyze through the four lenses
  const lenses = analyzeWithFourLenses(messages, qmdContext, timeMode);

  // Calculate overall significance
  const score = calculateSignificanceScore(lenses);
  const shouldUpdate = shouldUpdateDocuments(lenses, score);

  // Generate document updates
  const updates = shouldUpdate ? generateUpdates(lenses, timeMode) : [];

  // Build the full analysis
  const analysis: SignificanceAnalysis = {
    lenses,
    score,
    shouldUpdate,
    updates,
    timeMode,
  };

  // Convert to legacy format for backwards compatibility
  const signals = convertLensesToSignals(lenses);
  const milestone = shouldCreateMilestone(lenses, score, context);

  return {
    hasUpdates: shouldUpdate,
    milestone,
    significanceScore: score,
    signals,
    analysis,
  };
}

// =============================================================================
// Update Generation
// =============================================================================

/**
 * Generate document updates from lens results.
 */
function generateUpdates(lenses: LensResult[], timeMode: TimeMode): DocumentUpdate[] {
  const updates: DocumentUpdate[] = [];

  // Process significance lens → USER.md facts
  const significanceLens = lenses.find(l => l.lens === "significance");
  if (significanceLens?.found) {
    for (const item of significanceLens.items) {
      if (item.confidence >= 0.7) {
        updates.push({
          document: "USER.md",
          section: inferSection(item.content),
          content: item.evidence || item.content,
          type: "add",
          priority: item.confidence >= 0.8 ? "immediate" : "accumulate",
        });
      }
    }
  }

  // Process pattern lens → RELATIONAL.md patterns
  const patternLens = lenses.find(l => l.lens === "pattern");
  if (patternLens?.found) {
    for (const item of patternLens.items) {
      if (item.occurrences && item.occurrences >= 3) {
        updates.push({
          document: "RELATIONAL.md",
          section: "Working Patterns",
          content: item.content,
          type: "add",
          priority: "accumulate",
        });
      }
    }
  }

  // Process contradiction lens → updates to correct info
  const contradictionLens = lenses.find(l => l.lens === "contradiction");
  if (contradictionLens?.found) {
    for (const item of contradictionLens.items) {
      if (item.confidence >= 0.7) {
        updates.push({
          document: "USER.md",
          section: "Corrections",
          content: item.content,
          type: "update",
          priority: "immediate",
        });
      }
    }
  }

  // Don't generate updates for gaps - those inform questions, not storage

  return updates;
}

/**
 * Infer which section a fact should go in.
 */
function inferSection(content: string): string {
  const lower = content.toLowerCase();

  if (lower.includes("job") || lower.includes("work") || lower.includes("position")) {
    return "Work";
  }
  if (lower.includes("family") || lower.includes("wife") || lower.includes("husband") || 
      lower.includes("kid") || lower.includes("parent")) {
    return "Family";
  }
  if (lower.includes("hobby") || lower.includes("interest") || lower.includes("enjoy")) {
    return "Interests";
  }
  if (lower.includes("preference") || lower.includes("like") || lower.includes("hate")) {
    return "Preferences";
  }
  if (lower.includes("location") || lower.includes("move") || lower.includes("live")) {
    return "Location";
  }

  return "Notes";
}

// =============================================================================
// Milestone Detection
// =============================================================================

/**
 * Determine if this conversation warrants creating a milestone.
 */
function shouldCreateMilestone(
  lenses: LensResult[],
  score: number,
  context: AnalysisContext,
): Milestone | undefined {
  // Need high significance
  if (score < 0.7) return undefined;

  // Find the most significant item
  let topItem: { content: string; confidence: number; type: string } | undefined;
  
  for (const lens of lenses) {
    for (const item of lens.items) {
      if (!topItem || item.confidence > topItem.confidence) {
        topItem = {
          content: item.content,
          confidence: item.confidence,
          type: lens.lens,
        };
      }
    }
  }

  if (!topItem || topItem.confidence < 0.8) return undefined;

  // Map to milestone type
  const milestoneType = getMilestoneType(topItem.type);

  return {
    id: `${context.sessionId}-${Date.now()}`,
    type: milestoneType,
    date: Date.now(),
    description: topItem.content,
    significance: `Score: ${score.toFixed(2)}`,
  };
}

function getMilestoneType(lensType: string): Milestone["type"] {
  switch (lensType) {
    case "significance":
      return "breakthrough";
    case "pattern":
      return "growth";
    case "contradiction":
      return "custom";
    default:
      return "custom";
  }
}

// =============================================================================
// Legacy Conversion
// =============================================================================

/**
 * Convert lens results to legacy signal format for backwards compatibility.
 */
function convertLensesToSignals(lenses: LensResult[]): SignificanceSignal[] {
  const signals: SignificanceSignal[] = [];

  for (const lens of lenses) {
    for (const item of lens.items) {
      signals.push({
        type: mapLensToSignalType(lens.lens, item.content),
        description: item.content,
        confidence: item.confidence,
        evidence: item.evidence,
      });
    }
  }

  return signals;
}

function mapLensToSignalType(lens: string, content: string): SignalType {
  const lower = content.toLowerCase();

  // Try to infer signal type from content
  if (lower.includes("trust")) return "trust";
  if (lower.includes("vulnerable") || lower.includes("struggle")) return "vulnerability";
  if (lower.includes("breakthrough")) return "breakthrough";
  if (lower.includes("gratitude") || lower.includes("thank")) return "gratitude";
  if (lower.includes("delegate") || lower.includes("your call")) return "delegation";
  if (lower.includes("together") || lower.includes("collaborate")) return "collaboration";
  if (lower.includes("personal") || lower.includes("family")) return "personal_share";
  if (lower.includes("conflict") || lower.includes("frustrat")) return "conflict";
  if (lower.includes("resolved") || lower.includes("better")) return "resolution";
  if (lower.includes("growth") || lower.includes("learned")) return "growth";

  return "growth"; // Default
}

// =============================================================================
// Specialized Detection (kept for backwards compatibility)
// =============================================================================

/**
 * Check if a conversation contains a naming-relevant moment.
 */
export function detectNamingMoment(messages: ConversationMessage[]): boolean {
  const namingPatterns = [
    /what(?:'s| is) your name/i,
    /call you/i,
    /what should i call/i,
    /your name/i,
    /do you have a name/i,
    /name yourself/i,
    /pick a name/i,
    /choose a name/i,
  ];

  return messages.some((m) =>
    namingPatterns.some((pattern) => pattern.test(m.content)),
  );
}

/**
 * Check if a conversation contains a first meeting pattern.
 */
export function detectFirstMeetingPattern(messages: ConversationMessage[]): boolean {
  const firstMeetingPatterns = [
    /nice to meet/i,
    /first time/i,
    /getting started/i,
    /new here/i,
    /who are you/i,
    /introduce yourself/i,
    /tell me about yourself/i,
    /what can you do/i,
  ];

  return messages.some((m) =>
    firstMeetingPatterns.some((pattern) => pattern.test(m.content)),
  );
}

/**
 * Detect if the conversation shows signs of relationship deepening.
 */
export function detectRelationshipDeepening(messages: ConversationMessage[]): boolean {
  const deepeningSignals = [
    /you know me/i,
    /you understand me/i,
    /we work well together/i,
    /our partnership/i,
    /we'?ve come a long way/i,
    /remember when/i,
    /as always/i,
    /like you always do/i,
  ];

  return messages.some((m) =>
    deepeningSignals.some((pattern) => pattern.test(m.content)),
  );
}
