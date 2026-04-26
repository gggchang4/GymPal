import { Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface HealthProfileRecord {
  age?: number;
  gender?: string;
  heightCm?: number;
  currentWeightKg?: number;
  targetWeightKg?: number;
  activityLevel?: string;
  trainingExperience?: string;
  trainingDaysPerWeek?: number;
  equipmentAccess?: string;
  limitations?: string;
}

export interface BodyMetricRecord {
  userId: string;
  weightKg: number;
  bodyFatPct?: number;
  waistCm?: number;
}

export interface DailyCheckinRecord {
  userId: string;
  sleepHours: number;
  waterMl: number;
  steps: number;
  energyLevel?: string;
  fatigueLevel?: string;
  hungerLevel?: string;
}

export interface WorkoutLogRecord {
  userId: string;
  workoutType: string;
  durationMin: number;
  intensity: string;
  exerciseNote?: string;
  completion?: string;
  painFeedback?: string;
  fatigueAfter?: string;
}

export interface WorkoutPlanDayRecord {
  id: string;
  dayLabel: string;
  focus: string;
  duration: string;
  exercises: string[];
  recoveryTip: string;
  isCompleted: boolean;
  sortOrder: number;
  updatedAt?: string;
}

export interface CurrentPlanSnapshotRecord {
  plan: {
    id: string;
    title: string;
    goal: string;
    status: string;
    version: number;
    weekOf: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  days: WorkoutPlanDayRecord[];
}

export interface CreateWorkoutPlanDayPayload {
  dayLabel: string;
  focus: string;
  duration: string;
  exercises: string[];
  recoveryTip: string;
}

export interface UpdateWorkoutPlanDayPayload {
  dayLabel?: string;
  focus?: string;
  duration?: string;
  exercises?: string[];
  recoveryTip?: string;
  isCompleted?: boolean;
}

export interface GeneratedWorkoutPlanDayPayload {
  dayLabel: string;
  focus: string;
  duration: string;
  exercises: string[];
  recoveryTip: string;
  isCompleted?: boolean;
  sortOrder?: number;
}

export interface GeneratedWorkoutPlanPayload {
  title: string;
  goal: string;
  weekOf?: string;
  days: GeneratedWorkoutPlanDayPayload[];
}

export interface GeneratedDietRecommendationPayload {
  date?: string;
  userGoal: string;
  totalCalorie: number;
  targetCalorie: number;
  nutritionRatio: {
    carbohydrate: number;
    protein: number;
    fat: number;
  };
  nutritionDetail: Record<string, unknown>;
  meals: Record<string, unknown>[];
  agentTips: string[];
}

export interface GeneratedAdvicePayload {
  type: string;
  priority: string;
  summary: string;
  reasoningTags: string[];
  actionItems: string[];
  riskFlags: string[];
}

export interface CoachSummaryRecord {
  currentPlan: CurrentPlanSnapshotRecord;
  completion: {
    completedDays: number;
    totalDays: number;
    completionRate: number;
  };
  recentBodyMetrics: Awaited<ReturnType<AppStoreService["getBodyMetrics"]>>;
  recentDailyCheckins: Awaited<ReturnType<AppStoreService["getDailyCheckins"]>>;
  recentWorkoutLogs: Awaited<ReturnType<AppStoreService["getWorkoutLogs"]>>;
  latestDietRecommendation: Awaited<ReturnType<AppStoreService["getTodayDietRecommendation"]>> | null;
  recentAdviceSnapshots: Awaited<ReturnType<AppStoreService["getRecentAdviceSnapshots"]>>;
  pendingCoachingPackage: {
    id: string;
    threadId: string;
    title: string;
    summary: string;
    status: string;
    createdAt: string;
  } | null;
  needsWeeklyReview: boolean;
}

type DbClient = Prisma.TransactionClient | PrismaClient | PrismaService;

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeDateToDay(input: Date) {
  const result = new Date(input);
  result.setHours(0, 0, 0, 0);
  return result;
}

function sanitizeStringArray(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizePlanString(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function mapWorkoutPlanDay(day: {
  id: string;
  dayLabel: string;
  focus: string;
  duration: string;
  exercises: unknown;
  recoveryTip: string;
  isCompleted: boolean;
  sortOrder: number;
  updatedAt?: Date;
}): WorkoutPlanDayRecord {
  return {
    id: day.id,
    dayLabel: day.dayLabel,
    focus: day.focus,
    duration: day.duration,
    exercises: sanitizeStringArray(day.exercises),
    recoveryTip: day.recoveryTip,
    isCompleted: day.isCompleted,
    sortOrder: day.sortOrder,
    updatedAt: day.updatedAt?.toISOString()
  };
}

function buildPlanDays() {
  return [
    {
      dayLabel: "Monday",
      focus: "Upper body strength + core",
      duration: "55 min",
      exercises: ["Bench press 4x8", "Lat pulldown 4x10", "DB shoulder press 3x10", "Plank 3 rounds"],
      recoveryTip: "Hydrate after training and stretch the upper body before bed.",
      isCompleted: false,
      sortOrder: 0
    },
    {
      dayLabel: "Wednesday",
      focus: "Knee-friendly lower body",
      duration: "50 min",
      exercises: ["Box squat 4x8", "Romanian deadlift 4x10", "Glute bridge 3x12"],
      recoveryTip: "Reduce squat depth and keep the day submaximal if the knee feels irritated.",
      isCompleted: false,
      sortOrder: 1
    },
    {
      dayLabel: "Friday",
      focus: "Low-intensity cardio + core",
      duration: "40 min",
      exercises: ["Incline walk 30 min", "Dead bug 3x12", "Side plank 3x30 sec"],
      recoveryTip: "Prioritize total steps and avoid adding extra fatigue.",
      isCompleted: false,
      sortOrder: 2
    },
    {
      dayLabel: "Sunday",
      focus: "Full-body consistency session",
      duration: "50 min",
      exercises: ["Goblet squat 4x10", "Seated row 4x10", "Push-up 3x12", "Hip mobility 8 min"],
      recoveryTip: "Keep 1-2 reps in reserve on every movement.",
      isCompleted: false,
      sortOrder: 3
    }
  ];
}

@Injectable()
export class AppStoreService {
  private readonly logger = new Logger(AppStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  private db(client?: DbClient) {
    return client ?? this.prisma;
  }

  async createUser(email: string, password: string, name?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (name && existing.name !== name.trim()) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { name: name.trim() }
        });
      }
      return existing;
    }

    return this.prisma.user.create({
      data: {
        name: name?.trim() ?? "",
        email,
        passwordHash: password,
        healthProfile: {
          create: {}
        }
      }
    });
  }

  async authenticate(email: string, password: string) {
    return this.prisma.user.findFirst({
      where: {
        email,
        passwordHash: password
      }
    });
  }

  async getUser(userId?: string) {
    if (!userId) {
      throw new UnauthorizedException("Authentication required.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { healthProfile: true }
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    this.logger.log(
      `Loaded user from PostgreSQL id=${user.id} email=${user.email} via authenticated token`
    );

    return user;
  }

  async getProfile(userId?: string) {
    const user = await this.getUser(userId);
    return user.healthProfile;
  }

  async updateProfile(userId: string, payload: Partial<HealthProfileRecord>) {
    return this.prisma.healthProfile.upsert({
      where: { userId },
      update: payload,
      create: {
        userId,
        ...payload
      }
    });
  }

  async addBodyMetric(payload: BodyMetricRecord) {
    return this.prisma.bodyMetricLog.create({
      data: {
        userId: payload.userId,
        weightKg: payload.weightKg,
        bodyFatPct: payload.bodyFatPct,
        waistCm: payload.waistCm
      }
    });
  }

  async getBodyMetrics(userId?: string) {
    const user = await this.getUser(userId);
    const metrics = await this.prisma.bodyMetricLog.findMany({
      where: { userId: user.id },
      orderBy: { recordedAt: "desc" }
    });
    this.logger.log(`Loaded ${metrics.length} body metric record(s) from PostgreSQL for user=${user.id}`);
    return metrics;
  }

  async addDailyCheckin(payload: DailyCheckinRecord) {
    return this.prisma.dailyCheckin.create({
      data: payload
    });
  }

  async getDailyCheckins(userId?: string) {
    const user = await this.getUser(userId);
    const checkins = await this.prisma.dailyCheckin.findMany({
      where: { userId: user.id },
      orderBy: { recordedAt: "desc" }
    });
    this.logger.log(`Loaded ${checkins.length} daily check-in record(s) from PostgreSQL for user=${user.id}`);
    return checkins;
  }

  async addWorkoutLog(payload: WorkoutLogRecord) {
    return this.prisma.workoutLog.create({
      data: payload
    });
  }

  async getWorkoutLogs(userId?: string) {
    const user = await this.getUser(userId);
    const logs = await this.prisma.workoutLog.findMany({
      where: { userId: user.id },
      orderBy: { recordedAt: "desc" }
    });
    this.logger.log(`Loaded ${logs.length} workout log record(s) from PostgreSQL for user=${user.id}`);
    return logs;
  }

  async getCurrentPlan(userId?: string) {
    const user = await this.getUser(userId);
    const plan = await this.prisma.workoutPlan.findFirst({
      where: { userId: user.id, status: "active" },
      orderBy: [{ updatedAt: "desc" }, { weekOf: "desc" }, { createdAt: "desc" }],
      include: {
        days: {
          orderBy: [{ sortOrder: "asc" }, { dayLabel: "asc" }]
        }
      }
    });
    this.logger.log(
      `Loaded current workout plan from PostgreSQL for user=${user.id} found=${plan ? "yes" : "no"}`
    );
    return plan;
  }

  async getCurrentPlanDays(userId?: string) {
    const plan = await this.getCurrentPlan(userId);
    return (plan?.days ?? []).map(mapWorkoutPlanDay);
  }

  async getCurrentPlanSnapshot(userId?: string): Promise<CurrentPlanSnapshotRecord> {
    const plan = await this.getCurrentPlan(userId);

    if (!plan) {
      return {
        plan: null,
        days: []
      };
    }

    return {
      plan: {
        id: plan.id,
        title: plan.title,
        goal: plan.goal,
        status: plan.status,
        version: plan.version,
        weekOf: plan.weekOf.toISOString(),
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString()
      },
      days: plan.days.map((day) =>
        mapWorkoutPlanDay({
          ...day,
          updatedAt: day.updatedAt
        })
      )
    };
  }

  private async createEmptyCurrentPlan(userId: string) {
    return this.prisma.workoutPlan.create({
      data: {
        userId,
        title: "Current editable plan",
        goal: "maintenance",
        weekOf: normalizeDateToDay(new Date()),
        version: 1,
        status: "active"
      },
      include: {
        days: {
          orderBy: [{ sortOrder: "asc" }, { dayLabel: "asc" }]
        }
      }
    });
  }

  private async getOrCreateEditableCurrentPlan(userId?: string) {
    const user = await this.getUser(userId);
    const existingPlan = await this.getCurrentPlan(user.id);

    if (existingPlan) {
      return existingPlan;
    }

    this.logger.log(`No active plan found for user=${user.id}; creating an empty editable plan.`);
    return this.createEmptyCurrentPlan(user.id);
  }

  private async getRequiredCurrentPlan(userId?: string) {
    const plan = await this.getCurrentPlan(userId);
    if (!plan) {
      throw new NotFoundException("No active workout plan found. Generate a plan first.");
    }

    return plan;
  }

  private async getEditableCurrentPlanDay(dayId: string, userId?: string) {
    const user = await this.getUser(userId);
    const day = await this.prisma.workoutPlanDay.findFirst({
      where: {
        id: dayId,
        workoutPlan: {
          userId: user.id,
          status: "active"
        }
      },
      include: {
        workoutPlan: true
      }
    });

    if (!day) {
      throw new NotFoundException("Workout plan day was not found in the current active plan.");
    }

    return day;
  }

  private async resequencePlanDays(workoutPlanId: string) {
    const days = await this.prisma.workoutPlanDay.findMany({
      where: { workoutPlanId },
      orderBy: [{ sortOrder: "asc" }, { dayLabel: "asc" }]
    });

    await Promise.all(
      days.map((day, index) =>
        this.prisma.workoutPlanDay.update({
          where: { id: day.id },
          data: { sortOrder: index }
        })
      )
    );
  }

  async createCurrentPlanDay(payload: CreateWorkoutPlanDayPayload, userId?: string) {
    const plan = await this.getOrCreateEditableCurrentPlan(userId);
    const nextSortOrder =
      plan.days.reduce((max, day) => Math.max(max, day.sortOrder ?? 0), -1) + 1;

    const created = await this.prisma.workoutPlanDay.create({
      data: {
        workoutPlanId: plan.id,
        dayLabel: normalizePlanString(payload.dayLabel, "未命名"),
        focus: normalizePlanString(payload.focus, "待补充计划内容"),
        duration: normalizePlanString(payload.duration, "待安排"),
        exercises: sanitizeStringArray(payload.exercises),
        recoveryTip: normalizePlanString(payload.recoveryTip, "暂无恢复提醒"),
        sortOrder: nextSortOrder,
        isCompleted: false
      }
    });

    return mapWorkoutPlanDay(created);
  }

  async updateCurrentPlanDay(dayId: string, payload: UpdateWorkoutPlanDayPayload, userId?: string) {
    await this.getEditableCurrentPlanDay(dayId, userId);

    const updated = await this.prisma.workoutPlanDay.update({
      where: { id: dayId },
      data: {
        dayLabel: payload.dayLabel === undefined ? undefined : normalizePlanString(payload.dayLabel, "未命名"),
        focus: payload.focus === undefined ? undefined : normalizePlanString(payload.focus, "待补充计划内容"),
        duration: payload.duration === undefined ? undefined : normalizePlanString(payload.duration, "待安排"),
        exercises: payload.exercises === undefined ? undefined : sanitizeStringArray(payload.exercises),
        recoveryTip:
          payload.recoveryTip === undefined
            ? undefined
            : normalizePlanString(payload.recoveryTip, "暂无恢复提醒"),
        isCompleted: payload.isCompleted
      }
    });

    return mapWorkoutPlanDay(updated);
  }

  async deleteCurrentPlanDay(dayId: string, userId?: string) {
    const day = await this.getEditableCurrentPlanDay(dayId, userId);

    await this.prisma.workoutPlanDay.delete({ where: { id: dayId } });
    await this.resequencePlanDays(day.workoutPlanId);

    return { ok: true, id: dayId };
  }

  async generatePlan(userId: string, goal = "fat_loss") {
    await this.prisma.workoutPlan.updateMany({
      where: { userId, status: "active" },
      data: { status: "archived" }
    });

    return this.prisma.workoutPlan.create({
      data: {
        userId,
        title: "Generated weekly plan",
        goal,
        weekOf: normalizeDateToDay(new Date()),
        version: 1,
        status: "active",
        days: {
          create: buildPlanDays().map((day) => ({
            dayLabel: day.dayLabel,
            focus: day.focus,
            duration: day.duration,
            exercises: day.exercises,
            recoveryTip: day.recoveryTip,
            isCompleted: day.isCompleted,
            sortOrder: day.sortOrder
          }))
        }
      },
      include: { days: true }
    });
  }

  async adjustPlan(userId: string, note: string) {
    const current = await this.getCurrentPlan(userId);
    if (!current) {
      throw new NotFoundException("Plan not found");
    }

    await this.prisma.workoutPlan.update({
      where: { id: current.id },
      data: { version: { increment: 1 } }
    });

    const adjustableDay = current.days[1];
    if (adjustableDay) {
      await this.prisma.workoutPlanDay.update({
        where: { id: adjustableDay.id },
        data: {
          focus: `${adjustableDay.focus} (adjusted)`,
          recoveryTip: `${adjustableDay.recoveryTip}; adjustment note: ${note}`
        }
      });
    }

    return this.getCurrentPlan(userId);
  }

  async completeSession(userId: string, dayLabel: string) {
    const plan = await this.getRequiredCurrentPlan(userId);
    const targetDay = plan.days.find((day) => day.dayLabel === dayLabel);

    if (targetDay) {
      await this.prisma.workoutPlanDay.update({
        where: { id: targetDay.id },
        data: { isCompleted: true }
      });
    }

    return {
      ok: true,
      userId,
      dayLabel,
      completedAt: new Date().toISOString()
    };
  }

  async getExercises() {
    const exercises = await this.prisma.exercise.findMany({
      orderBy: { name: "asc" }
    });
    this.logger.log(`Loaded ${exercises.length} exercise record(s) from PostgreSQL.`);
    return exercises;
  }

  async getDashboard(userId?: string) {
    const user = await this.getUser(userId);
    const [metrics, checkins, workouts] = await Promise.all([
      this.prisma.bodyMetricLog.findMany({
        where: { userId: user.id },
        orderBy: { recordedAt: "desc" },
        take: 14
      }),
      this.prisma.dailyCheckin.findMany({
        where: { userId: user.id },
        orderBy: { recordedAt: "desc" },
        take: 7
      }),
      this.prisma.workoutLog.findMany({
        where: { userId: user.id },
        orderBy: { recordedAt: "desc" },
        take: 7
      })
    ]);

    this.logger.log(
      `Loaded dashboard source data from PostgreSQL for user=${user.id} metrics=${metrics.length} checkins=${checkins.length} workouts=${workouts.length}`
    );

    return {
      weightTrend: metrics.length > 0 ? "Weight trend available from recent logs" : "No weight data yet",
      weeklyCompletionRate:
        workouts.length > 0 ? `${Math.min(workouts.length * 25, 100)}% weekly completion` : "No workout logs yet",
      todayFocus:
        checkins.length > 0
          ? "Protect recovery first, then decide whether to add extra training"
          : "Log today's state first",
      recoveryStatus:
        checkins.length > 0 && checkins[0].sleepHours < 7
          ? "Recent sleep is low; prioritize recovery"
          : "Recovery status looks manageable",
      advice: [
        {
          type: "recovery",
          priority: "medium",
          summary: "Recent fatigue signals suggest protecting recovery before adding volume.",
          actionItems: [
            "Do 30-40 minutes of easy cardio",
            "Sleep at least 7 hours",
            "Trim one lower-body accessory if needed"
          ]
        }
      ]
    };
  }

  async getRecentAdviceSnapshots(userId?: string, take = 3) {
    const user = await this.getUser(userId);
    return this.prisma.adviceSnapshot.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take
    });
  }

  async getLatestDietRecommendation(userId?: string) {
    const user = await this.getUser(userId);
    return this.prisma.dietRecommendationSnapshot.findFirst({
      where: { userId: user.id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }]
    });
  }

  async getCoachSummary(userId?: string): Promise<CoachSummaryRecord> {
    const user = await this.getUser(userId);
    const [currentPlan, recentBodyMetrics, recentDailyCheckins, recentWorkoutLogs, latestDietRecommendation, recentAdviceSnapshots, pendingCoachingPackage] =
      await Promise.all([
        this.getCurrentPlanSnapshot(user.id),
        this.prisma.bodyMetricLog.findMany({
          where: { userId: user.id },
          orderBy: { recordedAt: "desc" },
          take: 8
        }),
        this.prisma.dailyCheckin.findMany({
          where: { userId: user.id },
          orderBy: { recordedAt: "desc" },
          take: 8
        }),
        this.prisma.workoutLog.findMany({
          where: { userId: user.id },
          orderBy: { recordedAt: "desc" },
          take: 8
        }),
        this.getLatestDietRecommendation(user.id),
        this.prisma.adviceSnapshot.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: 3
        }),
        this.prisma.agentProposalGroup.findFirst({
          where: { userId: user.id, status: { in: ["pending", "approved"] } },
          orderBy: { createdAt: "desc" }
        })
      ]);

    const totalDays = currentPlan.days.length;
    const completedDays = currentPlan.days.filter((day) => day.isCompleted).length;
    const completionRate = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;
    const latestCheckin = recentDailyCheckins[0];
    const needsWeeklyReview =
      totalDays === 0 ||
      completionRate < 60 ||
      !latestCheckin ||
      (typeof latestCheckin.sleepHours === "number" && latestCheckin.sleepHours < 7);

    return {
      currentPlan,
      completion: {
        completedDays,
        totalDays,
        completionRate
      },
      recentBodyMetrics,
      recentDailyCheckins,
      recentWorkoutLogs,
      latestDietRecommendation,
      recentAdviceSnapshots,
      pendingCoachingPackage: pendingCoachingPackage
        ? {
            id: pendingCoachingPackage.id,
            threadId: pendingCoachingPackage.threadId,
            title: pendingCoachingPackage.title,
            summary: pendingCoachingPackage.summary,
            status: pendingCoachingPackage.status,
            createdAt: pendingCoachingPackage.createdAt.toISOString()
          }
        : null,
      needsWeeklyReview
    };
  }

  async createGeneratedAdviceSnapshot(
    userId: string,
    payload: GeneratedAdvicePayload,
    client?: DbClient
  ) {
    return this.db(client).adviceSnapshot.create({
      data: {
        userId,
        type: normalizePlanString(payload.type, "weekly_coaching"),
        priority: normalizePlanString(payload.priority, "medium"),
        summary: normalizePlanString(payload.summary, "根据近期执行情况生成了一条教练建议。"),
        reasoningTags: sanitizeStringArray(payload.reasoningTags),
        actionItems: sanitizeStringArray(payload.actionItems),
        riskFlags: sanitizeStringArray(payload.riskFlags)
      }
    });
  }

  async createGeneratedDietRecommendation(
    userId: string,
    payload: GeneratedDietRecommendationPayload,
    client?: DbClient
  ) {
    const targetDate = payload.date ? normalizeDateToDay(new Date(payload.date)) : normalizeDateToDay(new Date());
    return this.db(client).dietRecommendationSnapshot.upsert({
      where: {
        userId_date: {
          userId,
          date: targetDate
        }
      },
      update: {
        userGoal: normalizePlanString(payload.userGoal, "maintenance"),
        totalCalorie: Math.round(payload.totalCalorie),
        targetCalorie: Math.round(payload.targetCalorie),
        nutritionRatio: asJson(payload.nutritionRatio),
        nutritionDetail: asJson(payload.nutritionDetail),
        meals: asJson(payload.meals),
        agentTips: sanitizeStringArray(payload.agentTips)
      },
      create: {
        userId,
        date: targetDate,
        userGoal: normalizePlanString(payload.userGoal, "maintenance"),
        totalCalorie: Math.round(payload.totalCalorie),
        targetCalorie: Math.round(payload.targetCalorie),
        nutritionRatio: asJson(payload.nutritionRatio),
        nutritionDetail: asJson(payload.nutritionDetail),
        meals: asJson(payload.meals),
        agentTips: sanitizeStringArray(payload.agentTips)
      }
    });
  }

  async generateNextWeekPlan(
    userId: string,
    payload: GeneratedWorkoutPlanPayload,
    client?: DbClient
  ) {
    const db = this.db(client);
    const normalizedWeek = payload.weekOf ? normalizeDateToDay(new Date(payload.weekOf)) : normalizeDateToDay(new Date());

    await db.workoutPlan.updateMany({
      where: { userId, status: "active" },
      data: { status: "archived" }
    });

    return db.workoutPlan.create({
      data: {
        userId,
        title: normalizePlanString(payload.title, "下周训练计划"),
        goal: normalizePlanString(payload.goal, "maintenance"),
        weekOf: normalizedWeek,
        version: 1,
        status: "active",
        days: {
          create: payload.days.map((day, index) => ({
            dayLabel: normalizePlanString(day.dayLabel, `训练日 ${index + 1}`),
            focus: normalizePlanString(day.focus, "待补充训练重点"),
            duration: normalizePlanString(day.duration, "45 分钟"),
            exercises: sanitizeStringArray(day.exercises),
            recoveryTip: normalizePlanString(day.recoveryTip, "优先保证恢复质量。"),
            isCompleted: day.isCompleted ?? false,
            sortOrder: day.sortOrder ?? index
          }))
        }
      },
      include: {
        days: {
          orderBy: [{ sortOrder: "asc" }, { dayLabel: "asc" }]
        }
      }
    });
  }

  async getTodayDietRecommendation(userId?: string) {
    const user = await this.getUser(userId);
    const today = normalizeDateToDay(new Date());

    const snapshot = await this.prisma.dietRecommendationSnapshot.findFirst({
      where: {
        userId: user.id,
        date: today
      },
      orderBy: { date: "desc" }
    });

    if (!snapshot) {
      throw new NotFoundException("Today's diet recommendation was not found in the database.");
    }

    this.logger.log(`Loaded today's diet recommendation from PostgreSQL for user=${user.id}`);

    return snapshot;
  }
}
