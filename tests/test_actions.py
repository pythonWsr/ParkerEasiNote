# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""Actions 协议测试（nonce 索引，全部打桩）。"""

import json

import pytest

from prlib.infra.actions import Actions, ActionsTimeout, TriggerResult
from tests.helpers import FakeClock


class FakeGh:
    def __init__(self, runs=None):
        self.runs = list(runs or [])
        self.workflow_calls = []
        self.list_calls = 0

    def repo(self):
        return "o/r"

    def run_workflow(self, workflow, inputs=None, dry_run=False):
        self.workflow_calls.append((workflow, dict(inputs or {})))

    def list_runs(self, workflow, limit=10):
        self.list_calls += 1
        if self.runs and isinstance(self.runs[0], list):
            return list(self.runs.pop(0))
        return list(self.runs)


class FakeStore:
    """read_json 按路径返回，支持"先空后到"的序列。"""

    def __init__(self, files=None, default=None):
        self.files = dict(files or {})
        self.default = default
        self.fetch_count = 0
        self.invalidate_count = 0

    def fetch(self):
        self.fetch_count += 1
        return "ok"

    def invalidate(self):
        self.invalidate_count += 1

    def read_json(self, path):
        value = self.files.get(path, self.default)
        if isinstance(value, list):
            return value.pop(0) if value else None
        return value


def _actions(gh, store, clock=None, timeout=180.0, poll=3.0):
    clock = clock or FakeClock()
    return Actions(
        gh,
        store,
        clock=clock,
        sleep=clock.sleep,
        poll_interval=poll,
        timeout=timeout,
    )


# ---------------------------------------------------------------- 触发与结果


def test_trigger_waits_and_returns_bound_result():
    gh = FakeGh()
    store = FakeStore({"ops/nonce/abc123.json": {"ok": True, "op": "open"}})
    result = _actions(gh, store).trigger("open", {"file": "a.js"}, actor="alice", nonce="abc123")
    assert result.nonce == "abc123"
    assert result.waited and result.result == {"ok": True, "op": "open"}
    inputs = gh.workflow_calls[0][1]
    assert inputs["op"] == "open"
    assert inputs["actor"] == "alice"
    assert inputs["nonce"] == "abc123"
    assert json.loads(inputs["payload"]) == {"file": "a.js"}


def test_nonce_is_unique_per_trigger():
    gh = FakeGh()
    store = FakeStore()
    actions = _actions(gh, store, timeout=0)
    first = actions.trigger("open", no_wait=True).nonce
    second = actions.trigger("open", no_wait=True).nonce
    assert first and second and first != second


def test_trigger_no_wait_does_not_poll():
    gh = FakeGh()
    store = FakeStore()
    result = _actions(gh, store).trigger("close", nonce="n1", no_wait=True)
    assert result.nonce == "n1" and not result.waited and result.result is None
    assert store.fetch_count == 0


def test_trigger_dry_run_has_empty_nonce():
    gh = FakeGh()
    result = _actions(gh, FakeStore()).trigger("open", dry_run=True)
    assert result.dry_run and result.nonce == ""
    assert gh.workflow_calls == []


def test_wait_result_polls_until_file_appears():
    clock = FakeClock()
    store = FakeStore({"ops/nonce/n2.json": [None, None, {"ok": True}]})
    result = _actions(FakeGh(), store, clock, timeout=30, poll=3).wait_result("n2")
    assert result == {"ok": True}
    assert clock.value == 6
    assert store.fetch_count == 3
    assert store.invalidate_count == 3


def test_wait_result_timeout_mentions_nonce_path():
    clock = FakeClock()
    store = FakeStore({})
    with pytest.raises(ActionsTimeout) as excinfo:
        _actions(FakeGh(), store, clock, timeout=2, poll=3).wait_result("n3")
    assert "ops/nonce/n3.json" in str(excinfo.value)


def test_read_result_missing():
    with pytest.raises(ActionsTimeout):
        _actions(FakeGh(), FakeStore()).read_result("n4")


def test_read_result_fetches_before_read():
    store = FakeStore({"ops/nonce/n5.json": {"ok": True}})
    assert _actions(FakeGh(), store).read_result("n5") == {"ok": True}
    assert store.fetch_count == 1 and store.invalidate_count == 1


def test_result_path_has_no_date_partition():
    assert _actions(FakeGh(), FakeStore()).result_path("abc") == "ops/nonce/abc.json"


# ---------------------------------------------------------------- 扫描


def test_trigger_scan_reuses_running_scan():
    gh = FakeGh(runs=[[{"databaseId": 11, "status": "in_progress"}]])
    assert _actions(gh, FakeStore()).trigger_scan() == ""
    assert gh.workflow_calls == []


def test_trigger_scan_starts_when_idle():
    gh = FakeGh(runs=[[]])
    nonce = _actions(gh, FakeStore()).trigger_scan()
    assert nonce
    assert gh.workflow_calls[0][1]["op"] == "scan"


def test_trigger_scan_dry_run():
    gh = FakeGh(runs=[[]])
    assert _actions(gh, FakeStore()).trigger_scan(dry_run=True) == ""
    assert gh.workflow_calls == []


# ---------------------------------------------------------------- 二次验证


def test_start_twice_check_payload_contract():
    gh = FakeGh()
    store = FakeStore(default={"ok": True, "data": {"issue": 7, "code": "abcd1234",
                                                    "expires_at": "2026-01-01T00:05:00Z"}})
    data = _actions(gh, store).start_twice_check("open", {"file": "a.js"}, actor="alice")
    assert data["issue"] == 7 and data["code"] == "abcd1234"
    inputs = gh.workflow_calls[0][1]
    assert inputs["op"] == "twice-check"
    assert json.loads(inputs["payload"]) == {
        "file": "a.js",
        "original_op": "open",
        "initiator": "alice",
    }


def test_trigger_result_defaults():
    result = TriggerResult("x")
    assert result.nonce == "x" and not result.waited and result.result is None
