import { describe, it, expect, beforeEach } from "vitest";
import { MockDataSource } from "../../src/data/mock-datasource";
import { getEncounterData } from "../../src/tools/get-encounter-data";

describe("get_encounter_data", () => {
  let toolFn: ReturnType<typeof getEncounterData>;

  beforeEach(() => {
    const ds = new MockDataSource();
    toolFn = getEncounterData(ds);
  });

  it("returns encounter list for patient 1 (1 discharged encounter)", async () => {
    const result = JSON.parse(await toolFn.invoke({ patient_id: "1" }));
    expect(result.encounters).toHaveLength(1);
    expect(result.encounters[0].status).toBe("discharged");
    expect(result.total_count).toBe(1);
  });

  it("returns encounter list for patient 4 (1 active encounter)", async () => {
    const result = JSON.parse(await toolFn.invoke({ patient_id: "4" }));
    expect(result.encounters).toHaveLength(1);
    expect(result.encounters[0].status).toBe("active");
    expect(result.active_count).toBe(1);
  });

  it("returns empty with note for patient 2 (no encounters)", async () => {
    const result = JSON.parse(await toolFn.invoke({ patient_id: "2" }));
    expect(result.encounters).toEqual([]);
    expect(result.note).toContain("No encounter");
  });

  it("returns error for unknown patient", async () => {
    const result = JSON.parse(await toolFn.invoke({ patient_id: "99999" }));
    expect(result.error).toBeTruthy();
  });

  it("each encounter has required fields", async () => {
    const result = JSON.parse(await toolFn.invoke({ patient_id: "1" }));
    const enc = result.encounters[0];
    expect(enc.encounter_id).toBe("enc-101");
    expect(enc.admission_date).toBeTruthy();
    expect(enc.attending_provider).toBeTruthy();
    expect(enc.admission_reason).toBeTruthy();
    expect(enc.diagnoses.length).toBeGreaterThan(0);
    expect(enc.hospital_course_notes.length).toBeGreaterThan(0);
  });

  it("includes active_count in response", async () => {
    const result = JSON.parse(await toolFn.invoke({ patient_id: "1" }));
    expect(result.active_count).toBe(0); // patient 1's encounter is discharged
  });
});
