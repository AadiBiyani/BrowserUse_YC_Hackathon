import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
    name: v.string(),
    url: v.string(),
    goal: v.string(),
    expected: v.optional(v.string()),
    compareMode: v.string(), // "contains" | "exact" | "regex"
    createdAt: v.number(),
  }),

  experiments: defineTable({
    name: v.string(),
    taskGoal: v.string(),
    taskUrl: v.string(),
    successConditions: v.array(v.string()),
    taskId: v.optional(v.id("tasks")),
    status: v.string(), // "pending" | "running" | "completed"
    createdAt: v.number(),
  }),

  variants: defineTable({
    experimentId: v.id("experiments"),
    model: v.string(),        // "gpt-4o" | "claude-sonnet-4-5" | "gemini-2.0-flash"
    toolConfig: v.string(),   // "full" | "navigation_only" | etc.
    architecture: v.string(), // "single_agent" | "multi_agent"
    hudRunId: v.optional(v.string()),
    status: v.string(),       // "pending" | "running" | "success" | "failure"
  })
    .index("by_experiment", ["experimentId"])
    .index("by_experiment_model_tool", ["experimentId", "model", "toolConfig"]),

  runs: defineTable({
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
  })
    .index("by_experiment", ["experimentId"])
    .index("by_variant", ["variantId"])
    .index("by_trace", ["hudTraceId"]),

  qaAnalyzerRuns: defineTable({
    experimentId: v.id("experiments"),
    analyzerType: v.string(), // "reward_hacking" | "failure_reasoning" | "tool_use"
    status: v.string(), // "queued" | "running" | "completed" | "failed"
    jobId: v.string(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    result: v.optional(v.string()),
    model: v.optional(v.string()),
    inputTraceCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_experiment", ["experimentId"])
    .index("by_job", ["jobId"])
    .index("by_experiment_analyzer", ["experimentId", "analyzerType"]),

  chatMessages: defineTable({
    experimentId: v.id("experiments"),
    role: v.string(), // "user" | "assistant"
    content: v.string(),
    sourcedRunIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
  }).index("by_experiment", ["experimentId"]),
});
