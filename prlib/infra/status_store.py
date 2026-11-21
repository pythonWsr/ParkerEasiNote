# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""status 分支读取层（**只读**）。

本地代码里不存在任何写 status 的路径；写操作一律经 :mod:`prlib.infra.actions`
触发 GitHub Actions，由 App token 完成（§4.1）。

缓存：TTL 60s + 显式 :meth:`StatusStore.invalidate`。
"""

from __future__ import annotations

import json
import time
from typing import Callable, Dict, Optional, Tuple

from ..core.config import Config, parse_ini
from .git import Git


class StatusError(RuntimeError):
    """status 分支内容异常。"""


class StatusStore:
    """从 ``origin/<status-branch>`` 读取 active/latest/config/version。"""

    def __init__(
        self,
        git: Git,
        branch: str = "status",
        remote: str = "origin",
        ttl: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.git = git
        self.branch = branch
        self.remote = remote
        self.ttl = ttl
        self._clock = clock
        self._cache: Dict[str, Tuple[Optional[str], float]] = {}

    # -- 基础 ---------------------------------------------------------
    def ref(self) -> str:
        """``origin/status`` 这种 ref 名。"""
        return "%s/%s" % (self.remote, self.branch)

    def fetch(self, dry_run: bool = False):
        """``git fetch origin status``，并**自动清空缓存**。"""
        result = self.git.fetch(self.remote, self.branch, dry_run=dry_run)
        self.invalidate()
        return result

    def invalidate(self) -> None:
        """清空缓存（sync / 写操作之后调用）。"""
        self._cache.clear()

    def read_text(self, path: str) -> Optional[str]:
        """读取 status 分支上的文件（带 TTL 缓存）。"""
        now = self._clock()
        cached = self._cache.get(path)
        if cached is not None and cached[1] > now:
            return cached[0]
        value = self.git.show_file(self.ref(), path)
        self._cache[path] = (value, now + self.ttl)
        return value

    def read_json(self, path: str):
        """读取并解析 JSON；文件不存在返回 None。"""
        text = self.read_text(path)
        if text is None:
            return None
        try:
            return json.loads(text)
        except ValueError as exc:
            raise StatusError("status 分支的 %s 不是合法 JSON: %s" % (path, exc))

    # -- 四个数据文件 --------------------------------------------------
    def active(self) -> dict:
        """active.json（文件 status / operator 的唯一权威）。"""
        return self.read_json("active.json") or {}

    def latest(self) -> dict:
        """latest.json（分支 owner / 已登记 SHA / 文件最后提交）。"""
        return self.read_json("latest.json") or {}

    def version(self) -> dict:
        """version.json（含 tool 段）。"""
        return self.read_json("version.json") or {}

    def config_text(self) -> str:
        return self.read_text("config.ini") or ""

    def config(self, user: str) -> Config:
        """把 config.ini 解析成 core 的 :class:`Config`。"""
        return Config(parse_ini(self.config_text()), user=user)

    # -- 便利查询 ------------------------------------------------------
    def file_status(self, path: str) -> Optional[str]:
        record = self.active().get(path)
        if isinstance(record, dict):
            return record.get("status")
        if isinstance(record, str):
            return record
        return None

    def branch_owner(self, branch: str) -> Optional[str]:
        entry = (self.latest().get("branches") or {}).get(branch)
        if isinstance(entry, dict):
            return entry.get("owner")
        return entry if isinstance(entry, str) else None
