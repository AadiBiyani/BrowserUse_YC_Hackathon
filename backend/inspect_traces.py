"""
inspect_traces.py — Fetch full trace data from HUD API for 2-3 seed traces
and save raw JSON so we can examine the exact step schema.

Tries three strategies in order:
  1. MCP streamable-HTTP transport (initialize → notifications/initialized → tools/call)
  2. REST endpoint variants (telemetry + api base URLs)
  3. HUD web UI scrape fallback (hud.ai/trace/<id>)

Usage:
    cd backend && uv run python inspect_traces.py
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

HUD_API_KEY = os.environ["HUD_API_KEY"]
HUD_API_URL = "https://api.hud.ai"
HUD_TELEMETRY_URL = "https://telemetry.hud.ai/v3/api"
HUD_MCP_URL = "https://mcp.hud.ai/v3/mcp"

# Pick 3 interesting traces: gpt-4o PASS, gpt-4o FAIL, claude PASS
TRACE_IDS = {
    "gpt4o_pass":   "5cd19812-a3dc-4714-a0bc-1db7afa62e61",
    "gpt4o_fail":   "0e240ae9-9716-4826-84cb-b699225c68b2",
    "claude_pass":  "bb2daf44-b77e-4294-b296-5179415d4ed0",
}

JOB_ID = "1325246e-c8e0-40b3-9d91-08db5978c64d"

OUT_DIR = Path(__file__).parent / "runs"
OUT_DIR.mkdir(exist_ok=True)

AUTH_HEADERS = {
    "Authorization": f"Bearer {HUD_API_KEY}",
    "Content-Type": "application/json",
    # HUD MCP server requires environment identification
    "Environment-Name": "replaybench-browser-env",
}


# ── MCP streamable HTTP transport ────────────────────────────────────────────

async def mcp_initialize(client: httpx.AsyncClient) -> str | None:
    """Send MCP initialize and return session ID (from header or body)."""
    payload = {
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "replaybench-inspector", "version": "0.1"},
        },
    }
    r = await client.post(HUD_MCP_URL, headers=AUTH_HEADERS, json=payload, timeout=30)
    print(f"    initialize → {r.status_code}")
    if r.status_code >= 400:
        print(f"    body: {r.text[:300]}")
        return None

    # Session ID may come from response header or body
    session_id = (
        r.headers.get("mcp-session-id")
        or r.headers.get("x-session-id")
        or r.headers.get("x-mcp-session-id")
    )

    # Also check response body for session ID
    try:
        body = r.json()
        print(f"    initialize body: {json.dumps(body)[:400]}")
        print(f"    initialize headers: {dict(r.headers)}")
        if not session_id:
            # Some implementations put session ID in result
            session_id = (
                body.get("result", {}).get("session_id")
                or body.get("result", {}).get("sessionId")
                or body.get("session_id")
                or body.get("sessionId")
            )
    except Exception:
        pass

    print(f"    session_id = {session_id!r}")
    return session_id


async def mcp_notify_initialized(client: httpx.AsyncClient, session_id: str | None) -> None:
    """Send MCP notifications/initialized."""
    headers = {**AUTH_HEADERS}
    if session_id:
        headers["mcp-session-id"] = session_id
    payload = {
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
    }
    r = await client.post(HUD_MCP_URL, headers=headers, json=payload, timeout=10)
    print(f"    notifications/initialized → {r.status_code}")


async def mcp_list_tools(client: httpx.AsyncClient, session_id: str | None) -> dict | None:
    headers = {**AUTH_HEADERS}
    if session_id:
        headers["mcp-session-id"] = session_id
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    r = await client.post(HUD_MCP_URL, headers=headers, json=payload, timeout=30)
    print(f"    tools/list → {r.status_code}")
    if r.status_code >= 400:
        print(f"    body: {r.text[:300]}")
        return None
    return r.json()


async def mcp_call_tool(
    client: httpx.AsyncClient,
    session_id: str | None,
    tool_name: str,
    args: dict,
    req_id: int = 2,
) -> dict | None:
    headers = {**AUTH_HEADERS}
    if session_id:
        headers["mcp-session-id"] = session_id
    payload = {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": args},
    }
    r = await client.post(HUD_MCP_URL, headers=headers, json=payload, timeout=60)
    print(f"    tools/call {tool_name} → {r.status_code}")
    if r.status_code >= 400:
        print(f"    body: {r.text[:400]}")
        return None
    return r.json()


# ── REST endpoint variants ────────────────────────────────────────────────────

CANDIDATE_URLS = [
    # Telemetry base
    "{telemetry}/trace/{tid}",
    "{telemetry}/traces/{tid}",
    "{telemetry}/trace/{tid}/steps",
    "{telemetry}/trace/{tid}/spans",
    # API base
    "{api}/trace/{tid}",
    "{api}/traces/{tid}",
    "{api}/v1/trace/{tid}",
    "{api}/v1/traces/{tid}",
    "{api}/v3/trace/{tid}",
    "{api}/v3/traces/{tid}",
]


async def probe_rest_endpoints(client: httpx.AsyncClient, tid: str) -> dict | None:
    for template in CANDIDATE_URLS:
        url = template.format(telemetry=HUD_TELEMETRY_URL, api=HUD_API_URL, tid=tid)
        try:
            r = await client.get(url, headers=AUTH_HEADERS, timeout=15)
            status = r.status_code
            if status == 200:
                print(f"    ✓ {url}")
                return {"url": url, "data": r.json()}
            else:
                print(f"    {status} {url}")
        except Exception as e:
            print(f"    ERR {url}: {e}")
    return None


async def main() -> None:
    async with httpx.AsyncClient() as client:

        # ── Strategy 1: MCP with proper initialization ────────────────────
        print("\n=== Strategy 1: MCP (initialize → tools/list → tools/call) ===")
        session_id = await mcp_initialize(client)
        if session_id is not None or True:  # try even if no session ID returned
            await mcp_notify_initialized(client, session_id)
            tools_resp = await mcp_list_tools(client, session_id)
            if tools_resp:
                tools_out = OUT_DIR / "mcp_tools_list.json"
                tools_out.write_text(json.dumps(tools_resp, indent=2))
                print(f"  Saved MCP tools → {tools_out}")
                tools = tools_resp.get("result", {}).get("tools", [])
                for t in tools:
                    print(f"    - {t['name']}: {t.get('description','')[:80]}")

            # get_job_traces first (returns trace IDs + summary for the whole job)
            print("\n  get_job_traces…")
            job_resp = await mcp_call_tool(client, session_id, "get_job_traces", {"job_id": JOB_ID}, req_id=10)
            if job_resp:
                (OUT_DIR / "job_traces_mcp.json").write_text(json.dumps(job_resp, indent=2))
                print(f"  Saved job traces → {OUT_DIR / 'job_traces_mcp.json'}")

            # get_trace on each of our 3 interesting traces
            print("\n  get_trace on individual traces…")
            for i, (label, tid) in enumerate(TRACE_IDS.items()):
                resp = await mcp_call_tool(client, session_id, "get_trace", {"trace_id": tid}, req_id=20 + i)
                if resp:
                    out = OUT_DIR / f"trace_{label}_mcp.json"
                    out.write_text(json.dumps(resp, indent=2))
                    print(f"  Saved {label} → {out}")

        # ── Strategy 2: REST endpoint probing ────────────────────────────
        print("\n=== Strategy 2: REST endpoint probing ===")
        for label, tid in TRACE_IDS.items():
            print(f"  {label} ({tid}):")
            result = await probe_rest_endpoints(client, tid)
            if result:
                out = OUT_DIR / f"trace_{label}_rest.json"
                out.write_text(json.dumps(result, indent=2))

    # ── Print summary of what we found ───────────────────────────────────────
    print("\n=== Files written to backend/runs/ ===")
    for p in sorted(OUT_DIR.glob("*.json")):
        size = p.stat().st_size
        print(f"  {p.name:45s}  {size:>8,} bytes")

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
