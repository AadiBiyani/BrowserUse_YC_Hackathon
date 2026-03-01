import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";


export const listByExperiment = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, { experimentId }) => {
    return await ctx.db
      .query("variants")
      .withIndex("by_experiment", (q) => q.eq("experimentId", experimentId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("variants") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByExperimentAndModel = internalQuery({
  args: {
    experimentId: v.id("experiments"),
    model: v.string(),
  },
  handler: async (ctx, { experimentId, model }) => {
    const variants = await ctx.db
      .query("variants")
      .withIndex("by_experiment", (q) => q.eq("experimentId", experimentId))
      .collect();
    return variants.find((v) => v.model === model) ?? null;
  },
});

export const getByExperimentModelAndTool = internalQuery({
  args: {
    experimentId: v.id("experiments"),
    model: v.string(),
    toolConfig: v.string(),
  },
  handler: async (ctx, { experimentId, model, toolConfig }) => {
    return await ctx.db
      .query("variants")
      .withIndex("by_experiment_model_tool", (q) =>
        q.eq("experimentId", experimentId).eq("model", model).eq("toolConfig", toolConfig)
      )
      .first();
  },
});

export const create = mutation({
  args: {
    experimentId: v.id("experiments"),
    model: v.string(),
    toolConfig: v.string(),
    architecture: v.string(),
    hudRunId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("variants", {
      ...args,
      status: "pending",
    });
  },
});

export const createInternal = internalMutation({
  args: {
    experimentId: v.id("experiments"),
    model: v.string(),
    toolConfig: v.string(),
    architecture: v.string(),
    hudRunId: v.optional(v.string()),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("variants", args);
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("variants"),
    status: v.string(),
    hudRunId: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, hudRunId }) => {
    await ctx.db.patch(id, { status, ...(hudRunId ? { hudRunId } : {}) });
  },
});

export const updateStatusInternal = internalMutation({
  args: {
    id: v.id("variants"),
    status: v.string(),
    hudRunId: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, hudRunId }) => {
    await ctx.db.patch(id, { status, ...(hudRunId ? { hudRunId } : {}) });
  },
});
