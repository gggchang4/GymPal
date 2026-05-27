from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SECRET_KEY_PARTS = ("authorization", "cookie", "token", "password", "secret", "api_key", "apikey", "auth_token")
MAX_STRING_LENGTH = 2000
MAX_ARRAY_ITEMS = 12
MAX_OBJECT_KEYS = 40
LOG_PATH = Path(__file__).resolve().parents[2] / ".runlogs" / "flow.log"


def _truncate(text: str) -> str:
    if len(text) <= MAX_STRING_LENGTH:
        return text
    return f"{text[:MAX_STRING_LENGTH]}...<truncated {len(text) - MAX_STRING_LENGTH} chars>"


def _redact(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _truncate(value)
    if isinstance(value, list):
        items = [_redact(item) for item in value[:MAX_ARRAY_ITEMS]]
        if len(value) > MAX_ARRAY_ITEMS:
            items.append(f"<truncated {len(value) - MAX_ARRAY_ITEMS} items>")
        return items
    if isinstance(value, dict):
        output: dict[str, Any] = {}
        items = list(value.items())
        for key, item in items[:MAX_OBJECT_KEYS]:
            normalized_key = str(key).lower()
            output[str(key)] = "<redacted>" if any(part in normalized_key for part in SECRET_KEY_PARTS) else _redact(item)
        if len(items) > MAX_OBJECT_KEYS:
            output["__truncated_keys"] = len(items) - MAX_OBJECT_KEYS
        return output
    return _truncate(str(value))


def _safe_print(text: str) -> None:
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or "utf-8"
        safe_text = text.encode(encoding, errors="backslashreplace").decode(encoding, errors="replace")
        print(safe_text, flush=True)


def write_flow_log(source: str, event: str, payload: dict[str, Any]) -> None:
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "event": event,
        "payload": _redact(payload),
    }
    line = json.dumps(entry, ensure_ascii=False)
    _safe_print(f"[FLOW][{source}][{event}] {json.dumps(entry['payload'], ensure_ascii=False)}")
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError as exc:
        _safe_print(f"[FLOW] Failed to write flow.log: {exc}")
