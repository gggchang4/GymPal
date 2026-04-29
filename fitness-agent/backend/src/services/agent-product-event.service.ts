import { Injectable } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type TransactionClient = Prisma.TransactionClient | PrismaClient;

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class AgentProductEventService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    userId: string,
    input: {
      eventType: string;
      source: string;
      entityType?: string | null;
      entityId?: string | null;
      requestId?: string | null;
      sessionId?: string | null;
      payload?: Record<string, unknown>;
    },
    client?: TransactionClient
  ) {
    const db = client ?? this.prisma;
    return db.agentProductEvent.create({
      data: {
        userId,
        eventType: input.eventType,
        source: input.source,
        entityType: input.entityType ?? undefined,
        entityId: input.entityId ?? undefined,
        requestId: input.requestId ?? undefined,
        sessionId: input.sessionId ?? undefined,
        payload: asJson(input.payload ?? {})
      }
    });
  }
}
