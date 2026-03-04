import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Perform an atomic write to a file by writing to a temporary file first
 * and then renaming it.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Get the current user's home directory.
 */
export function getHomeDir(): string {
  // Respect process.env.HOME if overridden (e.g., in tests),
  // otherwise fallback to os.homedir().
  return process.env.HOME || os.homedir();
}

// =============================================================================
// Markdown Section Parsing
// =============================================================================

/**
 * A parsed section from a markdown document.
 */
export interface MarkdownSection {
  /** Section heading text (without the ## prefix) */
  name: string;
  /** Full body content after the heading (does not include the heading line) */
  body: string;
}

/**
 * Result of parsing a markdown document into sections.
 */
export interface ParsedMarkdown {
  /** Content before the first ## heading (typically the # title block) */
  header: string;
  /** Ordered array of ## sections */
  sections: MarkdownSection[];
  /** Trailing content after the last section (e.g., --- separator and tagline) */
  footer: string;
}

/**
 * Parse a markdown document into header, ## sections, and footer.
 *
 * This is a line-by-line parser — no regex surgery on the document.
 * Handles arbitrary section names, preserves ordering, and cleanly
 * separates the footer (trailing `---` block) from the last section.
 */
export function parseMarkdownSections(content: string): ParsedMarkdown {
  const lines = content.split("\n");
  let header = "";
  const sections: MarkdownSection[] = [];
  let currentSection: { name: string; lines: string[] } | null = null;
  let inHeader = true;

  for (const line of lines) {
    const sectionMatch = line.match(/^## (.+)$/);

    if (sectionMatch) {
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

  if (currentSection) {
    sections.push({ name: currentSection.name, body: currentSection.lines.join("\n") });
  }

  // Extract footer from the last section (trailing --- separator)
  let footer = "";
  if (sections.length > 0) {
    const lastSection = sections[sections.length - 1];
    const footerIdx = lastSection.body.lastIndexOf("\n---\n");
    if (footerIdx !== -1) {
      footer = lastSection.body.slice(footerIdx + 1);
      lastSection.body = lastSection.body.slice(0, footerIdx + 1);
    }
  } else {
    const footerIdx = header.lastIndexOf("\n---\n");
    if (footerIdx !== -1) {
      footer = header.slice(footerIdx + 1);
      header = header.slice(0, footerIdx + 1);
    }
  }

  return { header, sections, footer };
}

/**
 * Reassemble a parsed markdown document back into a string.
 */
export function assembleMarkdown(parsed: ParsedMarkdown): string {
  let content = parsed.header;
  for (const section of parsed.sections) {
    content += `## ${section.name}\n${section.body}\n`;
  }
  if (parsed.footer) {
    content += parsed.footer;
  }
  return content;
}

/**
 * Find a section by name in a parsed markdown document.
 * Case-insensitive comparison.
 */
export function findSection(parsed: ParsedMarkdown, name: string): MarkdownSection | undefined {
  return parsed.sections.find(
    s => s.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Update a section's body in a parsed markdown document.
 * Returns true if the section was found and updated, false otherwise.
 */
export function updateSection(parsed: ParsedMarkdown, name: string, newBody: string): boolean {
  const section = findSection(parsed, name);
  if (section) {
    section.body = newBody;
    return true;
  }
  return false;
}

/**
 * Escape a string for safe use in a RegExp constructor.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
