# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""输出层（§12）：人类可读 / --short / --json。"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional, Sequence, TextIO

from ..core.config import Config


class Output:
    """统一输出口；错误一律走 stderr。"""

    def __init__(
        self,
        json_mode: bool = False,
        short: bool = False,
        stream: Optional[TextIO] = None,
        err: Optional[TextIO] = None,
    ):
        self.json_mode = json_mode
        self.short = short
        self.stream = stream or sys.stdout
        self.err = err or sys.stderr

    # -- 基础 ---------------------------------------------------------
    def _json(self, payload: Dict[str, Any]) -> None:
        self.stream.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")

    def line(self, text: str = "") -> None:
        if not self.json_mode:
            self.stream.write(text + "\n")

    def success(self, op: str, data: Optional[Dict[str, Any]] = None) -> None:
        """成功结果。"""
        if self.json_mode:
            self._json({"ok": True, "op": op, "data": data or {}, "error": None})
        elif self.short and data:
            self.line(str(data))
        elif data is not None:
            self.line(json.dumps(data, ensure_ascii=False, indent=2))

    def failure(
        self,
        op: str,
        code: int,
        message: str,
        hint: str = "",
    ) -> None:
        """失败结果（stderr；--json 时同时写到 stdout 便于程序消费）。"""
        if self.json_mode:
            self._json(
                {
                    "ok": False,
                    "op": op,
                    "data": {},
                    "error": {"code": code, "message": message, "hint": hint},
                }
            )
            return
        self.err.write("错误：%s\n" % message)
        if hint:
            self.err.write("提示：%s\n" % hint)

    # -- 提示 ---------------------------------------------------------
    def warn(self, text: str) -> None:
        self.err.write("警告：%s\n" % text)

    def plan(self, text: str) -> None:
        """dry-run 时把"将要做什么"写到 stderr，不污染 stdout。"""
        self.err.write("[dry-run] %s\n" % text)

    def table(self, headers: Sequence[str], rows: List[Sequence[Any]]) -> None:
        if self.json_mode:
            self._json(
                {
                    "ok": True,
                    "op": "table",
                    "data": {"headers": list(headers), "rows": [list(row) for row in rows]},
                    "error": None,
                }
            )
            return
        widths = [len(str(head)) for head in headers]
        for row in rows:
            widths = [max(width, len(str(cell))) for width, cell in zip(widths, row)]
        fmt = "  ".join("{:<%d}" % width for width in widths)
        self.line(fmt.format(*headers))
        self.line(fmt.format(*["-" * width for width in widths]))
        for row in rows:
            self.line(fmt.format(*row))


def warn_review_self(config: Config, out: Output) -> None:
    """§5.3 #30：review-self 被强制关闭时提示一次。"""
    if str(config.raw("review-self") or "").strip().lower() in ("true", "1", "yes", "on"):
        out.warn("review-self 已强制关闭（仓库不允许自我审批），配置值被忽略")
