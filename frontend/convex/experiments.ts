import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("experiments").order("desc").collect();
  },
});

export const listWithStats = query({
  args: {},
  handler: async (ctx) => {
    const experiments = await ctx.db.query("experiments").order("desc").collect();
    const runs = await ctx.db.query("runs").collect();

    return experiments.map((exp) => {
      const expRuns = runs.filter((r) => r.experimentId === exp._id);
      const successCount = expRuns.filter((r) => r.success).length;
      return {
        ...exp,
        runCount: expRuns.length,
        successCount,
      };
    });
  },
});

export const get = query({
  args: { id: v.id("experiments") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByName = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    return await ctx.db
      .query("experiments")
      .filter((q) => q.eq(q.field("name"), name))
      .first();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    taskGoal: v.string(),
    taskUrl: v.string(),
    successConditions: v.array(v.string()),
    taskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("experiments", {
      name: args.name,
      taskGoal: args.taskGoal,
      taskUrl: args.taskUrl,
      successConditions: args.successConditions,
      taskId: args.taskId,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const createInternal = internalMutation({
  args: {
    name: v.string(),
    taskGoal: v.string(),
    taskUrl: v.string(),
    successConditions: v.array(v.string()),
    status: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("experiments", args);
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("experiments"),
    status: v.string(),
  },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status });
  },
});

export const deleteExperiment = mutation({
  args: { id: v.id("experiments") },
  handler: async (ctx, { id }) => {
    const variants = await ctx.db
      .query("variants")
      .withIndex("by_experiment", (q) => q.eq("experimentId", id))
      .collect();
    for (const v of variants) {
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_variant", (q) => q.eq("variantId", v._id))
        .collect();
      for (const r of runs) await ctx.db.delete(r._id);
      await ctx.db.delete(v._id);
    }
    const msgs = await ctx.db
      .query("chatMessages")
      .withIndex("by_experiment", (q) => q.eq("experimentId", id))
      .collect();
    for (const m of msgs) await ctx.db.delete(m._id);
    const analyzerRuns = await ctx.db
      .query("qaAnalyzerRuns")
      .withIndex("by_experiment", (q) => q.eq("experimentId", id))
      .collect();
    for (const run of analyzerRuns) await ctx.db.delete(run._id);
    await ctx.db.delete(id);
  },
});
