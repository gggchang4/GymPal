import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(__dirname, "..", "..");
const scanRoots = [
  "backend/src",
  "backend/test",
  "agent/app",
  "frontend/app",
  "frontend/components",
  "frontend/lib",
  "frontend/test"
];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".cjs", ".py", ".css"]);
const secretScanExtensions = new Set([
  ".cjs",
  ".css",
  ".env",
  ".example",
  ".js",
  ".json",
  ".md",
  ".prisma",
  ".py",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml"
]);
const rawSecretPatterns = [
  { name: "OpenAI-compatible API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "JWT token", pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ }
];
const sensitiveAssignmentPattern =
  /^\s*(LLM_API_KEY|OPENAI_API_KEY|DEEPSEEK_API_KEY|AMAP_API_KEY|JWT_SECRET|DATABASE_URL)\s*=\s*([^#\s]+)/;
const mojibakePattern = /[\uFFFD\uE000-\uF8FF]|锛|銆|甯|澶|浣|鎴|绋|鍛|寤|閿|婢|娴|鈧|涓嬪|鏁欑|璁|鎵ц|宸茬|缁х/u;

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".next" || entry === ".venv") {
        continue;
      }
      files.push(...collectSourceFiles(path));
      continue;
    }

    if (sourceExtensions.has(extname(path))) {
      if (path.endsWith(join("backend", "test", "source-hygiene.test.ts")) || path.endsWith(join("frontend", "test", "encoding.test.cjs"))) {
        continue;
      }
      files.push(path);
    }
  }

  return files;
}

function trackedTextFiles(): string[] {
  const output = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => secretScanExtensions.has(extname(path)));
}

function isPlaceholderSecretValue(value: string): boolean {
  const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
  return (
    cleaned === "" ||
    /^(replace-me|your[_-].*|example|changeme|dummy)$/i.test(cleaned) ||
    /replace-me|YOUR_|localhost|127\.0\.0\.1/i.test(cleaned)
  );
}

test("source files do not contain mojibake, replacement characters, or private-use glyphs", () => {
  const findings: string[] = [];

  for (const root of scanRoots) {
    for (const file of collectSourceFiles(join(repoRoot, root))) {
      const content = readFileSync(file, "utf8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (mojibakePattern.test(line)) {
          findings.push(`${relative(repoRoot, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }

  assert.deepEqual(findings, []);
});

test("tracked text files do not contain committed secrets", () => {
  const findings: string[] = [];

  for (const file of trackedTextFiles()) {
    const content = readFileSync(join(repoRoot, file), "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const { name, pattern } of rawSecretPatterns) {
        if (pattern.test(line)) {
          findings.push(`${file}:${index + 1}: ${name}`);
        }
      }

      const assignment = line.match(sensitiveAssignmentPattern);
      if (assignment && !isPlaceholderSecretValue(assignment[2])) {
        findings.push(`${file}:${index + 1}: hard-coded ${assignment[1]}`);
      }
    });
  }

  assert.deepEqual(findings, []);
});
