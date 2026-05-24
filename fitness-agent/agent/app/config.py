from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _read_float_env(key: str, default: float) -> float:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _read_int_env(key: str, default: int) -> int:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float_invalid(key: str) -> bool:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return False
    try:
        float(raw)
        return False
    except ValueError:
        return True


def _env_int_invalid(key: str) -> bool:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return False
    try:
        int(raw)
        return False
    except ValueError:
        return True


@dataclass(slots=True)
class Settings:
    app_name: str = "Health Agent Service"
    backend_base_url: str = os.getenv("BACKEND_BASE_URL", "http://127.0.0.1:3001")
    llm_model_id: str = os.getenv("LLM_MODEL_ID", "deepseek-v4-flash")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://api.deepseek.com")
    llm_timeout: float = _read_float_env("LLM_TIMEOUT", 20)
    llm_temperature: float = _read_float_env("LLM_TEMPERATURE", 0.3)
    llm_max_tokens: int = _read_int_env("LLM_MAX_TOKENS", 1200)
    llm_max_retries: int = _read_int_env("LLM_MAX_RETRIES", 2)
    amap_api_key: str = os.getenv("AMAP_API_KEY", "")

    def llm_config_warnings(self) -> list[str]:
        warnings: list[str] = []
        if not self.llm_api_key:
            warnings.append("LLM_API_KEY is not configured.")
        if not self.llm_base_url:
            warnings.append("LLM_BASE_URL is not configured.")
        if not self.llm_model_id:
            warnings.append("LLM_MODEL_ID is not configured.")
        if self.llm_timeout <= 0:
            warnings.append("LLM_TIMEOUT must be greater than zero.")
        if _env_float_invalid("LLM_TIMEOUT"):
            warnings.append("LLM_TIMEOUT is invalid; using default 30.")
        if _env_float_invalid("LLM_TEMPERATURE"):
            warnings.append("LLM_TEMPERATURE is invalid; using default 0.3.")
        if self.llm_max_tokens <= 0:
            warnings.append("LLM_MAX_TOKENS must be greater than zero.")
        if _env_int_invalid("LLM_MAX_TOKENS"):
            warnings.append("LLM_MAX_TOKENS is invalid; using default 1200.")
        if self.llm_max_retries < 0:
            warnings.append("LLM_MAX_RETRIES must be zero or greater.")
        if _env_int_invalid("LLM_MAX_RETRIES"):
            warnings.append("LLM_MAX_RETRIES is invalid; using default 2.")
        return warnings


settings = Settings()
