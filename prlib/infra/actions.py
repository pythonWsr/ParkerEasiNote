# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""GitHub Actions 协议（§11）。

结果绑定用 **nonce 索引**，不用 run id：
· 触发前本地生成 ``nonce`` 并入参
· workflow 完成后写 ``ops/nonce/<nonce>.json``
· 客户端轮询该文件 → 结果天然绑定本次触发，不存在并发错配
· ``gh workflow run`` 不返回 run id，也无需再 ``gh run list`` 去猜

失败由结果文件内的 ``{"ok": false, "error": {...}}`` 表达；文件一直不出现则超时。
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Optional

from .gh import Gh
from .status_store import StatusStore


class ActionsTimeout(RuntimeError):
    """等待 workflow 结果超时。"""


@dataclass(frozen=True)
class TriggerResult:
    """一次 workflow 触发的句柄。

    · ``nonce``：本次触发的唯一键，结果文件为 ``ops/nonce/<nonce>.json``
    · ``nonce == ""``：只可能是 dry-run（没有真正触发）
    · ``waited``：是否已同步等到结果；``--no-wait`` 时为 False，可稍后 ``pr.py sync <nonce>`` 查询
    """

    nonce: str
    waited: bool = False
    result: Optional[dict] = None
    dry_run: bool = False


class Actions:
    """pr-ops / dev-scan 的触发与结果读取。"""

    def __init__(
        self,
        gh: Gh,
        store: StatusStore,
        workflow: str = "pr-ops.yml",
        scan_workflow: str = "dev-scan.yml",
        poll_interval: float = 3.0,
        timeout: float = 180.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.gh = gh
        self.store = store
        self.workflow = workflow
        self.scan_workflow = scan_workflow
        self.poll_interval = poll_interval
        self.timeout = timeout
        self._clock = clock
        self._sleep = sleep

    # -- 触发 ---------------------------------------------------------
    def trigger(
        self,
        op: str,
        payload: Optional[dict] = None,
        actor: str = "",
        nonce: Optional[str] = None,
        no_wait: bool = False,
        dry_run: bool = False,
    ) -> TriggerResult:
        """触发一次 status 写操作，结果以 nonce 为键。"""
        key = nonce or uuid.uuid4().hex
        inputs = {
            "op": op,
            "payload": json.dumps(payload or {}, ensure_ascii=False, sort_keys=True),
            "actor": actor,
            "nonce": key,
        }
        if dry_run:
            return TriggerResult("", waited=False, dry_run=True)
        self.gh.run_workflow(self.workflow, inputs)
        if no_wait:
            return TriggerResult(key)
        return TriggerResult(key, waited=True, result=self.wait_result(key))

    # -- 结果 ---------------------------------------------------------
    def result_path(self, nonce: str) -> str:
        """结果文件路径：``ops/nonce/<nonce>.json``（不按日期分目录）。"""
        return "ops/nonce/%s.json" % nonce

    def wait_result(self, nonce: str, timeout: Optional[float] = None) -> dict:
        """轮询结果文件，直到出现或超时（§11 输出协议）。"""
        deadline = self._clock() + (timeout if timeout is not None else self.timeout)
        while True:
            self.store.fetch()
            self.store.invalidate()
            data = self.store.read_json(self.result_path(nonce))
            if data is not None:
                return dict(data)
            if self._clock() >= deadline:
                raise ActionsTimeout("等待 %s 的结果超时（ops/nonce/%s.json 未出现）" % (nonce, nonce))
            self._sleep(self.poll_interval)

    def read_result(self, nonce: str) -> dict:
        """直接读一次结果（``sync <nonce>`` 用）。"""
        self.store.fetch()
        self.store.invalidate()
        data = self.store.read_json(self.result_path(nonce))
        if data is None:
            raise ActionsTimeout("没有找到 %s 的结果文件" % nonce)
        return dict(data)

    # -- 扫描（§7.13 #12） ---------------------------------------------
    def trigger_scan(self, no_wait: bool = True, dry_run: bool = False) -> str:
        """触发 dev-scan，返回 nonce。

        已有运行中的扫描时**复用**，返回空串（表示本次没有新建任务）。
        """
        running = {"in_progress", "queued", "requested", "waiting", "pending"}
        for run in self.gh.list_runs(self.scan_workflow, limit=5):
            if str(run.get("status")) in running:
                return ""
        return self.trigger("scan", payload={}, actor="", no_wait=no_wait, dry_run=dry_run).nonce

    # -- 二次验证（requirement HIGH） ----------------------------------
    def start_twice_check(
        self,
        op: str,
        payload: Optional[dict] = None,
        actor: str = "",
        dry_run: bool = False,
        no_wait: bool = False,
    ) -> dict:
        """高风险操作：触发验证码 flow，返回结果 data（issue / code / expires_at）。

        payload 结构（§11 / M3 契约）::

            {"original_op": "open", "file": "…", "initiator": "alice", …}
        """
        merged = dict(payload or {})
        merged["original_op"] = op
        if actor:
            merged.setdefault("initiator", actor)
        result = self.trigger(
            "twice-check",
            payload=merged,
            actor=actor,
            no_wait=no_wait,
            dry_run=dry_run,
        )
        payload_result = result.result or {}
        return dict(payload_result.get("data") or {})
