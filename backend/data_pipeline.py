"""
data_pipeline.py — Three-sink ingestion: raw HUD trace → MongoDB, browser steps →
Supermemory semantic chunks, aggregate metrics → Convex.

Call `ingest_run()` with a trace_id after hud_runner.py finishes, or run this file
directly to re-ingest the seed traces saved to runs/seed_traces_raw.json.

Required additional env vars (add to .env):
    MONGODB_URI             — MongoDB Atlas connection string
    SUPERMEMORY_API_KEY     — Supermemory API key (https://supermemory.ai)

Already in .env:
    HUD_API_KEY             — for fetching traces from HUD telemetry API
    CONVEX_SITE_URL         — Convex HTTP Actions base URL

Additional dependency (not yet in pyproject.toml):
    motor>=3.3.0            — async MongoDB driver  (uv add motor)

Usage:
    cd backend
    uv run python data_pipeline.py                      # re-ingest seed traces
    uv run python data_pipeline.py <trace_id>           # ingest one trace
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv(override=True)

logger = logging.getLogger(__name__)

# ── Connection config ─────────────────────────────────────────────────────────

HUD_API_KEY         = os.getenv("HUD_API_KEY", "")
MONGODB_URI         = os.getenv("MONGODB_URI", "")
SUPERMEMORY_API_KEY = os.getenv("SUPERMEMORY_API_KEY", "")
CONVEX_SITE_URL     = os.getenv("CONVEX_SITE_URL", "")

HUD_TELEMETRY_BASE  = "https://api.hud.ai/telemetry/traces"
SUPERMEMORY_BASE    = "https://api.supermemory.ai/v3/documents"

MONGO_DB_NAME       = "agentlens"
MONGO_COLLECTION    = "traces"


# ── HUD fetch ─────────────────────────────────────────────────────────────────

async def fetch_trace(trace_id: str, client: httpx.AsyncClient) -> dict:
    """Fetch full trace with trajectory from HUD telemetry API."""
    r = await client.get(
        f"{HUD_TELEMETRY_BASE}/{trace_id}",
        headers={"Authorization": f"Bearer {HUD_API_KEY}"},
        params={
            "include_trajectory": "true",
            "include_logs": "false",
            "include_rollout_logs": "false",
        },
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


# ── Sink 1: MongoDB (raw archive) ─────────────────────────────────────────────

def _store_raw_mongo_sync(data: dict) -> None:
    """Upsert the full trace JSON blob into MongoDB using plain pymongo."""
    from pymongo import MongoClient  # type: ignore[import]

    # tlsInsecure=True bypasses the TLS negotiation mismatch between Python 3.11's
    # OpenSSL and certain Atlas replica set members (TLSV1_ALERT_INTERNAL_ERROR).
    client = MongoClient(MONGODB_URI, tlsInsecure=True)
    try:
        col = client[MONGO_DB_NAME][MONGO_COLLECTION]
        col.replace_one(
            {"_id": data["trace_id"]},
            {"_id": data["trace_id"], **data},
            upsert=True,
        )
        logger.info("MongoDB: upserted trace %s", data["trace_id"])
    finally:
        client.close()


async def store_raw_mongo(data: dict) -> None:
    """Async wrapper — runs the sync pymongo call in a thread."""
    if not MONGODB_URI:
        logger.warning("MONGODB_URI not set — skipping MongoDB sink")
        return
    await asyncio.to_thread(_store_raw_mongo_sync, data)


# ── Sink 2: Supermemory (semantic chunks) ─────────────────────────────────────

def _build_supermemory_chunks(data: dict) -> list[dict]:
    """
    Build 3 semantic text chunks per trace following the extraction guide in
    TRACE_SCHEMA.md:
      - Chunk 1: Outcome summary (model, reward, cost, tools used)
      - Chunk 2: Per-step browser actions (tools/call.mcp spans)
      - Chunk 3: LLM I/O summary (inference.* spans)

    Field names are verified against live trajectory data.
    """
    trace_id   = data["trace_id"]
    job_id     = data.get("job_id", "")
    reward     = data.get("reward", 0.0)
    status     = data.get("status", "")
    meta       = data.get("metadata") or {}
    variants   = meta.get("variants") or {}
    model      = variants.get("model", "unknown")
    agent_steps      = meta.get("agent_steps", 0)
    usage            = meta.get("usage") or {}
    inference_calls  = usage.get("inference_calls", 0)
    total_cost       = usage.get("total_cost", 0.0)
    scenario_args    = data.get("scenario_args") or {}
    task_label       = scenario_args.get("url") or data.get("external_id") or "unknown"
    trajectory       = data.get("trajectory") or []

    reward_val = reward if reward is not None else 0.0
    base_tags = {
        "trace_id": trace_id,
        "job_id":   job_id,
        "model":    model,
        "reward":   reward_val,
        "task":     task_label,
    }

    chunks: list[dict] = []

    # ── Chunk 1: Outcome summary ──────────────────────────────────────────────
    tool_names = list(dict.fromkeys(
        s["attributes"]["request"]["params"]["name"]
        for s in trajectory
        if s.get("name") == "tools/call.mcp"
        and s.get("attributes", {}).get("request", {}).get("params", {}).get("name")
    ))
    outcome_text = (
        f"Model {model} {'succeeded' if reward_val >= 1.0 else 'failed'} on task '{task_label}' "
        f"in {agent_steps} agent steps, {inference_calls} LLM calls, "
        f"${total_cost:.4f} total cost. "
        f"Tools used: {', '.join(tool_names) or 'none'}. "
        f"Status: {status}. Reward: {reward_val}."
    )
    chunks.append({
        "content":  outcome_text,
        "metadata": {**base_tags, "chunk_type": "outcome_summary", "step_index": -1},
    })

    # ── Chunk 2: Per-step browser actions (tools/call.mcp) ───────────────────
    action_lines: list[str] = []
    tool_step = 0
    for span in trajectory:
        if span.get("name") != "tools/call.mcp":
            continue
        attrs     = span.get("attributes", {})
        params    = attrs.get("request", {}).get("params", {})
        tool_name = params.get("name", "unknown")
        args      = params.get("arguments", {})

        # result.content[0].text is a JSON string — parse for long_term_memory
        mem = ""
        try:
            result_content = attrs.get("result", {}).get("content") or []
            if result_content:
                parsed = json.loads(result_content[0]["text"])
                mem = (
                    parsed.get("result", {}).get("long_term_memory")
                    or parsed.get("error", "")
                )
        except (json.JSONDecodeError, KeyError, IndexError, TypeError):
            pass

        # No duration_ms on MCP spans — compute from ISO timestamps
        latency_ms = 0.0
        try:
            start = datetime.fromisoformat(span["start_time"])
            end   = datetime.fromisoformat(span["end_time"])
            latency_ms = (end - start).total_seconds() * 1000
        except (KeyError, ValueError):
            pass

        args_repr = json.dumps(args)[:120]
        action_lines.append(
            f"Step {tool_step}: {tool_name}({args_repr}) → {mem} [{latency_ms:.0f}ms]"
        )
        tool_step += 1

    if action_lines:
        chunks.append({
            "content":  "\n".join(action_lines),
            "metadata": {**base_tags, "chunk_type": "browser_actions", "step_index": -1},
        })

    # ── Chunk 3: LLM I/O (inference.responses / inference.messages) ──────────
    # Both OpenAI and Anthropic spans start with "inference." — filter by prefix.
    llm_lines: list[str] = []
    llm_step = 0
    for span in trajectory:
        if not span.get("name", "").startswith("inference."):
            continue
        attrs      = span.get("attributes", {})
        result     = attrs.get("result") or {}
        tool_calls = result.get("tool_calls") or []
        content    = (result.get("content") or "")[:200]

        tc_names = [tc["function"]["name"] for tc in tool_calls if tc.get("function")]
        llm_lines.append(
            f"LLM call {llm_step}: model={attrs.get('model', model)} "
            f"{attrs.get('input_tokens', 0)} in / {attrs.get('output_tokens', 0)} out, "
            f"{attrs.get('duration_ms', 0.0):.0f}ms. "
            + (f"Tool calls: {tc_names}" if tc_names else f"Final answer: {content}")
        )
        llm_step += 1

    if llm_lines:
        chunks.append({
            "content":  "\n".join(llm_lines),
            "metadata": {**base_tags, "chunk_type": "llm_io", "step_index": -1},
        })

    return chunks


async def store_supermemory_chunks(
    data: dict,
    client: httpx.AsyncClient,
    *,
    extra_spaces: list[str] | None = None,
) -> int:
    """
    POST each semantic chunk to Supermemory.
    Returns the number of chunks successfully stored.

    Args:
        extra_spaces: Additional Supermemory spaces to tag every chunk with
                      (e.g. ["experiment-seed"] for the seed run so all seed
                      traces can be queried as a single group).
    """
    if not SUPERMEMORY_API_KEY:
        logger.warning("SUPERMEMORY_API_KEY not set — skipping Supermemory sink")
        return 0

    chunks  = _build_supermemory_chunks(data)
    headers = {
        "Authorization": f"Bearer {SUPERMEMORY_API_KEY}",
        "Content-Type": "application/json",
    }
    # Use the experiment container tag for grouping; fall back to a trace-level
    # tag if no experiment space is provided.
    experiment_spaces = [s for s in (extra_spaces or []) if s.startswith("experiment-")]
    container_tag = experiment_spaces[0] if experiment_spaces else f"trace-{data['trace_id']}"
    stored = 0
    for chunk in chunks:
        try:
            r = await client.post(
                SUPERMEMORY_BASE,
                headers=headers,
                json={
                    "content":      chunk["content"],
                    "metadata":     chunk["metadata"],
                    "containerTag": container_tag,
                },
                timeout=30,
                follow_redirects=True,
            )
            if r.status_code in (200, 201):
                stored += 1
                logger.info(
                    "Supermemory: stored %s chunk for %s",
                    chunk["metadata"]["chunk_type"], data["trace_id"],
                )
            else:
                logger.warning(
                    "Supermemory %d for trace %s chunk %s: %s",
                    r.status_code, data["trace_id"],
                    chunk["metadata"]["chunk_type"], r.text[:200],
                )
        except httpx.HTTPError as exc:
            logger.error("Supermemory HTTP error for trace %s: %s", data["trace_id"], exc)

    return stored


# ── Sink 3: Convex (structured metrics) ──────────────────────────────────────

def _build_convex_metrics(data: dict) -> dict:
    """
    Extract the flat metrics row for Convex from a trace dict.
    All field names are verified against live HUD trace responses (TRACE_SCHEMA.md).
    """
    meta     = data.get("metadata") or {}
    variants = meta.get("variants") or {}
    usage    = meta.get("usage") or {}
    eval_res = meta.get("evaluation_result") or {}

    return {
        # Identity
        "trace_id":    data["trace_id"],
        "job_id":      data.get("job_id"),
        "external_id": data.get("external_id"),        # human-readable task ID e.g. "0001"
        "task_id":     data.get("task_id"),
        "scenario":    data.get("scenario"),            # e.g. "answer"

        # Variant & outcome
        "model":   variants.get("model"),
        "reward":  data.get("reward", 0.0),
        "status":  data.get("status"),                  # "completed" | "error"
        "error":   data.get("error"),

        # Step counts  (metadata.*)
        "agent_steps":       meta.get("agent_steps"),
        "mcp_tool_steps":    meta.get("mcp_tool_steps"),
        "base_mcp_steps":    meta.get("base_mcp_steps"),
        "trajectory_length": data.get("trajectory_length"),

        # Token / call counts  (metadata.usage.*)
        "inference_calls":            usage.get("inference_calls"),
        "agent_actions":              usage.get("agent_actions"),
        "total_input_tokens":         usage.get("total_input_tokens"),
        "total_output_tokens":        usage.get("total_output_tokens"),
        "avg_output_tokens_per_call": usage.get("avg_output_tokens_per_call"),
        "max_output_tokens_per_call": usage.get("max_output_tokens_per_call"),

        # Cost  (metadata.usage.*)
        "total_cost":        usage.get("total_cost"),
        "inference_cost":    usage.get("inference_cost"),
        "environment_cost":  usage.get("environment_cost"),

        # Environment runtime  (metadata.usage.*)
        "environment_total_runtime_seconds": usage.get("environment_total_runtime_seconds"),
        "environment_transactions":          usage.get("environment_transactions"),
        "environment_still_running":         usage.get("environment_still_running"),

        # Evaluation result  (metadata.evaluation_result.*)
        "eval_done":     eval_res.get("done"),
        "eval_is_error": eval_res.get("isError"),

        # Timestamps
        "usage_calculated_at": usage.get("calculated_at"),
        "ingested_at":         datetime.now(tz=timezone.utc).isoformat(),

        # Optional: set by experiment_runner.py to route the run to the correct experiment
        # in Convex without relying on the job_id lookup.
        "override_experiment_id": data.get("override_experiment_id"),
    }


async def store_convex_metrics(data: dict, client: httpx.AsyncClient) -> None:
    """POST the flat metrics row to the Convex HTTP Actions ingestTrace endpoint."""
    if not CONVEX_SITE_URL:
        logger.warning("CONVEX_SITE_URL not set — skipping Convex sink")
        return

    metrics = _build_convex_metrics(data)
    try:
        r = await client.post(
            f"{CONVEX_SITE_URL}/ingestTrace",
            json=metrics,
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        if r.status_code in (200, 201):
            logger.info("Convex: stored metrics for trace %s", data["trace_id"])
        else:
            logger.warning(
                "Convex ingestTrace %d for trace %s: %s",
                r.status_code, data["trace_id"], r.text[:200],
            )
    except httpx.HTTPError as exc:
        logger.error("Convex HTTP error for trace %s: %s", data["trace_id"], exc)


# ── Main ingestion entrypoint ─────────────────────────────────────────────────

async def ingest_run(
    trace_id: str,
    *,
    data: dict | None = None,
    http_client: httpx.AsyncClient | None = None,
    supermemory_spaces: list[str] | None = None,
) -> dict[str, Any]:
    """
    Ingest a single HUD trace into all three storage backends concurrently.

    Args:
        trace_id:           HUD trace UUID (with dashes).
        data:               Pre-fetched trace dict — skip the HUD fetch if available.
        http_client:        Reuse a shared httpx client (created internally if not provided).
        supermemory_spaces: Additional Supermemory spaces beyond the per-trace space
                            (e.g. ["experiment-seed"] for the seed ingestion pass).

    Returns:
        {
            "trace_id":      str,
            "reward":        float | None,
            "model":         str | None,
            "chunks_stored": int,
            "errors":        list[str],
        }
    """
    own_client = http_client is None
    client     = http_client or httpx.AsyncClient()
    errors: list[str] = []

    try:
        # Fetch from HUD if caller didn't supply pre-fetched data
        if data is None:
            logger.info("Fetching trace %s from HUD…", trace_id)
            try:
                data = await fetch_trace(trace_id, client)
            except httpx.HTTPStatusError as exc:
                msg = f"HUD fetch failed ({exc.response.status_code}): {exc}"
                logger.error(msg)
                errors.append(msg)
                return {
                    "trace_id": trace_id, "reward": None,
                    "model": None, "chunks_stored": 0, "errors": errors,
                }

        # Fan out to all three sinks concurrently
        mongo_task       = store_raw_mongo(data)
        supermemory_task = store_supermemory_chunks(
            data, client, extra_spaces=supermemory_spaces
        )
        convex_task      = store_convex_metrics(data, client)

        mongo_res, sm_res, convex_res = await asyncio.gather(
            mongo_task, supermemory_task, convex_task,
            return_exceptions=True,
        )

        sink_labels = ["mongodb", "supermemory", "convex"]
        for label, res in zip(sink_labels, [mongo_res, sm_res, convex_res]):
            if isinstance(res, Exception):
                msg = f"{label} error: {res}"
                logger.error(msg)
                errors.append(msg)

        chunks_stored = sm_res if isinstance(sm_res, int) else 0
        meta    = data.get("metadata") or {}
        model   = (meta.get("variants") or {}).get("model")

        return {
            "trace_id":      data["trace_id"],
            "reward":        data.get("reward"),
            "model":         model,
            "chunks_stored": chunks_stored,
            "errors":        errors,
        }

    finally:
        if own_client:
            await client.aclose()


async def ingest_job(
    job_results: list[dict],
    *,
    supermemory_spaces: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Ingest all traces from a completed hud_runner job in parallel.

    Args:
        job_results:        List of result dicts with at least a "trace_id" key,
                            as produced by hud_runner.py.
        supermemory_spaces: Additional Supermemory spaces added to every trace's
                            chunks (e.g. ["experiment-seed"]).

    Returns:
        List of ingest_run() summaries, one per trace.
    """
    async with httpx.AsyncClient() as client:
        return await asyncio.gather(*[
            ingest_run(
                r["trace_id"],
                http_client=client,
                supermemory_spaces=supermemory_spaces,
            )
            for r in job_results
            if r.get("trace_id")
        ])


# ── CLI entrypoint ────────────────────────────────────────────────────────────

async def _cli_main() -> None:
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )

    if len(sys.argv) > 1:
        trace_id = sys.argv[1]
        print(f"[data_pipeline] Ingesting trace {trace_id}…")
        result = await ingest_run(trace_id)
        print(json.dumps(result, indent=2))
        return

    # Default: re-ingest the seed traces written by hud_runner.py
    seed_file = Path(__file__).parent / "runs" / "seed_traces_raw.json"
    if not seed_file.exists():
        print(f"[data_pipeline] {seed_file} not found.")
        print("  Run hud_runner.py first, or pass a trace_id directly.")
        print("  Usage: uv run python data_pipeline.py <trace_id>")
        return

    payload = json.loads(seed_file.read_text())
    results_list = payload.get("results", [])
    print(f"[data_pipeline] Ingesting {len(results_list)} seed traces from {seed_file}…\n")
    print("  Supermemory spaces: trace-<id>, experiment-seed\n")

    summaries = await ingest_job(
        results_list,
        supermemory_spaces=["experiment-seed"],
    )
    ok_count  = sum(1 for s in summaries if not s["errors"])
    for s in summaries:
        marker = "✓" if not s["errors"] else "✗"
        print(
            f"  {marker}  {s['trace_id']}  "
            f"model={s['model']}  reward={s['reward']}  "
            f"chunks={s['chunks_stored']}"
            + (f"  errors={s['errors']}" if s["errors"] else "")
        )
    print(f"\n[data_pipeline] Done. {ok_count}/{len(summaries)} traces ingested without errors.")


if __name__ == "__main__":
    asyncio.run(_cli_main())
