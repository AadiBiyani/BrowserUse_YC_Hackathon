# HUD Trace API — Reference for data_pipeline.py

> **Verified**: All schemas below confirmed from live trajectory data via `fetch_trajectories.py`.
> Full annotated traces in `backend/runs/TRACE_SCHEMA.md`.

## The One Endpoint

```
GET https://api.hud.ai/telemetry/traces/{trace_id}
Authorization: Bearer {HUD_API_KEY}
?include_trajectory=true&include_logs=false
```

Returns the full trace with every step. Source: HUD's own open-source
[hud-trace-explorer](https://github.com/hud-evals/hud-trace-explorer/blob/main/env.py).

---

## Response Schema

```json
{
  "trace_id": "5cd19812-a3dc-4714-a0bc-1db7afa62e61",
  "job_id":   "1325246e-c8e0-40b3-9d91-08db5978c64d",
  "status":   "completed",
  "reward":   1.0,
  "error":    null,
  "external_id":      null,
  "task_id":          null,
  "task_version_id":  null,
  "scenario":         null,
  "scenario_args":    null,
  "prompt":           null,

  "metadata": {
    "variants": {"model": "gpt-4o"},
    "agent_steps": 6,
    "mcp_tool_steps": 8,
    "usage": {
      "total_cost":           0.245,
      "inference_cost":       0.2033,
      "environment_cost":     0.0417,
      "inference_calls":      6,
      "agent_actions":        10,
      "total_input_tokens":   48060,
      "total_output_tokens":  272,
      "avg_output_tokens_per_call": 45.3,
      "max_output_tokens_per_call": 90,
      "environment_hourly_rate":    0.5,
      "environment_baseline_minutes": 5,
      "environment_total_runtime_seconds": null,
      "calculated_at": "2026-02-28T23:33:30Z"
    },
    "evaluation_result": {"done": true, "reward": 1.0, "isError": false}
  },

  "trajectory": [ /* array of OTel spans — see below */ ],
  "trajectory_length": 16,
  "logs": [],
  "logs_count": null
}
```

---

## Trajectory Span Schema

Every element of `trajectory` is one of four types:

### LLM call span

**OpenAI** uses `name: "inference.responses"`, **Anthropic** uses `name: "inference.messages"`.
Both have `category: "inference-2"`. Filter with: `span["name"].startswith("inference.")`

```json
{
  "name": "inference.responses",
  "trace_id": "5cd19812a3dc4714a0bc1db7afa62e61",
  "span_id": "cc0a945578d24962",
  "parent_span_id": null,
  "start_time": "2026-02-28T23:32:54.448Z",
  "end_time":   "2026-02-28T23:32:56.531Z",
  "status_code": "OK",
  "attributes": {
    "category": "inference-2",
    "model": "openai/gpt-4o-2024-11-20",
    "duration_ms": 2083.0,
    "input_tokens": 7567,
    "output_tokens": 90,
    "is_byok": false,
    "request_id": "...",
    "model_checkpoint_id": "...",
    "result": {
      "content": null,
      "tool_calls": [
        {
          "id": "call_44uO...",
          "type": "function",
          "function": {
            "name": "input",
            "arguments": "{\"index\":4,\"text\":\"ReplayBench Test\",\"clear\":true}"
          }
        }
      ],
      "finish_reason": "completed"
    }
  }
}
```

When the model gives a **final text answer** (no tool call):
```json
"result": {
  "content": "The form submission was successful...",
  "tool_calls": null,
  "finish_reason": "completed"
}
```

### Browser tool call span (`name: "tools/call.mcp"`)

```json
{
  "name": "tools/call.mcp",
  "start_time": "2026-02-28T23:32:57.702Z",
  "end_time":   "2026-02-28T23:32:58.414Z",
  "status_code": "OK",
  "attributes": {
    "category": "mcp",
    "request": {
      "params": {
        "name": "input",
        "arguments": {"index": 4, "text": "ReplayBench Test", "clear": true}
      }
    },
    "result": {
      "content": [{"type": "text", "text": "{\"ok\":true,\"action\":\"input\",\"result\":{\"is_done\":false,\"long_term_memory\":\"Typed 'ReplayBench Test'\",\"extracted_content\":\"Typed 'ReplayBench Test'\",\"metadata\":{\"input_x\":236.15,\"input_y\":26.5}}}"}],
      "isError": false
    }
  }
}
```

Parse `result.content[0].text` as JSON to get `result.long_term_memory` (human-readable description).
On failure: `{"ok": false, "action": "...", "error": "...error message..."}`.

**Tool latency** (no `duration_ms` on MCP spans — compute from timestamps):
```python
from datetime import datetime
latency_ms = (
    datetime.fromisoformat(span["end_time"]) -
    datetime.fromisoformat(span["start_time"])
).total_seconds() * 1000
```

Tool names observed: `navigate`, `input`, `click`, `extract`, `search_page`,
`scroll`, `screenshot`, `save_as_pdf`, `_hud_submit`

### Scenario setup span (`name: "prompts/get.mcp"`, always first)

Contains the task prompt. Skip in pipeline (already in `metadata.prompt`).

### Eval result span (`name: "resources/read.mcp"`, always last)

```json
"result": {
  "contents": [{"uri": "...", "mimeType": "application/json",
                "text": "{\"reward\": 1.0, \"done\": true, \"info\": {}, \"isError\": false}"}]
}
```

---

## What to Store Where

### Convex — flat metrics row per run
Extract from `metadata.usage` + top-level fields:
```
trace_id, job_id, model (metadata.variants.model), reward, status,
agent_steps, mcp_tool_steps, inference_calls, agent_actions,
total_cost, inference_cost, environment_cost,
total_input_tokens, total_output_tokens, avg_output_tokens_per_call, calculated_at
```

### MongoDB — raw archive
Store the full response JSON as-is. Key for retrieval by `trace_id`.

### Supermemory — semantic chunks (3 per trace)
1. **Outcome summary** (text):
   `"Model {model} {'succeeded' if reward else 'failed'} in {agent_steps} steps,
   {inference_calls} LLM calls, ${total_cost:.3f}. Tools used: {tool_list}."`

2. **Step-by-step actions** (text, one entry per `tools/call.mcp` span):
   `"Step {n}: {tool_name}({args}) → {long_term_memory} [{latency_ms:.0f}ms]"`

3. **LLM I/O** (text, one entry per `inference.*` span):
   `"LLM call {n}: {input_tokens} in / {output_tokens} out, {duration_ms:.0f}ms,
   tool_calls={[names]} OR final_answer={content[:100]}"`

Tag every chunk with: `experiment_id`, `trace_id`, `model`, `reward`, `task`, `step_index`

---

## Seed Data Available

9 traces already run, saved in `backend/runs/seed_traces_raw.json`.
Full trajectories in `backend/runs/trajectory_*.json`.

| trace_id (short) | model | reward | spans |
|---|---|---|---|
| 5cd19812 | gpt-4o | 1.0 | 16 |
| 0e240ae9 | gpt-4o | 0.0 | 20 |
| bb2daf44 | claude-sonnet-4-5 | 1.0 | 4 |

Job ID: `1325246e-c8e0-40b3-9d91-08db5978c64d`

## No Screenshots in Trajectory

This environment uses DOM-based tool-calling (not Computer Use), so there are no
screenshot spans in the trajectory (`internal_type` is always `null`).

Screenshots may exist in Supabase public storage:
```
https://gahludmjcsmszgyufydt.supabase.co/storage/v1/object/public/screenshots/{trace_id}/{n}.png
```
Confirm with HUD sponsor before using this URL in the pipeline.
