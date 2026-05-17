from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from openai import OpenAI

from .config import settings


logger = logging.getLogger("health_agent.llm")


@dataclass(slots=True)
class StructuredLLMResult:
    ok: bool
    data: dict[str, Any]
    model_id: str
    base_url: str
    latency_ms: int
    error_code: str | None = None
    error_message: str | None = None
    fallback_used: bool = False


def _extract_json_object(text: str) -> str:
    cleaned = text.strip()

    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end >= start:
        return cleaned[start : end + 1]
    return cleaned


class OpenAICompatibleLLMClient:
    def __init__(self) -> None:
        self._enabled = bool(settings.llm_api_key)
        self._client = (
            OpenAI(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url,
                timeout=settings.llm_timeout,
            )
            if self._enabled
            else None
        )

    def supports_tool_calling(self) -> bool:
        return True

    def supports_json_output(self) -> bool:
        return True

    def is_enabled(self) -> bool:
        return self._enabled and self._client is not None

    @staticmethod
    def _classify_error(exc: Exception) -> str:
        name = type(exc).__name__.lower()
        message = str(exc).lower()
        if "authentication" in name or "401" in message or "unauthorized" in message:
            return "authentication_error"
        if "timeout" in name or "timed out" in message:
            return "timeout"
        if isinstance(exc, json.JSONDecodeError):
            return "json_parse_error"
        return "llm_request_failed"

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        if not self._enabled or self._client is None:
            logger.warning("[LLM] Request skipped because no API key/client is configured.")
            return user_prompt

        logger.info(
            "[LLM] Sending chat completion request to %s with model=%s user_chars=%s",
            settings.llm_base_url,
            settings.llm_model_id,
            len(user_prompt),
        )
        try:
            response = self._client.chat.completions.create(
                model=settings.llm_model_id,
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
        except Exception:
            logger.exception("[LLM] Request failed before a response was returned.")
            raise

        output = response.choices[0].message.content or ""
        logger.info(
            "[LLM] Response received from model=%s output_chars=%s",
            settings.llm_model_id,
            len(output),
        )
        return output

    def generate_structured(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        result = self.generate_structured_with_metadata(system_prompt, user_prompt)
        if result.ok:
            return result.data
        if result.error_code == "llm_disabled":
            return {}
        raise RuntimeError(result.error_message or result.error_code or "LLM structured request failed.")

    def generate_structured_with_metadata(self, system_prompt: str, user_prompt: str) -> StructuredLLMResult:
        started = time.perf_counter()
        if not self._enabled or self._client is None:
            logger.warning("[LLM] Structured request skipped because no API key/client is configured.")
            return StructuredLLMResult(
                ok=False,
                data={},
                model_id=settings.llm_model_id,
                base_url=settings.llm_base_url,
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_code="llm_disabled",
                error_message="LLM_API_KEY is not configured.",
                fallback_used=True,
            )

        logger.info(
            "[LLM] Sending structured request to %s with model=%s user_chars=%s",
            settings.llm_base_url,
            settings.llm_model_id,
            len(user_prompt),
        )
        try:
            response = self._client.chat.completions.create(
                model=settings.llm_model_id,
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
        except Exception as exc:
            error_code = self._classify_error(exc)
            logger.exception("[LLM] Structured request failed before a response was returned.")
            return StructuredLLMResult(
                ok=False,
                data={},
                model_id=settings.llm_model_id,
                base_url=settings.llm_base_url,
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_code=error_code,
                error_message=str(exc),
                fallback_used=True,
            )
        text = response.choices[0].message.content or "{}"
        logger.info(
            "[LLM] Structured response received from model=%s output_chars=%s",
            settings.llm_model_id,
            len(text),
        )
        if not text.strip():
            return StructuredLLMResult(
                ok=False,
                data={},
                model_id=settings.llm_model_id,
                base_url=settings.llm_base_url,
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_code="empty_response",
                error_message="The model returned an empty response.",
                fallback_used=True,
            )
        try:
            parsed = json.loads(_extract_json_object(text))
        except Exception as exc:
            error_code = self._classify_error(exc)
            logger.exception("[LLM] Structured response could not be parsed as JSON.")
            return StructuredLLMResult(
                ok=False,
                data={},
                model_id=settings.llm_model_id,
                base_url=settings.llm_base_url,
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_code=error_code,
                error_message=str(exc),
                fallback_used=True,
            )

        if not isinstance(parsed, dict):
            return StructuredLLMResult(
                ok=False,
                data={},
                model_id=settings.llm_model_id,
                base_url=settings.llm_base_url,
                latency_ms=int((time.perf_counter() - started) * 1000),
                error_code="invalid_json_shape",
                error_message="The model returned JSON that was not an object.",
                fallback_used=True,
            )

        return StructuredLLMResult(
            ok=True,
            data=parsed,
            model_id=settings.llm_model_id,
            base_url=settings.llm_base_url,
            latency_ms=int((time.perf_counter() - started) * 1000),
            fallback_used=False,
        )

    def health_check(self) -> dict[str, Any]:
        result = self.generate_structured_with_metadata(
            "Return JSON only.",
            '{"task":"Return exactly {\"ok\":true,\"service\":\"llm\"}."}',
        )
        return {
            "enabled": self.is_enabled(),
            "ok": result.ok and result.data.get("ok") is True,
            "model_id": result.model_id,
            "base_url": result.base_url,
            "latency_ms": result.latency_ms,
            "error_code": None if result.ok else result.error_code,
            "error_message": None if result.ok else result.error_message,
        }
