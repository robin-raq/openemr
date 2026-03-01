import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  describe("initLangfuse", () => {
    it("returns false when keys are missing", async () => {
      process.env.LANGFUSE_SECRET_KEY = "";
      process.env.LANGFUSE_PUBLIC_KEY = "";
      const { initLangfuse } = await import("../src/config");
      expect(initLangfuse()).toBe(false);
    });

    it("returns false when keys contain placeholder '...'", async () => {
      process.env.LANGFUSE_SECRET_KEY = "sk-lf-...";
      process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-...";
      const { initLangfuse } = await import("../src/config");
      expect(initLangfuse()).toBe(false);
    });

    it("logs warning when placeholder keys detected", async () => {
      process.env.LANGFUSE_SECRET_KEY = "sk-lf-...";
      process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-...";
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { initLangfuse } = await import("../src/config");
      initLangfuse();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Langfuse")
      );
      consoleSpy.mockRestore();
    });

    it("returns true and initializes OTel when valid keys are set", async () => {
      process.env.LANGFUSE_SECRET_KEY = "sk-lf-real-key-1234";
      process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-real-key-5678";
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const { initLangfuse } = await import("../src/config");
      const result = initLangfuse();
      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Langfuse OTel tracing initialized")
      );
      consoleSpy.mockRestore();
    });
  });

  describe("getLangfuseCallbacks", () => {
    it("returns empty array when Langfuse not initialized", async () => {
      process.env.LANGFUSE_SECRET_KEY = "";
      process.env.LANGFUSE_PUBLIC_KEY = "";
      const { getLangfuseCallbacks } = await import("../src/config");
      const callbacks = getLangfuseCallbacks("test");
      expect(callbacks).toEqual([]);
    });

    it("returns CallbackHandler array when initialized", async () => {
      process.env.LANGFUSE_SECRET_KEY = "sk-lf-real-key-1234";
      process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-real-key-5678";
      vi.spyOn(console, "log").mockImplementation(() => {});
      const { initLangfuse, getLangfuseCallbacks } = await import("../src/config");
      initLangfuse();
      const callbacks = getLangfuseCallbacks("test-session");
      expect(callbacks).toHaveLength(1);
      expect((callbacks[0] as any).name).toBe("LangfuseCallbackHandler");
    });
  });

  describe("getAnthropicApiKey", () => {
    it("throws when ANTHROPIC_API_KEY is missing", async () => {
      process.env.ANTHROPIC_API_KEY = "";
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
      process.env.FHIR_BASE_URL = "";
      process.env.FHIR_CLIENT_ID = "";
      const { getDataSource } = await import("../src/config");
      expect(() => getDataSource()).toThrow("FHIR datasource requires");
    });
  });

  describe("isPlaceholderKey (SEC-006)", () => {
    it("detects '...' placeholder", async () => {
      const { isPlaceholderKey } = await import("../src/config");
      expect(isPlaceholderKey("sk-ant-...")).toBe(true);
    });

    it("detects 'changeme' placeholder", async () => {
      const { isPlaceholderKey } = await import("../src/config");
      expect(isPlaceholderKey("changeme")).toBe(true);
      expect(isPlaceholderKey("CHANGEME")).toBe(true);
    });

    it("detects 'placeholder' in key", async () => {
      const { isPlaceholderKey } = await import("../src/config");
      expect(isPlaceholderKey("my_placeholder_key")).toBe(true);
    });

    it("detects '<your' pattern", async () => {
      const { isPlaceholderKey } = await import("../src/config");
      expect(isPlaceholderKey("<your-api-key-here>")).toBe(true);
    });

    it("detects 'xxx' pattern", async () => {
      const { isPlaceholderKey } = await import("../src/config");
      expect(isPlaceholderKey("xxx")).toBe(true);
    });

    it("does not flag real API keys", async () => {
      const { isPlaceholderKey } = await import("../src/config");
      expect(isPlaceholderKey("sk-ant-api03-real-key-1234567890")).toBe(false);
      expect(isPlaceholderKey("pk-lf-abc123def456")).toBe(false);
    });
  });

  describe("PORT validation (SEC-006)", () => {
    it("falls back to 3000 for NaN PORT", async () => {
      process.env.PORT = "not-a-number";
      const { PORT } = await import("../src/config");
      expect(PORT).toBe(3000);
    });

    it("falls back to 3000 for PORT out of range (0)", async () => {
      process.env.PORT = "0";
      const { PORT } = await import("../src/config");
      expect(PORT).toBe(3000);
    });

    it("falls back to 3000 for PORT out of range (99999)", async () => {
      process.env.PORT = "99999";
      const { PORT } = await import("../src/config");
      expect(PORT).toBe(3000);
    });

    it("accepts valid PORT", async () => {
      process.env.PORT = "8080";
      const { PORT } = await import("../src/config");
      expect(PORT).toBe(8080);
    });
  });

  describe("warnInsecureTls", () => {
    it("logs warning when NODE_TLS_REJECT_UNAUTHORIZED is 0", async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { warnInsecureTls } = await import("../src/config");
      warnInsecureTls();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("TLS")
      );
      consoleSpy.mockRestore();
    });

    it("does not log when NODE_TLS_REJECT_UNAUTHORIZED is not 0", async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { warnInsecureTls } = await import("../src/config");
      warnInsecureTls();
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
