/**
 * USER.md Document Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadUserDocument,
  saveUserDocument,
  ensureUserDocument,
  addUserFact,
  getUserContext,
  getUserPath,
  countUserFacts,
} from "./user.js";

describe("USER.md Management", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "25o1-user-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getUserPath", () => {
    it("should return workspace-based path when workspaceDir provided", () => {
      const result = getUserPath("/some/workspace");
      expect(result).toBe("/some/workspace/USER.md");
    });

    it("should return home-based path when no workspaceDir", () => {
      const result = getUserPath();
      expect(result).toContain(".openclaw");
      expect(result).toContain("USER.md");
    });
  });

  describe("loadUserDocument", () => {
    it("should return null when file does not exist", async () => {
      const result = await loadUserDocument(tempDir);
      expect(result).toBeNull();
    });

    it("should load existing USER.md", async () => {
      const content = "# About You\n\nTest content";
      await fs.promises.writeFile(path.join(tempDir, "USER.md"), content);
      const result = await loadUserDocument(tempDir);
      expect(result).toBe(content);
    });
  });

  describe("saveUserDocument", () => {
    it("should save content to USER.md", async () => {
      const content = "# About You\n\nSaved content";
      await saveUserDocument(content, tempDir);
      const result = await fs.promises.readFile(path.join(tempDir, "USER.md"), "utf-8");
      expect(result).toBe(content);
    });

    it("should create directory if it does not exist", async () => {
      const nestedDir = path.join(tempDir, "nested", "dir");
      await saveUserDocument("test", nestedDir);
      const result = await fs.promises.readFile(path.join(nestedDir, "USER.md"), "utf-8");
      expect(result).toBe("test");
    });
  });

  describe("ensureUserDocument", () => {
    it("should create USER.md with template when missing", async () => {
      const result = await ensureUserDocument(tempDir);
      expect(result).toContain("# About You");
      expect(result).toContain("## Work");
      expect(result).toContain("## Family");
      expect(result).toContain("## Interests");

      // Verify it was written to disk
      const onDisk = await fs.promises.readFile(path.join(tempDir, "USER.md"), "utf-8");
      expect(onDisk).toBe(result);
    });

    it("should return existing content when file exists", async () => {
      const existing = "# Custom USER.md";
      await fs.promises.writeFile(path.join(tempDir, "USER.md"), existing);
      const result = await ensureUserDocument(tempDir);
      expect(result).toBe(existing);
    });
  });

  describe("addUserFact", () => {
    it("should add a fact to the Work section", async () => {
      await ensureUserDocument(tempDir);
      await addUserFact(tempDir, "Work", "Software engineer at Acme Corp");
      const result = await loadUserDocument(tempDir);
      expect(result).toContain("Software engineer at Acme Corp");
      // Placeholder should be gone
      expect(result).not.toContain("(What you do, projects, workplace)");
    });

    it("should add a fact to the Family section", async () => {
      await ensureUserDocument(tempDir);
      await addUserFact(tempDir, "Family", "Has a dog named Rex");
      const result = await loadUserDocument(tempDir);
      expect(result).toContain("Has a dog named Rex");
    });

    it("should append multiple facts to the same section", async () => {
      await ensureUserDocument(tempDir);
      await addUserFact(tempDir, "Interests", "Likes hiking");
      await addUserFact(tempDir, "Interests", "Plays guitar");
      const result = await loadUserDocument(tempDir);
      expect(result).toContain("Likes hiking");
      expect(result).toContain("Plays guitar");
    });

    it("should fall back to Notes for unknown sections", async () => {
      await ensureUserDocument(tempDir);
      await addUserFact(tempDir, "UnknownSection", "Random fact");
      const result = await loadUserDocument(tempDir);
      expect(result).toContain("Random fact");
      // Should be in Notes section
      const notesIdx = result!.indexOf("## Notes");
      const factIdx = result!.indexOf("Random fact");
      expect(factIdx).toBeGreaterThan(notesIdx);
    });

    it("should create USER.md if it does not exist", async () => {
      await addUserFact(tempDir, "Work", "New job at startup");
      const result = await loadUserDocument(tempDir);
      expect(result).not.toBeNull();
      expect(result).toContain("New job at startup");
    });

    it("should replace section content on update type", async () => {
      await ensureUserDocument(tempDir);
      await addUserFact(tempDir, "Location", "Lives in Denver");
      await addUserFact(tempDir, "Location", "Moved to Austin", "update");
      const result = await loadUserDocument(tempDir);
      expect(result).toContain("Moved to Austin");
      expect(result).not.toContain("Lives in Denver");
    });

    it("should include date prefix in entries", async () => {
      await ensureUserDocument(tempDir);
      await addUserFact(tempDir, "Work", "Got promoted");
      const result = await loadUserDocument(tempDir);
      const today = new Date().toISOString().split("T")[0];
      expect(result).toContain(`- ${today}: Got promoted`);
    });
  });

  describe("getUserContext", () => {
    it("should return null for null input", () => {
      expect(getUserContext(null)).toBeNull();
    });

    it("should return null when all sections are placeholders", () => {
      const template = `# About You

## Work

(What you do, projects, workplace)

---

## Notes

(Other things)

---`;
      expect(getUserContext(template)).toBeNull();
    });

    it("should extract sections with real content", () => {
      const content = `# About You

## Work

- 2026-03-04: Software engineer at Acme Corp
- 2026-03-04: Working on AI project

---

## Family

(People you've mentioned)

---`;
      const result = getUserContext(content);
      expect(result).not.toBeNull();
      expect(result).toContain("**Work:**");
      expect(result).toContain("Software engineer at Acme Corp");
      // Family is still placeholder, should not appear
      expect(result).not.toContain("**Family:**");
    });

    it("should format multiple populated sections", () => {
      const content = `# About You

## Work

- 2026-03-04: Engineer

---

## Interests

- 2026-03-04: Hiking
- 2026-03-04: Guitar

---`;
      const result = getUserContext(content);
      expect(result).toContain("**Work:**");
      expect(result).toContain("**Interests:**");
      expect(result).toContain("## What You Know About This Person");
    });
  });

  describe("countUserFacts", () => {
    it("returns 0 for null content", () => {
      expect(countUserFacts(null)).toBe(0);
    });

    it("returns 0 for empty template", () => {
      const template = `# About You\n\n## Work\n\n(Nothing yet)\n\n## Family\n\n(Nothing yet)\n`;
      expect(countUserFacts(template)).toBe(0);
    });

    it("counts bullet points across sections", () => {
      const content = `# About You

## Work

- Software engineer at Acme Corp
- Works on AI projects

## Family

- Has a daughter
- Wife mentioned in medical decisions

## Interests

(Nothing yet)

---`;
      expect(countUserFacts(content)).toBe(4);
    });

    it("ignores non-bullet content", () => {
      const content = `# About You

## Notes

Some random text here.
Not a bullet point.
- This is a fact
- And this too

---`;
      expect(countUserFacts(content)).toBe(2);
    });
  });
});
