import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock for streamEvents — tests set this before each test
let mockStreamEvents: vi.Mock;

// Mock the LangChain modules before importing agent
vi.mock("langchain/agents", () => {
  return {
    createToolCallingAgent: vi.fn(() => ({})),
    AgentExecutor: {
      fromAgentAndTools: vi.fn(() => ({
        invoke: vi.fn(),
        get streamEvents() {
          return mockStreamEvents;
        },
      })),
    },
  };
});

vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: vi.fn(() => ({})),
}));

vi.mock("@langchain/core/prompts", () => ({
  ChatPromptTemplate: { fromMessages: vi.fn(() => ({})) },
  MessagesPlaceholder: vi.fn(() => ({})),
}));

vi.mock("@langchain/core/messages", () => ({
  HumanMessage: vi.fn((content: string) => ({ content, _getType: () => "human" })),
  AIMessage: vi.fn((content: string) => ({ content, _getType: () => "ai" })),
  SystemMessage: vi.fn((opts: any) => ({ ...opts, _getType: () => "system" })),
}));

vi.mock("@langchain/core/callbacks/base", () => ({
  BaseCallbackHandler: class {
    name = "base";
  },
}));

// Mock all tool imports
vi.mock("../src/tools/get-patient-summary", () => ({ getPatientSummary: vi.fn(() => ({})) }));
vi.mock("../src/tools/get-medications", () => ({ getMedications: vi.fn(() => ({})) }));
vi.mock("../src/tools/drug-interaction-check", () => ({ drugInteractionCheck: vi.fn(() => ({})) }));
vi.mock("../src/tools/allergy-check", () => ({ allergyCheck: vi.fn(() => ({})) }));
vi.mock("../src/tools/lab-results", () => ({ getLabResults: vi.fn(() => ({})) }));
vi.mock("../src/tools/get-encounter-data", () => ({ getEncounterData: vi.fn(() => ({})) }));
vi.mock("../src/tools/reconcile-medications", () => ({ reconcileMedications: vi.fn(() => ({})) }));
vi.mock("../src/tools/draft-discharge-summary", () => ({ draftDischargeSummary: vi.fn(() => ({})) }));
vi.mock("../src/tools/save-to-chart", () => ({ saveToChart: vi.fn(() => ({})) }));
vi.mock("../src/tools/generate-discharge-instructions", () => ({ generateDischargeInstructions: vi.fn(() => ({})) }));

vi.mock("../src/config", () => ({
  getDataSource: vi.fn(() => ({})),
  getAnthropicApiKey: vi.fn(() => "test-key"),
}));

vi.mock("../src/data/cached-datasource", () => ({
  CachedDataSource: vi.fn((ds: any) => ds),
}));

vi.mock("../src/verification/verification", () => ({
  applyVerification: vi.fn((response: string, toolCalls: any[]) => ({
    response,
    toolCalls,
    safetyAlerts: [],
  })),
}));

import type { StreamEvent } from "../src/agent";
import { applyVerification } from "../src/verification/verification";

const mockedApplyVerification = vi.mocked(applyVerification);

// Helper: collect all events from an async generator
async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("chatStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamEvents = vi.fn();
  });

  it("yields token events for each LLM text chunk", async () => {
    async function* fakeStream() {
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: { chunk: { content: "Hello " } },
      };
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: { chunk: { content: "world" } },
      };
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const events = await collectEvents(chatStream("test", "sess-1", history));

    const tokenEvents = events.filter((e) => e.type === "token");
    expect(tokenEvents).toHaveLength(2);
    expect(tokenEvents[0]).toEqual({ type: "token", content: "Hello " });
    expect(tokenEvents[1]).toEqual({ type: "token", content: "world" });
  });

  it("handles content blocks array format from Claude", async () => {
    async function* fakeStream() {
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: {
          chunk: {
            content: [{ type: "text", text: "block text" }],
          },
        },
      };
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const events = await collectEvents(chatStream("test", "sess-2", history));

    const tokenEvents = events.filter((e) => e.type === "token");
    expect(tokenEvents).toHaveLength(1);
    expect(tokenEvents[0]).toEqual({ type: "token", content: "block text" });
  });

  it("yields tool_start event when tool begins executing", async () => {
    async function* fakeStream() {
      yield {
        event: "on_tool_start",
        name: "get_patient_summary",
        run_id: "tool-run-1",
        data: { input: { patient_id: "1" } },
      };
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const events = await collectEvents(chatStream("test", "sess-3", history));

    const toolStartEvents = events.filter((e) => e.type === "tool_start");
    expect(toolStartEvents).toHaveLength(1);
    expect(toolStartEvents[0]).toEqual({
      type: "tool_start",
      tool: "get_patient_summary",
    });
  });

  it("yields tool_end event with duration when tool completes", async () => {
    async function* fakeStream() {
      yield {
        event: "on_tool_start",
        name: "get_medications",
        run_id: "tool-run-2",
        data: { input: { patient_id: "1" } },
      };
      // Simulate some delay
      await new Promise((r) => setTimeout(r, 10));
      yield {
        event: "on_tool_end",
        name: "get_medications",
        run_id: "tool-run-2",
        data: { output: '{"medications": []}' },
      };
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const events = await collectEvents(chatStream("test", "sess-4", history));

    const toolEndEvents = events.filter((e) => e.type === "tool_end");
    expect(toolEndEvents).toHaveLength(1);
    expect(toolEndEvents[0].type).toBe("tool_end");
    if (toolEndEvents[0].type === "tool_end") {
      expect(toolEndEvents[0].tool).toBe("get_medications");
      expect(toolEndEvents[0].duration_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("yields done event with full ChatResult after stream completes", async () => {
    async function* fakeStream() {
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: { chunk: { content: "Patient 1 is on warfarin." } },
      };
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const events = await collectEvents(chatStream("test message", "sess-5", history));

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents).toHaveLength(1);
    if (doneEvents[0].type === "done") {
      expect(doneEvents[0].result.response).toBe("Patient 1 is on warfarin.");
      expect(doneEvents[0].result.toolCalls).toEqual([]);
      expect(doneEvents[0].result.safetyAlerts).toEqual([]);
      expect(doneEvents[0].result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("collects tool calls from stream events in done result", async () => {
    async function* fakeStream() {
      yield {
        event: "on_tool_start",
        name: "get_patient_summary",
        run_id: "tool-run-1",
        data: { input: { patient_id: "1" } },
      };
      yield {
        event: "on_tool_end",
        name: "get_patient_summary",
        run_id: "tool-run-1",
        data: { output: '{"name": "John Demo"}' },
      };
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: { chunk: { content: "Here is the summary." } },
      };
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const events = await collectEvents(chatStream("test", "sess-6", history));

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "done") {
      expect(doneEvent.result.toolCalls).toHaveLength(1);
      expect(doneEvent.result.toolCalls[0].name).toBe("get_patient_summary");
    }
  });

  it("yields error event when stream throws", async () => {
    async function* fakeStream() {
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: { chunk: { content: "partial" } },
      };
      throw new Error("API rate limit exceeded");
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const events = await collectEvents(chatStream("test", "sess-7", history));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    if (errorEvents[0].type === "error") {
      expect(errorEvents[0].message).toContain("API rate limit exceeded");
    }
  });

  it("mutates history array with user and assistant messages", async () => {
    async function* fakeStream() {
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: { chunk: { content: "Response text" } },
      };
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    await collectEvents(chatStream("Hello doctor", "sess-8", history));

    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: "user", content: "Hello doctor" });
    expect(history[1]).toEqual({ role: "assistant", content: "Response text" });
  });

  it("skips empty content chunks without emitting token events", async () => {
    async function* fakeStream() {
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: { chunk: { content: "" } },
      };
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: { chunk: { content: "actual text" } },
      };
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const events = await collectEvents(chatStream("test", "sess-9", history));

    const tokenEvents = events.filter((e) => e.type === "token");
    expect(tokenEvents).toHaveLength(1);
    expect(tokenEvents[0]).toEqual({ type: "token", content: "actual text" });
  });

  it("handles interleaved tool and token events in correct order", async () => {
    async function* fakeStream() {
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: { chunk: { content: "Let me check " } },
      };
      yield {
        event: "on_tool_start",
        name: "get_lab_results",
        run_id: "tool-run-1",
        data: { input: { patient_id: "1" } },
      };
      yield {
        event: "on_tool_end",
        name: "get_lab_results",
        run_id: "tool-run-1",
        data: { output: '{"labs": []}' },
      };
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-2",
        data: { chunk: { content: "your labs." } },
      };
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const events = await collectEvents(chatStream("test", "sess-10", history));

    const types = events.map((e) => e.type);
    expect(types).toEqual(["token", "tool_start", "tool_end", "token", "done"]);
  });

  it("applies verification to accumulated text in done event", async () => {
    // Override the verification mock to add a disclaimer
    mockedApplyVerification.mockImplementation((response: string, toolCalls: any[]) => ({
      response: response + "\n\nDisclaimer: For reference only.",
      toolCalls,
      safetyAlerts: ["SCOPE WARNING: limited data"],
    }));

    async function* fakeStream() {
      yield {
        event: "on_chat_model_stream",
        name: "ChatAnthropic",
        run_id: "run-1",
        data: { chunk: { content: "Raw output" } },
      };
    }
    mockStreamEvents.mockReturnValue(fakeStream());

    const { chatStream } = await import("../src/agent");
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const events = await collectEvents(chatStream("test", "sess-11", history));

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "done") {
      expect(doneEvent.result.response).toContain("Disclaimer: For reference only.");
      expect(doneEvent.result.safetyAlerts).toContain("SCOPE WARNING: limited data");
    }

    // Restore default mock
    mockedApplyVerification.mockImplementation((response: string, toolCalls: any[]) => ({
      response,
      toolCalls,
      safetyAlerts: [],
    }));
  });
});
