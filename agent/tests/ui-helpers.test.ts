import { describe, it, expect } from "vitest";
import {
  PATIENT_INFO,
  getPatientContext,
  createChatIndexEntry,
  trimChatIndex,
  MAX_SAVED_CHATS,
  escapeHtml,
  renderMarkdown,
} from "../src/ui-helpers";

describe("ui-helpers", () => {
  describe("PATIENT_INFO", () => {
    it("has entries for all 4 mock patients", () => {
      expect(PATIENT_INFO["1"]).toBeDefined();
      expect(PATIENT_INFO["2"]).toBeDefined();
      expect(PATIENT_INFO["3"]).toBeDefined();
      expect(PATIENT_INFO["4"]).toBeDefined();
    });

    it("each entry has name and detail", () => {
      for (const pid of ["1", "2", "3", "4"]) {
        expect(PATIENT_INFO[pid].name).toBeTruthy();
        expect(PATIENT_INFO[pid].detail).toBeTruthy();
      }
    });

    it("patient 1 is John Demo", () => {
      expect(PATIENT_INFO["1"].name).toBe("John Demo");
    });

    it("patient 4 is Sara Complex", () => {
      expect(PATIENT_INFO["4"].name).toBe("Sara Complex");
    });
  });

  describe("getPatientContext", () => {
    it("returns patient info for valid ID", () => {
      const ctx = getPatientContext("1");
      expect(ctx).not.toBeNull();
      expect(ctx!.name).toBe("John Demo");
      expect(ctx!.detail).toBeTruthy();
    });

    it("returns null for empty string", () => {
      expect(getPatientContext("")).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(getPatientContext(undefined as any)).toBeNull();
    });

    it("returns null for invalid ID", () => {
      expect(getPatientContext("999")).toBeNull();
    });

    it("returns correct info for each patient", () => {
      expect(getPatientContext("2")!.name).toBe("Jane Minimal");
      expect(getPatientContext("3")!.name).toBe("Bob Allergic");
    });
  });

  describe("createChatIndexEntry", () => {
    it("creates entry with all required fields", () => {
      const entry = createChatIndexEntry("session-123", "1", "What meds?");
      expect(entry.id).toBe("session-123");
      expect(entry.patient_id).toBe("1");
      expect(entry.patient_name).toBe("John Demo");
      expect(entry.title).toBe("What meds?");
      expect(entry.created_at).toBeTruthy();
      expect(entry.message_count).toBe(0);
    });

    it("truncates title to 50 chars", () => {
      const longTitle = "a".repeat(80);
      const entry = createChatIndexEntry("s1", "1", longTitle);
      expect(entry.title.length).toBeLessThanOrEqual(50);
    });

    it("uses 'No Patient' for unknown patient_id", () => {
      const entry = createChatIndexEntry("s1", "", "hello");
      expect(entry.patient_name).toBe("No Patient");
    });

    it("uses 'No Patient' for undefined patient_id", () => {
      const entry = createChatIndexEntry("s1", undefined, "hello");
      expect(entry.patient_name).toBe("No Patient");
    });
  });

  describe("trimChatIndex", () => {
    it("returns array as-is when under MAX_SAVED_CHATS", () => {
      const index = [
        createChatIndexEntry("s1", "1", "msg1"),
        createChatIndexEntry("s2", "2", "msg2"),
      ];
      expect(trimChatIndex(index)).toHaveLength(2);
    });

    it("trims to MAX_SAVED_CHATS when over limit", () => {
      const index = Array.from({ length: MAX_SAVED_CHATS + 5 }, (_, i) =>
        createChatIndexEntry("s" + i, "1", "msg" + i)
      );
      const trimmed = trimChatIndex(index);
      expect(trimmed).toHaveLength(MAX_SAVED_CHATS);
    });

    it("keeps the first entries (most recent)", () => {
      const index = Array.from({ length: MAX_SAVED_CHATS + 3 }, (_, i) =>
        createChatIndexEntry("s" + i, "1", "msg" + i)
      );
      const trimmed = trimChatIndex(index);
      expect(trimmed[0].id).toBe("s0");
      expect(trimmed[trimmed.length - 1].id).toBe("s" + (MAX_SAVED_CHATS - 1));
    });
  });

  describe("escapeHtml", () => {
    it("escapes angle brackets", () => {
      expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
    });

    it("escapes ampersands", () => {
      expect(escapeHtml("a & b")).toBe("a &amp; b");
    });

    it("escapes double and single quotes", () => {
      expect(escapeHtml('"hello"')).toContain("&quot;");
      expect(escapeHtml("it's")).toContain("&#39;");
    });

    it("returns empty string for empty input", () => {
      expect(escapeHtml("")).toBe("");
    });

    it("does not alter plain text", () => {
      expect(escapeHtml("hello world")).toBe("hello world");
    });

    it("escapes script tags for XSS safety", () => {
      const result = escapeHtml("<script>alert('xss')</script>");
      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;script&gt;");
    });
  });

  describe("renderMarkdown", () => {
    it("wraps plain text in a paragraph", () => {
      const result = renderMarkdown("Hello world");
      expect(result).toMatch(/<p[^>]*>/);
      expect(result).toContain("Hello world");
    });

    it("renders **bold** as <strong>", () => {
      const result = renderMarkdown("This is **bold** text");
      expect(result).toContain("<strong>bold</strong>");
    });

    it("renders *italic* as <em>", () => {
      const result = renderMarkdown("This is *italic* text");
      expect(result).toContain("<em>italic</em>");
    });

    it("renders # heading as <h2>", () => {
      const result = renderMarkdown("# Main Heading");
      expect(result).toContain("<h2");
      expect(result).toContain("Main Heading");
    });

    it("renders ## heading as <h3>", () => {
      const result = renderMarkdown("## Sub Heading");
      expect(result).toContain("<h3");
      expect(result).toContain("Sub Heading");
    });

    it("renders ### heading as <h4>", () => {
      const result = renderMarkdown("### Minor Heading");
      expect(result).toContain("<h4");
      expect(result).toContain("Minor Heading");
    });

    it("renders unordered list items", () => {
      const result = renderMarkdown("- item one\n- item two");
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>");
      expect(result).toContain("item one");
      expect(result).toContain("item two");
    });

    it("renders ordered list items", () => {
      const result = renderMarkdown("1. first\n2. second");
      expect(result).toContain("<ol>");
      expect(result).toContain("<li>");
      expect(result).toContain("first");
      expect(result).toContain("second");
    });

    it("renders --- as horizontal rule", () => {
      const result = renderMarkdown("above\n---\nbelow");
      expect(result).toContain("<hr");
    });

    it("creates paragraph breaks on double newline", () => {
      const result = renderMarkdown("paragraph one\n\nparagraph two");
      const pCount = (result.match(/<p[^>]*>/g) || []).length;
      expect(pCount).toBeGreaterThanOrEqual(2);
    });

    it("creates line breaks on single newline within a paragraph", () => {
      const result = renderMarkdown("line one\nline two");
      expect(result).toContain("<br");
    });

    it("escapes HTML in input for XSS safety", () => {
      const result = renderMarkdown("<script>alert('xss')</script>");
      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;script&gt;");
    });

    it("does not double-escape already safe text", () => {
      const result = renderMarkdown("Hello & welcome");
      expect(result).toContain("&amp;");
      expect(result).not.toContain("&amp;amp;");
    });

    it("handles mixed markdown: bold, italic, list", () => {
      const input = "**Title**\n\n*Note:*\n- item A\n- item B";
      const result = renderMarkdown(input);
      expect(result).toContain("<strong>Title</strong>");
      expect(result).toContain("<em>Note:</em>");
      expect(result).toContain("<ul>");
      expect(result).toContain("item A");
    });
  });
});
