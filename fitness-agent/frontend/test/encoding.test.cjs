const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");
const test = require("node:test");

const sourceRoot = process.cwd();
const scanRoots = ["app", "components", "lib", "test"];
const sourceExtensions = new Set([".tsx", ".ts", ".css", ".cjs"]);
const mojibakePattern = /[\uFFFD\uE000-\uF8FF]|锛|銆|甯|澶|浣|鎴|绋|鍛|寤|€/u;

function extensionOf(path) {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

function collectSourceFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      if (entry === ".next" || entry === "node_modules") {
        continue;
      }

      files.push(...collectSourceFiles(path));
      continue;
    }

    if (sourceExtensions.has(extensionOf(path))) {
      if (entry === "encoding.test.cjs") {
        continue;
      }

      files.push(path);
    }
  }

  return files;
}

test("frontend source files do not contain common Chinese mojibake markers", () => {
  const findings = [];

  for (const root of scanRoots) {
    for (const file of collectSourceFiles(join(sourceRoot, root))) {
      const content = readFileSync(file, "utf8");
      const lines = content.split(/\r?\n/);

      lines.forEach((line, index) => {
        if (mojibakePattern.test(line)) {
          findings.push(`${relative(sourceRoot, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }

  assert.deepEqual(findings, []);
});
