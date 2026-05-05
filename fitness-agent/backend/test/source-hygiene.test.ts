import * as assert from "node:assert/strict";
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
