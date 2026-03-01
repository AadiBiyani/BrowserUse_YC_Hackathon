import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";

function toBreakdown<T extends string>(
  values: T[],
  summarize: (value: T) => {
    runCount: number;
    successCount: number;
    successRate: number;
    avgReward: number;
  }
) {
  return values.map((value) => ({ value, ...summarize(value) }));
}

export const listByExperiment = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, { experimentId }) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_experiment", (q) => q.eq("experimentId", experimentId))
      .collect();
  },
});

export const listByVariant = query({
  args: { variantId: v.id("variants") },
  handler: async (ctx, { variantId }) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_variant", (q) => q.eq("variantId", variantId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByTraceId = internalQuery({
  args: { hudTraceId: v.string() },
  handler: async (ctx, { hudTraceId }) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_trace", (q) => q.eq("hudTraceId", hudTraceId))
      .first();
  },
});

/** Aggregate metrics per model for the comparison table and query engine. */
export const getExperimentMetrics = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, { experimentId }) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_experiment", (q) => q.eq("experimentId", experimentId))
      .collect();

    const variants = await ctx.db
      .query("variants")
      .withIndex("by_experiment", (q) => q.eq("experimentId", experimentId))
      .collect();

    return variants.map((variant) => {
      const variantRuns = runs.filter(
        (r) => r.variantId === variant._id
      );
      const successCount = variantRuns.filter((r) => r.success).length;
      const rewardValues = variantRuns.map((r) => r.reward ?? 0);
      const avgCost =
        variantRuns.length > 0
          ? variantRuns.reduce((s, r) => s + r.totalCostUsd, 0) /
            variantRuns.length
          : 0;
      const avgLatencyMs =
        variantRuns.length > 0
          ? variantRuns.reduce((s, r) => s + r.totalLatencyMs, 0) /
            variantRuns.length
          : 0;
      const avgSteps =
        variantRuns.length > 0
          ? variantRuns.reduce((s, r) => s + r.totalSteps, 0) /
            variantRuns.length
          : 0;
      const avgReward =
        variantRuns.length > 0
          ? rewardValues.reduce((sum, reward) => sum + reward, 0) / variantRuns.length
          : 0;
      const sortedRewards = [...rewardValues].sort((a, b) => a - b);
      const medianReward =
        sortedRewards.length === 0
          ? null
          : sortedRewards.length % 2 === 1
          ? sortedRewards[(sortedRewards.length - 1) / 2]
          : (sortedRewards[sortedRewards.length / 2 - 1] +
              sortedRewards[sortedRewards.length / 2]) /
            2;
      const rewardStdDev =
        variantRuns.length > 0
          ? Math.sqrt(
              rewardValues.reduce(
                (sum, reward) => sum + (reward - avgReward) ** 2,
                0
              ) / variantRuns.length
            )
          : 0;
      const rewardMin =
        sortedRewards.length > 0 ? sortedRewards[0] : null;
      const rewardMax =
        sortedRewards.length > 0 ? sortedRewards[sortedRewards.length - 1] : null;
      const determinismScores = variantRuns
        .map((r) => r.determinismScore)
        .filter((d): d is number => d !== undefined);
      const avgDeterminism =
        determinismScores.length > 0
          ? determinismScores.reduce((s, d) => s + d, 0) /
            determinismScores.length
          : null;
      const scenarioValues = Array.from(
        new Set(
          variantRuns
            .map((r) => r.scenario)
            .filter((scenario): scenario is string => !!scenario)
        )
      );
      const difficultyValues = Array.from(
        new Set(
          variantRuns
            .map((r) => r.difficulty)
            .filter((difficulty): difficulty is string => !!difficulty)
        )
      );
      const categoryValues = Array.from(
        new Set(
          variantRuns
            .map((r) => r.category)
            .filter((category): category is string => !!category)
        )
      );
      const taskValues = Array.from(
        new Set(
          variantRuns
            .map((r) => r.taskId ?? r.externalId)
            .filter((taskId): taskId is string => !!taskId)
        )
      );
      const summarizeGroup = (groupRuns: typeof variantRuns) => {
        const groupSuccessCount = groupRuns.filter((run) => run.success).length;
        const groupRewardValues = groupRuns.map((run) => run.reward ?? 0);
        const groupAvgReward =
          groupRuns.length > 0
            ? groupRewardValues.reduce((sum, reward) => sum + reward, 0) / groupRuns.length
            : 0;
        return {
          runCount: groupRuns.length,
          successCount: groupSuccessCount,
          successRate:
            groupRuns.length > 0 ? groupSuccessCount / groupRuns.length : 0,
          avgReward: groupAvgReward,
        };
      };

      return {
        model: variant.model,
        toolConfig: variant.toolConfig,
        variantId: variant._id,
        status: variant.status,
        runCount: variantRuns.length,
        successCount,
        successRate: variantRuns.length > 0 ? successCount / variantRuns.length : 0,
        avgReward,
        medianReward,
        rewardStdDev,
        rewardMin,
        rewardMax,
        avgCostUsd: avgCost,
        avgLatencyMs,
        avgSteps,
        avgDeterminismScore: avgDeterminism,
        scenarioBreakdown: toBreakdown(
          scenarioValues,
          (scenario) => summarizeGroup(variantRuns.filter((run) => run.scenario === scenario))
        ),
        difficultyBreakdown: toBreakdown(
          difficultyValues,
          (difficulty) =>
            summarizeGroup(variantRuns.filter((run) => run.difficulty === difficulty))
        ),
        categoryBreakdown: toBreakdown(
          categoryValues,
          (category) => summarizeGroup(variantRuns.filter((run) => run.category === category))
        ),
        taskBreakdown: toBreakdown(
          taskValues,
          (taskId) =>
            summarizeGroup(
              variantRuns.filter((run) => (run.taskId ?? run.externalId) === taskId)
            )
        ),
        runs: variantRuns.map((r) => ({
          runId: r._id,
          hudTraceId: r.hudTraceId,
          externalId: r.externalId,
          taskId: r.taskId,
          scenario: r.scenario,
          difficulty: r.difficulty,
          category: r.category,
          attempt: r.attempt,
          maxAttempts: r.maxAttempts,
          reward: r.reward ?? 0,
          success: r.success,
          totalSteps: r.totalSteps,
          totalCostUsd: r.totalCostUsd,
          totalLatencyMs: r.totalLatencyMs,
          determinismScore: r.determinismScore,
        })),
      };
    });
  },
});

export const create = internalMutation({
  args: {
    variantId: v.id("variants"),
    experimentId: v.id("experiments"),
    hudTraceId: v.optional(v.string()),
    externalId: v.optional(v.string()),
    taskId: v.optional(v.string()),
    scenario: v.optional(v.string()),
    difficulty: v.optional(v.string()),
    category: v.optional(v.string()),
    attempt: v.optional(v.number()),
    maxAttempts: v.optional(v.number()),
    reward: v.optional(v.number()),
    totalSteps: v.number(),
    totalTokens: v.number(),
    totalCostUsd: v.number(),
    totalLatencyMs: v.number(),
    success: v.boolean(),
    determinismScore: v.optional(v.number()),
    supermemoryContainerId: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("runs", args);
  },
});

export const updateDeterminismScore = mutation({
  args: {
    id: v.id("runs"),
    determinismScore: v.number(),
  },
  handler: async (ctx, { id, determinismScore }) => {
    await ctx.db.patch(id, { determinismScore });
  },
});
