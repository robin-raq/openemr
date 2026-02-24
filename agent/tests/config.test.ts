import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  describe("getLangfuseCallbacks", () => {
    it("returns empty array when keys contain placeholder '...'", async () => {
      process.env.LANGFUSE_SECRET_KEY = "sk-lf-...";
      process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-...";
      const { getLangfuseCallbacks } = await import("../src/config");
      const callbacks = getLangfuseCallbacks("test");
      expect(callbacks).toEqual([]);
    });

    it("returns empty array when keys are missing", async () => {
      delete process.env.LANGFUSE_SECRET_KEY;
      delete process.env.LANGFUSE_PUBLIC_KEY;
      const { getLangfuseCallbacks } = await import("../src/config");
      const callbacks = getLangfuseCallbacks("test");
      expect(callbacks).toEqual([]);
    });

    it("logs warning when placeholder keys detected", async () => {
      process.env.LANGFUSE_SECRET_KEY = "sk-lf-...";
      process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-...";
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { getLangfuseCallbacks } = await import("../src/config");
      getLangfuseCallbacks("test");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Langfuse")
      );
      consoleSpy.mockRestore();
    });
  });

  describe("getAnthropicApiKey", () => {
    it("throws when ANTHROPIC_API_KEY is missing", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const { getAnthropicApiKey } = await import("../src/config");
      expect(() => getAnthropicApiKey()).toThrow("ANTHROPIC_API_KEY");
    });

    it("throws when ANTHROPIC_API_KEY is a placeholder", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-...";
      const { getAnthropicApiKey } = await import("../src/config");
      expect(() => getAnthropicApiKey()).toThrow();
    });
  });

  describe("getDataSource", () => {
    it("returns MockDataSource when DATA_SOURCE is mock or unset", async () => {
      process.env.DATA_SOURCE = "mock";
      const { getDataSource } = await import("../src/config");
      const ds = getDataSource();
      expect(ds.constructor.name).toBe("MockDataSource");
    });

    it("returns FhirDataSource when DATA_SOURCE is fhir and required env vars are set", async () => {
      process.env.DATA_SOURCE = "fhir";
      process.env.FHIR_BASE_URL = "https://localhost:9300/apis/default/fhir";
      process.env.FHIR_CLIENT_ID = "test-client";
      process.env.FHIR_USERNAME = "admin";
      process.env.FHIR_PASSWORD = "pass";
      const { getDataSource } = await import("../src/config");
      const ds = getDataSource();
      expect(ds.constructor.name).toBe("FhirDataSource");
    });

    it("throws when DATA_SOURCE is fhir but required env vars are missing", async () => {
      process.env.DATA_SOURCE = "fhir";
      delete process.env.FHIR_BASE_URL;
      delete process.env.FHIR_CLIENT_ID;
      const { getDataSource } = await import("../src/config");
      expect(() => getDataSource()).toThrow("FHIR datasource requires");
    });
  });
});
