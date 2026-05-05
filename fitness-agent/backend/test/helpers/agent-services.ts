import { PrismaService } from "../../src/prisma/prisma.service";
import { AppStoreService } from "../../src/store/app-store.service";
import { AgentActionExecutorService } from "../../src/services/agent-action-executor.service";
import { AgentPolicyService } from "../../src/services/agent-policy.service";
import { AgentProductEventService } from "../../src/services/agent-product-event.service";
import { AgentQualityService } from "../../src/services/agent-quality.service";
import { AgentStateService } from "../../src/services/agent-state.service";
import { AgentWorkItemService } from "../../src/services/agent-work-item.service";
import { CoachingOutcomeService } from "../../src/services/coaching-outcome.service";
import { CoachingStrategyService } from "../../src/services/coaching-strategy.service";

export function createAgentTestServices() {
  const prisma = new PrismaService();
  const outcomeService = new CoachingOutcomeService(prisma);
  const strategyService = new CoachingStrategyService(prisma);
  const appStore = new AppStoreService(prisma, outcomeService);
  const policyService = new AgentPolicyService();
  const productEvents = new AgentProductEventService(prisma);
  const qualityService = new AgentQualityService(prisma, appStore, policyService);
  const actionExecutor = new AgentActionExecutorService(appStore, outcomeService, policyService);
  const agentState = new AgentStateService(
    prisma,
    appStore,
    outcomeService,
    strategyService,
    policyService,
    qualityService,
    productEvents,
    actionExecutor
  );
  const workItems = new AgentWorkItemService(prisma, appStore, productEvents, agentState);

  return {
    prisma,
    appStore,
    agentState,
    outcomeService,
    strategyService,
    policyService,
    qualityService,
    productEvents,
    actionExecutor,
    workItems
  };
}
