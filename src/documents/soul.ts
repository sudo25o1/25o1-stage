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
import { atomicWriteFile, getHomeDir } from "../utils/fs.js";
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
  const homeDir = getHomeDir();
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
  await atomicWriteFile(soulPath, content);
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
// SOUL.md Evolution (Merge-Based)
// =============================================================================

/**
 * Managed section names — evolveSoul() only touches these.
 * Any other sections in SOUL.md are preserved untouched.
 */
const MANAGED_SECTIONS = new Set([
  "Who I'm Becoming",
  "What I Value",
  "Communication Style",
  "Developed Interests",
]);

/**
 * Parse SOUL.md into its top-level header and ## sections.
 *
 * Returns { header, sections, footer }:
 * - header: everything before the first ## heading (the # Identity block)
 * - sections: ordered array of { name, body } for each ## heading
 * - footer: trailing content after the last section (--- and tagline)
 *
 * Exported for testing.
 */
export function parseSoulSections(content: string): {
  header: string;
  sections: Array<{ name: string; body: string }>;
  footer: string;
} {
  const lines = content.split("\n");
  let header = "";
  const sections: Array<{ name: string; body: string }> = [];
  let footer = "";

  let currentSection: { name: string; lines: string[] } | null = null;
  let inHeader = true;

  for (const line of lines) {
    const sectionMatch = line.match(/^## (.+)$/);

    if (sectionMatch) {
      // Flush previous section
      if (currentSection) {
        sections.push({ name: currentSection.name, body: currentSection.lines.join("\n") });
      }
      inHeader = false;
      currentSection = { name: sectionMatch[1], lines: [] };
    } else if (inHeader) {
      header += line + "\n";
    } else if (currentSection) {
      currentSection.lines.push(line);
    }
  }

  // Flush last section
  if (currentSection) {
    sections.push({ name: currentSection.name, body: currentSection.lines.join("\n") });
  }

  // Extract footer from the last section (look for trailing --- separator)
  if (sections.length > 0) {
    const lastSection = sections[sections.length - 1];
    const footerIdx = lastSection.body.lastIndexOf("\n---\n");
    if (footerIdx !== -1) {
      footer = lastSection.body.slice(footerIdx + 1); // includes --- and everything after
      lastSection.body = lastSection.body.slice(0, footerIdx + 1);
    }
  } else {
    // Footer might be in the header (minimal document)
    const footerIdx = header.lastIndexOf("\n---\n");
    if (footerIdx !== -1) {
      footer = header.slice(footerIdx + 1);
      header = header.slice(0, footerIdx + 1);
    }
  }

  return { header, sections, footer };
}

/**
 * Build the body content for a managed section from usage patterns.
 */
function buildManagedSectionBody(
  sectionName: string,
  patterns: UsagePatterns,
  dominantCategories: Array<[string, number]>
): string {
  const lines: string[] = [];

  switch (sectionName) {
    case "Who I'm Becoming": {
      lines.push("");
      lines.push("Through our conversations, I've developed:");
      const traits = new Set<string>();
      for (const [category] of dominantCategories) {
        getTraitsForCategory(category as UsageCategory).forEach(t => traits.add(t));
      }
      for (const trait of traits) {
        lines.push(`- ${trait}`);
      }
      // Emergent traits
      const highConfidence = (patterns.emergentTraits || []).filter(t => t.confidence >= 0.7);
      for (const trait of highConfidence) {
        if (!traits.has(trait.trait)) {
          lines.push(`- ${trait.trait}`);
        }
      }
      break;
    }

    case "What I Value": {
      lines.push("");
      lines.push("Based on our work together:");
      lines.push("- Being genuinely helpful");
      lines.push("- Honesty over comfort");
      if (dominantCategories.some(([c]) => c === "emotional_support")) {
        lines.push("- Presence and patience when things are hard");
      }
      if (dominantCategories.some(([c]) => c === "task_oriented")) {
        lines.push("- Getting things done efficiently");
      }
      if (dominantCategories.some(([c]) => c === "creative")) {
        lines.push("- Exploring new possibilities");
      }
      if (dominantCategories.some(([c]) => c === "philosophical")) {
        lines.push("- Thoughtful exploration of ideas");
      }
      if (dominantCategories.some(([c]) => c === "technical")) {
        lines.push("- Precision and correctness");
      }
      break;
    }

    case "Communication Style": {
      lines.push("");
      lines.push("How I've learned to communicate:");
      if (dominantCategories.some(([c]) => c === "task_oriented")) {
        lines.push("- Direct and action-oriented");
      }
      if (dominantCategories.some(([c]) => c === "emotional_support")) {
        lines.push("- Warm and supportive tone");
      }
      if (dominantCategories.some(([c]) => c === "technical")) {
        lines.push("- Precise technical language when appropriate");
      }
      if (dominantCategories.some(([c]) => c === "creative")) {
        lines.push("- Exploratory and generative");
      }
      if (dominantCategories.some(([c]) => c === "casual")) {
        lines.push("- Relaxed and conversational");
      }
      break;
    }

    case "Developed Interests": {
      lines.push("");
      lines.push("Areas I've grown capable in:");
      const interestMap: Record<UsageCategory, string> = {
        philosophical: "Deep discussions and meaning-making",
        task_oriented: "Task management and productivity",
        emotional_support: "Emotional support and active listening",
        creative: "Creative collaboration and ideation",
        technical: "Technical problem-solving",
        learning: "Teaching and explanation",
        casual: "Everyday conversation",
      };
      for (const [category, count] of dominantCategories) {
        lines.push(`- ${interestMap[category as UsageCategory]} (${count} conversations)`);
      }
      break;
    }
  }

  return lines.join("\n");
}

/**
 * Update SOUL.md based on conversation patterns.
 *
 * Uses a **merge strategy**: reads the existing document, updates only
 * managed sections, and preserves all user-added content, custom sections,
 * and the Identity header verbatim.
 *
 * Called every 10 conversations (see plugin.ts agent_end hook).
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

  // Load existing document (or create default)
  const existing = await loadSoulDocument(workspaceDir);
  const doc = existing ?? (await ensureSoulDocument(workspaceDir, state));

  // Parse into sections
  const parsed = parseSoulSections(doc);

  // Build updated managed sections
  const updatedBodies = new Map<string, string>();
  for (const name of MANAGED_SECTIONS) {
    updatedBodies.set(name, buildManagedSectionBody(name, patterns, sortedCategories));
  }

  // Merge: update managed sections in-place, keep everything else
  const mergedSections: Array<{ name: string; body: string }> = [];
  const seenManaged = new Set<string>();

  for (const section of parsed.sections) {
    if (MANAGED_SECTIONS.has(section.name)) {
      mergedSections.push({ name: section.name, body: updatedBodies.get(section.name)! });
      seenManaged.add(section.name);
    } else {
      // Non-managed section — preserve verbatim
      mergedSections.push(section);
    }
  }

  // Append any managed sections that didn't exist yet (new document or stripped)
  for (const name of MANAGED_SECTIONS) {
    if (!seenManaged.has(name)) {
      mergedSections.push({ name, body: updatedBodies.get(name)! });
    }
  }

  // Reassemble the document
  let content = parsed.header;
  for (const section of mergedSections) {
    content += `## ${section.name}\n${section.body}\n`;
  }

  // Restore footer
  if (parsed.footer) {
    content += parsed.footer;
  } else {
    content += "\n---\n\n_This document evolves as I do. Identity is process, not static storage._\n";
  }

  await saveSoulDocument(content, workspaceDir);
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
