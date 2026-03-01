import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";

const sortByMostRecent = <
  T extends { startedAt?: number; createdAt: number }
>(
  runs: T[]
) => {
  return runs.sort(
    (a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt)
  );
};

export const listByExperiment = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, { experimentId }) => {
    const runs = await ctx.db
      .query("qaAnalyzerRuns")
      .withIndex("by_experiment", (q) => q.eq("experimentId", experimentId))
      .collect();

    return sortByMostRecent(runs);
  },
});

export const listByExperimentAndAnalyzer = query({
  args: {
    experimentId: v.id("experiments"),
    analyzerType: v.string(),
  },
  handler: async (ctx, { experimentId, analyzerType }) => {
    const runs = await ctx.db
      .query("qaAnalyzerRuns")
      .withIndex("by_experiment_analyzer", (q) =>
        q.eq("experimentId", experimentId).eq("analyzerType", analyzerType)
      )
      .collect();

    return sortByMostRecent(runs);
  },
});

export const getLatestByExperimentAndAnalyzer = query({
  args: {
    experimentId: v.id("experiments"),
    analyzerType: v.string(),
  },
  handler: async (ctx, { experimentId, analyzerType }) => {
    const runs = await ctx.db
      .query("qaAnalyzerRuns")
      .withIndex("by_experiment_analyzer", (q) =>
        q.eq("experimentId", experimentId).eq("analyzerType", analyzerType)
      )
      .collect();

    return sortByMostRecent(runs)[0] ?? null;
  },
});

export const getByJobId = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    return await ctx.db
      .query("qaAnalyzerRuns")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .first();
  },
});

const lifecycleArgs = {
  experimentId: v.id("experiments"),
  analyzerType: v.string(),
  jobId: v.string(),
  status: v.string(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  error: v.optional(v.string()),
  result: v.optional(v.string()),
  model: v.optional(v.string()),
  inputTraceCount: v.optional(v.number()),
};

export const upsertLifecycle = mutation({
  args: lifecycleArgs,
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("qaAnalyzerRuns")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .first();

    if (existing) {
      const patch: Record<string, unknown> = {
        status: args.status,
        updatedAt: now,
      };

      if (args.startedAt !== undefined) {
        patch.startedAt = args.startedAt;
      } else if (args.status === "running" && existing.startedAt === undefined) {
        patch.startedAt = now;
      }

      if (args.completedAt !== undefined) {
        patch.completedAt = args.completedAt;
      } else if (args.status === "completed" || args.status === "failed") {
        patch.completedAt = now;
      }

      if (args.error !== undefined) patch.error = args.error;
      if (args.result !== undefined) patch.result = args.result;
      if (args.model !== undefined) patch.model = args.model;
      if (args.inputTraceCount !== undefined) {
        patch.inputTraceCount = args.inputTraceCount;
      }

      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("qaAnalyzerRuns", {
      experimentId: args.experimentId,
      analyzerType: args.analyzerType,
      status: args.status,
      jobId: args.jobId,
      startedAt: args.startedAt ?? (args.status === "running" ? now : undefined),
      completedAt:
        args.completedAt ??
        (args.status === "completed" || args.status === "failed" ? now : undefined),
      error: args.error,
      result: args.result,
      model: args.model,
      inputTraceCount: args.inputTraceCount,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsertLifecycleInternal = internalMutation({
  args: lifecycleArgs,
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("qaAnalyzerRuns")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .first();

    if (existing) {
      const patch: Record<string, unknown> = {
        status: args.status,
        updatedAt: now,
      };

      if (args.startedAt !== undefined) {
        patch.startedAt = args.startedAt;
      } else if (args.status === "running" && existing.startedAt === undefined) {
        patch.startedAt = now;
      }

      if (args.completedAt !== undefined) {
        patch.completedAt = args.completedAt;
      } else if (args.status === "completed" || args.status === "failed") {
        patch.completedAt = now;
      }

      if (args.error !== undefined) patch.error = args.error;
      if (args.result !== undefined) patch.result = args.result;
      if (args.model !== undefined) patch.model = args.model;
      if (args.inputTraceCount !== undefined) {
        patch.inputTraceCount = args.inputTraceCount;
      }

      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("qaAnalyzerRuns", {
      experimentId: args.experimentId,
      analyzerType: args.analyzerType,
      status: args.status,
      jobId: args.jobId,
      startedAt: args.startedAt ?? (args.status === "running" ? now : undefined),
      completedAt:
        args.completedAt ??
        (args.status === "completed" || args.status === "failed" ? now : undefined),
      error: args.error,
      result: args.result,
      model: args.model,
      inputTraceCount: args.inputTraceCount,
      createdAt: now,
      updatedAt: now,
    });
  },
});
