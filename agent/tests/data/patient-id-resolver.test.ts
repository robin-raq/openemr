import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PatientIdResolver } from "../../src/data/patient-id-resolver";

describe("PatientIdResolver", () => {
  const getToken = vi.fn().mockResolvedValue("bearer-tok-123");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves numeric pid to UUID via Standard API", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ uuid: "90cde167-511f-4f6d-bc97-b65a78cf1995" }),
    });

    const resolver = new PatientIdResolver({
      apiBaseUrl: "https://localhost:9300/apis/default/api",
      getAccessToken: getToken,
    });

    const uuid = await resolver.resolveToUuid("1");

    expect(uuid).toBe("90cde167-511f-4f6d-bc97-b65a78cf1995");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://localhost:9300/apis/default/api/patient?pid=1",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer bearer-tok-123",
          Accept: "application/json",
        },
      })
    );
  });

  it("caches result for repeated calls", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ uuid: "90cde167-511f-4f6d-bc97-b65a78cf1995" }),
    });

    const resolver = new PatientIdResolver({
      apiBaseUrl: "https://localhost:9300/apis/default/api",
      getAccessToken: getToken,
    });

    const u1 = await resolver.resolveToUuid("1");
    const u2 = await resolver.resolveToUuid("1");

    expect(u1).toBe(u2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when patient not found (404)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    });

    const resolver = new PatientIdResolver({
      apiBaseUrl: "https://localhost:9300/apis/default/api",
      getAccessToken: getToken,
    });

    await expect(resolver.resolveToUuid("99999")).rejects.toThrow(
      "Patient not found: 99999"
    );
  });

  it("throws when response has no uuid", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const resolver = new PatientIdResolver({
      apiBaseUrl: "https://localhost:9300/apis/default/api",
      getAccessToken: getToken,
    });

    await expect(resolver.resolveToUuid("1")).rejects.toThrow(
      "Patient 1 has no UUID in response"
    );
  });

  it("accepts uuid from id field when uuid is absent", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ id: "a1b2c3d4-0000-0000-0000-000000000000" }),
    });

    const resolver = new PatientIdResolver({
      apiBaseUrl: "https://localhost:9300/apis/default/api",
      getAccessToken: getToken,
    });

    const uuid = await resolver.resolveToUuid("1");

    expect(uuid).toBe("a1b2c3d4-0000-0000-0000-000000000000");
  });
});
