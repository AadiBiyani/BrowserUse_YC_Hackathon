"""
api.py — AgentLens FastAPI server.

Routes:
    GET  /health
    POST /query                   → {answer, cited_trace_ids}
    POST /run-experiment          → starts async HUD eval, returns {status, experiment_id}
    POST /run-analyzer            → starts async analyzer job, returns {status, experiment_id, analyzer_type, job_id}
    POST /compute-determinism     → compute + store determinism scores for an experiment

Start:
    cd backend
    uv run uvicorn api:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import logging
import os
from uuid import uuid4

from dotenv import load_dotenv

load_dotenv(override=True)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from query_engine import answer_query
from task_payload import normalize_task_payload

CONVEX_URL = os.getenv("CONVEX_URL", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AgentLens API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ─────────────────────────────────────────────────

class QueryRequest(BaseModel):
    experiment_id: str
    question: str


class QueryResponse(BaseModel):
    answer: str
    cited_trace_ids: list[str]


class RunExperimentRequest(BaseModel):
    experiment_id: str
    task: dict                  # legacy or normalized scenario payload
    variant_specs: list[dict]   # [{model, tool_config}, ...]
    group: int = 3


class ComputeDeterminismRequest(BaseModel):
    experiment_id: str


class RunAnalyzerRequest(BaseModel):
    experiment_id: str
    analyzer_type: str


ALLOWED_ANALYZER_TYPES = {
    "reward_hacking",
    "failure_reasoning",
    "tool_use",
}


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "agentlens-api"}


@app.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest):
    """Answer a natural-language question about experiment results using RAG."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question cannot be empty")
    try:
        result = await answer_query(req.question, req.experiment_id)
        return QueryResponse(**result)
    except Exception as exc:
        logger.exception("query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/run-experiment")
async def run_experiment_endpoint(req: RunExperimentRequest):
    """
    Launch a HUD experiment run asynchronously.
    Returns immediately; the actual run happens as a background task.
    """
    if not req.variant_specs:
        raise HTTPException(status_code=400, detail="at least one variant_spec is required")
    try:
        normalized_task = normalize_task_payload(req.task)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        from experiment_runner import run_experiment
    except ImportError as exc:
        raise HTTPException(
            status_code=500, detail=f"experiment_runner module unavailable: {exc}"
        ) from exc

    asyncio.create_task(
        run_experiment(
            experiment_id=req.experiment_id,
            task_config=normalized_task,
            variant_specs=req.variant_specs,
            group=req.group,
        )
    )

    logger.info(
        "Background experiment started: id=%s variants=%s group=%d",
        req.experiment_id, req.variant_specs, req.group,
    )
    return {"status": "started", "experiment_id": req.experiment_id}


@app.post("/run-analyzer")
async def run_analyzer_endpoint(req: RunAnalyzerRequest):
    """
    Launch a QA analyzer job asynchronously.
    Returns immediately; the analyzer run happens as a background task.
    """
    if not req.experiment_id.strip():
        raise HTTPException(status_code=400, detail="experiment_id cannot be empty")
    if req.analyzer_type not in ALLOWED_ANALYZER_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                "invalid analyzer_type; expected one of "
                f"{', '.join(sorted(ALLOWED_ANALYZER_TYPES))}"
            ),
        )

    try:
        from qa_analyzers import run_analyzer_job
    except ImportError as exc:
        raise HTTPException(
            status_code=500, detail=f"qa_analyzers module unavailable: {exc}"
        ) from exc

    job_id = str(uuid4())
    asyncio.create_task(
        run_analyzer_job(
            experiment_id=req.experiment_id,
            analyzer_type=req.analyzer_type,
            job_id=job_id,
        )
    )

    logger.info(
        "Background analyzer started: experiment_id=%s analyzer_type=%s job_id=%s",
        req.experiment_id,
        req.analyzer_type,
        job_id,
    )
    return {
        "status": "accepted",
        "experiment_id": req.experiment_id,
        "analyzer_type": req.analyzer_type,
        "job_id": job_id,
    }


@app.post("/compute-determinism")
async def compute_determinism_endpoint(req: ComputeDeterminismRequest):
    """
    Fetch all runs for an experiment from Convex, pull their HUD traces,
    compute pairwise behavioural similarity within each model variant, and
    write the scores back to Convex.
    """
    if not CONVEX_URL:
        raise HTTPException(status_code=500, detail="CONVEX_URL not configured")

    import httpx
    from determinism import compute_and_store
    from data_pipeline import fetch_trace

    # 1. Fetch experiment metrics (variants + run list) from Convex
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{CONVEX_URL}/api/query",
            json={
                "path": "runs:getExperimentMetrics",
                "args": {"experimentId": req.experiment_id},
                "format": "json",
            },
            timeout=15,
        )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Convex query failed: {r.text[:300]}")

    variant_metrics = r.json().get("value", [])
    if not variant_metrics:
        return {"status": "no_data", "experiment_id": req.experiment_id}

    # 2. Build variant_run_map: fetch HUD traces for every run
    variant_run_map: dict[str, list[dict]] = {}
    async with httpx.AsyncClient() as client:
        for variant in variant_metrics:
            variant_id = variant["variantId"]
            runs_with_traces = []
            for run_summary in variant.get("runs", []):
                trace_id = run_summary.get("hudTraceId")
                if not trace_id:
                    continue
                try:
                    trace = await fetch_trace(trace_id, client)
                    runs_with_traces.append({"run_id": run_summary["runId"], "trace": trace})
                except Exception as exc:
                    logger.warning("Could not fetch trace %s: %s", trace_id, exc)
            if runs_with_traces:
                variant_run_map[variant_id] = runs_with_traces

    if not variant_run_map:
        return {"status": "no_traces", "experiment_id": req.experiment_id}

    # 3. Compute + store scores
    try:
        summary = await compute_and_store(req.experiment_id, variant_run_map, CONVEX_URL)
        return {"status": "ok", **summary}
    except Exception as exc:
        logger.exception("compute_determinism failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
