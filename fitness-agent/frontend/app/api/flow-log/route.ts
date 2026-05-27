import { appendFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SECRET_KEY_PATTERN = /(authorization|cookie|token|password|secret|api.?key|auth.?token)/i;
const MAX_STRING_LENGTH = 1200;

function getRunLogDir() {
  const cwd = process.cwd();
  return basename(cwd).toLowerCase() === "frontend" ? resolve(cwd, "..", ".runlogs") : resolve(cwd, ".runlogs");
}

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...<truncated ${value.length - MAX_STRING_LENGTH} chars>`
      : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map(sanitize);
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? "<redacted>" : sanitize(item);
    }
    return output;
  }

  return value;
}

function writeFrontendFlowLog(event: string, payload: unknown) {
  const entry = {
    ts: new Date().toISOString(),
    source: "frontend",
    event,
    payload: sanitize(payload)
  };

  console.log(`[FLOW][frontend][${event}] ${JSON.stringify(entry.payload)}`);

  const logDir = getRunLogDir();
  mkdirSync(logDir, { recursive: true });
  appendFileSync(join(logDir, "flow.log"), `${JSON.stringify(entry)}\n`, "utf8");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const event = typeof body.event === "string" ? body.event : "event";

  writeFrontendFlowLog(event, body.payload ?? {});

  return NextResponse.json({ ok: true });
}
