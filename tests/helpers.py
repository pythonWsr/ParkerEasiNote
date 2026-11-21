# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
"""测试辅助设施（进程桩 / 假时钟）。"""

from __future__ import annotations

import time
from typing import Callable, Dict, List, Optional


class FakeRunner:
    """可注入的 git / gh 进程桩。

    ``responses`` 的 key 是 ``" ".join(args)``；值可以是
    ``(returncode, stdout, stderr)`` 或 ``callable(args) -> CommandResult``。
    """

    def __init__(self, responses: Optional[Dict[str, object]] = None):
        self.calls: List[List[str]] = []
        self.responses = dict(responses or {})

    def __call__(self, args):
        from prlib.infra.git import CommandResult

        self.calls.append(list(args))
        key = " ".join(args)
        response = self.responses.get(key)
        if response is None:
            return CommandResult(tuple(["stub"] + list(args)), 0, "", "")
        if callable(response):
            return response(list(args))
        returncode, stdout, stderr = response  # type: ignore[misc]
        return CommandResult(tuple(["stub"] + list(args)), returncode, stdout, stderr)

    def commands(self) -> List[str]:
        return [" ".join(call) for call in self.calls]


class FakeClock:
    """可推进的单调时钟 + 配套 sleep。"""

    def __init__(self, start: float = 0.0):
        self.value = float(start)

    def __call__(self) -> float:
        return self.value

    def sleep(self, seconds: float) -> None:
        self.value += float(seconds)

    def advance(self, seconds: float) -> None:
        self.value += float(seconds)


def now_iso(offset_days: float = 0.0) -> str:
    """UTC ISO 时间字符串（用于 issue createdAt）。"""
    import datetime as _dt

    stamp = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(days=offset_days)
    return stamp.strftime("%Y-%m-%dT%H:%M:%SZ")
