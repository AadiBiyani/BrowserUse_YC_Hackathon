"""
query_engine.py — Experiment-scoped RAG with pinned context + dynamic retrieval.

Every chat is scoped to a single experiment ID.  Static context (MongoDB raw
traces + Convex structured metrics) is pinned to the prompt for the full
conversation.  The only dynamic component is a Supermemory semantic search
driven by the user's question.

Exposes:
    answer_query(question: str, experiment_id: str) -> dict

Returns:
    {"answer": str, "cited_trace_ids": list[str]}
"""
from __future__ import annotations

import asyncio
import json
import logging
import os

import httpx
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv(override=True)

logger = logging.getLogger(__name__)

SUPERMEMORY_API_KEY = os.getenv("SUPERMEMORY_API_KEY", "")
OPENAI_API_KEY      = os.getenv("OPENAI_API_KEY", "")
CONVEX_URL          = os.getenv("CONVEX_URL", "")
MONGODB_URI         = os.getenv("MONGODB_URI", "")
QUERY_MODEL         = os.getenv("QUERY_ENGINE_MODEL", "gpt-4o")

SUPERMEMORY_SEARCH = "https://api.supermemory.ai/v4/search"

SYSTEM_PROMPT = """\
You are an AI agent performance analyst for AgentLens — a platform that \
benchmarks web-browsing AI agents on standardized tasks.

You are given the full dataset for one experiment:
  • TRACE DOCUMENTS — raw per-run data from MongoDB (steps, tool calls, \
LLM I/O, timing, errors).
  • STRUCTURED METRICS — aggregated per-variant statistics from Convex \
(success rate, cost, latency, steps, determinism).
  • SEMANTIC SEARCH RESULTS — trace chunks most relevant to the user's \
question (dynamically retrieved).

Guidelines:
- Cite specific numbers (cost, latency, success rate, steps) whenever possible.
- Reference individual trace IDs when discussing specific runs.
- Make concrete, actionable recommendations.
- Keep answers under 250 words unless more detail is requested.\
"""


# ── MongoDB: fetch all traces for an experiment ───────────────────────────────

def _fetch_mongo_traces_sync(experiment_id: str) -> list[dict]:
    """Synchronous pymongo fetch — called via asyncio.to_thread."""
    from pymongo import MongoClient

    client = MongoClient(MONGODB_URI, tlsInsecure=True)
    try:
        col = client["agentlens"]["traces"]
        docs = list(col.find({"override_experiment_id": experiment_id}).limit(100))
        return [_summarize_trace(doc) for doc in docs]
    finally:
        client.close()


def _summarize_trace(doc: dict) -> dict:
    """Trim a raw MongoDB trace to the fields useful for LLM context."""
    meta     = doc.get("metadata") or {}
    variants = meta.get("variants") or {}
    usage    = meta.get("usage") or {}
    trajectory = doc.get("trajectory") or []

    tool_steps: list[str] = []
    llm_steps: list[str] = []

    for span in trajectory[:80]:
        name = span.get("name", "")
        attrs = span.get("attributes") or {}

        if name == "tools/call.mcp":
            params = attrs.get("request", {}).get("params", {})
            tool_name = params.get("name", "?")
            args_str = json.dumps(params.get("arguments", {}))[:150]
            latency_ms = 0.0
            try:
                from datetime import datetime
                start = datetime.fromisoformat(span["start_time"])
                end   = datetime.fromisoformat(span["end_time"])
                latency_ms = (end - start).total_seconds() * 1000
            except (KeyError, ValueError):
                pass
            tool_steps.append(f"{tool_name}({args_str}) [{latency_ms:.0f}ms]")

        elif name.startswith("inference."):
            result = attrs.get("result") or {}
            tc_names = [
                tc.get("function", {}).get("name", "?")
                for tc in (result.get("tool_calls") or [])
            ]
            content_preview = (result.get("content") or "")[:120]
            llm_steps.append(
                f"model={attrs.get('model', '?')} "
                f"in={attrs.get('input_tokens', 0)} out={attrs.get('output_tokens', 0)} "
                f"{attrs.get('duration_ms', 0):.0f}ms"
                + (f" → tools: {tc_names}" if tc_names else f" → \"{content_preview}\"")
            )

    return {
        "trace_id":     doc.get("trace_id") or doc.get("_id"),
        "job_id":       doc.get("job_id"),
        "model":        variants.get("model") or doc.get("model"),
        "tool_config":  doc.get("tool_config"),
        "reward":       doc.get("reward"),
        "status":       doc.get("status"),
        "error":        doc.get("error"),
        "agent_steps":  meta.get("agent_steps"),
        "total_cost":   usage.get("total_cost"),
        "inference_calls": usage.get("inference_calls"),
        "total_input_tokens":  usage.get("total_input_tokens"),
        "total_output_tokens": usage.get("total_output_tokens"),
        "environment_runtime_s": usage.get("environment_total_runtime_seconds"),
        "tool_steps":   tool_steps,
        "llm_steps":    llm_steps,
    }


async def _fetch_mongo_traces(experiment_id: str) -> list[dict]:
    """Async wrapper — runs sync pymongo in a thread."""
    if not MONGODB_URI:
        logger.warning("MONGODB_URI not set — skipping MongoDB trace fetch")
        return []
    try:
        return await asyncio.to_thread(_fetch_mongo_traces_sync, experiment_id)
    except Exception as exc:
        logger.warning("MongoDB trace fetch failed: %s", exc)
        return []


# ── Convex: structured per-variant metrics ────────────────────────────────────

async def _fetch_convex_metrics(experiment_id: str) -> list[dict]:
    """Fetch structured per-variant metrics from Convex via the HTTP query API."""
    if not CONVEX_URL:
        logger.warning("CONVEX_URL not set — skipping structured metrics fetch")
        return []

    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                f"{CONVEX_URL}/api/query",
                json={
                    "path": "runs:getExperimentMetrics",
                    "args": {"experimentId": experiment_id},
                    "format": "json",
                },
                timeout=15,
            )
            if r.status_code == 200:
                return r.json().get("value", [])
            logger.warning("Convex metrics fetch %d: %s", r.status_code, r.text[:200])
        except httpx.HTTPError as exc:
            logger.warning("Convex metrics fetch HTTP error: %s", exc)
    return []


# ── Supermemory: dynamic semantic search ──────────────────────────────────────

async def _fetch_supermemory(question: str, experiment_id: str, limit: int = 15) -> list[dict]:
    """Semantic search over trace chunks scoped to this experiment only."""
    if not SUPERMEMORY_API_KEY:
        logger.warning("SUPERMEMORY_API_KEY not set — skipping semantic search")
        return []

    headers = {
        "Authorization": f"Bearer {SUPERMEMORY_API_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                SUPERMEMORY_SEARCH,
                headers=headers,
                json={
                    "q": question,
                    "containerTag": f"experiment-{experiment_id}",
                    "searchMode": "hybrid",
                    "limit": limit,
                },
                timeout=30,
            )
            if r.status_code == 200:
                results = r.json().get("results", [])
                return [
                    {
                        "content": res.get("memory") or res.get("chunk", ""),
                        "metadata": res.get("metadata") or {},
                    }
                    for res in results
                ]
            logger.warning("Supermemory search %d: %s", r.status_code, r.text[:200])
        except httpx.HTTPError as exc:
            logger.warning("Supermemory search HTTP error: %s", exc)
    return []


# ── Context builder ───────────────────────────────────────────────────────────

def _build_context(
    traces: list[dict],
    metrics: list[dict],
    semantic_results: list[dict],
) -> str:
    """Assemble the three data sources into a single LLM context string."""
    parts: list[str] = []

    # --- Section 1: pinned trace documents from MongoDB ---
    if traces:
        parts.append("=== TRACE DOCUMENTS (all runs in this experiment) ===")
        for t in traces:
            reward = t.get("reward")
            reward_str = f"{reward}" if reward is not None else "N/A"
            cost = t.get("total_cost")
            cost_str = f"${cost:.4f}" if cost is not None else "N/A"
            runtime = t.get("environment_runtime_s")
            runtime_str = f"{runtime:.1f}s" if runtime is not None else "N/A"

            header = (
                f"trace_id={t['trace_id']}  model={t.get('model','?')}"
                f"  tool_config={t.get('tool_config','?')}  reward={reward_str}"
                f"  status={t.get('status','?')}  steps={t.get('agent_steps','?')}"
                f"  cost={cost_str}  runtime={runtime_str}"
                f"  llm_calls={t.get('inference_calls','?')}"
                f"  tokens_in={t.get('total_input_tokens','?')}"
                f"  tokens_out={t.get('total_output_tokens','?')}"
            )
            lines = [header]
            if t.get("error"):
                lines.append(f"  error: {t['error']}")
            if t.get("tool_steps"):
                lines.append("  browser actions:")
                for step in t["tool_steps"][:20]:
                    lines.append(f"    {step}")
            if t.get("llm_steps"):
                lines.append("  llm calls:")
                for step in t["llm_steps"][:15]:
                    lines.append(f"    {step}")
            parts.append("\n".join(lines))

    # --- Section 2: pinned structured metrics from Convex ---
    if metrics:
        parts.append("=== STRUCTURED METRICS (aggregated per variant) ===")
        for m in metrics:
            det = (
                f"{m['avgDeterminismScore'] * 100:.0f}%"
                if m.get("avgDeterminismScore") is not None
                else "N/A"
            )
            parts.append(
                f"  {m.get('model','?')} (tool_config={m.get('toolConfig','full')}): "
                f"runs={m['runCount']}  success_rate={round(m['successRate'] * 100)}%"
                f"  avg_steps={m['avgSteps']:.1f}  avg_cost=${m['avgCostUsd']:.4f}"
                f"  avg_latency={m['avgLatencyMs'] / 1000:.1f}s  determinism={det}"
            )

    # --- Section 3: dynamic semantic search results ---
    if semantic_results:
        parts.append("=== SEMANTIC SEARCH RESULTS (relevant to the question) ===")
        for i, res in enumerate(semantic_results[:12]):
            content = res.get("content", "")
            meta    = res.get("metadata", {})
            if not content:
                continue
            model  = meta.get("model", "?")
            reward = meta.get("reward", "?")
            ctype  = meta.get("chunk_type", "?")
            parts.append(
                f"[{i + 1}] model={model}  reward={reward}  chunk_type={ctype}\n"
                f"{content[:500]}"
            )

    return "\n\n".join(parts)


# ── Main entry point ──────────────────────────────────────────────────────────

async def answer_query(question: str, experiment_id: str) -> dict:
    """
    Answer a natural-language question about an experiment.

    Static context (MongoDB traces + Convex metrics) is pinned for the entire
    experiment.  Dynamic context (Supermemory) is retrieved per-question.

    Returns:
        {"answer": str, "cited_trace_ids": list[str]}
    """
    traces, metrics, semantic_results = await asyncio.gather(
        _fetch_mongo_traces(experiment_id),
        _fetch_convex_metrics(experiment_id),
        _fetch_supermemory(question, experiment_id),
    )

    cited_trace_ids: list[str] = list(dict.fromkeys(
        tid for tid in (
            t.get("trace_id") for t in traces
        ) if tid
    ))

    sm_trace_ids = [
        res.get("metadata", {}).get("trace_id")
        for res in semantic_results
        if res.get("metadata", {}).get("trace_id")
    ]
    for tid in sm_trace_ids:
        if tid and tid not in cited_trace_ids:
            cited_trace_ids.append(tid)

    context = _build_context(traces, metrics, semantic_results)

    if not context.strip():
        return {
            "answer": (
                "No trace data found for this experiment. "
                "Make sure the experiment has completed at least one run and data "
                "has been ingested into MongoDB, Supermemory, and Convex."
            ),
            "cited_trace_ids": [],
        }

    if not OPENAI_API_KEY:
        return {
            "answer": f"[OPENAI_API_KEY not configured]\n\nRaw context:\n{context[:1500]}",
            "cited_trace_ids": cited_trace_ids,
        }

    client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    response = await client.chat.completions.create(
        model=QUERY_MODEL,
        max_tokens=1024,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Experiment data:\n\n{context}\n\nQuestion: {question}",
            },
        ],
    )

    answer = response.choices[0].message.content or "(no answer generated)"
    return {"answer": answer, "cited_trace_ids": cited_trace_ids}
