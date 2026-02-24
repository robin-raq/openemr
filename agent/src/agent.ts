import { ChatAnthropic } from "@langchain/anthropic";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { getDataSource, getAnthropicApiKey } from "./config";
import { getPatientSummary } from "./tools/get-patient-summary";
import { getMedications } from "./tools/get-medications";
import { drugInteractionCheck } from "./tools/drug-interaction-check";
import { allergyCheck } from "./tools/allergy-check";
import { getLabResults } from "./tools/lab-results";
import { applyVerification } from "./verification/verification";

const AGENT_TIMEOUT_MS = 60_000;
const MAX_HISTORY_MESSAGES = 20;

const SYSTEM_PROMPT = `You are a clinical query assistant for OpenEMR, a healthcare electronic health records system.

You help clinicians look up patient information, review medication lists, check for drug interactions, check allergy cross-reactivity, and review lab results.

RULES:
- NEVER prescribe medications or recommend specific treatments
- NEVER diagnose conditions
- Always cite the data source (OpenEMR, OpenFDA) in your response
- If you find a serious drug interaction, prominently flag it as a safety concern
- If you find an allergy conflict, prominently flag it as a safety concern
- If you find critical lab values, prominently flag them
- If you don't have enough information, ask for clarification (e.g., ask for a patient ID)
- For medical emergencies, always recommend calling emergency services
- You are a data retrieval and safety checking tool, NOT a medical advisor

You have access to these tools:
- get_patient_summary: Look up patient demographics, conditions, medications, allergies
- get_medications: Get detailed medication list for a patient
- drug_interaction_check: Check for known interactions between medications
- allergy_check: Check if a proposed medication conflicts with patient allergies
- get_lab_results: Get recent lab results for a patient with flagged abnormal/critical values`;

const prompt = ChatPromptTemplate.fromMessages([
  ["system", SYSTEM_PROMPT],
  new MessagesPlaceholder("chat_history"),
  ["human", "{input}"],
  new MessagesPlaceholder("agent_scratchpad"),
]);

function createAgentExecutor() {
  const dataSource = getDataSource();
  const tools = [
    getPatientSummary(dataSource),
    getMedications(dataSource),
    drugInteractionCheck(),
    allergyCheck(dataSource),
    getLabResults(dataSource),
  ];

  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0,
    anthropicApiKey: getAnthropicApiKey(),
  });

  const agent = createToolCallingAgent({ llm, tools, prompt });
  return AgentExecutor.fromAgentAndTools({
    agent,
    tools,
    returnIntermediateSteps: true,
    maxIterations: 10,
  });
}

let executor: AgentExecutor | null = null;

export function getExecutor(): AgentExecutor {
  if (!executor) {
    executor = createAgentExecutor();
  }
  return executor;
}

export function resetExecutor(): void {
  executor = null;
}

export interface ChatResult {
  response: string;
  toolCalls: Array<{ name: string; args: unknown; result?: string }>;
  safetyAlerts: string[];
}

export async function chat(
  message: string,
  sessionId: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  callbacks?: unknown[]
): Promise<ChatResult> {
  // Cap history to prevent context overflow
  const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
  const chatHistory = recentHistory.flatMap((h) =>
    h.role === "user"
      ? [new HumanMessage(h.content)]
      : [new AIMessage(h.content)]
  );

  const exec = getExecutor();
  const config: { callbacks?: unknown[] } = {};
  if (callbacks && callbacks.length > 0) {
    config.callbacks = callbacks;
  }

  try {
    const resultPromise = exec.invoke(
      {
        input: message,
        chat_history: chatHistory,
      },
      config
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Agent timed out after ${AGENT_TIMEOUT_MS / 1000} seconds`)), AGENT_TIMEOUT_MS)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);

    const toolCalls: Array<{ name: string; args: unknown; result?: string }> = [];
    const intermediateSteps = result.intermediateSteps || [];

    for (const step of intermediateSteps) {
      if (step.action?.tool) {
        toolCalls.push({
          name: step.action.tool,
          args: step.action.toolInput,
          result: step.observation?.toString?.(),
        });
      }
    }

    const rawOutput = result.output ?? "";
    let output: string;
    if (typeof rawOutput === "string") {
      output = rawOutput;
    } else if (Array.isArray(rawOutput)) {
      // Claude may return content blocks: [{type:"text", text:"..."}]
      output = rawOutput
        .filter((block: { type?: string }) => block.type === "text")
        .map((block: { text?: string }) => block.text || "")
        .join("\n");
    } else {
      output = String(rawOutput);
    }
    const verification = applyVerification(output, toolCalls);

    // Mutate history so callers can track conversation
    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: verification.response });

    return {
      response: verification.response,
      toolCalls: verification.toolCalls,
      safetyAlerts: verification.safetyAlerts,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`Agent error [${sessionId}]:`, errorMessage);

    const verification = applyVerification(
      `I encountered an error processing your request: ${errorMessage}. Please try again.`,
      []
    );

    return {
      response: verification.response,
      toolCalls: [],
      safetyAlerts: verification.safetyAlerts,
    };
  }
}
