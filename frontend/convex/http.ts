import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

/**
 * POST /ingestTrace
 * Called by data_pipeline.py after each HUD run completes.
 * Body: flat metrics dict from _build_convex_metrics().
 *
 * Upserts: experiment (keyed by job_id name) → variant (model) → run (trace_id).
 */
http.route({
  path: "/ingestTrace",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const jobId = (body.job_id as string) ?? "unknown-job";
    const model = (body.model as string) ?? "unknown-model";
    const toolConfig = (body.tool_config as string) ?? "full";
    const traceId = (body.trace_id as string) ?? undefined;

    // If the Python runner already created an experiment in Convex and provides its ID,
    // use it directly instead of looking up by name.
    const overrideExperimentId = (body.override_experiment_id as string) ?? undefined;
    const reward = typeof body.reward === "number" ? body.reward : 0;
    const agentSteps = typeof body.agent_steps === "number" ? body.agent_steps : 0;
    const totalInputTokens =
      typeof body.total_input_tokens === "number" ? body.total_input_tokens : 0;
    const totalOutputTokens =
      typeof body.total_output_tokens === "number" ? body.total_output_tokens : 0;
    const totalCost = typeof body.total_cost === "number" ? body.total_cost : 0;
    const runtimeSeconds =
      typeof body.environment_total_runtime_seconds === "number"
        ? body.environment_total_runtime_seconds
        : null;
    const scenario = typeof body.scenario === "string" ? body.scenario : undefined;
    const taskId = typeof body.task_id === "string" ? body.task_id : undefined;
    const externalId = typeof body.external_id === "string" ? body.external_id : undefined;
    const difficulty = typeof body.difficulty === "string" ? body.difficulty : undefined;
    const category = typeof body.category === "string" ? body.category : undefined;
    const attempt = typeof body.attempt === "number" ? body.attempt : undefined;
    const maxAttempts =
      typeof body.max_attempts === "number" ? body.max_attempts : undefined;

    const totalLatencyMs = runtimeSeconds != null ? runtimeSeconds * 1000 : 300_000;
    const success = reward >= 0.5;
    const now = Date.now();

    // ── 1. Find or create experiment ────────────────────────────────────────
    // If the Python runner already created the experiment (wizard flow), use it directly.
    let experiment: { _id: Id<"experiments"> } | null = null;
    if (overrideExperimentId) {
      experiment = { _id: overrideExperimentId as Id<"experiments"> };
    } else {
      const found = await ctx.runQuery(internal.experiments.getByName, { name: jobId });
      if (found) {
        experiment = found;
      } else {
        const expId = await ctx.runMutation(internal.experiments.createInternal, {
          name: jobId,
          taskGoal: "Auto-ingested from HUD run",
          taskUrl: "",
          successConditions: [],
          status: "completed",
          createdAt: now,
        });
        experiment = { _id: expId };
      }
    }

    // ── 2. Find or create variant ────────────────────────────────────────────
    let variant = await ctx.runQuery(internal.variants.getByExperimentModelAndTool, {
      experimentId: experiment!._id,
      model,
      toolConfig,
    });
    if (!variant) {
      const varId = await ctx.runMutation(internal.variants.createInternal, {
        experimentId: experiment!._id,
        model,
        toolConfig,
        architecture: "single_agent",
        hudRunId: jobId,
        status: success ? "success" : "failure",
      });
      variant = { _id: varId } as unknown as typeof variant;
    }

    // ── 3. Skip if trace already ingested ───────────────────────────────────
    if (traceId) {
      const existing = await ctx.runQuery(internal.runs.getByTraceId, {
        hudTraceId: traceId,
      });
      if (existing) {
        return new Response(
          JSON.stringify({ success: true, action: "skipped", trace_id: traceId }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // ── 4. Create run ────────────────────────────────────────────────────────
    const runId = await ctx.runMutation(internal.runs.create, {
      variantId: variant!._id,
      experimentId: experiment!._id,
      hudTraceId: traceId,
      externalId,
      taskId,
      scenario,
      difficulty,
      category,
      attempt,
      maxAttempts,
      reward,
      totalSteps: agentSteps,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCostUsd: totalCost,
      totalLatencyMs,
      success,
      startedAt: now - totalLatencyMs,
      completedAt: now,
    });

    return new Response(
      JSON.stringify({ success: true, action: "created", run_id: runId }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  }),
});

/**
 * POST /updateVariantStatus
 * Called by experiment_runner.py to mark a variant as "running" before HUD evals start,
 * or "failure" if the eval errors out.
 * Body: { experiment_id: string, model: string, status: string }
 */
http.route({
  path: "/updateVariantStatus",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const experimentId = body.experiment_id as string;
    const model = body.model as string;
    const toolConfig = (body.tool_config as string) ?? "full";
    const status = body.status as string;

    if (!experimentId || !model || !status) {
      return new Response(
        JSON.stringify({ error: "experiment_id, model, and status are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const variant = await ctx.runQuery(internal.variants.getByExperimentModelAndTool, {
      experimentId: experimentId as Id<"experiments">,
      model,
      toolConfig,
    });

    if (!variant) {
      return new Response(
        JSON.stringify({ success: false, error: "variant not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    await ctx.runMutation(internal.variants.updateStatusInternal, {
      id: variant._id,
      status,
    });

    return new Response(
      JSON.stringify({ success: true, variant_id: variant._id }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }),
});

export default http;
