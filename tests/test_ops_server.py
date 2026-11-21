# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""Actions 侧 ops.server 的状态写入测试（纯本地目录，无网络）。"""

import json

from tests.helpers import now_iso

from prlib.ops import server


def _read(tmp_path, name):
    return json.loads((tmp_path / name).read_text(encoding="utf-8"))


def test_init_creates_skeleton(tmp_path):
    result = server.apply_op("init", {}, "alice", str(tmp_path))
    assert result["ok"]
    for name in ("active.json", "latest.json", "version.json", "config.ini"):
        assert (tmp_path / name).exists()


def test_unknown_op_rejected(tmp_path):
    result = server.apply_op("nope", {}, "alice", str(tmp_path))
    assert not result["ok"] and result["error"]["code"] == 2


def test_create_branch_writes_owner(tmp_path):
    server.apply_op("init", {}, "alice", str(tmp_path))
    result = server.apply_op("create", {"branch": "dev/alice", "public": False}, "alice", str(tmp_path))
    assert result["ok"]
    assert _read(tmp_path, "latest.json")["branches"]["dev/alice"]["owner"] == "alice"


def test_create_public_branch(tmp_path):
    server.apply_op("init", {}, "alice", str(tmp_path))
    server.apply_op("create", {"branch": "dev/shared", "public": True}, "alice", str(tmp_path))
    assert _read(tmp_path, "latest.json")["branches"]["dev/shared"]["owner"] == "@everyone"
    assert "dev/shared" in (tmp_path / "config.ini").read_text(encoding="utf-8")


def test_open_and_commit(tmp_path):
    server.apply_op("init", {}, "alice", str(tmp_path))
    server.apply_op("create", {"branch": "dev/alice"}, "alice", str(tmp_path))
    opened = server.apply_op("open", {"file": "a.js"}, "alice", str(tmp_path))
    assert opened["ok"]
    assert _read(tmp_path, "active.json")["a.js"]["status"] == "opening"

    committed = server.apply_op("commit", {"files": ["a.js"], "branch": "dev/alice"}, "alice", str(tmp_path))
    assert committed["ok"]
    assert _read(tmp_path, "active.json")["a.js"]["status"] == "committed"


def test_open_held_by_other_needs_force(tmp_path):
    server.apply_op("init", {}, "alice", str(tmp_path))
    server.apply_op("open", {"file": "a.js"}, "bob", str(tmp_path))
    denied = server.apply_op("open", {"file": "a.js"}, "alice", str(tmp_path))
    assert not denied["ok"] and denied["error"]["code"] == 5
    only_force = server.apply_op("open", {"file": "a.js", "force": True}, "alice", str(tmp_path))
    assert not only_force["ok"] and only_force["error"]["code"] == 6
    forced = server.apply_op(
        "open", {"file": "a.js", "force": True, "twice_check": "abc"}, "alice", str(tmp_path)
    )
    assert forced["ok"]


def test_move_marks_renamed(tmp_path):
    server.apply_op("init", {}, "alice", str(tmp_path))
    server.apply_op("open", {"file": "a.js"}, "alice", str(tmp_path))
    server.apply_op("move", {"src": "a.js", "dst": "b.js"}, "alice", str(tmp_path))
    active = _read(tmp_path, "active.json")
    assert active["a.js"]["status"] == "renamed" and active["a.js"]["to"] == "b.js"
    assert active["b.js"]["status"] == "new"


def test_config_set(tmp_path):
    server.apply_op("init", {}, "alice", str(tmp_path))
    server.apply_op("config", {"key": "auto-close", "value": "true", "scope": "global"}, "alice", str(tmp_path))
    assert "auto-close = true" in (tmp_path / "config.ini").read_text(encoding="utf-8")


def test_pr_cancel_returns_files_to_committed(tmp_path):
    server.apply_op("init", {}, "alice", str(tmp_path))
    server.apply_op("open", {"file": "a.js"}, "alice", str(tmp_path))
    server.apply_op("pr", {"files": ["a.js"]}, "alice", str(tmp_path))
    assert _read(tmp_path, "active.json")["a.js"]["status"] == "waiting"
    server.apply_op("pr", {"cancel": True}, "alice", str(tmp_path))
    assert _read(tmp_path, "active.json")["a.js"]["status"] == "committed"


def test_twice_check_then_verify(tmp_path, monkeypatch):
    created = []

    def fake_gh(args):
        created.append(list(args))
        if args[:2] == ["issue", "create"]:
            return 0, "https://github.com/o/r/issues/7", ""
        return 0, json.dumps([
            {
                "number": 7,
                "body": "验证码：`abcd1234`\n操作：open\n文件：a.js\n发起人：alice\n过期：2026-01-01T00:05:00Z",
                "createdAt": now_iso(0),
            }
        ]), ""

    monkeypatch.setattr(server, "_gh", fake_gh)
    server.apply_op("init", {}, "alice", str(tmp_path))
    result = server.apply_op(
        "twice-check", {"original_op": "open", "file": "a.js"}, "alice", str(tmp_path)
    )
    assert result["ok"] and result["data"]["issue"] == 7
    assert len(result["data"]["code"]) == 8
    assert "过期" in result["data"]["expires_at"] or result["data"]["expires_at"]

    good = server.apply_op(
        "verify-twice-check",
        {"file": "a.js", "code": "abcd1234", "initiator": "alice"},
        "alice",
        str(tmp_path),
    )
    assert good["ok"] and good["data"]["valid"] is True

    bad = server.apply_op(
        "verify-twice-check",
        {"file": "a.js", "code": "wrong", "initiator": "alice"},
        "alice",
        str(tmp_path),
    )
    assert bad["ok"] and bad["data"]["valid"] is False


def test_verify_twice_check_without_open_issue(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "_gh", lambda args: (0, "[]", ""))
    result = server.apply_op(
        "verify-twice-check", {"file": "a.js", "code": "x"}, "alice", str(tmp_path)
    )
    assert result["ok"] and result["data"]["valid"] is False
    assert result["data"]["reason"] == "no-open-issue"


def test_verify_twice_check_gh_error(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "_gh", lambda args: (1, "", "boom"))
    result = server.apply_op(
        "verify-twice-check", {"file": "a.js", "code": "x"}, "alice", str(tmp_path)
    )
    assert not result["ok"] and result["error"]["code"] == 8


def test_verify_twice_check_expired_issue(tmp_path, monkeypatch):
    """issue 仍 open 但已超过 twice-check-timeout → valid=false。"""

    def fake_gh(args):
        return 0, json.dumps([
            {
                "number": 8,
                "body": "验证码：`abcd1234`\n操作：open\n文件：a.js\n发起人：alice\n过期：old",
                "createdAt": now_iso(-10),
            }
        ]), ""

    monkeypatch.setattr(server, "_gh", fake_gh)
    result = server.apply_op(
        "verify-twice-check",
        {"file": "a.js", "code": "abcd1234", "initiator": "alice"},
        "alice",
        str(tmp_path),
    )
    assert result["ok"] and result["data"]["valid"] is False
    assert result["data"]["reason"] == "expired"


def test_verify_twice_check_fail_closed_on_bad_created_at(tmp_path, monkeypatch):
    """createdAt 缺失/非法时 fail-closed，视为过期而不是通过。"""

    def fake_gh(args):
        return 0, json.dumps([
            {
                "number": 9,
                "body": "验证码：`abcd1234`\n操作：open\n文件：a.js\n发起人：alice\n过期：x",
                "createdAt": "",
            }
        ]), ""

    monkeypatch.setattr(server, "_gh", fake_gh)
    result = server.apply_op(
        "verify-twice-check",
        {"file": "a.js", "code": "abcd1234", "initiator": "alice"},
        "alice",
        str(tmp_path),
    )
    assert result["ok"] and result["data"]["valid"] is False
    assert result["data"]["reason"] == "expired"


def test_init_is_idempotent_and_seeds_version(tmp_path):
    first = server.apply_op("init", {}, "alice", str(tmp_path))
    assert set(first["data"]["initialized"]) == {
        "active.json", "latest.json", "version.json", "config.ini",
    }
    version = json.loads((tmp_path / "version.json").read_text(encoding="utf-8"))
    assert version["schema"] == 3 and version["tool"]["pr.py"]["version"]

    second = server.apply_op("init", {}, "alice", str(tmp_path))
    assert second["ok"] and second["data"]["initialized"] == []
