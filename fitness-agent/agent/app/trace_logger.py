from __future__ import annotations

import copy
from typing import Any


class TraceLogger:
    def __init__(self) -> None:
        self._records: list[dict[str, Any]] = []

    def log(self, **payload: Any) -> None:
        self._records.append(payload)

    def list_records(self, user_id: str | None = None) -> list[dict[str, Any]]:
        if not user_id:
            return copy.deepcopy(self._records)

        return [copy.deepcopy(record) for record in self._records if record.get("user_id") == user_id]

