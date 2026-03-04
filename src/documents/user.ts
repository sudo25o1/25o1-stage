/**
 * USER.md Document Management
 *
 * Stores learned facts about the human.
 * Sections: Work, Family, Interests, Preferences, Location, Corrections, Notes
 *
 * This document is the companion's memory of who the human is.
 * It should only contain things the human has actually said.
 */

import fs from "node:fs";
import {
  atomicWriteFile,
  getHomeDir,
  parseMarkdownSections,
  assembleMarkdown,
  findSection,
} from "../utils/fs.js";
import path from "node:path";

// =============================================================================
// Path Resolution
// =============================================================================

export function getUserPath(workspaceDir?: string): string {
  if (workspaceDir) {
    return path.join(workspaceDir, "USER.md");
  }
  const homeDir = getHomeDir();
  return path.join(homeDir, ".openclaw", "bernard", "USER.md");
}

// =============================================================================
// Template
// =============================================================================

const USER_TEMPLATE = `# About You

What I've learned about you through our conversations.

---

## Work

(What you do, projects, workplace)

---

## Family

(People you've mentioned)

---

## Interests

(Hobbies, passions, things you enjoy)

---

## Preferences

(Likes, dislikes, preferences you've expressed)

---

## Location

(Where you are, where you've been)

---

## Corrections

(Things I got wrong that you corrected)

---

## Notes

(Other things I've learned about you)

---

_This document is updated as I learn about you. You can review and correct it at any time._
`;

// =============================================================================
// Loading & Saving
// =============================================================================

export async function loadUserDocument(workspaceDir?: string): Promise<string | null> {
  const userPath = getUserPath(workspaceDir);
  try {
    return await fs.promises.readFile(userPath, "utf-8");
  } catch {
    return null;
  }
}

export async function saveUserDocument(content: string, workspaceDir?: string): Promise<void> {
  const userPath = getUserPath(workspaceDir);
  await fs.promises.mkdir(path.dirname(userPath), { recursive: true });
  await atomicWriteFile(userPath, content);
}

export async function ensureUserDocument(workspaceDir?: string): Promise<string> {
  const existing = await loadUserDocument(workspaceDir);
  if (existing) return existing;
  await saveUserDocument(USER_TEMPLATE, workspaceDir);
  return USER_TEMPLATE;
}

// =============================================================================
// Section Updates
// =============================================================================

/**
 * Add a fact to a section of USER.md.
 * Creates the document if it doesn't exist.
 */
export async function addUserFact(
  workspaceDir: string | undefined,
  section: string,
  fact: string,
  type: "add" | "update" = "add",
): Promise<void> {
  let content = await loadUserDocument(workspaceDir);
  if (!content) {
    content = USER_TEMPLATE;
  }

  const dateStr = new Date().toISOString().split("T")[0];
  const entry = `- ${dateStr}: ${fact}`;

  const parsed = parseMarkdownSections(content);
  let target = findSection(parsed, section);

  if (target) {
    const body = target.body.trim();
    if (body.startsWith("(")) {
      // Placeholder text — replace it
      target.body = "\n" + entry + "\n";
    } else if (type === "update") {
      target.body = "\n" + entry + "\n";
    } else {
      target.body = "\n" + body + "\n" + entry + "\n";
    }
  } else {
    // Section not found — fall back to Notes
    target = findSection(parsed, "Notes");
    if (target) {
      const body = target.body.trim();
      if (body.startsWith("(")) {
        target.body = "\n" + entry + "\n";
      } else {
        target.body = "\n" + body + "\n" + entry + "\n";
      }
    }
  }

  content = assembleMarkdown(parsed);
  await saveUserDocument(content, workspaceDir);
}

// =============================================================================
// Context Injection
// =============================================================================

/**
 * Format USER.md content for system prompt injection.
 * Extracts non-placeholder sections only.
 */
export function getUserContext(userContent: string | null): string | null {
  if (!userContent) return null;

  const parsed = parseMarkdownSections(userContent);
  const parts: string[] = [];

  for (const section of parsed.sections) {
    const body = section.body.trim();
    // Skip placeholder sections (content starts with parenthesized text)
    if (!body || body.startsWith("(")) continue;
    // Only include sections that have bullet-point facts
    const bulletLines = body.split("\n").filter(l => l.startsWith("- "));
    if (bulletLines.length === 0) continue;

    parts.push(`**${section.name}:**\n${bulletLines.join("\n")}`);
  }

  if (parts.length === 0) return null;

  return "## What You Know About This Person\n\n" + parts.join("\n\n");
}
