#!/usr/bin/env node

const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { PrismaClient } = require("@prisma/client");
const iconv = require("iconv-lite");

function loadBackendEnv() {
  const envPath = resolve(__dirname, "..", ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

const suspiciousMojibakePattern = /[涓鍒鏍璁鎭缁冨垝寰懆鏁欏厛鏍規嵁杩戞湡鐢熸垚鏉℃暀缁冨缓鏃瀹夋帓寰呰ˉ鍏浼淇濊瘉鎭㈠璐ㄩ噺]/u;
const cjkPattern = /[\u3400-\u9fff]/u;

function normalizeRecoveredChinese(value) {
  return value
    .replace(/^训练\?\s*(\d+)$/u, "训练日 $1")
    .replace(/待补\?$/u, "待补充")
    .replace(/建议\?$/u, "建议。")
    .replace(/质量\?$/u, "质量。")
    .replace(/^训练\?$/u, "训练日");
}

function repairMojibakeString(value) {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  if (!normalized || !suspiciousMojibakePattern.test(normalized)) {
    return value;
  }

  const fixed = iconv.encode(value, "gbk").toString("utf8");
  const cleaned = normalizeRecoveredChinese(fixed.replace(/\uFFFD+/gu, "").trim());
  if (cleaned === value || !cleaned || !cjkPattern.test(cleaned)) {
    return value;
  }

  return cleaned;
}

function repairValue(value, path = [], changes = []) {
  if (typeof value === "string") {
    const repaired = repairMojibakeString(value);
    if (repaired !== value) {
      changes.push({
        path: path.join("."),
        before: value,
        after: repaired,
      });
    }
    return repaired;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const repaired = value.map((item, index) => {
      const next = repairValue(item, [...path, String(index)], changes);
      if (next !== item) {
        changed = true;
      }
      return next;
    });

    return changed ? repaired : value;
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    let changed = false;
    const repaired = {};

    for (const [key, entry] of Object.entries(value)) {
      const next = repairValue(entry, [...path, key], changes);
      if (next !== entry) {
        changed = true;
      }
      repaired[key] = next;
    }

    return changed ? repaired : value;
  }

  return value;
}

function summarizeChanges(label, id, changes) {
  return changes.map((change) => ({
    model: label,
    id,
    field: change.path,
    before: change.before,
    after: change.after,
  }));
}

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply"),
    selfTest: argv.includes("--self-test"),
  };
}

function runSelfTest() {
  const makeMojibake = (value) => iconv.decode(Buffer.from(value, "utf8"), "gbk");

  const sample = {
    title: makeMojibake("下周教练计划"),
    summary: makeMojibake("根据近期数据生成了一条教练建议。"),
    preview: {
      dayLabel: `${makeMojibake("训练日")} 1`,
      focus: makeMojibake("训练安排待补充"),
      recoveryTip: makeMojibake("优先保证恢复质量。"),
    },
  };

  const changes = [];
  const repaired = repairValue(sample, [], changes);

  console.log(JSON.stringify({ sample, repaired, changes }, null, 2));
}

const repairTargets = [
  {
    label: "user",
    select: { id: true, name: true },
    list: (prisma) => prisma.user.findMany({ select: { id: true, name: true } }),
    update: (prisma, id, data) => prisma.user.update({ where: { id }, data }),
  },
  {
    label: "healthProfile",
    select: { id: true, limitations: true },
    list: (prisma) => prisma.healthProfile.findMany({ select: { id: true, limitations: true } }),
    update: (prisma, id, data) => prisma.healthProfile.update({ where: { id }, data }),
  },
  {
    label: "workoutLog",
    select: { id: true, exerciseNote: true, painFeedback: true, fatigueAfter: true },
    list: (prisma) =>
      prisma.workoutLog.findMany({
        select: { id: true, exerciseNote: true, painFeedback: true, fatigueAfter: true },
      }),
    update: (prisma, id, data) => prisma.workoutLog.update({ where: { id }, data }),
  },
  {
    label: "workoutPlan",
    select: { id: true, title: true },
    list: (prisma) => prisma.workoutPlan.findMany({ select: { id: true, title: true } }),
    update: (prisma, id, data) => prisma.workoutPlan.update({ where: { id }, data }),
  },
  {
    label: "workoutPlanDay",
    select: {
      id: true,
      dayLabel: true,
      focus: true,
      duration: true,
      exercises: true,
      recoveryTip: true,
    },
    list: (prisma) =>
      prisma.workoutPlanDay.findMany({
        select: {
          id: true,
          dayLabel: true,
          focus: true,
          duration: true,
          exercises: true,
          recoveryTip: true,
        },
      }),
    update: (prisma, id, data) => prisma.workoutPlanDay.update({ where: { id }, data }),
  },
  {
    label: "dietRecommendationSnapshot",
    select: {
      id: true,
      agentTips: true,
      nutritionDetail: true,
      meals: true,
    },
    list: (prisma) =>
      prisma.dietRecommendationSnapshot.findMany({
        select: {
          id: true,
          agentTips: true,
          nutritionDetail: true,
          meals: true,
        },
      }),
    update: (prisma, id, data) => prisma.dietRecommendationSnapshot.update({ where: { id }, data }),
  },
  {
    label: "adviceSnapshot",
    select: {
      id: true,
      summary: true,
      reasoningTags: true,
      actionItems: true,
      riskFlags: true,
    },
    list: (prisma) =>
      prisma.adviceSnapshot.findMany({
        select: {
          id: true,
          summary: true,
          reasoningTags: true,
          actionItems: true,
          riskFlags: true,
        },
      }),
    update: (prisma, id, data) => prisma.adviceSnapshot.update({ where: { id }, data }),
  },
  {
    label: "agentThread",
    select: { id: true, title: true, summary: true },
    list: (prisma) => prisma.agentThread.findMany({ select: { id: true, title: true, summary: true } }),
    update: (prisma, id, data) => prisma.agentThread.update({ where: { id }, data }),
  },
  {
    label: "agentMessage",
    select: { id: true, content: true, reasoning: true, cards: true },
    list: (prisma) =>
      prisma.agentMessage.findMany({
        select: { id: true, content: true, reasoning: true, cards: true },
      }),
    update: (prisma, id, data) => prisma.agentMessage.update({ where: { id }, data }),
  },
  {
    label: "coachingReviewSnapshot",
    select: {
      id: true,
      title: true,
      summary: true,
      riskFlags: true,
      focusAreas: true,
      recommendationTags: true,
      inputSnapshot: true,
      resultSnapshot: true,
    },
    list: (prisma) =>
      prisma.coachingReviewSnapshot.findMany({
        select: {
          id: true,
          title: true,
          summary: true,
          riskFlags: true,
          focusAreas: true,
          recommendationTags: true,
          inputSnapshot: true,
          resultSnapshot: true,
        },
      }),
    update: (prisma, id, data) => prisma.coachingReviewSnapshot.update({ where: { id }, data }),
  },
  {
    label: "agentActionProposal",
    select: {
      id: true,
      title: true,
      summary: true,
      payload: true,
      preview: true,
    },
    list: (prisma) =>
      prisma.agentActionProposal.findMany({
        select: {
          id: true,
          title: true,
          summary: true,
          payload: true,
          preview: true,
        },
      }),
    update: (prisma, id, data) => prisma.agentActionProposal.update({ where: { id }, data }),
  },
  {
    label: "agentProposalGroup",
    select: { id: true, title: true, summary: true, preview: true },
    list: (prisma) =>
      prisma.agentProposalGroup.findMany({
        select: { id: true, title: true, summary: true, preview: true },
      }),
    update: (prisma, id, data) => prisma.agentProposalGroup.update({ where: { id }, data }),
  },
  {
    label: "placeRecommendationSnapshot",
    select: { id: true, query: true, title: true, address: true },
    list: (prisma) =>
      prisma.placeRecommendationSnapshot.findMany({
        select: { id: true, query: true, title: true, address: true },
      }),
    update: (prisma, id, data) => prisma.placeRecommendationSnapshot.update({ where: { id }, data }),
  },
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }

  loadBackendEnv();
  const prisma = new PrismaClient();

  try {
    const summary = [];
    let touchedRows = 0;

    for (const target of repairTargets) {
      const rows = await target.list(prisma);

      for (const row of rows) {
        const updateData = {};
        const rowChanges = [];

        for (const [field, value] of Object.entries(row)) {
          if (field === "id" || value === null || value === undefined) {
            continue;
          }

          const repaired = repairValue(value, [field], rowChanges);
          if (repaired !== value) {
            updateData[field] = repaired;
          }
        }

        if (Object.keys(updateData).length === 0) {
          continue;
        }

        touchedRows += 1;
        summary.push(...summarizeChanges(target.label, row.id, rowChanges));

        if (options.apply) {
          await target.update(prisma, row.id, updateData);
        }
      }
    }

    const modeLabel = options.apply ? "APPLY" : "DRY RUN";
    console.log(`[${modeLabel}] scanned ${repairTargets.length} model(s), matched ${touchedRows} row(s).`);

    if (summary.length === 0) {
      console.log("No probable Chinese mojibake was found.");
      return;
    }

    for (const item of summary) {
      console.log(`- ${item.model}:${item.id} ${item.field}`);
      console.log(`  before: ${JSON.stringify(item.before)}`);
      console.log(`  after:  ${JSON.stringify(item.after)}`);
    }

    if (!options.apply) {
      console.log("");
      console.log("Run again with --apply to write the repaired values back to PostgreSQL.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to scan/repair Chinese mojibake: ${message}`);
  if (message.includes("Can't reach database server")) {
    console.error("Start PostgreSQL first, then rerun `npm run db:encoding:check` or `npm run db:encoding:repair`.");
  }
  process.exit(1);
});
