/**
 * QMD Client
 *
 * Interface for querying QMD (semantic memory) to retrieve relevant context.
 * Uses OpenClaw's built-in memory system (getMemorySearchManager).
 */

import fs from "node:fs";
import path from "node:path";
import { getHomeDir, atomicWriteFile } from "../utils/fs.js";
import type { QMDMemory, GapItem, ContradictionItem, PatternItem, QMDContext } from "./types.js";

// =============================================================================
// OpenClaw Memory Integration
// =============================================================================

/**
 * Type for OpenClaw config - we just need the shape, not the full import.
 * The actual config is passed from the plugin.
 */
export type OpenClawConfigLike = {
  memory?: unknown;
  [key: string]: unknown;
};

/**
 * Memory search manager interface matching OpenClaw's MemorySearchManager.
 */
export interface MemorySearchManagerLike {
  search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string }
  ): Promise<Array<{
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
    source: string;
  }>>;
}

/**
 * Module-level config store - set by plugin during initialization.
 * This allows the significance layer to access OpenClaw's memory system.
 */
let openclawConfig: OpenClawConfigLike | null = null;
let getMemoryManagerFn: ((params: {
  cfg: OpenClawConfigLike;
  agentId: string;
}) => Promise<{ manager: MemorySearchManagerLike | null; error?: string }>) | null = null;
let qmdLogger: { warn: (msg: string) => void } = { warn: console.warn };

/**
 * Initialize the QMD client with OpenClaw's config and memory manager factory.
 * Called once from plugin.ts during registration.
 */
export function initQMDClient(params: {
  config: OpenClawConfigLike;
  getMemorySearchManager: typeof getMemoryManagerFn;
  logger?: { warn: (msg: string) => void };
}): void {
  openclawConfig = params.config;
  getMemoryManagerFn = params.getMemorySearchManager;
  if (params.logger) {
    qmdLogger = params.logger;
  }
}

/**
 * Check if QMD client is initialized.
 */
export function isQMDClientInitialized(): boolean {
  return openclawConfig !== null && getMemoryManagerFn !== null;
}

// =============================================================================
// QMD Query Interface
// =============================================================================

/**
 * Query QMD for context relevant to the current message.
 * 
 * This should be called in before_agent_start to retrieve:
 * - Relevant memories based on the incoming message
 * - Any patterns that might apply
 * - Gaps in knowledge about mentioned entities
 */
export async function queryQMDContext(
  message: string,
  options: {
    workspaceDir?: string;
    agentId?: string;
    limit?: number;
  } = {}
): Promise<QMDContext> {
  const limit = options.limit ?? 10;
  const agentId = options.agentId ?? "main";

  try {
    // Extract key entities/topics from the message for targeted queries
    const entities = extractEntities(message);
    
    // Query memories using OpenClaw's memory system
    const memories = await queryMemories(message, agentId, limit);
    
    // Identify gaps (entities mentioned without prior context)
    const gaps = identifyGaps(entities, memories);
    
    // Check for contradictions against retrieved memories
    const contradictions = checkContradictions(message, memories);
    
    // Look for pattern matches (cross-references memories + persisted observations)
    const patterns = findPatterns(message, memories, options.workspaceDir);

    return {
      memories,
      gaps,
      contradictions,
      patterns,
    };
  } catch (error) {
    // If QMD is unavailable, return empty context
    // The companion should still function, just without memory enhancement
    qmdLogger.warn(`QMD query failed: ${error}`);
    return {
      memories: [],
      gaps: [],
      contradictions: [],
      patterns: [],
    };
  }
}

// =============================================================================
// Entity Extraction
// =============================================================================

/**
 * Extract key entities/topics from a message for targeted queries.
 * 
 * This is a simple extraction - could be enhanced with NER later.
 */
function extractEntities(message: string): string[] {
  const entities: string[] = [];
  
  // Look for proper nouns (capitalized words not at start of sentence)
  const properNounPattern = /(?<![.!?]\s)[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g;
  const properNouns = message.match(properNounPattern) || [];
  entities.push(...properNouns);
  
  // Look for quoted terms
  const quotedPattern = /"([^"]+)"|'([^']+)'/g;
  let match;
  while ((match = quotedPattern.exec(message)) !== null) {
    entities.push(match[1] || match[2]);
  }
  
  // Look for "the X" patterns (often referring to known entities)
  const thePattern = /the\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/gi;
  while ((match = thePattern.exec(message)) !== null) {
    entities.push(match[1]);
  }
  
  // Deduplicate and filter short terms
  return [...new Set(entities)].filter(e => e.length > 2);
}

// =============================================================================
// Memory Queries
// =============================================================================

/**
 * Query OpenClaw's memory system for relevant memories.
 * Uses getMemorySearchManager which provides QMD or builtin index.
 */
async function queryMemories(
  message: string,
  agentId: string,
  limit: number
): Promise<QMDMemory[]> {
  // If not initialized, return empty
  if (!openclawConfig || !getMemoryManagerFn) {
    return [];
  }

  try {
    const { manager, error } = await getMemoryManagerFn({
      cfg: openclawConfig,
      agentId,
    });

    if (!manager) {
      if (error) {
        qmdLogger.warn(`Memory manager unavailable: ${error}`);
      }
      return [];
    }

    // Search for relevant memories
    const results = await manager.search(message, {
      maxResults: limit,
      minScore: 0.3, // Reasonable threshold for relevance
    });

    // Convert to our QMDMemory format
    return results.map((result) => ({
      content: result.snippet,
      source: result.path,
      timestamp: Date.now(), // Results don't include timestamp, use current
      relevance: result.score,
      metadata: {
        startLine: result.startLine,
        endLine: result.endLine,
        sourceType: result.source, // "memory" or "sessions"
      },
    }));
  } catch (err) {
    qmdLogger.warn(`Memory query failed: ${err}`);
    return [];
  }
}

// =============================================================================
// Gap Detection
// =============================================================================

/**
 * Identify gaps in knowledge (entities mentioned without prior context).
 */
function identifyGaps(entities: string[], memories: QMDMemory[]): GapItem[] {
  const gaps: GapItem[] = [];
  const knownEntities = new Set(
    memories.flatMap(m => extractEntities(m.content))
  );
  
  for (const entity of entities) {
    // If we don't have context for this entity, it's a gap
    const hasContext = knownEntities.has(entity) || 
      memories.some(m => m.content.toLowerCase().includes(entity.toLowerCase()));
    
    if (!hasContext) {
      gaps.push({
        entity,
        mention: entity,
        suggestedQuestion: generateGapQuestion(entity),
        priority: "medium",
      });
    }
  }
  
  return gaps;
}

/**
 * Generate a natural question to fill a knowledge gap.
 */
function generateGapQuestion(entity: string): string {
  // Simple heuristic - could be enhanced
  if (entity.match(/^[A-Z]/)) {
    // Likely a person or place
    return `Who is ${entity}?` // or "Tell me about ${entity}"
  }
  return `What's the ${entity.toLowerCase()} you mentioned?`;
}

// =============================================================================
// Contradiction Detection
// =============================================================================

/**
 * Preference/opinion patterns for contradiction detection.
 * Each entry captures sentiment and topic from statements like "I love X" / "I hate X".
 */
const SENTIMENT_PATTERNS: Array<{
  pattern: RegExp;
  sentiment: "positive" | "negative";
}> = [
  { pattern: /i\s+(?:really\s+)?(?:love|enjoy|like)\s+(.+?)(?:\.|,|!|$)/i, sentiment: "positive" },
  { pattern: /i\s+(?:really\s+)?(?:hate|dislike|can't stand|don't like)\s+(.+?)(?:\.|,|!|$)/i, sentiment: "negative" },
  { pattern: /i\s+(?:prefer|always choose)\s+(.+?)(?:\.|,|!|$)/i, sentiment: "positive" },
  { pattern: /i\s+(?:never|avoid)\s+(.+?)(?:\.|,|!|$)/i, sentiment: "negative" },
];

/**
 * Extract sentiment statements from text.
 * Returns array of { topic, sentiment } pairs.
 */
function extractSentiments(text: string): Array<{ topic: string; sentiment: "positive" | "negative" }> {
  const results: Array<{ topic: string; sentiment: "positive" | "negative" }> = [];
  for (const { pattern, sentiment } of SENTIMENT_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      results.push({ topic: match[1].trim().toLowerCase(), sentiment });
    }
  }
  return results;
}

/**
 * Check for potential contradictions between the current message and
 * retrieved memories.
 *
 * Detects cases where the user's current sentiment about a topic
 * conflicts with sentiment expressed in a prior memory.
 */
function checkContradictions(
  message: string,
  memories: QMDMemory[]
): ContradictionItem[] {
  const contradictions: ContradictionItem[] = [];
  if (memories.length === 0) return contradictions;

  const currentSentiments = extractSentiments(message);
  if (currentSentiments.length === 0) return contradictions;

  // Build sentiment map from memories
  const memorySentiments = new Map<string, { sentiment: "positive" | "negative"; source: string }>();
  for (const memory of memories) {
    for (const { topic, sentiment } of extractSentiments(memory.content)) {
      // Keep the first (oldest in result order) sentiment per topic
      if (!memorySentiments.has(topic)) {
        memorySentiments.set(topic, { sentiment, source: memory.content });
      }
    }
  }

  // Compare current sentiments against memory sentiments
  for (const current of currentSentiments) {
    const prior = memorySentiments.get(current.topic);
    if (prior && prior.sentiment !== current.sentiment) {
      // Determine contradiction type based on specifics
      const type: ContradictionItem["type"] = "change";
      // Soft handling by default — people's preferences evolve
      const handling: ContradictionItem["handling"] = "light_acknowledgment";

      contradictions.push({
        current: message.match(
          new RegExp(`[^.!?]*${escapeForRegex(current.topic)}[^.!?]*`, "i")
        )?.[0]?.trim() || message.slice(0, 100),
        previous: prior.source.slice(0, 150),
        type,
        handling,
      });
    }
  }

  return contradictions;
}

/**
 * Escape a string for safe use in a RegExp constructor.
 */
function escapeForRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// Pattern Detection
// =============================================================================

/**
 * Find recurring themes by cross-referencing entities in the current message
 * against retrieved memories.
 *
 * If the user mentions "Sarah" and three memories also reference "Sarah",
 * that's a pattern worth surfacing so the companion has context like
 * "Sarah comes up regularly."
 *
 * Also loads persisted observations from `trackPatternObservation()` to
 * detect cross-session recurrence.
 */
function findPatterns(
  message: string,
  memories: QMDMemory[],
  workspaceDir?: string
): PatternItem[] {
  const patterns: PatternItem[] = [];
  if (memories.length === 0) return patterns;

  // Extract entities from the current message
  const currentEntities = extractEntities(message);
  if (currentEntities.length === 0) return patterns;

  // Count how many memories mention each entity
  const entityMemoryCounts = new Map<string, { count: number; examples: string[] }>();

  for (const entity of currentEntities) {
    const lowerEntity = entity.toLowerCase();
    let count = 0;
    const examples: string[] = [];

    for (const memory of memories) {
      if (memory.content.toLowerCase().includes(lowerEntity)) {
        count++;
        if (examples.length < 3) {
          examples.push(memory.content.slice(0, 120));
        }
      }
    }

    if (count >= 2) {
      entityMemoryCounts.set(entity, { count, examples });
    }
  }

  // Convert to PatternItems
  for (const [entity, data] of entityMemoryCounts) {
    patterns.push({
      description: `"${entity}" is a recurring topic (appears in ${data.count} memories)`,
      occurrences: data.count,
      examples: data.examples,
      confidence: Math.min(0.9, 0.4 + data.count * 0.15),
    });
  }

  // Load persisted observations and merge any that match current entities
  const observations = loadObservations(workspaceDir);
  if (observations.length > 0) {
    const currentLower = currentEntities.map(e => e.toLowerCase());
    const observationCounts = new Map<string, { count: number; firstSeen: number; examples: string[] }>();

    for (const obs of observations) {
      const obsLower = obs.content.toLowerCase();
      for (const entity of currentLower) {
        if (obsLower.includes(entity)) {
          const existing = observationCounts.get(entity) || {
            count: 0,
            firstSeen: obs.timestamp,
            examples: [],
          };
          existing.count++;
          existing.firstSeen = Math.min(existing.firstSeen, obs.timestamp);
          if (existing.examples.length < 3) {
            existing.examples.push(obs.content.slice(0, 120));
          }
          observationCounts.set(entity, existing);
        }
      }
    }

    for (const [entity, data] of observationCounts) {
      // Only add if not already covered by memory-based patterns
      const alreadyCovered = patterns.some(
        p => p.description.toLowerCase().includes(entity)
      );
      if (!alreadyCovered && data.count >= 2) {
        patterns.push({
          description: `"${entity}" has come up across ${data.count} prior conversations`,
          occurrences: data.count,
          examples: data.examples,
          firstNoticed: data.firstSeen,
          confidence: Math.min(0.9, 0.3 + data.count * 0.1),
        });
      }
    }
  }

  return patterns;
}

// =============================================================================
// Pattern Tracking (Persistent)
// =============================================================================

/**
 * Observation stored on disk for cross-session pattern detection.
 */
interface StoredObservation {
  type: string;
  content: string;
  timestamp: number;
}

/**
 * Maximum number of observations to retain.
 * Keeps the file manageable while preserving enough history for pattern detection.
 */
const MAX_OBSERVATIONS = 500;

/**
 * Get the path to the observations file.
 */
function getObservationsPath(workspaceDir?: string): string {
  const base = workspaceDir || path.join(getHomeDir(), ".openclaw", "bernard");
  return path.join(base, ".25o1-observations.json");
}

/**
 * Load persisted observations from disk.
 * Returns empty array if file doesn't exist or is corrupt.
 */
function loadObservations(workspaceDir?: string): StoredObservation[] {
  try {
    const filePath = getObservationsPath(workspaceDir);
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Track a new observation for pattern detection.
 * Persists to a JSON file so patterns accumulate across sessions.
 *
 * Called from the agent_end hook after significance analysis.
 */
export async function trackPatternObservation(
  observation: {
    type: string;
    content: string;
    timestamp: number;
  },
  workspaceDir?: string
): Promise<void> {
  const filePath = getObservationsPath(workspaceDir);
  const existing = loadObservations(workspaceDir);

  existing.push({
    type: observation.type,
    content: observation.content,
    timestamp: observation.timestamp,
  });

  // Trim to MAX_OBSERVATIONS, keeping most recent
  const trimmed = existing.length > MAX_OBSERVATIONS
    ? existing.slice(existing.length - MAX_OBSERVATIONS)
    : existing;

  // Atomic write (mkdir handled internally by atomicWriteFile)
  await atomicWriteFile(filePath, JSON.stringify(trimmed, null, 2));
}

/**
 * Check if a pattern threshold has been met.
 * Patterns need 2-3 instances before being considered real.
 */
export function isPatternConfirmed(occurrences: number): boolean {
  return occurrences >= 3;
}
