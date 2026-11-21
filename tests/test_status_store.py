# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""status 分支只读层测试。"""

import json

import pytest

from prlib.infra.status_store import StatusError, StatusStore
from tests.helpers import FakeClock


class FakeGit:
    """只暴露 show_file / fetch 的假 git。"""

    def __init__(self, files=None):
        self.files = dict(files or {})
        self.show_calls = []
        self.fetch_calls = []

    def show_file(self, ref, path):
        self.show_calls.append((ref, path))
        return self.files.get(path)

    def fetch(self, remote="origin", ref="", dry_run=False):
        self.fetch_calls.append((remote, ref))
        return "fetched"


def _store(files=None, clock=None):
    git = FakeGit(files)
    return git, StatusStore(git, clock=clock or FakeClock(), ttl=60.0)


def test_read_text_cached_within_ttl():
    clock = FakeClock()
    git, store = _store({"active.json": "{}"}, clock)
    assert store.read_text("active.json") == "{}"
    assert store.read_text("active.json") == "{}"
    assert len(git.show_calls) == 1

    clock.advance(61)
    store.read_text("active.json")
    assert len(git.show_calls) == 2


def test_invalidate_clears_cache():
    git, store = _store({"active.json": "{}"})
    store.read_text("active.json")
    store.invalidate()
    store.read_text("active.json")
    assert len(git.show_calls) == 2


def test_ref_and_fetch():
    git, store = _store()
    assert store.ref() == "origin/status"
    store.fetch()
    assert git.fetch_calls == [("origin", "status")]


def test_read_json_missing_returns_none():
    _, store = _store()
    assert store.read_json("nope.json") is None


def test_read_json_invalid_raises():
    _, store = _store({"bad.json": "{not json"})
    with pytest.raises(StatusError):
        store.read_json("bad.json")


def test_four_data_files():
    files = {
        "active.json": json.dumps({"a.js": {"status": "opening", "operator": "alice"}}),
        "latest.json": json.dumps({"branches": {"dev/alice": {"owner": "alice"}}}),
        "version.json": json.dumps({"latest": "10.0.5", "tool": {"pr.py": {"version": "1.0.0"}}}),
        "config.ini": "[global]\nauto-close = true\n[alice]\nwarn = 小心\n",
    }
    _, store = _store(files)
    assert store.active()["a.js"]["operator"] == "alice"
    assert store.latest()["branches"]["dev/alice"]["owner"] == "alice"
    assert store.version()["latest"] == "10.0.5"
    assert "auto-close" in store.config_text()


def test_config_parses_ini():
    _, store = _store({"config.ini": "[global]\nauto-close = true\n[alice]\nwarn = 小心\n"})
    cfg = store.config("alice")
    assert cfg.get("auto-close") is True
    assert cfg.get("warn") == "小心"


def test_config_defaults_when_file_missing():
    _, store = _store()
    cfg = store.config("alice")
    assert cfg.get("pr-branch") == "pr"


def test_file_status_variants():
    files = {
        "active.json": json.dumps({"a.js": {"status": "opening"}, "b.js": "closed"}),
    }
    _, store = _store(files)
    assert store.file_status("a.js") == "opening"
    assert store.file_status("b.js") == "closed"
    assert store.file_status("c.js") is None


def test_branch_owner_variants():
    files = {"latest.json": json.dumps({"branches": {"dev/a": {"owner": "alice"}, "dev/b": "bob"}})}
    _, store = _store(files)
    assert store.branch_owner("dev/a") == "alice"
    assert store.branch_owner("dev/b") == "bob"
    assert store.branch_owner("dev/c") is None


def test_no_write_functions_exist():
    """约束：本地代码不存在写 status 的路径。"""
    forbidden = ("write_", "save_", "update_", "commit_", "put_")
    names = [name for name in dir(StatusStore) if not name.startswith("__")]
    assert not [name for name in names if name.startswith(forbidden)]


def test_fetch_invalidates_cache():
    git, store = _store({"active.json": "{}"})
    store.read_text("active.json")
    store.fetch()
    store.read_text("active.json")
    assert len(git.show_calls) == 2
