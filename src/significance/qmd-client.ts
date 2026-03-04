/**
 * QMD Client
 *
 * Interface for querying QMD (semantic memory) to retrieve relevant context.
 * Uses OpenClaw's built-in memory system (getMemorySearchManager).
 */

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

/**
 * Initialize the QMD client with OpenClaw's config and memory manager factory.
 * Called once from plugin.ts during registration.
 */
export function initQMDClient(params: {
  config: OpenClawConfigLike;
  getMemorySearchManager: typeof getMemoryManagerFn;
}): void {
  openclawConfig = params.config;
  getMemoryManagerFn = params.getMemorySearchManager;
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
    
    // Look for pattern matches
    const patterns = findPatterns(message, memories);

    return {
      memories,
      gaps,
      contradictions,
      patterns,
    };
  } catch (error) {
    // If QMD is unavailable, return empty context
    // The companion should still function, just without memory enhancement
    console.warn("QMD query failed:", error);
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
        console.warn("Memory manager unavailable:", error);
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
    console.warn("Memory query failed:", err);
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
 * Check for potential contradictions against known information.
 */
function checkContradictions(
  message: string,
  memories: QMDMemory[]
): ContradictionItem[] {
  const contradictions: ContradictionItem[] = [];
  
  // Simple contradiction patterns to check:
  // - "I don't like X" vs memory of "likes X"
  // - "I never X" vs memory of doing X
  // - "I always X" vs memory of not doing X
  
  // This would be enhanced with actual semantic comparison
  // For now, return empty - real implementation needs QMD populated
  
  return contradictions;
}

// =============================================================================
// Pattern Detection
// =============================================================================

/**
 * Find patterns that might apply to the current message.
 */
function findPatterns(
  message: string,
  memories: QMDMemory[]
): PatternItem[] {
  const patterns: PatternItem[] = [];
  
  // Look for recurring themes in memories
  // This would track things like:
  // - "Third time they mentioned their sister"
  // - "Always vents about work on Tuesdays"
  // - "Gets quiet when tired"
  
  return patterns;
}

// =============================================================================
// Pattern Tracking
// =============================================================================

/**
 * Track a new observation for pattern detection.
 * Called after conversations to accumulate pattern data.
 */
export async function trackPatternObservation(
  observation: {
    type: string;
    content: string;
    timestamp: number;
  },
  workspaceDir?: string
): Promise<void> {
  // Store observation for pattern detection
  // This would write to a patterns file or QMD index
}

/**
 * Check if a pattern threshold has been met.
 * Patterns need 2-3 instances before being considered real.
 */
export function isPatternConfirmed(occurrences: number): boolean {
  return occurrences >= 3;
}
