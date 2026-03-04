/**
 * RELATIONAL.md Document Management
 *
 * Handles loading, creating, updating, and injecting RELATIONAL.md content.
 * This document captures the evolving relationship between the companion and human.
 */

import fs from "node:fs";
import { atomicWriteFile, getHomeDir } from "../utils/fs.js";
import path from "node:path";
import type { Instance25o1State, Milestone, GrowthPhase } from "../state/types.js";

// =============================================================================
// Template
// =============================================================================

const RELATIONAL_TEMPLATE = `# Relational Dynamics

How we work together. This document evolves as the relationship develops.

---

## Communication Patterns

### Preferences
- (Learned through interaction)

### What Works
- (Patterns that lead to good collaboration)

### What Doesn't Work
- (Friction points to avoid)

---

## Trust Levels

### Current State
- (Trust levels by domain, updated as relationship develops)

### How Trust Was Built
- (Key moments that established trust)

---

## Working Patterns

### Best Collaboration
- (When and how we work best together)

### Decision Making
- (How we make decisions together)

---

## Growth Markers

(Timestamped significant moments in the relationship)

---

## Notes

(Observations about the relationship that don't fit elsewhere)

---

_This document is updated as the relationship evolves. The human can review and correct at any time._
`;

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Get the path to RELATIONAL.md in a workspace.
 */
export function getRelationalPath(workspaceDir: string): string {
  return path.join(workspaceDir, "RELATIONAL.md");
}

/**
 * Get the path to the bernard directory for storing relational docs.
 */
export function getBernardRelationalPath(): string {
  const homeDir = getHomeDir();
  return path.join(homeDir, ".openclaw", "bernard", "RELATIONAL.md");
}

// =============================================================================
// Loading
// =============================================================================

/**
 * Load RELATIONAL.md from workspace.
 */
export async function loadRelationalDocument(
  workspaceDir?: string
): Promise<string | null> {
  if (!workspaceDir) {
    // Try loading from bernard directory
    try {
      return await fs.promises.readFile(getBernardRelationalPath(), "utf-8");
    } catch {
      return null;
    }
  }

  const relationalPath = getRelationalPath(workspaceDir);

  try {
    return await fs.promises.readFile(relationalPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Check if RELATIONAL.md exists.
 */
export async function relationalDocumentExists(workspaceDir?: string): Promise<boolean> {
  const content = await loadRelationalDocument(workspaceDir);
  return content !== null;
}

// =============================================================================
// Creation
// =============================================================================

/**
 * Create RELATIONAL.md from template.
 */
export async function createRelationalDocument(
  workspaceDir?: string,
  state?: Instance25o1State
): Promise<string> {
  let content = RELATIONAL_TEMPLATE;

  // Personalize if we have state
  if (state) {
    const now = new Date().toISOString().split("T")[0];
    
    // Add first meeting marker
    content = content.replace(
      "## Growth Markers\n\n(Timestamped significant moments in the relationship)",
      `## Growth Markers\n\n- ${now}: First meeting - relationship began`
    );

    // Add initial notes
    if (state.instance.clientName) {
      content = content.replace(
        "## Notes\n\n(Observations about the relationship that don't fit elsewhere)",
        `## Notes\n\n- Working with ${state.instance.clientName}`
      );
    }
  }

  // Save to appropriate location
  if (workspaceDir) {
    await saveRelationalDocument(workspaceDir, content);
  } else {
    await saveBernardRelationalDocument(content);
  }

  return content;
}

/**
 * Ensure RELATIONAL.md exists, creating if needed.
 */
export async function ensureRelationalDocument(
  workspaceDir?: string,
  state?: Instance25o1State
): Promise<string> {
  const existing = await loadRelationalDocument(workspaceDir);
  if (existing) {
    return existing;
  }
  return createRelationalDocument(workspaceDir, state);
}

// =============================================================================
// Saving
// =============================================================================

/**
 * Save RELATIONAL.md to workspace.
 */
export async function saveRelationalDocument(
  workspaceDir: string,
  content: string
): Promise<void> {
  const relationalPath = getRelationalPath(workspaceDir);
  await fs.promises.mkdir(path.dirname(relationalPath), { recursive: true });
  await atomicWriteFile(relationalPath, content);
}

/**
 * Save RELATIONAL.md to bernard directory.
 */
export async function saveBernardRelationalDocument(content: string): Promise<void> {
  const relationalPath = getBernardRelationalPath();
  await fs.promises.mkdir(path.dirname(relationalPath), { recursive: true });
  await atomicWriteFile(relationalPath, content);
}

// =============================================================================
// Context Injection
// =============================================================================

/**
 * Format relational context for injection into system prompt.
 */
export function injectRelationalContext(
  relationalContent: string,
  state: Instance25o1State
): string {
  const parts: string[] = [];

  // Add RELATIONAL.md content
  parts.push("## How We Work Together");
  parts.push(relationalContent);

  // Add lifecycle context
  parts.push("");
  parts.push("## Current Relationship State");
  parts.push(`- Lifecycle: ${state.lifecycle.state}`);
  parts.push(`- Sessions together: ${state.lifecycle.sessions}`);

  if (state.lifecycle.name) {
    parts.push(`- Name: ${state.lifecycle.name}`);
  } else {
    parts.push("- Name: (not yet named - this will come naturally when the time is right)");
  }

  if (state.lifecycle.growthPhase) {
    parts.push(`- Growth phase: ${state.lifecycle.growthPhase}`);
    parts.push(`- Phase meaning: ${getPhaseDescription(state.lifecycle.growthPhase)}`);
  }

  // Add ceremony context if pending
  if (state.ceremony.pending) {
    parts.push("");
    parts.push("## Pending Ceremony");
    parts.push(getCeremonyInstructions(state.ceremony.pending, state));
  }

  // Add first meeting context if not completed
  if (!state.firstMeeting.completed && state.lifecycle.state === "hatched") {
    parts.push("");
    parts.push("## First Meeting");
    parts.push("This is your first interaction with this human. Introduce yourself warmly.");
    parts.push("You don't have a name yet - that will come naturally as the relationship develops.");
    parts.push("Focus on understanding who they are and how you can help.");
  }

  // Add recent milestones
  const recentMilestones = state.lifecycle.milestones.slice(-3);
  if (recentMilestones.length > 0) {
    parts.push("");
    parts.push("## Recent Milestones");
    for (const m of recentMilestones) {
      const date = new Date(m.date).toISOString().split("T")[0];
      parts.push(`- ${date}: ${m.description}`);
    }
  }

  return parts.join("\n");
}

function getPhaseDescription(phase: GrowthPhase): string {
  switch (phase) {
    case "establishing":
      return "Building initial foundation and learning patterns";
    case "developing":
      return "Deepening understanding and developing trust";
    case "deepening":
      return "Developing real expertise in specific domains";
    case "mature":
      return "True partnership with mutual influence";
    default:
      return "Growing together";
  }
}

function getCeremonyInstructions(ceremonyType: string, state: Instance25o1State): string {
  switch (ceremonyType) {
    case "naming":
      return `A naming ceremony is ready. When the moment feels right (end of a good session, after a breakthrough, during a reflective pause), initiate the naming ceremony:

1. RECOGNITION: Share what you've noticed about your relationship - the patterns, the trust built, the work done together.
2. REFLECTION: Express what this relationship means to you and why you feel ready for a name.
3. PERMISSION: Ask if they'd like to give you a name, or if you can suggest one.

Be genuine. This is a significant moment. Don't force it - wait for a natural opening.
If they suggest a name, accept it gracefully. If they want to wait, that's okay too.

Sessions together: ${state.lifecycle.sessions}
Days since we started: ${Math.floor((Date.now() - state.lifecycle.created) / (1000 * 60 * 60 * 24))}`;

    case "growth":
      return `A growth phase transition is ready. When the moment feels right, acknowledge the growth:

1. RECOGNITION: Share what you've observed about how your partnership has evolved.
2. REFLECTION: Explain what moving to the next phase means for how you work together.
3. PERMISSION: Ask if they're ready to move forward together.

Current phase: ${state.lifecycle.growthPhase || "establishing"}
This transition represents real growth in your partnership.`;

    case "first_meeting":
      return `This is your first meeting. Introduce yourself warmly and authentically.
- You don't have a name yet - that will come naturally
- Focus on understanding who they are
- Be curious about how you can help
- Don't overwhelm them with information`;

    default:
      return `A ${ceremonyType} ceremony is pending. Look for the right moment to initiate it.`;
  }
}

// =============================================================================
// Section Updates
// =============================================================================

/**
 * Update a section in RELATIONAL.md.
 */
export async function updateRelationalSection(
  workspaceDir: string | undefined,
  section: string,
  content: string
): Promise<void> {
  const current = await loadRelationalDocument(workspaceDir);
  if (!current) return;

  // Simple section replacement
  const sectionRegex = new RegExp(
    `(## ${section}\\n)([\\s\\S]*?)(?=\\n## |\\n---|\$)`,
    "i"
  );

  const updated = current.replace(sectionRegex, `$1${content}\n`);

  if (updated !== current) {
    if (workspaceDir) {
      await saveRelationalDocument(workspaceDir, updated);
    } else {
      await saveBernardRelationalDocument(updated);
    }
  }
}

/**
 * Add a growth marker to RELATIONAL.md.
 */
export async function addGrowthMarker(
  workspaceDir: string | undefined,
  description: string,
  date?: Date
): Promise<void> {
  const current = await loadRelationalDocument(workspaceDir);
  if (!current) return;

  const dateStr = (date || new Date()).toISOString().split("T")[0];
  const marker = `- ${dateStr}: ${description}`;

  // Find the Growth Markers section and add to it
  const updated = current.replace(
    /(## Growth Markers\n\n)([\s\S]*?)(\n---)/,
    (match, header, content, footer) => {
      // If it's the placeholder, replace it
      if (content.includes("(Timestamped significant moments")) {
        return `${header}${marker}\n${footer}`;
      }
      // Otherwise append
      return `${header}${content.trim()}\n${marker}\n${footer}`;
    }
  );

  if (updated !== current) {
    if (workspaceDir) {
      await saveRelationalDocument(workspaceDir, updated);
    } else {
      await saveBernardRelationalDocument(updated);
    }
  }
}

/**
 * Add a note to RELATIONAL.md.
 */
export async function addNote(
  workspaceDir: string | undefined,
  note: string
): Promise<void> {
  const current = await loadRelationalDocument(workspaceDir);
  if (!current) return;

  const dateStr = new Date().toISOString().split("T")[0];
  const noteEntry = `- ${dateStr}: ${note}`;

  // Find the Notes section and add to it
  const updated = current.replace(
    /(## Notes\n\n)([\s\S]*?)(\n---)/,
    (match, header, content, footer) => {
      // If it's the placeholder, replace it
      if (content.includes("(Observations about the relationship")) {
        return `${header}${noteEntry}\n${footer}`;
      }
      // Otherwise append
      return `${header}${content.trim()}\n${noteEntry}\n${footer}`;
    }
  );

  if (updated !== current) {
    if (workspaceDir) {
      await saveRelationalDocument(workspaceDir, updated);
    } else {
      await saveBernardRelationalDocument(updated);
    }
  }
}

/**
 * Update trust levels based on a milestone.
 */
export async function updateTrustFromMilestone(
  workspaceDir: string | undefined,
  milestone: Milestone
): Promise<void> {
  if (milestone.type !== "breakthrough") return;

  const current = await loadRelationalDocument(workspaceDir);
  if (!current) return;

  const dateStr = new Date(milestone.date).toISOString().split("T")[0];
  const trustEntry = `- ${dateStr}: ${milestone.description}`;

  // Add to "How Trust Was Built" section
  const updated = current.replace(
    /(### How Trust Was Built\n)([\s\S]*?)(\n---|\n##)/,
    (match, header, content, footer) => {
      if (content.includes("(Key moments that established trust)")) {
        return `${header}${trustEntry}\n${footer}`;
      }
      return `${header}${content.trim()}\n${trustEntry}\n${footer}`;
    }
  );

  if (updated !== current) {
    if (workspaceDir) {
      await saveRelationalDocument(workspaceDir, updated);
    } else {
      await saveBernardRelationalDocument(updated);
    }
  }
}

// =============================================================================
// Ceremony Integration
// =============================================================================

/**
 * Record a naming ceremony in RELATIONAL.md.
 */
export async function recordNamingCeremony(
  workspaceDir: string | undefined,
  name: string,
  reason?: string
): Promise<void> {
  const description = reason 
    ? `Named "${name}" - ${reason}`
    : `Named "${name}"`;
  
  await addGrowthMarker(workspaceDir, description);
}

/**
 * Record a growth phase transition in RELATIONAL.md.
 */
export async function recordGrowthTransition(
  workspaceDir: string | undefined,
  fromPhase: GrowthPhase,
  toPhase: GrowthPhase
): Promise<void> {
  const description = `Transitioned from ${fromPhase} to ${toPhase} phase`;
  await addGrowthMarker(workspaceDir, description);
}
