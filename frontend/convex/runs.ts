import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";

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
      const determinismScores = variantRuns
        .map((r) => r.determinismScore)
        .filter((d): d is number => d !== undefined);
      const avgDeterminism =
        determinismScores.length > 0
          ? determinismScores.reduce((s, d) => s + d, 0) /
            determinismScores.length
          : null;

      return {
        model: variant.model,
        toolConfig: variant.toolConfig,
        variantId: variant._id,
        status: variant.status,
        runCount: variantRuns.length,
        successCount,
        successRate: variantRuns.length > 0 ? successCount / variantRuns.length : 0,
        avgCostUsd: avgCost,
        avgLatencyMs,
        avgSteps,
        avgDeterminismScore: avgDeterminism,
        runs: variantRuns.map((r) => ({
          runId: r._id,
          hudTraceId: r.hudTraceId,
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
