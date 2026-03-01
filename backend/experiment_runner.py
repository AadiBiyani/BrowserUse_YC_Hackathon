"""
experiment_runner.py — Orchestrate a multi-model/multi-tool HUD experiment end-to-end.

Called by api.py as a background asyncio task via POST /run-experiment.

Flow:
  1. Mark all variants as "running" in Convex via /updateVariantStatus HTTP action
  2. For each variant spec: fire one hud.eval() with a single model + tool_config
  3. For each completed trace: ingest into MongoDB + Supermemory + Convex
     (experiment_id and tool_config are injected so /ingestTrace routes correctly)
  4. Mark the experiment as "completed" in Convex via the HTTP mutation API
  5. Compute pairwise determinism scores within each variant
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv(override=True)

import hud
from hud import Environment
from hud.agents import create_agent

from data_pipeline import fetch_trace, store_raw_mongo, store_supermemory_chunks, store_convex_metrics
from determinism import compute_and_store as compute_determinism

logger = logging.getLogger(__name__)

CONVEX_SITE_URL = os.getenv("CONVEX_SITE_URL", "")
CONVEX_URL      = os.getenv("CONVEX_URL", "")

HUB_ENV = "traceiq-browser-env"

# Tool config presets — mirrors the frontend TOOL_CONFIGS constant.
# None means the scenario exposes all tools; a list restricts to those names.
TOOL_PRESETS: dict[str, list[str] | None] = {
    "full":            None,
    "navigation_only": ["navigate", "click", "input", "extract"],
}


def _coerce_int(value: Any, default: int, *, minimum: int = 1) -> int:
    """Coerce a config value to int with bounds and fallback."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, parsed)


def _coerce_float(value: Any, default: float, *, minimum: float = 0.0) -> float:
    """Coerce a config value to float with bounds and fallback."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, parsed)


def _coerce_bool(value: Any, default: bool) -> bool:
    """Best-effort bool parsing for config values."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value.strip().lower() in {"true", "1", "yes", "y", "on"}:
            return True
        if value.strip().lower() in {"false", "0", "no", "n", "off"}:
            return False
    return default


def _is_transient_eval_error(exc: Exception) -> bool:
    """Heuristic for transient HUD eval errors worth retrying."""
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError, asyncio.TimeoutError)):
        return True
    text = str(exc).lower()
    transient_markers = (
        "timeout",
        "temporar",
        "connection reset",
        "connection aborted",
        "broken pipe",
        "rate limit",
        "429",
        "503",
        "gateway",
        "unavailable",
    )
    return any(marker in text for marker in transient_markers)


async def _convex_mutation(path: str, args: dict) -> None:
    """Call a Convex public mutation via the HTTP API."""
    if not CONVEX_URL:
        return
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                f"{CONVEX_URL}/api/mutation",
                json={"path": path, "args": args, "format": "json"},
                timeout=10,
            )
            if r.status_code != 200:
                logger.warning("Convex mutation %s → %d: %s", path, r.status_code, r.text[:200])
        except httpx.HTTPError as exc:
            logger.warning("Convex mutation %s failed: %s", path, exc)


async def _update_variant_statuses(
    experiment_id: str,
    variant_specs: list[dict],
    status: str,
) -> None:
    """Mark each (model, tool_config) variant as `status` via Convex /updateVariantStatus."""
    if not CONVEX_SITE_URL:
        return
    async with httpx.AsyncClient() as client:
        for spec in variant_specs:
            try:
                await client.post(
                    f"{CONVEX_SITE_URL}/updateVariantStatus",
                    json={
                        "experiment_id": experiment_id,
                        "model":         spec["model"],
                        "tool_config":   spec.get("tool_config", "full"),
                        "status":        status,
                    },
                    timeout=10,
                )
            except httpx.HTTPError as exc:
                logger.warning(
                    "updateVariantStatus failed for model=%s tool_config=%s: %s",
                    spec.get("model"), spec.get("tool_config"), exc,
                )


async def run_experiment(
    experiment_id: str,
    task_config: dict,
    variant_specs: list[dict],
    group: int = 3,
) -> None:
    """
    Full experiment orchestration — designed to run as a background asyncio task.

    Args:
        experiment_id: Convex experiment ID (created by the frontend wizard)
        task_config:   {
                         scenario: str,
                         scenarioArgs: dict,
                         ...optional metadata:
                           taskId/externalId/difficulty/category/successConditions
                           maxAttempts/retryDelaySec/retryTransientOnly
                       }
        variant_specs: List of {model, tool_config} dicts defining all combinations to run
        group:         Number of runs per variant
    """
    logger.info(
        "[experiment_runner] Starting experiment=%s variants=%s group=%d",
        experiment_id, variant_specs, group,
    )

    # ── 1. Mark all variants as running ──────────────────────────────────────
    await _update_variant_statuses(experiment_id, variant_specs, "running")

    spaces = [f"experiment-{experiment_id}"]

    # ── 2. Fire all variant evals in parallel, one hud.eval() per spec ────────
    async def _run_variant(spec: dict) -> bool:
        """Run a single variant and ingest its traces. Returns True on success."""
        model = spec["model"]
        tool_config = spec.get("tool_config", "full")
        allowed_tools = TOOL_PRESETS.get(tool_config)
        scenario = task_config["scenario"]
        scenario_args = dict(task_config.get("scenarioArgs") or {})
        scenario_args["allowed_tools"] = allowed_tools
        max_attempts = _coerce_int(task_config.get("maxAttempts"), 1, minimum=1)
        retry_delay_sec = _coerce_float(task_config.get("retryDelaySec"), 2.0, minimum=0.0)
        retry_transient_only = _coerce_bool(task_config.get("retryTransientOnly"), True)
        task_metadata = {
            "task_id": task_config.get("taskId"),
            "external_id": task_config.get("externalId"),
            "difficulty": task_config.get("difficulty"),
            "category": task_config.get("category"),
            "success_conditions": task_config.get("successConditions"),
        }
        logger.info(
            (
                "[experiment_runner] eval variant model=%s tool_config=%s scenario=%s "
                "max_attempts=%d retry_transient_only=%s"
            ),
            model,
            tool_config,
            scenario,
            max_attempts,
            retry_transient_only,
        )

        results = []
        attempt_used = 0
        last_error: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            attempt_used = attempt
            try:
                env = Environment(HUB_ENV).connect_hub(HUB_ENV)
                task = env(scenario, **scenario_args)

                async with hud.eval(task, variants={"model": [model]}, group=group) as ctx:
                    agent = create_agent(ctx.variants["model"])
                    await agent.run(ctx)

                # ctx.results is populated only when total_evals > 1 (parallel path).
                # When group=1 (single eval), ctx itself is the result.
                results = list(ctx.results) if ctx.results else [ctx]

                logger.info(
                    (
                        "[experiment_runner] eval complete model=%s tool_config=%s "
                        "attempt=%d/%d results=%d"
                    ),
                    model,
                    tool_config,
                    attempt,
                    max_attempts,
                    len(results),
                )
                break
            except Exception as exc:
                last_error = exc
                is_transient = _is_transient_eval_error(exc)
                should_retry = attempt < max_attempts and (is_transient or not retry_transient_only)
                logger.warning(
                    (
                        "[experiment_runner] HUD eval failed model=%s tool_config=%s "
                        "attempt=%d/%d transient=%s retrying=%s error=%s"
                    ),
                    model,
                    tool_config,
                    attempt,
                    max_attempts,
                    is_transient,
                    should_retry,
                    exc,
                )
                if should_retry and retry_delay_sec > 0:
                    await asyncio.sleep(retry_delay_sec)
                if not should_retry:
                    break

        if not results:
            logger.error(
                "[experiment_runner] HUD eval exhausted retries model=%s tool_config=%s: %s",
                model,
                tool_config,
                last_error,
            )
            await _update_variant_statuses(experiment_id, [spec], "failure")
            return False

        # ── 3. Ingest each trace from this variant ────────────────────────
        async with httpx.AsyncClient() as http_client:
            for r in results:
                if not r.trace_id:
                    continue
                try:
                    trace_data = await fetch_trace(r.trace_id, http_client)
                    trace_data["override_experiment_id"] = experiment_id
                    trace_data["model"] = model
                    trace_data["tool_config"] = tool_config
                    trace_data["model_label"] = f"{model}:{tool_config}"
                    trace_data["scenario"] = scenario
                    trace_data["attempt"] = attempt_used
                    trace_data["max_attempts"] = max_attempts
                    for key, value in task_metadata.items():
                        if value is not None:
                            trace_data[key] = value

                    await store_raw_mongo(trace_data)
                    await store_supermemory_chunks(trace_data, http_client, extra_spaces=spaces)
                    await store_convex_metrics(trace_data, http_client)

                    logger.info(
                        (
                            "[experiment_runner] Ingested trace=%s model=%s tool_config=%s "
                            "attempt=%d reward=%s"
                        ),
                        r.trace_id,
                        model,
                        tool_config,
                        attempt_used,
                        r.reward,
                    )
                except Exception as exc:
                    logger.error(
                        "[experiment_runner] Ingest failed for trace=%s: %s", r.trace_id, exc
                    )

        await _update_variant_statuses(experiment_id, [spec], "success")
        return True

    results_flags = await asyncio.gather(*[_run_variant(spec) for spec in variant_specs])
    any_success = any(results_flags)

    if not any_success:
        await _convex_mutation(
            "experiments:updateStatus",
            {"id": experiment_id, "status": "failed"},
        )
        return

    # ── 4. Mark experiment as completed ──────────────────────────────────────
    await _convex_mutation(
        "experiments:updateStatus",
        {"id": experiment_id, "status": "completed"},
    )

    # ── 5. Compute determinism scores (requires ≥2 runs per variant) ─────────
    if CONVEX_URL:
        try:
            logger.info("[experiment_runner] Computing determinism scores…")
            async with httpx.AsyncClient() as http_client:
                metrics_resp = await http_client.post(
                    f"{CONVEX_URL}/api/query",
                    json={
                        "path": "runs:getExperimentMetrics",
                        "args": {"experimentId": experiment_id},
                        "format": "json",
                    },
                    timeout=15,
                )
            if metrics_resp.status_code == 200:
                variant_metrics = metrics_resp.json().get("value", [])
                det_map: dict[str, list[dict]] = {}
                async with httpx.AsyncClient() as http_client:
                    for variant in variant_metrics:
                        variant_id = variant["variantId"]
                        runs_with_traces = []
                        for run_summary in variant.get("runs", []):
                            trace_id = run_summary.get("hudTraceId")
                            if not trace_id:
                                continue
                            try:
                                trace = await fetch_trace(trace_id, http_client)
                                runs_with_traces.append(
                                    {"run_id": run_summary["runId"], "trace": trace}
                                )
                            except Exception as exc:
                                logger.warning("Could not fetch trace %s: %s", trace_id, exc)
                        if runs_with_traces:
                            det_map[variant_id] = runs_with_traces
                if det_map:
                    await compute_determinism(experiment_id, det_map, CONVEX_URL)
        except Exception as exc:
            logger.warning("[experiment_runner] Determinism computation failed: %s", exc)

    logger.info("[experiment_runner] Experiment %s complete.", experiment_id)
