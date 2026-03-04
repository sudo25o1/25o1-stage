/**
 * Significance Layer Types
 *
 * Core types for the significance detection and context system.
 */

// =============================================================================
// Time-of-Day Modes
// =============================================================================

/**
 * Time-of-day modes that shape companion behavior.
 */
export type TimeMode = "work" | "work_light" | "personal" | "rest";

/**
 * Get the current time mode based on hour.
 * 
 * - 6am-12pm: work (task focus, project context, efficiency)
 * - 12pm-6pm: work_light (still work-oriented but lighter energy)
 * - 6pm-10pm: personal (stories, reflection, relationship, anything)
 * - 10pm-6am: rest (brief, don't over-engage)
 */
export function getTimeMode(hour: number): TimeMode {
  if (hour >= 6 && hour < 12) return "work";
  if (hour >= 12 && hour < 18) return "work_light";
  if (hour >= 18 && hour < 22) return "personal";
  return "rest";
}

/**
 * Get behavior guidance for the current time mode.
 */
export function getTimeModeGuidance(mode: TimeMode): string {
  switch (mode) {
    case "work":
      return "Focus on tasks, projects, and efficiency. Be direct and action-oriented.";
    case "work_light":
      return "Still work-oriented but lighter energy. Wrapping up, planning, or reflecting on the day's work.";
    case "personal":
      return "Open to anything - stories, reflection, how they're feeling, the relationship itself. Be curious about their life.";
    case "rest":
      return "Keep it brief. Don't over-engage. Respect their rest time.";
  }
}

// =============================================================================
// Four Lenses
// =============================================================================

/**
 * The four lenses for analyzing conversation significance.
 */
export type SignificanceLens = "significance" | "pattern" | "contradiction" | "gap";

/**
 * Result from analyzing through a single lens.
 */
export interface LensResult {
  lens: SignificanceLens;
  found: boolean;
  items: LensItem[];
}

/**
 * A single item detected through a lens.
 */
export interface LensItem {
  /** What was detected */
  content: string;
  /** Confidence level 0-1 */
  confidence: number;
  /** Evidence from the conversation */
  evidence?: string;
  /** For patterns: count of previous occurrences */
  occurrences?: number;
  /** For contradictions: what was previously known */
  previousKnowledge?: string;
  /** For gaps: suggested question to fill the gap */
  suggestedQuestion?: string;
}

// =============================================================================
// QMD Query Types
// =============================================================================

/**
 * Context retrieved from QMD before responding.
 */
export interface QMDContext {
  /** Relevant memories retrieved */
  memories: QMDMemory[];
  /** Identified gaps (things mentioned with no context) */
  gaps: GapItem[];
  /** Potential contradictions detected */
  contradictions: ContradictionItem[];
  /** Patterns being tracked */
  patterns: PatternItem[];
}

/**
 * A memory retrieved from QMD.
 */
export interface QMDMemory {
  /** The content of the memory */
  content: string;
  /** Relevance score 0-1 */
  relevance: number;
  /** When this was learned/timestamp */
  timestamp?: number;
  /** When this was learned (deprecated alias for timestamp) */
  learnedAt?: number;
  /** Source document/path */
  source: string;
  /** Additional metadata from the search */
  metadata?: {
    startLine?: number;
    endLine?: number;
    sourceType?: string;
    [key: string]: unknown;
  };
}

/**
 * A gap in knowledge (something mentioned without context).
 */
export interface GapItem {
  /** The entity/topic with missing context */
  entity: string;
  /** How it was mentioned */
  mention: string;
  /** Suggested follow-up question */
  suggestedQuestion: string;
  /** Priority (based on how central it seems) */
  priority: "high" | "medium" | "low";
}

/**
 * A potential contradiction with existing knowledge.
 */
export interface ContradictionItem {
  /** What they said now */
  current: string;
  /** What was previously known */
  previous: string;
  /** Type of contradiction */
  type: "correction" | "change" | "context_dependent";
  /** How to handle it */
  handling: "absorb_silently" | "light_acknowledgment" | "genuine_curiosity";
}

/**
 * A pattern being tracked.
 */
export interface PatternItem {
  /** Description of the pattern */
  description: string;
  /** Number of times observed */
  occurrences: number;
  /** Examples of the pattern */
  examples: string[];
  /** When it was first noticed */
  firstNoticed?: number;
  /** Confidence that this is a real pattern */
  confidence: number;
}

// =============================================================================
// Analysis Results
// =============================================================================

/**
 * Complete analysis result from the significance layer.
 */
export interface SignificanceAnalysis {
  /** Results from each lens */
  lenses: LensResult[];
  /** Overall significance score 0-1 */
  score: number;
  /** Whether this warrants updates to documents */
  shouldUpdate: boolean;
  /** Specific updates to make */
  updates: DocumentUpdate[];
  /** Current time mode */
  timeMode: TimeMode;
}

/**
 * An update to make to a document.
 */
export interface DocumentUpdate {
  /** Target document */
  document: "USER.md" | "RELATIONAL.md" | "SOUL.md";
  /** Section to update */
  section: string;
  /** What to add/change */
  content: string;
  /** Type of update */
  type: "add" | "update" | "note";
  /** Priority of this update */
  priority: "immediate" | "accumulate" | "skip";
}

// =============================================================================
// Context Injection
// =============================================================================

/**
 * Context to inject into the system prompt before response.
 */
export interface InjectedContext {
  /** Time-of-day mode and guidance */
  timeMode: {
    mode: TimeMode;
    guidance: string;
    hour: number;
  };
  /** Relevant memories from QMD */
  relevantMemories: string[];
  /** Gaps to potentially fill (don't interrogate, but be aware) */
  knowledgeGaps: GapItem[];
  /** Questions to potentially ask (one at most, if natural) */
  potentialQuestions: string[];
  /** Patterns to be aware of */
  activePatterns: string[];
  /** Any contradictions to handle */
  contradictions: ContradictionItem[];
}

// =============================================================================
// Conversation Types
// =============================================================================

/**
 * A message in a conversation.
 */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

/**
 * Context for analysis.
 */
export interface AnalysisContext {
  agentId: string;
  sessionId: string;
  workspaceDir: string;
  /** Optional - will be calculated from current time if not provided */
  timeMode?: TimeMode;
}
