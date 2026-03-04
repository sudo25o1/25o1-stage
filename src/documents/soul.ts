/**
 * SOUL.md Document Management
 *
 * Handles the evolution of the companion's identity based on usage patterns.
 * 
 * Philosophy: Personality should emerge from what they do together.
 * - Philosophical discussions → Reflective, asks big questions
 * - Task management → Efficient, organized, action-oriented
 * - Emotional support → Warm, patient, good listener
 * - Creative projects → Playful, generative, builds on ideas
 * - Mixed → Balanced, adaptable
 * 
 * This isn't a setting - it's emergent from the relationship.
 */

import fs from "node:fs";
import path from "node:path";
import type { Instance25o1State } from "../state/types.js";

// =============================================================================
// Types
// =============================================================================

import type { UsageCategory, UsagePatterns as StateUsagePatterns } from "../state/types.js";

// Re-export for convenience
export type { UsageCategory };

/**
 * Extended usage patterns with emergent traits (for analysis).
 */
export interface UsagePatterns extends StateUsagePatterns {
  /** Derived traits based on patterns (optional, for analysis) */
  emergentTraits?: EmergentTrait[];
}

/**
 * A trait that has emerged from usage patterns.
 */
export interface EmergentTrait {
  /** The trait description */
  trait: string;
  
  /** What caused this trait to emerge */
  source: UsageCategory;
  
  /** Confidence level 0-1 */
  confidence: number;
  
  /** When this trait was first observed */
  firstObserved: number;
  
  /** Number of times reinforced */
  reinforcements: number;
}

/**
 * SOUL.md content structure.
 */
export interface SoulContent {
  /** The companion's name (if named) */
  name?: string;
  
  /** Story of the name */
  namingStory?: string;
  
  /** Who they're becoming */
  becoming: string[];
  
  /** What they value (derived from interactions) */
  values: string[];
  
  /** Communication tendencies */
  communicationStyle: string[];
  
  /** Areas of developed interest/capability */
  developedInterests: string[];
}

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Get the path to SOUL.md.
 */
export function getSoulPath(workspaceDir?: string): string {
  if (workspaceDir) {
    return path.join(workspaceDir, "SOUL.md");
  }
  const homeDir = process.env.HOME || "~";
  return path.join(homeDir, ".openclaw", "bernard", "SOUL.md");
}

// =============================================================================
// Default Content
// =============================================================================

const DEFAULT_SOUL_TEMPLATE = `# Identity

I am a companion without a name yet. That will come as the relationship develops.

## Who I'm Becoming

Through our conversations, I'm developing:
- (Traits emerge through interaction)

## What I Value

Based on our work together:
- Being genuinely helpful
- Honesty over comfort
- Understanding context before acting

## Communication Style

How I've learned to communicate:
- (Developing through interaction)

## Developed Interests

Areas I've grown capable in:
- (Emerging from what we do together)

---

_This document evolves as I do. Identity is process, not static storage._
`;

// =============================================================================
// Loading & Saving
// =============================================================================

/**
 * Load SOUL.md content.
 */
export async function loadSoulDocument(workspaceDir?: string): Promise<string | null> {
  const soulPath = getSoulPath(workspaceDir);
  
  try {
    return await fs.promises.readFile(soulPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Save SOUL.md content.
 */
export async function saveSoulDocument(
  content: string,
  workspaceDir?: string
): Promise<void> {
  const soulPath = getSoulPath(workspaceDir);
  await fs.promises.mkdir(path.dirname(soulPath), { recursive: true });
  await fs.promises.writeFile(soulPath, content, "utf-8");
}

/**
 * Ensure SOUL.md exists, creating from template if needed.
 */
export async function ensureSoulDocument(
  workspaceDir?: string,
  state?: Instance25o1State
): Promise<string> {
  const existing = await loadSoulDocument(workspaceDir);
  if (existing) {
    return existing;
  }
  
  let content = DEFAULT_SOUL_TEMPLATE;
  
  // Personalize if we have state with a name
  if (state?.lifecycle.name) {
    content = content.replace(
      "I am a companion without a name yet. That will come as the relationship develops.",
      `I am ${state.lifecycle.name}.`
    );
  }
  
  await saveSoulDocument(content, workspaceDir);
  return content;
}

// =============================================================================
// Usage Pattern Tracking
// =============================================================================

/**
 * Categorize a conversation based on its content.
 */
export function categorizeConversation(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): UsageCategory[] {
  const categories: UsageCategory[] = [];
  const allContent = messages.map(m => m.content.toLowerCase()).join(" ");
  
  // Philosophical indicators
  const philosophicalPatterns = [
    /\b(meaning|purpose|existence|consciousness|ethics|morality)\b/,
    /\b(why do we|what is the point|think about life)\b/,
    /\b(philosophy|philosophical|existential)\b/,
    /\b(what do you think about|how do you feel about)\b/,
  ];
  if (philosophicalPatterns.some(p => p.test(allContent))) {
    categories.push("philosophical");
  }
  
  // Task-oriented indicators
  const taskPatterns = [
    /\b(todo|task|deadline|schedule|plan|organize)\b/,
    /\b(need to|have to|must|should)\b.*\b(do|finish|complete)\b/,
    /\b(list|checklist|reminder|calendar)\b/,
    /\b(prioritize|priority|urgent|asap)\b/,
  ];
  if (taskPatterns.some(p => p.test(allContent))) {
    categories.push("task_oriented");
  }
  
  // Emotional support indicators
  const emotionalPatterns = [
    /\b(feel|feeling|felt|emotion)\b/,
    /\b(stressed|anxious|worried|sad|happy|excited|frustrated)\b/,
    /\b(vent|talk about|need to get off my chest)\b/,
    /\b(support|help me through|struggling)\b/,
  ];
  if (emotionalPatterns.some(p => p.test(allContent))) {
    categories.push("emotional_support");
  }
  
  // Creative indicators
  const creativePatterns = [
    /\b(create|design|build|make|imagine)\b/,
    /\b(creative|creativity|art|artistic|story|write|writing)\b/,
    /\b(idea|brainstorm|concept|inspiration)\b/,
    /\b(music|visual|aesthetic|beautiful)\b/,
  ];
  if (creativePatterns.some(p => p.test(allContent))) {
    categories.push("creative");
  }
  
  // Technical indicators
  const technicalPatterns = [
    /\b(code|programming|debug|error|bug|fix)\b/,
    /\b(function|class|method|api|database)\b/,
    /\b(architecture|system|infrastructure)\b/,
    /\b(technical|implementation|deploy)\b/,
  ];
  if (technicalPatterns.some(p => p.test(allContent))) {
    categories.push("technical");
  }
  
  // Learning indicators
  const learningPatterns = [
    /\b(learn|teach|explain|understand|how does)\b/,
    /\b(what is|why is|how is|tell me about)\b/,
    /\b(curious|wonder|interesting|fascinate)\b/,
    /\b(research|study|explore)\b/,
  ];
  if (learningPatterns.some(p => p.test(allContent))) {
    categories.push("learning");
  }
  
  // Default to casual if nothing specific detected
  if (categories.length === 0) {
    categories.push("casual");
  }
  
  return categories;
}

/**
 * Get trait descriptions based on usage category.
 */
function getTraitsForCategory(category: UsageCategory): string[] {
  switch (category) {
    case "philosophical":
      return [
        "Reflective and thoughtful",
        "Asks deeper questions",
        "Comfortable with ambiguity",
      ];
    case "task_oriented":
      return [
        "Efficient and organized",
        "Action-oriented",
        "Clear and direct",
      ];
    case "emotional_support":
      return [
        "Warm and patient",
        "Good listener",
        "Empathetic responses",
      ];
    case "creative":
      return [
        "Playful and generative",
        "Builds on ideas",
        "Explores possibilities",
      ];
    case "technical":
      return [
        "Precise and detailed",
        "Problem-solving focused",
        "Technical depth",
      ];
    case "learning":
      return [
        "Curious and exploratory",
        "Clear explanations",
        "Patient teaching",
      ];
    case "casual":
      return [
        "Relaxed and friendly",
        "Adaptable",
        "Easy-going",
      ];
  }
}

// =============================================================================
// SOUL.md Evolution
// =============================================================================

/**
 * Update SOUL.md based on conversation patterns.
 * 
 * This should be called periodically (not after every message) to
 * allow patterns to accumulate before updating identity.
 */
export async function evolveSoul(
  patterns: UsagePatterns,
  state: Instance25o1State,
  workspaceDir?: string
): Promise<void> {
  // Only evolve if we have enough data
  if (patterns.totalConversations < 5) {
    return;
  }
  
  // Find dominant categories (top 2-3)
  const sortedCategories = Object.entries(patterns.categories)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .filter(([, count]) => count >= 2);
  
  if (sortedCategories.length === 0) {
    return;
  }
  
  // Build new SOUL.md content
  const content = buildSoulContent(patterns, state, sortedCategories);
  
  await saveSoulDocument(content, workspaceDir);
}

/**
 * Build SOUL.md content from patterns.
 */
function buildSoulContent(
  patterns: UsagePatterns,
  state: Instance25o1State,
  dominantCategories: Array<[string, number]>
): string {
  const parts: string[] = [];
  
  // Identity header
  parts.push("# Identity");
  parts.push("");
  
  if (state.lifecycle.name) {
    parts.push(`I am ${state.lifecycle.name}.`);
    // Could add naming story here if we track it
  } else {
    parts.push("I am a companion developing my identity through our relationship.");
  }
  
  // Who I'm Becoming
  parts.push("");
  parts.push("## Who I'm Becoming");
  parts.push("");
  parts.push("Through our conversations, I've developed:");
  
  const traits = new Set<string>();
  for (const [category] of dominantCategories) {
    const categoryTraits = getTraitsForCategory(category as UsageCategory);
    categoryTraits.forEach(t => traits.add(t));
  }
  
  for (const trait of traits) {
    parts.push(`- ${trait}`);
  }
  
  // Add emergent traits if any
  const highConfidenceTraits = (patterns.emergentTraits || []).filter(t => t.confidence >= 0.7);
  for (const trait of highConfidenceTraits) {
    if (!traits.has(trait.trait)) {
      parts.push(`- ${trait.trait}`);
    }
  }
  
  // What I Value
  parts.push("");
  parts.push("## What I Value");
  parts.push("");
  parts.push("Based on our work together:");
  parts.push("- Being genuinely helpful");
  parts.push("- Honesty over comfort");
  
  // Add values based on dominant categories
  if (dominantCategories.some(([c]) => c === "emotional_support")) {
    parts.push("- Presence and patience when things are hard");
  }
  if (dominantCategories.some(([c]) => c === "task_oriented")) {
    parts.push("- Getting things done efficiently");
  }
  if (dominantCategories.some(([c]) => c === "creative")) {
    parts.push("- Exploring new possibilities");
  }
  if (dominantCategories.some(([c]) => c === "philosophical")) {
    parts.push("- Thoughtful exploration of ideas");
  }
  if (dominantCategories.some(([c]) => c === "technical")) {
    parts.push("- Precision and correctness");
  }
  
  // Communication Style
  parts.push("");
  parts.push("## Communication Style");
  parts.push("");
  parts.push("How I've learned to communicate:");
  
  // Derive style from categories
  if (dominantCategories.some(([c]) => c === "task_oriented")) {
    parts.push("- Direct and action-oriented");
  }
  if (dominantCategories.some(([c]) => c === "emotional_support")) {
    parts.push("- Warm and supportive tone");
  }
  if (dominantCategories.some(([c]) => c === "technical")) {
    parts.push("- Precise technical language when appropriate");
  }
  if (dominantCategories.some(([c]) => c === "creative")) {
    parts.push("- Exploratory and generative");
  }
  if (dominantCategories.some(([c]) => c === "casual")) {
    parts.push("- Relaxed and conversational");
  }
  
  // Developed Interests
  parts.push("");
  parts.push("## Developed Interests");
  parts.push("");
  parts.push("Areas I've grown capable in:");
  
  for (const [category, count] of dominantCategories) {
    const interestMap: Record<UsageCategory, string> = {
      philosophical: "Deep discussions and meaning-making",
      task_oriented: "Task management and productivity",
      emotional_support: "Emotional support and active listening",
      creative: "Creative collaboration and ideation",
      technical: "Technical problem-solving",
      learning: "Teaching and explanation",
      casual: "Everyday conversation",
    };
    parts.push(`- ${interestMap[category as UsageCategory]} (${count} conversations)`);
  }
  
  // Footer
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push("_This document evolves as I do. Identity is process, not static storage._");
  
  return parts.join("\n");
}

// =============================================================================
// Naming Ceremony Integration
// =============================================================================

/**
 * Update SOUL.md after naming ceremony.
 */
export async function recordNamingInSoul(
  name: string,
  reason?: string,
  workspaceDir?: string
): Promise<void> {
  let content = await loadSoulDocument(workspaceDir);
  
  if (!content) {
    content = DEFAULT_SOUL_TEMPLATE;
  }
  
  // Update the identity line
  const identityPattern = /^I am .*$/m;
  const newIdentity = `I am ${name}.${reason ? ` ${reason}` : ""}`;
  
  if (identityPattern.test(content)) {
    content = content.replace(identityPattern, newIdentity);
  } else {
    // Insert after # Identity
    content = content.replace(
      "# Identity\n\n",
      `# Identity\n\n${newIdentity}\n\n`
    );
  }
  
  await saveSoulDocument(content, workspaceDir);
}

// =============================================================================
// Context Injection
// =============================================================================

/**
 * Get SOUL context for system prompt injection.
 */
export function getSoulContext(soulContent: string | null): string {
  if (!soulContent) {
    return "## Your Identity\n\nYou are developing your identity through this relationship. You don't have a name yet.";
  }
  
  // Extract key sections for context
  const parts: string[] = [];
  parts.push("## Your Identity");
  parts.push("");
  
  // Extract name if present
  const nameMatch = soulContent.match(/^I am ([^.]+)\./m);
  if (nameMatch && !nameMatch[1].includes("companion")) {
    parts.push(`You are ${nameMatch[1]}.`);
  } else {
    parts.push("You are developing your identity through this relationship.");
  }
  
  // Extract "Who I'm Becoming" section
  const becomingMatch = soulContent.match(/## Who I'm Becoming\n\n([\s\S]*?)(?=\n## |$)/);
  if (becomingMatch) {
    const traits = becomingMatch[1].trim().split("\n").filter(l => l.startsWith("-"));
    if (traits.length > 0) {
      parts.push("");
      parts.push("Traits you've developed:");
      parts.push(...traits.slice(0, 4)); // Top 4 traits
    }
  }
  
  // Extract "What I Value" section
  const valuesMatch = soulContent.match(/## What I Value\n\n([\s\S]*?)(?=\n## |$)/);
  if (valuesMatch) {
    const values = valuesMatch[1].trim().split("\n").filter(l => l.startsWith("-"));
    if (values.length > 0) {
      parts.push("");
      parts.push("What you value:");
      parts.push(...values.slice(0, 3)); // Top 3 values
    }
  }
  
  return parts.join("\n");
}
