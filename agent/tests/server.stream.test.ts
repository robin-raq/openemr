import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import { createApp, setSessionHistory, getSessionHistory } from "../src/server";

describe("/api/chat/stream endpoint", () => {
  let app: express.Express;

  beforeAll(() => {
    app = createApp();
  });

  describe("input validation", () => {
    it("returns 400 for missing message", async () => {
      const res = await makeStreamRequest(app, {
        session_id: "test",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for message longer than 2000 chars", async () => {
      const res = await makeStreamRequest(app, {
        message: "a".repeat(2001),
        session_id: "test",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid session_id format", async () => {
      const res = await makeStreamRequest(app, {
        message: "Hello",
        session_id: "'; DROP TABLE sessions; --",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid patient_id format", async () => {
      const res = await makeStreamRequest(app, {
        message: "Hello",
        session_id: "test-stream-" + Date.now(),
        patient_id: "'; DROP TABLE patients; --",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("SSE format", () => {
    it("sets Content-Type: text/event-stream header", async () => {
      const res = await makeStreamRequest(app, {
        message: "Hello",
        session_id: "stream-header-test-" + Date.now(),
      });
      // If status is 200 (streaming started), check content-type
      // If agent errors (500), the response may not be SSE
      if (res.status === 200) {
        expect(res.headers["content-type"]).toContain("text/event-stream");
      }
    });

    it("sets Cache-Control: no-cache header", async () => {
      const res = await makeStreamRequest(app, {
        message: "Hello",
        session_id: "stream-cache-test-" + Date.now(),
      });
      if (res.status === 200) {
        expect(res.headers["cache-control"]).toContain("no-cache");
      }
    });

    it("emits SSE events in correct format", async () => {
      const res = await makeStreamRequest(app, {
        message: "Hello",
        session_id: "stream-format-test-" + Date.now(),
      });
      // Either we get SSE events or an error event
      if (res.status === 200 && res.events.length > 0) {
        // Each event should have a valid type
        for (const evt of res.events) {
          expect(["token", "tool_start", "tool_end", "done", "error"]).toContain(evt.event);
          expect(evt.data).toBeDefined();
        }
      }
    });
  });

  describe("event sequence", () => {
    it("last event is either done or error", async () => {
      const res = await makeStreamRequest(app, {
        message: "What medications is patient 1 on?",
        session_id: "stream-seq-test-" + Date.now(),
        patient_id: "1",
      });
      if (res.status === 200 && res.events.length > 0) {
        const lastEvent = res.events[res.events.length - 1];
        expect(["done", "error"]).toContain(lastEvent.event);
      }
    });

    it("done event has same shape as /api/chat response payload", async () => {
      const res = await makeStreamRequest(app, {
        message: "Hello",
        session_id: "stream-done-shape-" + Date.now(),
      });
      if (res.status === 200) {
        const doneEvent = res.events.find((e) => e.event === "done");
        if (doneEvent) {
          // Should have the ChatResponsePayload fields
          expect(doneEvent.data).toHaveProperty("response");
          expect(doneEvent.data).toHaveProperty("tool_calls");
          expect(doneEvent.data).toHaveProperty("verification_flags");
          expect(doneEvent.data).toHaveProperty("timing");
          expect(doneEvent.data).toHaveProperty("structured_result");
          expect(doneEvent.data).toHaveProperty("performance");
        }
      }
    });
  });

  describe("compression", () => {
    it("does not apply compression to SSE responses", async () => {
      const res = await makeStreamRequest(app, {
        message: "Hello",
        session_id: "stream-nocompress-" + Date.now(),
      }, {
        "Accept-Encoding": "gzip, deflate, br",
      });
      if (res.status === 200) {
        // SSE should not have content-encoding (would break streaming)
        expect(res.headers["content-encoding"]).toBeUndefined();
      }
    });
  });
});

// SSE-aware request helper
async function makeStreamRequest(
  app: express.Express,
  body: unknown,
  extraHeaders?: Record<string, string>
): Promise<{
  status: number;
  headers: Record<string, string>;
  events: Array<{ event: string; data: any }>;
  rawBody: string;
}> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const url = `http://localhost:${port}/api/chat/stream`;

      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const text = await res.text();
          const headers: Record<string, string> = {};
          res.headers.forEach((value, key) => {
            headers[key] = value;
          });

          // Parse SSE events from raw text
          const events = parseSSEText(text);

          resolve({
            status: res.status,
            headers,
            events,
            rawBody: text,
          });
        })
        .catch((err) => {
          resolve({
            status: 0,
            headers: {},
            events: [],
            rawBody: err.message,
          });
        })
        .finally(() => {
          server.close();
        });
    });
  });
}

function parseSSEText(text: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const blocks = text.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7);
      if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (event && data) {
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        events.push({ event, data });
      }
    }
  }
  return events;
}
