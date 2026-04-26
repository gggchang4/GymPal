from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parent.parent / ".env")


@dataclass(slots=True)
class Settings:
    app_name: str = "Health Agent Service"
    backend_base_url: str = os.getenv("BACKEND_BASE_URL", "http://127.0.0.1:3001")
    llm_model_id: str = os.getenv("LLM_MODEL_ID", "gpt-4.1-mini")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    llm_timeout: float = float(os.getenv("LLM_TIMEOUT", "30"))
    llm_temperature: float = float(os.getenv("LLM_TEMPERATURE", "0.3"))
    llm_max_tokens: int = int(os.getenv("LLM_MAX_TOKENS", "1200"))
    amap_api_key: str = os.getenv("AMAP_API_KEY", "")


settings = Settings()
