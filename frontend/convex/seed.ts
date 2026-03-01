import { internalMutation } from "./_generated/server";

/**
 * Seed the 9 runs from the form_submission seed run executed on 2026-02-28.
 * Job ID: 1325246e-c8e0-40b3-9d91-08db5978c64d
 *
 * Run: npx convex run seed:seedAll
 * (idempotent — skips if experiment already exists)
 */
export const seedAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const JOB_ID = "1325246e-c8e0-40b3-9d91-08db5978c64d";

    // ── Guard: skip if already seeded ──────────────────────────────────────
    const existing = await ctx.db
      .query("experiments")
      .filter((q) => q.eq(q.field("name"), JOB_ID))
      .first();
    if (existing) {
      console.log("Seed data already present — skipping.");
      return { skipped: true };
    }

    // Seed run timestamp: 2026-02-28T23:33:38Z
    const BASE_TS = 1740789218000;

    // ── Create experiment ──────────────────────────────────────────────────
    const experimentId = await ctx.db.insert("experiments", {
      name: JOB_ID,
      taskGoal:
        "Fill in the form: set customer name to 'Trace.IQ Test', telephone to '555-1234', email to 'test@traceiq.dev', select 'Medium' for pizza size, then submit.",
      taskUrl: "https://httpbin.org/forms/post",
      successConditions: [
        "Response body contains 'Trace.IQ Test'",
        "Form submitted successfully",
        "All fields correctly populated",
      ],
      status: "completed",
      createdAt: BASE_TS,
    });

    // ── Create variants ────────────────────────────────────────────────────
    const gptVariantId = await ctx.db.insert("variants", {
      experimentId,
      model: "gpt-4o",
      toolConfig: "{}",
      architecture: "single_agent",
      hudRunId: JOB_ID,
      status: "failure", // 1/3 success → failure overall
    });

    const claudeVariantId = await ctx.db.insert("variants", {
      experimentId,
      model: "claude-sonnet-4-5",
      toolConfig: "{}",
      architecture: "single_agent",
      hudRunId: JOB_ID,
      status: "success", // 3/3 success
    });

    const geminiVariantId = await ctx.db.insert("variants", {
      experimentId,
      model: "gemini-2.0-flash",
      toolConfig: "{}",
      architecture: "single_agent",
      hudRunId: JOB_ID,
      status: "failure", // 0/3 success (model not found error)
    });

    // ── gpt-4o runs ────────────────────────────────────────────────────────
    // Run 1: reward=1.0, 6 agent steps, $0.245, 48332 tokens
    await ctx.db.insert("runs", {
      variantId: gptVariantId,
      experimentId,
      hudTraceId: "5cd19812-a3dc-4714-a0bc-1db7afa62e61",
      totalSteps: 6,
      totalTokens: 48332,
      totalCostUsd: 0.245,
      totalLatencyMs: 300000,
      success: true,
      startedAt: BASE_TS - 300000,
      completedAt: BASE_TS,
    });

    // Run 2: reward=0.0, 8 agent steps, $0.1465, 64772 tokens
    await ctx.db.insert("runs", {
      variantId: gptVariantId,
      experimentId,
      hudTraceId: "0e240ae9-9716-4826-84cb-b699225c68b2",
      totalSteps: 8,
      totalTokens: 64772,
      totalCostUsd: 0.1465,
      totalLatencyMs: 300000,
      success: false,
      startedAt: BASE_TS - 300000,
      completedAt: BASE_TS,
    });

    // Run 3: reward=0.0, ~9 steps (estimated), $0.18 (estimated)
    await ctx.db.insert("runs", {
      variantId: gptVariantId,
      experimentId,
      hudTraceId: "ff7a1663-5282-44ee-ac84-1445706c0dbc",
      totalSteps: 9,
      totalTokens: 70000,
      totalCostUsd: 0.18,
      totalLatencyMs: 300000,
      success: false,
      startedAt: BASE_TS - 300000,
      completedAt: BASE_TS,
    });

    // ── claude-sonnet-4-5 runs ─────────────────────────────────────────────
    // Run 1: reward=1.0, 1 agent step, $0.0976, 694 tokens
    await ctx.db.insert("runs", {
      variantId: claudeVariantId,
      experimentId,
      hudTraceId: "bb2daf44-b77e-4294-b296-5179415d4ed0",
      totalSteps: 1,
      totalTokens: 694,
      totalCostUsd: 0.0976,
      totalLatencyMs: 300000,
      success: true,
      startedAt: BASE_TS - 300000,
      completedAt: BASE_TS,
    });

    // Run 2: reward=1.0, ~2 steps (estimated), $0.10 (estimated)
    await ctx.db.insert("runs", {
      variantId: claudeVariantId,
      experimentId,
      hudTraceId: "c7482154-2260-4764-a7b4-4f33804edb3f",
      totalSteps: 2,
      totalTokens: 1200,
      totalCostUsd: 0.1,
      totalLatencyMs: 300000,
      success: true,
      startedAt: BASE_TS - 300000,
      completedAt: BASE_TS,
    });

    // Run 3: reward=1.0, ~2 steps (estimated), $0.10 (estimated)
    await ctx.db.insert("runs", {
      variantId: claudeVariantId,
      experimentId,
      hudTraceId: "5b6e6b7c-f066-4dbd-9cba-146cb15b39a2",
      totalSteps: 2,
      totalTokens: 1200,
      totalCostUsd: 0.1,
      totalLatencyMs: 300000,
      success: true,
      startedAt: BASE_TS - 300000,
      completedAt: BASE_TS,
    });

    // ── gemini-2.0-flash runs (all errored: model not found) ───────────────
    // Run 1
    await ctx.db.insert("runs", {
      variantId: geminiVariantId,
      experimentId,
      hudTraceId: "cb030c04-8804-4f19-beae-0e4f83b685e9",
      totalSteps: 0,
      totalTokens: 0,
      totalCostUsd: 0.0417,
      totalLatencyMs: 60000,
      success: false,
      startedAt: BASE_TS - 60000,
      completedAt: BASE_TS,
    });

    // Run 2
    await ctx.db.insert("runs", {
      variantId: geminiVariantId,
      experimentId,
      hudTraceId: "96d6bbfe-1a21-4583-9fc0-188a832c8d22",
      totalSteps: 0,
      totalTokens: 0,
      totalCostUsd: 0.0417,
      totalLatencyMs: 60000,
      success: false,
      startedAt: BASE_TS - 60000,
      completedAt: BASE_TS,
    });

    // Run 3
    await ctx.db.insert("runs", {
      variantId: geminiVariantId,
      experimentId,
      hudTraceId: "dec3a239-0f53-4b7c-8976-29b0a70039ba",
      totalSteps: 0,
      totalTokens: 0,
      totalCostUsd: 0.0417,
      totalLatencyMs: 60000,
      success: false,
      startedAt: BASE_TS - 60000,
      completedAt: BASE_TS,
    });

    console.log(
      `Seeded experiment ${experimentId} with 3 variants and 9 runs.`
    );
    return {
      skipped: false,
      experimentId,
      variantIds: { gptVariantId, claudeVariantId, geminiVariantId },
    };
  },
});
