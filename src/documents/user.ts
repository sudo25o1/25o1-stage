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
import path from "node:path";

// =============================================================================
// Path Resolution
// =============================================================================

export function getUserPath(workspaceDir?: string): string {
  if (workspaceDir) {
    return path.join(workspaceDir, "USER.md");
  }
  const homeDir = process.env.HOME || "/tmp";
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
  await fs.promises.writeFile(userPath, content, "utf-8");
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

  // Find the section and add to it
  const sectionRegex = new RegExp(
    `(## ${section}\\n\\n)((?:.|\\n)*?)(?=\\n---)`
  );

  const match = content.match(sectionRegex);
  if (match) {
    const sectionHeader = match[1];
    const sectionContent = match[2];

    let newContent: string;
    // If it's the placeholder text, replace it
    if (sectionContent.startsWith("(")) {
      newContent = entry;
    } else {
      // For "update" type, replace the section content; for "add", append
      if (type === "update") {
        newContent = entry;
      } else {
        newContent = sectionContent.trim() + "\n" + entry;
      }
    }

    content = content.replace(sectionRegex, `${sectionHeader}${newContent}\n`);
  } else {
    // Section not found — append to Notes
    const notesRegex = /(## Notes\n\n)((?:.|\n)*?)(?=\n---)/;
    const notesMatch = content.match(notesRegex);
    if (notesMatch) {
      const notesContent = notesMatch[2];
      const newNotes = notesContent.startsWith("(")
        ? entry
        : notesContent.trim() + "\n" + entry;
      content = content.replace(notesRegex, `${notesMatch[1]}${newNotes}\n`);
    }
  }

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

  const sections: string[] = [];
  // Match sections with actual content (not placeholders)
  const sectionRegex = /## (\w[\w\s]*)\n\n((?:- .+\n?)+)/g;
  let match;
  while ((match = sectionRegex.exec(userContent)) !== null) {
    sections.push(`**${match[1].trim()}:**\n${match[2].trim()}`);
  }

  if (sections.length === 0) return null;

  return "## What You Know About This Person\n\n" + sections.join("\n\n");
}
