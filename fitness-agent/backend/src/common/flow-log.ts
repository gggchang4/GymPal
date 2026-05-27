import { appendFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const SECRET_KEY_PATTERN = /(authorization|cookie|token|password|secret|api.?key|auth.?token)/i;
const MAX_STRING_LENGTH = 1200;
const MAX_ARRAY_ITEMS = 12;
const MAX_OBJECT_KEYS = 40;

function getRunLogDir() {
  const cwd = process.cwd();
  return basename(cwd).toLowerCase() === "backend" ? resolve(cwd, "..", ".runlogs") : resolve(cwd, ".runlogs");
}

function truncate(text: string) {
  if (text.length <= MAX_STRING_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_STRING_LENGTH)}...<truncated ${text.length - MAX_STRING_LENGTH} chars>`;
}

function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  if (typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "<circular>";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactValue(item, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`<truncated ${value.length - MAX_ARRAY_ITEMS} items>`);
    }
    return items;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
  for (const [key, item] of entries) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "<redacted>" : redactValue(item, seen);
  }

  const keyCount = Object.keys(value as Record<string, unknown>).length;
  if (keyCount > MAX_OBJECT_KEYS) {
    output.__truncated_keys = keyCount - MAX_OBJECT_KEYS;
  }

  return output;
}

export function writeFlowLog(source: string, event: string, payload: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    source,
    event,
    payload: redactValue(payload)
  };
  const terminalLine = `[FLOW][${source}][${event}] ${JSON.stringify(entry.payload)}`;

  console.log(terminalLine);

  try {
    const logDir = getRunLogDir();
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, "flow.log"), `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.warn("[FLOW] Failed to write flow.log", error);
  }
}
