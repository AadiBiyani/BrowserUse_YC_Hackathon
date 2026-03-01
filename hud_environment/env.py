"""Compact HUD Environment exposing Browser Use actions as top-level tools."""

from __future__ import annotations

import logging
import os
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")
os.environ.setdefault("BROWSER_USE_SETUP_LOGGING", "false")

from browser_use.agent.views import ActionResult
from browser_use.agent.prompts import AgentMessagePrompt
from browser_use.browser import BrowserSession
from browser_use.filesystem.file_system import FileSystem
from browser_use.llm.base import BaseChatModel
from browser_use.llm.openai.chat import ChatOpenAI
from browser_use.tools.service import Tools
from fastmcp.tools.tool import FunctionTool
from hud import Environment
from hud.settings import settings
from pydantic import BaseModel, ConfigDict

logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="[%(levelname)s] %(asctime)s | %(name)s | %(message)s",
    force=True,
)
logger = logging.getLogger(__name__)

env = Environment(name="replaybench-browser-env")

HEADLESS_DEFAULT = os.getenv("BROWSER_USE_HEADLESS", "true").strip().lower()[:1] in {"1", "t", "y"}
ALLOW_HEADFUL = os.getenv("BROWSER_USE_ALLOW_HEADFUL", "false").strip().lower()[:1] in {"1", "t", "y"}
EXECUTABLE_PATH = (os.getenv("BROWSER_USE_EXECUTABLE_PATH") or "").strip()
ALLOWED_DOMAINS = [d.strip() for d in (os.getenv("BROWSER_USE_ALLOWED_DOMAINS") or "").split(",") if d.strip()]
SESSION_NAME = (os.getenv("BROWSER_USE_SESSION_ID") or "hud-browser-use-session").strip()
PROFILE_ROOT = Path(os.getenv("BROWSER_USE_PROFILE_ROOT", "/tmp/browser-use-hud/profiles"))
DOWNLOAD_ROOT = Path(os.getenv("BROWSER_USE_DOWNLOAD_ROOT", "/tmp/browser-use-hud/downloads"))
FILE_ROOT = Path(os.getenv("BROWSER_USE_FILE_ROOT", "/tmp/browser-use-hud/files"))
EXTRACTION_MODEL = os.getenv("BROWSER_USE_EXTRACTION_MODEL", "gpt-4o-mini")
EXTRACTION_BASE_URL = (os.getenv("BROWSER_USE_EXTRACTION_BASE_URL") or settings.hud_gateway_url).strip()
SUCCESS_THRESHOLD_DEFAULT = 0.5


class Runtime(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    session: BrowserSession
    tools: Tools[None]
    file_system: FileSystem
    extraction_llm: BaseChatModel | None


RUNTIME: Runtime | None = None
ALLOWED_TOOLS: set[str] | None = None  # None = all tools; set = allowlist
BROWSER_USE_HUD_OUTPUT = """
This HUD harness uses function/tool-calling instead of Browser Use JSON envelopes.
For every step:
1) Decide your next browser action(s).
2) Call the corresponding tool directly (navigate, click, input, find_text, extract, etc.).
3) Continue iteratively until the task is complete.

Do NOT output an "action" JSON object or JSON wrapper keys like:
"thinking", "evaluation_previous_goal", "memory", "next_goal", "action".

When finished, return a normal plain-text final answer to the user.
There is no `done` tool in this harness.
""".strip()
BROWSER_USE_HUD_PROMPT = BROWSER_USE_HUD_OUTPUT


def extraction_llm() -> BaseChatModel | None:
    api_key = (os.getenv("OPENAI_API_KEY") or os.getenv("HUD_API_KEY") or settings.api_key or "").strip()
    if not api_key:
        return None
    try:
        return ChatOpenAI(
            model=EXTRACTION_MODEL,
            api_key=api_key,
            base_url=(os.getenv("OPENAI_BASE_URL") or EXTRACTION_BASE_URL or None),
        )
    except Exception as e:
        logger.warning("Extraction LLM disabled: %s", e)
        return None


def available_paths(runtime: Runtime) -> list[str]:
    paths = [str(runtime.file_system.get_dir() / name) for name in runtime.file_system.list_files()]
    paths.extend(str(path) for path in (runtime.session.downloaded_files or []) if path)
    return list(dict.fromkeys(paths))


async def stop_session(force: bool = True) -> None:
    global RUNTIME
    runtime = RUNTIME
    RUNTIME = None
    if runtime is None:
        return
    try:
        if force:
            await runtime.session.kill()
        else:
            await runtime.session.stop()
    except Exception as e:
        logger.warning("Session cleanup failed: %s", e)


def normalize_result(value: Any) -> Any:
    if isinstance(value, ActionResult):
        return value.model_dump(mode="json", exclude_none=True)
    if hasattr(value, "model_dump"):
        try:
            return value.model_dump(mode="json", exclude_none=True)
        except TypeError:
            return value.model_dump()
    return value


async def call_action(action_name: str, action_args: dict[str, Any]) -> dict[str, Any]:
    runtime = RUNTIME
    if runtime is None:
        return {"ok": False, "error": "No active session. Use browser_use_task; lifecycle is scenario-managed."}
    if ALLOWED_TOOLS is not None and action_name not in ALLOWED_TOOLS:
        return {"ok": False, "error": f"Tool '{action_name}' is not available in this configuration."}
    if action_name not in runtime.tools.registry.registry.actions:
        return {"ok": False, "error": f"Unknown Browser Use action '{action_name}'."}

    try:
        result = await runtime.tools.registry.execute_action(
            action_name=action_name,
            params=action_args,
            browser_session=runtime.session,
            page_extraction_llm=runtime.extraction_llm,
            available_file_paths=available_paths(runtime),
            file_system=runtime.file_system,
        )
        return {"ok": True, "action": action_name, "result": normalize_result(result)}
    except Exception as e:
        return {"ok": False, "action": action_name, "error": str(e)}


async def start_session(start_url: str = "", allowed_domains: list[str] | None = None) -> dict[str, Any]:
    global RUNTIME
    await stop_session(force=True)

    profile_dir = PROFILE_ROOT / SESSION_NAME
    downloads_dir = DOWNLOAD_ROOT / SESSION_NAME
    files_dir = FILE_ROOT / SESSION_NAME
    profile_dir.mkdir(parents=True, exist_ok=True)
    downloads_dir.mkdir(parents=True, exist_ok=True)
    files_dir.mkdir(parents=True, exist_ok=True)

    effective_allowed_domains = (
        [domain.strip() for domain in allowed_domains if isinstance(domain, str) and domain.strip()]
        if allowed_domains is not None
        else ALLOWED_DOMAINS
    )

    session = BrowserSession(
        id=SESSION_NAME,
        is_local=True,
        headless=(HEADLESS_DEFAULT if ALLOW_HEADFUL else True),
        disable_security=True,
        user_data_dir=str(profile_dir),
        downloads_path=str(downloads_dir),
        executable_path=EXECUTABLE_PATH or None,
        allowed_domains=effective_allowed_domains or None,
        keep_alive=True,
    )
    try:
        await session.start()
    except Exception as e:
        return {"ok": False, "error": f"Failed to start Browser Use session: {e}"}

    RUNTIME = Runtime(
        session=session,
        tools=Tools(exclude_actions=["done"], output_model=None, display_files_in_done_text=False),
        file_system=FileSystem(base_dir=str(files_dir), create_default_files=True),
        extraction_llm=extraction_llm(),
    )

    if start_url.strip():
        nav = await call_action("navigate", {"url": start_url.strip(), "new_tab": False})
        if not nav.get("ok"):
            return {"ok": False, "error": f"Session started but navigation failed: {nav.get('error')}"}

    return {"ok": True}


def register_action_tools() -> None:
    template = Tools(exclude_actions=["done"], output_model=None, display_files_in_done_text=False)
    for action_name, action in template.registry.registry.actions.items():
        async def run_tool(_action_name: str = action_name, **kwargs: Any) -> dict[str, Any]:
            return await call_action(_action_name, kwargs)

        env.add_tool(
            FunctionTool(
                name=action_name,
                description=action.description or f"Browser Use action '{action_name}'",
                parameters=action.param_model.model_json_schema(),
                fn=run_tool,
            )
        )


register_action_tools()


def compare_answers(actual: Any, expected: Any, mode: str = "exact") -> float:
    if actual is None:
        return 0.0
    actual_str = str(actual).strip()
    expected_str = str(expected).strip()

    if mode == "exact":
        return 1.0 if actual_str.lower() == expected_str.lower() else 0.0
    if mode == "contains":
        return 1.0 if expected_str.lower() in actual_str.lower() else 0.0
    if mode == "json":
        try:
            actual_json = json.loads(actual_str) if isinstance(actual, str) else actual
            expected_json = json.loads(expected_str) if isinstance(expected, str) else expected
            return 1.0 if actual_json == expected_json else 0.0
        except (json.JSONDecodeError, TypeError):
            return 0.0
    if mode == "numeric":
        try:
            actual_nums = re.findall(r"-?\d+\.?\d*", actual_str)
            expected_nums = re.findall(r"-?\d+\.?\d*", expected_str)
            if actual_nums and expected_nums:
                return 1.0 if float(actual_nums[0]) == float(expected_nums[0]) else 0.0
            return 0.0
        except (ValueError, IndexError):
            return 0.0
    if mode == "regex":
        try:
            return 1.0 if re.search(expected_str, actual_str, re.IGNORECASE) else 0.0
        except re.error:
            return 0.0
    return 0.0


def _json_type_matches(value: Any, expected_type: str) -> bool:
    if expected_type == "object":
        return isinstance(value, dict)
    if expected_type == "array":
        return isinstance(value, list)
    if expected_type == "string":
        return isinstance(value, str)
    if expected_type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected_type == "boolean":
        return isinstance(value, bool)
    if expected_type == "null":
        return value is None
    return True


def _validate_output_schema_value(value: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    errors: list[str] = []
    expected_type = schema.get("type")
    if isinstance(expected_type, list):
        if not any(_json_type_matches(value, str(t)) for t in expected_type):
            errors.append(f"{path}: expected one of types {expected_type}")
            return errors
    elif isinstance(expected_type, str):
        if not _json_type_matches(value, expected_type):
            errors.append(f"{path}: expected type '{expected_type}'")
            return errors

    if "enum" in schema:
        enum_values = schema.get("enum")
        if isinstance(enum_values, list) and value not in enum_values:
            errors.append(f"{path}: value not in enum")

    if isinstance(value, str):
        min_len = schema.get("minLength")
        max_len = schema.get("maxLength")
        pattern = schema.get("pattern")
        if isinstance(min_len, int) and len(value) < min_len:
            errors.append(f"{path}: length < minLength ({min_len})")
        if isinstance(max_len, int) and len(value) > max_len:
            errors.append(f"{path}: length > maxLength ({max_len})")
        if isinstance(pattern, str):
            try:
                if not re.search(pattern, value):
                    errors.append(f"{path}: pattern mismatch")
            except re.error:
                errors.append(f"{path}: invalid regex pattern in schema")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if isinstance(minimum, (int, float)) and value < minimum:
            errors.append(f"{path}: value < minimum ({minimum})")
        if isinstance(maximum, (int, float)) and value > maximum:
            errors.append(f"{path}: value > maximum ({maximum})")

    if isinstance(value, dict):
        required = schema.get("required")
        if isinstance(required, list):
            for key in required:
                if isinstance(key, str) and key not in value:
                    errors.append(f"{path}.{key}: missing required property")
        properties = schema.get("properties")
        if isinstance(properties, dict):
            for key, subschema in properties.items():
                if key in value and isinstance(subschema, dict):
                    errors.extend(
                        _validate_output_schema_value(value[key], subschema, path=f"{path}.{key}")
                    )

    if isinstance(value, list):
        min_items = schema.get("minItems")
        max_items = schema.get("maxItems")
        if isinstance(min_items, int) and len(value) < min_items:
            errors.append(f"{path}: item count < minItems ({min_items})")
        if isinstance(max_items, int) and len(value) > max_items:
            errors.append(f"{path}: item count > maxItems ({max_items})")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for idx, item in enumerate(value):
                errors.extend(
                    _validate_output_schema_value(item, item_schema, path=f"{path}[{idx}]")
                )

    return errors


def _structured_output_score(agent_answer: str, output_schema: dict[str, Any]) -> tuple[float, list[str]]:
    try:
        parsed = json.loads((agent_answer or "").strip())
    except json.JSONDecodeError:
        return 0.0, ["Output is not valid JSON"]

    if not isinstance(output_schema, dict):
        return 0.0, ["output_schema must be a JSON object"]

    errors = _validate_output_schema_value(parsed, output_schema)
    return (1.0, []) if not errors else (0.0, errors[:8])


async def _judge_answer_score(
    prompt: str,
    agent_answer: str,
    *,
    rubric: str | None = None,
    output_schema: dict[str, Any] | None = None,
) -> float | None:
    judge_llm = extraction_llm()
    if judge_llm is None:
        return None

    judge_prompt = (
        "You are a strict evaluator. Score the assistant answer from 0.0 to 1.0.\n"
        "Return JSON only with keys: score (number), reason (string).\n\n"
        f"Task:\n{prompt}\n\n"
        f"Answer:\n{agent_answer}\n\n"
    )
    if output_schema is not None:
        judge_prompt += f"Expected output schema:\n{json.dumps(output_schema, ensure_ascii=True)}\n\n"
    if rubric:
        judge_prompt += f"Rubric:\n{rubric}\n\n"

    judge_prompt += "Remember: output valid JSON only."

    try:
        response = await judge_llm.ainvoke(judge_prompt)
        content = response.content if hasattr(response, "content") else str(response)
        text = content if isinstance(content, str) else json.dumps(content)
        match = re.search(r"\{[\s\S]*\}", text)
        payload = json.loads(match.group(0) if match else text)
        score = float(payload.get("score"))
        return max(0.0, min(1.0, score))
    except Exception as e:
        logger.warning("Judge scoring failed: %s", e)
        return None


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_weight(value: Any, default: float = 1.0) -> float:
    try:
        weight = float(value)
        return max(0.0, weight)
    except (TypeError, ValueError):
        return default


def _coerce_reward(value: Any, default: float = 0.0) -> float:
    raw = _to_float(value)
    if raw is None:
        raw = default
    return max(0.0, min(1.0, float(raw)))


def _resolve_success_threshold(value: Any) -> float:
    threshold = _to_float(value)
    if threshold is None:
        return SUCCESS_THRESHOLD_DEFAULT
    return _coerce_reward(threshold, default=SUCCESS_THRESHOLD_DEFAULT)


def _extract_step_answers(agent_answer: str) -> list[str]:
    answer = (agent_answer or "").strip()
    if not answer:
        return []

    try:
        parsed = json.loads(answer)
        if isinstance(parsed, dict):
            steps = parsed.get("steps")
            if isinstance(steps, list):
                return [str(step).strip() for step in steps if str(step).strip()]
        elif isinstance(parsed, list):
            return [str(step).strip() for step in parsed if str(step).strip()]
    except (json.JSONDecodeError, TypeError):
        pass

    parsed_steps: dict[int, str] = {}
    for match in re.finditer(r"(?im)^step\s*(\d+)\s*[:\-]\s*(.+)$", answer):
        idx = int(match.group(1))
        parsed_steps[idx] = match.group(2).strip()
    if parsed_steps:
        return [parsed_steps[i] for i in sorted(parsed_steps)]

    return []


def _resolve_criterion_actual(
    source: str,
    agent_answer: str,
    step_answers: list[str],
    step_index: int,
    final_state: dict[str, str],
) -> Any:
    source_norm = source.strip().lower()
    if source_norm == "final_url":
        return final_state.get("url", "")
    if source_norm == "final_title":
        return final_state.get("title", "")
    if source_norm == "step_answer":
        if 0 <= step_index < len(step_answers):
            return step_answers[step_index]
        return ""
    return agent_answer


def _evaluate_weighted_criteria(
    criteria: list[dict[str, Any]],
    agent_answer: str,
    final_state: dict[str, str],
) -> float:
    if not criteria:
        return 0.0

    step_answers = _extract_step_answers(agent_answer)
    total_weight = 0.0
    weighted_score = 0.0

    for idx, criterion in enumerate(criteria):
        weight = _coerce_weight(criterion.get("weight"), default=1.0)
        if weight <= 0:
            continue

        criterion_score = _to_float(criterion.get("score"))
        if criterion_score is None:
            expected = criterion.get("expected")
            if expected is None:
                continue
            source = str(criterion.get("source", "agent_answer"))
            mode = str(criterion.get("compare_mode", "exact"))
            actual = _resolve_criterion_actual(source, agent_answer, step_answers, idx, final_state)
            criterion_score = compare_answers(actual, expected, mode)

        score = _coerce_reward(criterion_score, default=0.0)

        total_weight += weight
        weighted_score += score * weight

    if total_weight <= 0:
        return 0.0
    return weighted_score / total_weight


def _estimate_steps_from_state(final_state: dict[str, str], fallback: int = 1) -> int:
    text = final_state.get("history_text", "")
    if text:
        nums = re.findall(r"\d+", text)
        if nums:
            try:
                return max(1, int(nums[0]) - 1)
            except (TypeError, ValueError):
                pass
    return max(1, fallback)


def _resolve_limits(
    max_steps: int | None,
    timeout_sec: int | None,
    maxSteps: int | None,
    timeoutSec: int | None,
) -> tuple[int | None, int | None]:
    resolved_steps = _to_int(max_steps)
    if resolved_steps is None:
        resolved_steps = _to_int(maxSteps)
    if resolved_steps is not None:
        resolved_steps = max(1, resolved_steps)

    resolved_timeout = _to_int(timeout_sec)
    if resolved_timeout is None:
        resolved_timeout = _to_int(timeoutSec)
    if resolved_timeout is not None:
        resolved_timeout = max(1, resolved_timeout)

    return resolved_steps, resolved_timeout


def _apply_termination_controls(
    reward: float,
    step_count: int,
    elapsed_sec: float,
    max_steps_limit: int | None,
    timeout_limit: int | None,
) -> float:
    if max_steps_limit is not None and step_count > max_steps_limit:
        logger.info(
            "Termination control triggered: steps=%s exceeds maxSteps=%s",
            step_count,
            max_steps_limit,
        )
        return 0.0
    if timeout_limit is not None and elapsed_sec > timeout_limit:
        logger.info(
            "Termination control triggered: elapsed=%.2fs exceeds timeoutSec=%s",
            elapsed_sec,
            timeout_limit,
        )
        return 0.0
    return max(0.0, min(1.0, float(reward)))


async def _collect_final_state() -> dict[str, str]:
    final_state: dict[str, str] = {"url": "", "title": "", "history_text": ""}
    runtime = RUNTIME
    if runtime is None:
        return final_state

    try:
        state = await runtime.session.get_browser_state_summary(
            include_screenshot=False,
            include_recent_events=False,
        )
        final_state["url"] = (state.url or "").strip()
        final_state["title"] = (state.title or "").strip()
    except Exception as e:
        logger.warning("Could not collect browser summary: %s", e)

    try:
        hist = await call_action("evaluate", {"code": "window.history.length"})
        if hist.get("ok"):
            final_state["history_text"] = str((hist.get("result") or {}).get("extracted_content", ""))
    except Exception as e:
        logger.warning("Could not estimate step count from history: %s", e)

    return final_state


async def render_harness_prompt(
    task: str,
    *,
    output_schema: dict[str, Any] | None = None,
    system_prompt_extension: str | None = None,
) -> str:
    runtime = RUNTIME
    if runtime is None:
        schema_block = ""
        if output_schema is not None:
            schema_block = (
                "\n\nReturn strictly valid JSON matching this schema:\n"
                f"{json.dumps(output_schema, ensure_ascii=True, indent=2)}"
            )
        extension_block = f"\n\n{system_prompt_extension.strip()}" if system_prompt_extension else ""
        return (
            f"{BROWSER_USE_HUD_PROMPT}\n\n"
            f" Browser runtime not available. \n"
            f"USER TASK:\n{task}{schema_block}{extension_block}"
        )
    state = await runtime.session.get_browser_state_summary(
        include_screenshot=False,
        include_recent_events=False,
    )
    browser_use_input = AgentMessagePrompt(
        browser_state_summary=state,
        file_system=runtime.file_system,
        task=task,
        include_recent_events=False,
    ).get_user_message(use_vision=False)
    browser_use_input_text = (
        browser_use_input.content if isinstance(browser_use_input.content, str) else str(browser_use_input.content)
    )
    schema_block = ""
    if output_schema is not None:
        schema_block = (
            "\n\nReturn strictly valid JSON matching this schema:\n"
            f"{json.dumps(output_schema, ensure_ascii=True, indent=2)}"
        )
    extension_block = f"\n\n{system_prompt_extension.strip()}" if system_prompt_extension else ""
    return f"{BROWSER_USE_HUD_PROMPT}\n\n{browser_use_input_text}{schema_block}{extension_block}"


@env.scenario("task")
async def task(
    task: str,
    start_url: str = "",
    expected: Any | None = None,
    compare_mode: str = "contains",
    criteria: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    judge: bool = False,
    judge_rubric: str | None = None,
    system_prompt_extension: str | None = None,
    success_threshold: float | None = None,
    allowed_tools: list[str] | None = None,
    allowed_domains: list[str] | None = None,
    max_steps: int | None = None,
    timeout_sec: int | None = None,
    maxSteps: int | None = None,
    timeoutSec: int | None = None,
) -> Any:
    """Browser task with optional schema validation and judge scoring."""
    global ALLOWED_TOOLS
    ALLOWED_TOOLS = set(allowed_tools) if allowed_tools is not None else None
    resolved_max_steps, resolved_timeout = _resolve_limits(max_steps, timeout_sec, maxSteps, timeoutSec)

    setup = await start_session(start_url=start_url, allowed_domains=allowed_domains)
    if not setup.get("ok"):
        ALLOWED_TOOLS = None
        _ = yield f"Browser session setup failed: {setup.get('error')}\nRespond with a brief failure message."
        yield 0.0
        return

    agent_answer = ""
    final_state: dict[str, str] = {"url": "", "title": "", "history_text": ""}
    step_count = 1
    started_at = time.monotonic()
    elapsed_sec = 0.0
    try:
        agent_answer = yield await render_harness_prompt(
            task,
            output_schema=output_schema,
            system_prompt_extension=system_prompt_extension,
        )
        elapsed_sec = max(0.0, time.monotonic() - started_at)
        final_state = await _collect_final_state()
        step_count = _estimate_steps_from_state(final_state, fallback=1)
    finally:
        ALLOWED_TOOLS = None
        await stop_session(force=True)

    component_scores: list[float] = []
    if isinstance(criteria, list) and criteria:
        component_scores.append(_evaluate_weighted_criteria(criteria, agent_answer, final_state))
    elif expected is not None:
        component_scores.append(compare_answers(agent_answer, expected, compare_mode))

    if output_schema is not None:
        schema_score, schema_errors = _structured_output_score(agent_answer, output_schema)
        if schema_errors:
            logger.info("Structured output validation failed: %s", "; ".join(schema_errors))
        component_scores.append(schema_score)

    if judge:
        judge_score = await _judge_answer_score(
            task,
            agent_answer,
            rubric=judge_rubric,
            output_schema=output_schema,
        )
        if judge_score is not None:
            component_scores.append(judge_score)

    reward = 1.0 if not component_scores else sum(component_scores) / len(component_scores)
    reward = _apply_termination_controls(
        reward=reward,
        step_count=step_count,
        elapsed_sec=elapsed_sec,
        max_steps_limit=resolved_max_steps,
        timeout_limit=resolved_timeout,
    )
    threshold = _resolve_success_threshold(success_threshold)
    logger.debug("task reward=%.3f threshold=%.3f components=%s", reward, threshold, component_scores)
    yield reward


@env.scenario("answer")
async def answer(
    url: str,
    prompt: str,
    expected: Any | None = None,
    compare_mode: str = "exact",
    criteria: list[dict[str, Any]] | None = None,
    success_threshold: float | None = None,
    allowed_tools: list[str] | None = None,
    allowed_domains: list[str] | None = None,
    max_steps: int | None = None,
    timeout_sec: int | None = None,
    maxSteps: int | None = None,
    timeoutSec: int | None = None,
) -> Any:
    """Generic browser task returning an answer.

    Args:
        allowed_tools: If provided, only these browser-use actions are callable
                       by the agent. None means all tools are available.
                       Preset names are resolved by the caller (experiment_runner).
    """
    global ALLOWED_TOOLS
    ALLOWED_TOOLS = set(allowed_tools) if allowed_tools is not None else None
    resolved_max_steps, resolved_timeout = _resolve_limits(max_steps, timeout_sec, maxSteps, timeoutSec)

    setup = await start_session(start_url=url, allowed_domains=allowed_domains)
    if not setup.get("ok"):
        ALLOWED_TOOLS = None
        _ = yield f"Browser session setup failed: {setup.get('error')}\nRespond with a brief failure message."
        yield 0.0
        return

    agent_answer = ""
    final_state: dict[str, str] = {"url": "", "title": "", "history_text": ""}
    step_count = 1
    started_at = time.monotonic()
    elapsed_sec = 0.0
    try:
        agent_answer = yield await render_harness_prompt(prompt)
        elapsed_sec = max(0.0, time.monotonic() - started_at)
        final_state = await _collect_final_state()
        step_count = _estimate_steps_from_state(final_state, fallback=1)
    finally:
        ALLOWED_TOOLS = None
        await stop_session(force=True)

    if isinstance(criteria, list) and criteria:
        reward = _evaluate_weighted_criteria(criteria, agent_answer, final_state)
    elif expected is None:
        reward = 1.0
    else:
        reward = compare_answers(agent_answer, expected, compare_mode)

    reward = _apply_termination_controls(
        reward=reward,
        step_count=step_count,
        elapsed_sec=elapsed_sec,
        max_steps_limit=resolved_max_steps,
        timeout_limit=resolved_timeout,
    )
    threshold = _resolve_success_threshold(success_threshold)
    logger.debug("answer reward=%.3f threshold=%.3f", reward, threshold)
    yield reward


@env.scenario("multi_step")
async def multi_step(
    url: str,
    prompt: str,
    checkpoints: list[dict[str, Any]],
    allowed_tools: list[str] | None = None,
    allowed_domains: list[str] | None = None,
    max_steps: int | None = None,
    timeout_sec: int | None = None,
    maxSteps: int | None = None,
    timeoutSec: int | None = None,
) -> Any:
    """Scenario with ordered checkpoints and partial-credit scoring."""
    global ALLOWED_TOOLS
    ALLOWED_TOOLS = set(allowed_tools) if allowed_tools is not None else None

    resolved_max_steps, resolved_timeout = _resolve_limits(max_steps, timeout_sec, maxSteps, timeoutSec)
    checkpoint_lines = [
        f"{idx + 1}. {cp.get('description') or cp.get('expected') or 'Complete checkpoint'}"
        for idx, cp in enumerate(checkpoints or [])
    ]
    limits = []
    if resolved_max_steps is not None:
        limits.append(f"max browser steps: {resolved_max_steps}")
    if resolved_timeout is not None:
        limits.append(f"time limit: {resolved_timeout}s")
    limits_text = f"\nTermination controls: {', '.join(limits)}." if limits else ""

    scenario_prompt = (
        f"{prompt}\n\n"
        "Complete the checkpoints in order. "
        "In your final response, include one line per checkpoint in this format: "
        "'Step N: <result>' so progress can be validated.\n\n"
        f"Checkpoints:\n" + ("\n".join(checkpoint_lines) if checkpoint_lines else "- Follow the task prompt.") + limits_text
    )

    setup = await start_session(start_url=url, allowed_domains=allowed_domains)
    if not setup.get("ok"):
        ALLOWED_TOOLS = None
        _ = yield f"Browser session setup failed: {setup.get('error')}\nRespond with a brief failure message."
        yield 0.0
        return

    agent_answer = ""
    final_state: dict[str, str] = {"url": "", "title": "", "history_text": ""}
    step_count = 1
    started_at = time.monotonic()
    elapsed_sec = 0.0
    try:
        agent_answer = yield await render_harness_prompt(scenario_prompt)
        elapsed_sec = max(0.0, time.monotonic() - started_at)
        final_state = await _collect_final_state()
        step_count = _estimate_steps_from_state(final_state, fallback=1)
    finally:
        ALLOWED_TOOLS = None
        await stop_session(force=True)

    criteria = checkpoints or []
    reward = _evaluate_weighted_criteria(criteria, agent_answer, final_state)
    reward = _apply_termination_controls(
        reward=reward,
        step_count=step_count,
        elapsed_sec=elapsed_sec,
        max_steps_limit=resolved_max_steps,
        timeout_limit=resolved_timeout,
    )
    yield reward


@env.scenario("branching_goal")
async def branching_goal(
    url: str,
    prompt: str,
    branches: list[dict[str, Any]],
    allowed_tools: list[str] | None = None,
    allowed_domains: list[str] | None = None,
    max_steps: int | None = None,
    timeout_sec: int | None = None,
    maxSteps: int | None = None,
    timeoutSec: int | None = None,
) -> Any:
    """Scenario with multiple valid completion branches and weighted branch scoring."""
    global ALLOWED_TOOLS
    ALLOWED_TOOLS = set(allowed_tools) if allowed_tools is not None else None

    resolved_max_steps, resolved_timeout = _resolve_limits(max_steps, timeout_sec, maxSteps, timeoutSec)
    branch_lines = []
    for idx, branch in enumerate(branches or []):
        name = str(branch.get("name", f"Branch {idx + 1}"))
        description = str(branch.get("description", ""))
        line = f"{idx + 1}. {name}"
        if description:
            line += f" - {description}"
        branch_lines.append(line)

    limits = []
    if resolved_max_steps is not None:
        limits.append(f"max browser steps: {resolved_max_steps}")
    if resolved_timeout is not None:
        limits.append(f"time limit: {resolved_timeout}s")
    limits_text = f"\nTermination controls: {', '.join(limits)}." if limits else ""

    scenario_prompt = (
        f"{prompt}\n\n"
        "You may solve this task through any valid branch below. "
        "In your final response, clearly explain which branch you completed and provide supporting evidence."
        "\n\nValid branches:\n"
        + ("\n".join(branch_lines) if branch_lines else "- Complete the task using any valid approach.")
        + limits_text
    )

    setup = await start_session(start_url=url, allowed_domains=allowed_domains)
    if not setup.get("ok"):
        ALLOWED_TOOLS = None
        _ = yield f"Browser session setup failed: {setup.get('error')}\nRespond with a brief failure message."
        yield 0.0
        return

    agent_answer = ""
    final_state: dict[str, str] = {"url": "", "title": "", "history_text": ""}
    step_count = 1
    started_at = time.monotonic()
    elapsed_sec = 0.0
    try:
        agent_answer = yield await render_harness_prompt(scenario_prompt)
        elapsed_sec = max(0.0, time.monotonic() - started_at)
        final_state = await _collect_final_state()
        step_count = _estimate_steps_from_state(final_state, fallback=1)
    finally:
        ALLOWED_TOOLS = None
        await stop_session(force=True)

    best_branch_score = 0.0
    total_branch_weight = 0.0
    weighted_branch_score = 0.0
    for idx, branch in enumerate(branches or []):
        branch_weight = _coerce_weight(branch.get("weight"), default=1.0)
        criteria = branch.get("criteria") if isinstance(branch.get("criteria"), list) else []
        if not criteria:
            expected = branch.get("expected")
            if expected is not None:
                criteria = [
                    {
                        "expected": expected,
                        "compare_mode": branch.get("compare_mode", "exact"),
                        "source": branch.get("source", "agent_answer"),
                        "weight": 1.0,
                    }
                ]
        branch_score = _evaluate_weighted_criteria(criteria, agent_answer, final_state)
        logger.debug("Branch %s score=%.3f", branch.get("name", idx + 1), branch_score)

        best_branch_score = max(best_branch_score, branch_score)
        if branch_weight > 0:
            total_branch_weight += branch_weight
            weighted_branch_score += branch_score * branch_weight

    reward = best_branch_score
    if total_branch_weight > 0:
        reward = max(best_branch_score, weighted_branch_score / total_branch_weight)

    reward = _apply_termination_controls(
        reward=reward,
        step_count=step_count,
        elapsed_sec=elapsed_sec,
        max_steps_limit=resolved_max_steps,
        timeout_limit=resolved_timeout,
    )
    yield reward


@env.scenario("wiki-game")
async def wiki_game(
    start_page: str,
    target_page: str,
    max_clicks: int = 10,
    prompt: str | None = None,
) -> Any:
    """Wikipedia click-only navigation game with efficiency reward."""
    start_url = f"https://en.wikipedia.org/wiki/{start_page}"
    target_fragment = f"/wiki/{target_page}".lower()
    task_prompt = prompt or (
        f"Wikipedia Speedrun Challenge!\n\n"
        f"Starting article: {start_page.replace('_', ' ')}\n"
        f"Target article: {target_page.replace('_', ' ')}\n\n"
        "Navigate from the starting article to the target article by clicking links.\n"
        "You may use only link clicks within article content (no search, no back button).\n"
        f"Try to reach the target in as few clicks as possible. Maximum clicks: {max_clicks}."
    )

    setup = await start_session(start_url=start_url)
    if not setup.get("ok"):
        _ = yield f"Browser session setup failed: {setup.get('error')}\nRespond with a brief failure message."
        yield 0.0
        return

    final_url = ""
    clicks = max_clicks
    try:
        _ = yield await render_harness_prompt(task_prompt)
        runtime = RUNTIME
        if runtime is not None:
            state = await runtime.session.get_browser_state_summary(
                include_screenshot=False,
                include_recent_events=False,
            )
            final_url = (state.url or "").strip()
            hist = await call_action("evaluate", {"code": "window.history.length"})
            if hist.get("ok"):
                text = str((hist.get("result") or {}).get("extracted_content", ""))
                nums = re.findall(r"\d+", text)
                if nums:
                    clicks = max(1, int(nums[0]) - 1)
    finally:
        await stop_session(force=True)

    if target_fragment in final_url.lower():
        max_clicks = max(1, int(max_clicks))
        if clicks <= max_clicks:
            reward = max(0.1, 1.0 - (clicks - 1) / max_clicks)
        else:
            reward = 0.1
    else:
        reward = 0.0
    yield reward


if __name__ == "__main__":
    env.run(transport="stdio")
