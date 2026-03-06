/**
 * Meta Block Parser
 *
 * Extracts and strips the 25o1 meta block from assistant responses.
 *
 * The companion is instructed (via IDENTITY.md) to include a structured
 * HTML comment at the end of significant responses:
 *
 *   <!-- 25o1:meta
 *   significance: 7
 *   category: emotional_support
 *   facts: daughter had DKA crisis, wife involved in medical decisions
 *   entities: daughter, wife, DKA
 *   emotions: stress, concern, relief
 *   topics: family, health, medical
 *   -->
 *
 * HTML comments are invisible in every markdown renderer, so even if
 * stripping fails, the user sees nothing. Defense in depth.
 *
 * This single module is used by both hooks:
 * - message_sending: strips the block before delivery (uses `cleaned`)
 * - agent_end: parses the block for significance processing (uses `meta`)
 */

import type { UsageCategory } from "../state/types.js";

// =============================================================================
// Types
// =============================================================================

export interface MetaBlock {
  /** Significance score 1-10 */
  significance: number;
  /** Conversation category */
  category: UsageCategory;
  /** New facts learned about the user */
  facts: string[];
  /** Named entities mentioned (people, places, projects) */
  entities: string[];
  /** Emotional content detected */
  emotions: string[];
  /** Topic tags for cross-session pattern matching */
  topics: string[];
  /** Raw key-value pairs (for forward-compat with unknown keys) */
  raw: Record<string, string>;
}

export interface ExtractResult {
  /** Content with meta block removed */
  cleaned: string;
  /** Parsed meta block, or null if not found */
  meta: MetaBlock | null;
}

// =============================================================================
// Regex
// =============================================================================

/**
 * Matches the full 25o1:meta HTML comment block.
 * Captures the inner content (between the markers).
 *
 * The regex:
 * - Matches <!-- 25o1:meta at the start (with optional whitespace)
 * - Captures everything inside (non-greedy)
 * - Matches the closing -->
 * - Includes optional trailing whitespace/newlines so stripping is clean
 */
const META_BLOCK_REGEX = /<!--\s*25o1:meta\s*\n([\s\S]*?)-->\s*/;

// =============================================================================
// Core Function
// =============================================================================

/**
 * Extract and parse the 25o1 meta block from a message.
 *
 * Returns both the cleaned content (block removed) and the parsed
 * structured data. If no meta block is found, returns the original
 * content unchanged and meta: null.
 *
 * This is the SINGLE source of truth for both stripping and parsing.
 * Called in message_sending (use `cleaned`) and agent_end (use `meta`).
 */
export function extractMetaBlock(content: string): ExtractResult {
  const match = content.match(META_BLOCK_REGEX);

  if (!match) {
    return { cleaned: content, meta: null };
  }

  // Strip the block from content
  const cleaned = content.replace(META_BLOCK_REGEX, "").trimEnd();

  // Parse the inner content
  const innerContent = match[1];
  const meta = parseMetaContent(innerContent);

  return { cleaned, meta };
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse the inner content of a meta block into structured data.
 * Line-by-line key-value parsing. Unknown keys are stored in `raw`
 * for forward-compatibility.
 */
function parseMetaContent(inner: string): MetaBlock {
  const raw: Record<string, string> = {};

  // Parse key: value pairs, one per line
  const lines = inner.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key && value) {
      raw[key] = value;
    }
  }

  // Extract typed fields from raw
  return {
    significance: parseSignificance(raw["significance"]),
    category: parseCategory(raw["category"]),
    facts: parseCommaSeparated(raw["facts"]),
    entities: parseCommaSeparated(raw["entities"]),
    emotions: parseCommaSeparated(raw["emotions"]),
    topics: parseCommaSeparated(raw["topics"]),
    raw,
  };
}

/**
 * Parse significance score. Defaults to 3 (low) if missing or invalid.
 */
function parseSignificance(value: string | undefined): number {
  if (!value) return 3;
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1) return 1;
  if (num > 10) return 10;
  return num;
}

/**
 * Parse usage category. Defaults to "casual" if missing or unknown.
 */
function parseCategory(value: string | undefined): UsageCategory {
  if (!value) return "casual";

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");

  const validCategories: UsageCategory[] = [
    "philosophical",
    "task_oriented",
    "emotional_support",
    "creative",
    "technical",
    "learning",
    "casual",
  ];

  if (validCategories.includes(normalized as UsageCategory)) {
    return normalized as UsageCategory;
  }

  return "casual";
}

/**
 * Parse a comma-separated string into an array of trimmed strings.
 * Returns empty array if missing.
 */
function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
