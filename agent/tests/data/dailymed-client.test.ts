import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseSplSections,
  searchDrug,
  getDrugLabel,
  getDrugEducation,
  SPL_SECTION_CODES,
} from "../../src/data/dailymed-client";

describe("dailymed-client", () => {
  describe("parseSplSections", () => {
    it("extracts indications section from SPL XML", () => {
      const xml = `
        <document>
          <component>
            <section>
              <code code="34067-9" codeSystem="2.16.840.1.113883.6.1" />
              <title>INDICATIONS AND USAGE</title>
              <text>Used for the treatment of hypertension and heart failure.</text>
            </section>
          </component>
        </document>`;
      const sections = parseSplSections(xml);
      expect(sections).toHaveLength(1);
      expect(sections[0].code).toBe("34067-9");
      expect(sections[0].title).toContain("INDICATIONS");
      expect(sections[0].text).toContain("hypertension");
    });

    it("extracts multiple sections", () => {
      const xml = `
        <document>
          <component>
            <section>
              <code code="34067-9" codeSystem="2.16.840.1.113883.6.1" />
              <title>INDICATIONS</title>
              <text>Treats high blood pressure.</text>
            </section>
            <section>
              <code code="34084-4" codeSystem="2.16.840.1.113883.6.1" />
              <title>ADVERSE REACTIONS</title>
              <text>Common side effects include dizziness and fatigue.</text>
            </section>
          </component>
        </document>`;
      const sections = parseSplSections(xml);
      expect(sections).toHaveLength(2);
      expect(sections[0].code).toBe(SPL_SECTION_CODES.INDICATIONS);
      expect(sections[1].code).toBe(SPL_SECTION_CODES.ADVERSE_REACTIONS);
    });

    it("strips HTML/XML tags from text content", () => {
      const xml = `
        <section>
          <code code="34067-9" codeSystem="2.16.840.1.113883.6.1" />
          <title>INDICATIONS</title>
          <text><paragraph>For treatment of <content styleCode="bold">hypertension</content>.</paragraph></text>
        </section>`;
      const sections = parseSplSections(xml);
      expect(sections[0].text).not.toContain("<");
      expect(sections[0].text).toContain("hypertension");
    });

    it("ignores sections with non-target LOINC codes", () => {
      const xml = `
        <section>
          <code code="99999-9" codeSystem="2.16.840.1.113883.6.1" />
          <title>OTHER SECTION</title>
          <text>Not relevant.</text>
        </section>`;
      const sections = parseSplSections(xml);
      expect(sections).toHaveLength(0);
    });

    it("returns empty array for empty XML", () => {
      const sections = parseSplSections("");
      expect(sections).toHaveLength(0);
    });

    it("handles boxed warning section", () => {
      const xml = `
        <section>
          <code code="34066-1" codeSystem="2.16.840.1.113883.6.1" />
          <title>BOXED WARNING</title>
          <text>WARNING: BLEEDING RISK. Warfarin can cause major or fatal bleeding.</text>
        </section>`;
      const sections = parseSplSections(xml);
      expect(sections).toHaveLength(1);
      expect(sections[0].code).toBe(SPL_SECTION_CODES.BOXED_WARNING);
      expect(sections[0].text).toContain("BLEEDING RISK");
    });

    it("decodes XML entities", () => {
      const xml = `
        <section>
          <code code="34067-9" codeSystem="2.16.840.1.113883.6.1" />
          <title>INDICATIONS</title>
          <text>Use &amp; dosage for patients &gt; 18 years.</text>
        </section>`;
      const sections = parseSplSections(xml);
      expect(sections[0].text).toContain("Use & dosage");
      expect(sections[0].text).toContain("> 18");
    });
  });

  describe("searchDrug (integration)", () => {
    // These tests hit the real DailyMed API — skip in CI
    const SKIP_INTEGRATION = process.env.CI === "true";

    it.skipIf(SKIP_INTEGRATION)(
      "finds results for metoprolol",
      async () => {
        const results = await searchDrug("metoprolol", 1);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].setid).toBeTruthy();
        expect(results[0].title.toLowerCase()).toContain("metoprolol");
      },
      15_000
    );

    it.skipIf(SKIP_INTEGRATION)(
      "returns empty array for nonexistent drug",
      async () => {
        const results = await searchDrug("zzzznotarealdrug12345", 1);
        expect(results).toHaveLength(0);
      },
      15_000
    );
  });

  describe("getDrugEducation (integration)", () => {
    const SKIP_INTEGRATION = process.env.CI === "true";

    it.skipIf(SKIP_INTEGRATION)(
      "returns education info for warfarin",
      async () => {
        const info = await getDrugEducation("warfarin");
        expect(info).not.toBeNull();
        expect(info!.drug_name).toBe("warfarin");
        expect(info!.setid).toBeTruthy();
        expect(info!.source).toBe("DailyMed (NLM/NIH)");
        expect(info!.fetched_at).toBeTruthy();
        // Warfarin should have indications and warnings at minimum
        expect(
          info!.indications || info!.warnings || info!.adverse_reactions
        ).toBeTruthy();
      },
      20_000
    );

    it.skipIf(SKIP_INTEGRATION)(
      "returns null for nonexistent drug",
      async () => {
        const info = await getDrugEducation("zzzznotarealdrug12345");
        expect(info).toBeNull();
      },
      15_000
    );
  });
});
