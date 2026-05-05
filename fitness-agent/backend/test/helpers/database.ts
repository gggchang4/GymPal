import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { PrismaService } from "../../src/prisma/prisma.service";

type TestCallback = (context: TestContext) => void | Promise<void>;

let databaseProbe: Promise<{ ok: true } | { ok: false; reason: string }> | null = null;

export function loadBackendEnv() {
  const envPath = resolve(__dirname, "..", "..", ".env");
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}

export async function checkDatabaseAvailable() {
  loadBackendEnv();

  if (!process.env.DATABASE_URL) {
    return { ok: false as const, reason: "Set backend/.env DATABASE_URL to run real database tests." };
  }

  if (!databaseProbe) {
    databaseProbe = (async () => {
      const prisma = new PrismaService();
      try {
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
        return { ok: true as const };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown database connection error.";
        return { ok: false as const, reason: detail };
      } finally {
        await prisma.$disconnect().catch(() => undefined);
      }
    })();
  }

  return databaseProbe;
}

export function databaseTest(name: string, fn: TestCallback) {
  test(name, async (context) => {
    const availability = await checkDatabaseAvailable();
    if (!availability.ok) {
      if (process.env.REQUIRE_DATABASE_TESTS === "1") {
        throw new Error(`Database tests are required but the database is unavailable: ${availability.reason}`);
      }
      context.skip(`Database unavailable: ${availability.reason}`);
      return;
    }

    return fn(context);
  });
}

export async function cleanupTestUsers(prisma: PrismaService, runId: string) {
  await prisma.user.deleteMany({
    where: {
      email: {
        contains: runId
      }
    }
  });
}
