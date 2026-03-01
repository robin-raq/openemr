/**
 * UI Helper Functions
 *
 * Pure functions shared between the test suite and the frontend (index.html).
 * These are inlined in the HTML for the browser, but importable for TDD.
 */

export interface PatientInfo {
  name: string;
  detail: string;
}

/** Mock patient metadata for the 4 demo patients. */
export const PATIENT_INFO: Record<string, PatientInfo> = {
  "1": {
    name: "John Demo",
    detail: "DOB: 03/15/1958 | Male | Conditions: AFib, HTN, T2DM, Hyperlipidemia, GERD",
  },
  "2": {
    name: "Jane Minimal",
    detail: "DOB: 07/22/1985 | Female | No active conditions",
  },
  "3": {
    name: "Bob Allergic",
    detail: "DOB: 11/03/1972 | Male | Conditions: HTN | Multiple drug allergies",
  },
  "4": {
    name: "Sara Complex",
    detail: "DOB: 05/28/1945 | Female | Multi-morbidity: AFib, HTN, T2DM, CKD",
  },
};

/**
 * Look up patient context for a given patient ID.
 * Returns null if the ID is empty, undefined, or not found.
 */
export function getPatientContext(
  patientId: string | undefined | null
): PatientInfo | null {
  if (!patientId) return null;
  return PATIENT_INFO[patientId] ?? null;
}

// --- Chat History Helpers ---

export const MAX_SAVED_CHATS = 20;

export interface ChatIndexEntry {
  id: string;
  patient_id: string;
  patient_name: string;
  title: string;
  created_at: string;
  message_count: number;
}

/**
 * Create a chat index entry for saving to history.
 * Title is truncated to 50 chars.
 */
export function createChatIndexEntry(
  sessionId: string,
  patientId: string | undefined | null,
  firstMessage: string,
  messageCount = 0
): ChatIndexEntry {
  const pid = patientId || "";
  return {
    id: sessionId,
    patient_id: pid,
    patient_name: PATIENT_INFO[pid]?.name || "No Patient",
    title: firstMessage.slice(0, 50),
    created_at: new Date().toISOString(),
    message_count: messageCount,
  };
}

/**
 * Trim chat index to MAX_SAVED_CHATS, keeping the first entries (most recent).
 */
export function trimChatIndex(index: ChatIndexEntry[]): ChatIndexEntry[] {
  return index.slice(0, MAX_SAVED_CHATS);
}

// --- HTML / Markdown Helpers ---

/**
 * Escape HTML special characters for safe insertion into the DOM.
 * Handles &, <, >, ", and ' to prevent XSS.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Lightweight inline markdown renderer — no external deps.
 * Escapes HTML first (XSS-safe), then applies markdown transforms.
 *
 * Supported syntax:
 *   # / ## / ### headings
 *   **bold**, *italic*
 *   - unordered lists, 1. ordered lists
 *   --- horizontal rules
 *   Double newline → paragraph break, single newline → <br>
 */
export function renderMarkdown(text: string): string {
  // 1. Escape HTML first
  let html = escapeHtml(text);

  // 2. Split into lines for block-level processing
  const lines = html.split("\n");
  const blocks: string[] = [];
  let currentList: { type: "ul" | "ol"; items: string[] } | null = null;

  function flushList() {
    if (currentList) {
      const tag = currentList.type;
      const inner = currentList.items
        .map((item) => `<li>${item}</li>`)
        .join("");
      blocks.push(`<${tag}>${inner}</${tag}>`);
      currentList = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Horizontal rule: --- (standalone)
    if (/^-{3,}$/.test(line.trim())) {
      flushList();
      blocks.push("<hr>");
      continue;
    }

    // Headings: ### before ## before #
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      flushList();
      blocks.push(`<h4 class="md-h4">${h3Match[1]}</h4>`);
      continue;
    }
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flushList();
      blocks.push(`<h3 class="md-h3">${h2Match[1]}</h3>`);
      continue;
    }
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      flushList();
      blocks.push(`<h2 class="md-h2">${h1Match[1]}</h2>`);
      continue;
    }

    // Unordered list: - item
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (currentList && currentList.type !== "ul") flushList();
      if (!currentList) currentList = { type: "ul", items: [] };
      currentList.items.push(ulMatch[1]);
      continue;
    }

    // Ordered list: 1. item
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (currentList && currentList.type !== "ol") flushList();
      if (!currentList) currentList = { type: "ol", items: [] };
      currentList.items.push(olMatch[1]);
      continue;
    }

    // Not a list line — flush any open list
    flushList();

    // Empty line → paragraph break marker
    if (line.trim() === "") {
      blocks.push("__PARA_BREAK__");
      continue;
    }

    // Regular text line
    blocks.push(line);
  }
  flushList();

  // 3. Group consecutive text lines into paragraphs
  const output: string[] = [];
  let paraLines: string[] = [];

  function flushPara() {
    if (paraLines.length > 0) {
      output.push(`<p class="md-p">${paraLines.join("<br>")}</p>`);
      paraLines = [];
    }
  }

  for (const block of blocks) {
    if (block === "__PARA_BREAK__") {
      flushPara();
    } else if (
      block.startsWith("<h") ||
      block.startsWith("<ul>") ||
      block.startsWith("<ol>") ||
      block.startsWith("<hr")
    ) {
      flushPara();
      output.push(block);
    } else {
      paraLines.push(block);
    }
  }
  flushPara();

  // 4. Apply inline formatting (bold, italic)
  let result = output.join("");
  // Bold: **text** (must come before italic)
  result = result.replace(
    /\*\*(.+?)\*\*/g,
    "<strong>$1</strong>"
  );
  // Italic: *text* (but not inside <strong>)
  result = result.replace(
    /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
    "<em>$1</em>"
  );

  return result;
}
