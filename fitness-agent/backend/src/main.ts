import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

function loadBackendEnv() {
  const candidatePaths = [
    resolve(__dirname, "..", ".env"),
    resolve(__dirname, "..", "..", "..", ".env"),
    resolve(process.cwd(), "backend", ".env"),
    resolve(process.cwd(), ".env")
  ];
  const envPath = candidatePaths.find((candidate) => existsSync(candidate));
  if (!envPath) {
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

async function bootstrap() {
  loadBackendEnv();
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true
      }
    })
  );

  const port = Number(process.env.BACKEND_PORT ?? 3001);
  const host = process.env.BACKEND_HOST?.trim() || "0.0.0.0";

  await app.listen(port, host);
}

void bootstrap().catch((error) => {
  console.error("Backend bootstrap failed.", error);
  process.exit(1);
});
