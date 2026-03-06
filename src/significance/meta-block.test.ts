/**
 * Meta Block Parser Tests
 */

import { describe, it, expect } from "vitest";
import { extractMetaBlock, type MetaBlock, type ExtractResult } from "./meta-block.js";

describe("extractMetaBlock", () => {
  // ===========================================================================
  // No meta block present
  // ===========================================================================

  describe("when no meta block is present", () => {
    it("returns original content and null meta", () => {
      const result = extractMetaBlock("Just a normal response.");
      expect(result.cleaned).toBe("Just a normal response.");
      expect(result.meta).toBeNull();
    });

    it("handles empty string", () => {
      const result = extractMetaBlock("");
      expect(result.cleaned).toBe("");
      expect(result.meta).toBeNull();
    });

    it("ignores regular HTML comments", () => {
      const content = "Some text <!-- this is a regular comment --> more text";
      const result = extractMetaBlock(content);
      expect(result.cleaned).toBe(content);
      expect(result.meta).toBeNull();
    });

    it("ignores partial 25o1 markers", () => {
      const content = "Some text <!-- 25o1 --> more text";
      const result = extractMetaBlock(content);
      expect(result.cleaned).toBe(content);
      expect(result.meta).toBeNull();
    });
  });

  // ===========================================================================
  // Full meta block extraction
  // ===========================================================================

  describe("when meta block is present", () => {
    const fullResponse = `That sounds really tough. Having a family member in the hospital is never easy, and DKA can be scary. How is she doing now?

<!-- 25o1:meta
significance: 7
category: emotional_support
facts: daughter had DKA crisis, wife involved in medical decisions
entities: daughter, wife, DKA
emotions: stress, concern, relief
topics: family, health, medical
-->`;

    it("strips the meta block from content", () => {
      const result = extractMetaBlock(fullResponse);
      expect(result.cleaned).toBe(
        "That sounds really tough. Having a family member in the hospital is never easy, and DKA can be scary. How is she doing now?"
      );
      expect(result.cleaned).not.toContain("25o1:meta");
      expect(result.cleaned).not.toContain("<!--");
    });

    it("parses significance score", () => {
      const result = extractMetaBlock(fullResponse);
      expect(result.meta?.significance).toBe(7);
    });

    it("parses category", () => {
      const result = extractMetaBlock(fullResponse);
      expect(result.meta?.category).toBe("emotional_support");
    });

    it("parses facts as array", () => {
      const result = extractMetaBlock(fullResponse);
      expect(result.meta?.facts).toEqual([
        "daughter had DKA crisis",
        "wife involved in medical decisions",
      ]);
    });

    it("parses entities as array", () => {
      const result = extractMetaBlock(fullResponse);
      expect(result.meta?.entities).toEqual(["daughter", "wife", "DKA"]);
    });

    it("parses emotions as array", () => {
      const result = extractMetaBlock(fullResponse);
      expect(result.meta?.emotions).toEqual(["stress", "concern", "relief"]);
    });

    it("parses topics as array", () => {
      const result = extractMetaBlock(fullResponse);
      expect(result.meta?.topics).toEqual(["family", "health", "medical"]);
    });

    it("preserves raw key-value pairs", () => {
      const result = extractMetaBlock(fullResponse);
      expect(result.meta?.raw["significance"]).toBe("7");
      expect(result.meta?.raw["category"]).toBe("emotional_support");
    });
  });

  // ===========================================================================
  // Meta block at various positions
  // ===========================================================================

  describe("meta block positioning", () => {
    it("handles meta block at the very end", () => {
      const content = `Response text.\n\n<!-- 25o1:meta\nsignificance: 5\ncategory: casual\n-->`;
      const result = extractMetaBlock(content);
      expect(result.cleaned).toBe("Response text.");
      expect(result.meta?.significance).toBe(5);
    });

    it("handles meta block in the middle (strips it)", () => {
      const content = `Before.\n\n<!-- 25o1:meta\nsignificance: 3\ncategory: technical\n-->\n\nAfter.`;
      const result = extractMetaBlock(content);
      expect(result.cleaned).toContain("Before.");
      expect(result.cleaned).toContain("After.");
      expect(result.cleaned).not.toContain("25o1:meta");
      expect(result.meta?.category).toBe("technical");
    });

    it("handles meta block with trailing whitespace", () => {
      const content = `Text.\n\n<!-- 25o1:meta\nsignificance: 4\ncategory: casual\n-->   \n\n`;
      const result = extractMetaBlock(content);
      expect(result.cleaned).toBe("Text.");
      expect(result.meta?.significance).toBe(4);
    });
  });

  // ===========================================================================
  // Edge cases in parsing
  // ===========================================================================

  describe("parsing edge cases", () => {
    it("defaults significance to 3 when missing", () => {
      const content = `Text.\n\n<!-- 25o1:meta\ncategory: casual\n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.significance).toBe(3);
    });

    it("defaults category to casual when missing", () => {
      const content = `Text.\n\n<!-- 25o1:meta\nsignificance: 5\n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.category).toBe("casual");
    });

    it("defaults category to casual for unknown values", () => {
      const content = `Text.\n\n<!-- 25o1:meta\ncategory: existential_crisis\n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.category).toBe("casual");
    });

    it("clamps significance to 1-10 range", () => {
      const content1 = `Text.\n\n<!-- 25o1:meta\nsignificance: 0\n-->`;
      expect(extractMetaBlock(content1).meta?.significance).toBe(1);

      const content2 = `Text.\n\n<!-- 25o1:meta\nsignificance: 15\n-->`;
      expect(extractMetaBlock(content2).meta?.significance).toBe(10);
    });

    it("handles significance as non-number", () => {
      const content = `Text.\n\n<!-- 25o1:meta\nsignificance: high\n-->`;
      expect(extractMetaBlock(content).meta?.significance).toBe(1);
    });

    it("returns empty arrays for missing list fields", () => {
      const content = `Text.\n\n<!-- 25o1:meta\nsignificance: 5\n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.facts).toEqual([]);
      expect(result.meta?.entities).toEqual([]);
      expect(result.meta?.emotions).toEqual([]);
      expect(result.meta?.topics).toEqual([]);
    });

    it("handles single-item lists", () => {
      const content = `Text.\n\n<!-- 25o1:meta\nfacts: one thing\nentities: person\n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.facts).toEqual(["one thing"]);
      expect(result.meta?.entities).toEqual(["person"]);
    });

    it("preserves unknown keys in raw for forward-compat", () => {
      const content = `Text.\n\n<!-- 25o1:meta\nsignificance: 5\nfuture_field: some value\n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.raw["future_field"]).toBe("some value");
    });

    it("handles extra whitespace in key-value pairs", () => {
      const content = `Text.\n\n<!-- 25o1:meta\n  significance :  8  \n  category : technical  \n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.significance).toBe(8);
      expect(result.meta?.category).toBe("technical");
    });

    it("ignores blank lines inside meta block", () => {
      const content = `Text.\n\n<!-- 25o1:meta\nsignificance: 5\n\ncategory: casual\n\n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.significance).toBe(5);
      expect(result.meta?.category).toBe("casual");
    });

    it("handles colons in values", () => {
      const content = `Text.\n\n<!-- 25o1:meta\nfacts: time was 3:00 PM, location: downtown\n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.facts).toEqual(["time was 3:00 PM", "location: downtown"]);
    });

    it("normalizes category with spaces to underscores", () => {
      const content = `Text.\n\n<!-- 25o1:meta\ncategory: emotional support\n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.category).toBe("emotional_support");
    });

    it("normalizes category with mixed case", () => {
      const content = `Text.\n\n<!-- 25o1:meta\ncategory: Task_Oriented\n-->`;
      const result = extractMetaBlock(content);
      expect(result.meta?.category).toBe("task_oriented");
    });
  });

  // ===========================================================================
  // Idempotency
  // ===========================================================================

  describe("idempotency", () => {
    it("extracting from already-cleaned content returns same content", () => {
      const original = `Some response.\n\n<!-- 25o1:meta\nsignificance: 5\n-->`;
      const first = extractMetaBlock(original);
      const second = extractMetaBlock(first.cleaned);

      expect(second.cleaned).toBe(first.cleaned);
      expect(second.meta).toBeNull();
    });
  });
});
