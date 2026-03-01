"""
query_engine.py — Supermemory RAG + Convex structured metrics + GPT-4o-mini synthesis.

Exposes:
    answer_query(question: str, experiment_id: str) -> dict

Returns:
    {"answer": str, "cited_trace_ids": list[str]}
"""
from __future__ import annotations

import asyncio
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
QUERY_MODEL         = os.getenv("QUERY_ENGINE_MODEL", "gpt-4o-mini")

SUPERMEMORY_SEARCH = "https://api.supermemory.ai/v4/search"


async def _search_supermemory_tag(
    client: httpx.AsyncClient,
    question: str,
    container_tag: str,
    limit: int,
) -> list[dict]:
    """Single Supermemory v4 search scoped to one container tag."""
    headers = {
        "Authorization": f"Bearer {SUPERMEMORY_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        r = await client.post(
            SUPERMEMORY_SEARCH,
            headers=headers,
            json={"q": question, "containerTag": container_tag, "searchMode": "hybrid", "limit": limit},
            timeout=30,
        )
        if r.status_code == 200:
            results = r.json().get("results", [])
            return [
                {"content": res.get("memory") or res.get("chunk", ""), "metadata": res.get("metadata") or {}}
                for res in results
            ]
        logger.warning("Supermemory search %s %d: %s", container_tag, r.status_code, r.text[:200])
    except httpx.HTTPError as exc:
        logger.warning("Supermemory search HTTP error (%s): %s", container_tag, exc)
    return []


async def _fetch_supermemory(question: str, experiment_id: str, limit: int = 20) -> list[dict]:
    """Semantic search over trace chunks in both the experiment tag and the seed tag."""
    if not SUPERMEMORY_API_KEY:
        logger.warning("SUPERMEMORY_API_KEY not set — skipping semantic search")
        return []

    per_tag = limit // 2 or limit
    async with httpx.AsyncClient() as client:
        experiment_results, seed_results = await asyncio.gather(
            _search_supermemory_tag(client, question, f"experiment-{experiment_id}", per_tag),
            _search_supermemory_tag(client, question, "experiment-seed", per_tag),
        )

    # Deduplicate by content, experiment-specific results take precedence
    seen: set[str] = set()
    merged: list[dict] = []
    for res in experiment_results + seed_results:
        key = res["content"][:100]
        if key not in seen:
            seen.add(key)
            merged.append(res)
    return merged[:limit]


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


def _build_context(semantic_results: list[dict], metrics: list[dict]) -> str:
    """Combine structured metrics + semantic trace evidence into an LLM context string."""
    parts: list[str] = []

    if metrics:
        parts.append("=== STRUCTURED METRICS (aggregated per model) ===")
        for m in metrics:
            det = (
                f"{m['avgDeterminismScore'] * 100:.0f}%"
                if m.get("avgDeterminismScore") is not None
                else "N/A"
            )
            parts.append(
                f"  {m['model']}: runs={m['runCount']}  success_rate={round(m['successRate'] * 100)}%"
                f"  avg_steps={m['avgSteps']:.1f}  avg_cost=${m['avgCostUsd']:.4f}"
                f"  avg_latency={m['avgLatencyMs'] / 1000:.1f}s  determinism={det}"
            )

    if semantic_results:
        parts.append("\n=== TRACE EVIDENCE (semantic search over step data) ===")
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
                f"{content[:400]}"
            )

    return "\n\n".join(parts)


async def answer_query(question: str, experiment_id: str) -> dict:
    """
    Answer a natural-language question about an experiment using RAG.

    Args:
        question:      The user's question (e.g. "Which model is cheapest?")
        experiment_id: Convex experiment ID (used to scope Supermemory + Convex fetch)

    Returns:
        {"answer": str, "cited_trace_ids": list[str]}
    """
    semantic_results, metrics = await asyncio.gather(
        _fetch_supermemory(question, experiment_id),
        _fetch_convex_metrics(experiment_id),
    )

    cited_trace_ids: list[str] = list(
        dict.fromkeys(
            res.get("metadata", {}).get("trace_id", "")
            for res in semantic_results
            if res.get("metadata", {}).get("trace_id")
        )
    )[:5]

    context = _build_context(semantic_results, metrics)

    if not context.strip():
        return {
            "answer": (
                "No trace data found for this experiment. "
                "Make sure the experiment has completed at least one run and data has been ingested "
                "into Supermemory and Convex."
            ),
            "cited_trace_ids": [],
        }

    if not OPENAI_API_KEY:
        return {
            "answer": f"[OPENAI_API_KEY not configured]\n\nRaw context:\n{context[:1000]}",
            "cited_trace_ids": cited_trace_ids,
        }

    client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    response = await client.chat.completions.create(
        model=QUERY_MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an AI agent performance analyst. You answer questions about web agent "
                    "experiment results using trace data and structured metrics. Always cite specific "
                    "numbers (cost, latency, success rate, steps). Make concrete, actionable "
                    "recommendations. Keep answers under 200 words unless more detail is requested."
                ),
            },
            {
                "role": "user",
                "content": f"Experiment data:\n\n{context}\n\nQuestion: {question}",
            },
        ],
    )

    answer = response.choices[0].message.content or "(no answer generated)"
    return {"answer": answer, "cited_trace_ids": cited_trace_ids}
