# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""命令执行上下文：惰性装配 git / gh / status / Actions。"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from ..core.config import Config
from ..infra.actions import Actions
from ..infra.gh import Gh
from ..infra.git import Git
from ..infra.status_store import StatusStore
from .output import Output


class RemoteFailure(RuntimeError):
    """Actions 返回 ``ok: false``。"""

    def __init__(self, code: int, message: str, hint: str = ""):
        self.code = int(code or 8)
        self.message = message
        self.hint = hint
        super().__init__(message)

    @property
    def exit_code(self) -> int:
        return self.code if 0 < self.code < 10 else 8


class Context:
    """一次命令执行的全部依赖（惰性构造，--dry-run 不会触发远端）。"""

    def __init__(self, args, output: Optional[Output] = None):
        self.args = args
        self.dry_run = bool(getattr(args, "dry_run", False))
        self.output = output or Output(
            json_mode=bool(getattr(args, "json", False)),
            short=bool(getattr(args, "short", False)),
        )
        self._git = None
        self._gh = None
        self._store = None
        self._actions = None
        self._user = None
        self._config = None

    # -- 依赖 ---------------------------------------------------------
    @property
    def git(self) -> Git:
        if self._git is None:
            self._git = Git()
        return self._git

    @property
    def gh(self) -> Gh:
        if self._gh is None:
            self._gh = Gh()
        return self._gh

    @property
    def store(self) -> StatusStore:
        if self._store is None:
            self._store = StatusStore(self.git)
        return self._store

    @property
    def actions(self) -> Actions:
        if self._actions is None:
            self._actions = Actions(self.gh, self.store)
        return self._actions

    @property
    def user(self) -> str:
        if self._user is None:
            self._user = self.gh.current_user()
        return self._user

    @property
    def config(self) -> Config:
        if self._config is None:
            try:
                self._config = self.store.config(self.user)
            except Exception:
                self.output.warn("读不到 status 分支的 config.ini，使用内置默认值")
                self._config = Config({}, user=self.user)
        return self._config

    # -- 常用 ---------------------------------------------------------
    def current_branch(self) -> str:
        return self.git.current_branch()

    def active(self) -> Dict[str, Any]:
        return self.store.active()

    def record(self, path: str):
        """取 (status, operator)。"""
        record = self.active().get(path)
        if isinstance(record, dict):
            return record.get("status"), record.get("operator")
        if isinstance(record, str):
            return record, None
        return None, None

    def codeowner(self, path: str) -> Optional[str]:
        try:
            path_cfg = str(self.config.get("codeowners-path"))
            return self.gh.codeowners_owner(path, "main", path_cfg)
        except Exception:
            return None

    def apply(self, op: str, payload: Optional[dict] = None) -> Dict[str, Any]:
        """经 Actions 写 status（dry-run 只打印计划）。"""
        if self.dry_run:
            plan = {"workflow": self.actions.workflow, "op": op, "payload": payload or {}}
            self.output.plan(
                "将触发 %s：op=%s payload=%s"
                % (self.actions.workflow, op, json.dumps(payload or {}, ensure_ascii=False))
            )
            return {"ok": True, "dry_run": True, "plan": plan}
        result = self.actions.trigger(op, payload or {}, actor=self.user)
        data = result.result or {}
        if not data.get("ok", False):
            error = data.get("error") or {}
            raise RemoteFailure(
                int(error.get("code", 8)),
                str(error.get("message", "远端操作失败")),
                str(error.get("hint", "")),
            )
        return data

    def start_verification(self, op: str, payload: Optional[dict]) -> Dict[str, Any]:
        """高风险（requirement HIGH）：开验证码 issue，返回 {issue, code, expires_at}。"""
        if self.dry_run:
            self.output.plan("将触发 twice-check：original_op=%s payload=%s" % (op, payload))
            return {}
        return self.actions.start_twice_check(op, payload, actor=self.user)
