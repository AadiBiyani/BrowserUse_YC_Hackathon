import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByExperiment = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, { experimentId }) => {
    return await ctx.db
      .query("chatMessages")
      .withIndex("by_experiment", (q) => q.eq("experimentId", experimentId))
      .order("asc")
      .collect();
  },
});

export const create = mutation({
  args: {
    experimentId: v.id("experiments"),
    role: v.string(),
    content: v.string(),
    sourcedRunIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("chatMessages", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
