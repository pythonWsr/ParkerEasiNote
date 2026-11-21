# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""Actions 侧的 status 写操作（§11）。

由 ``pr-ops.yml`` 调用：在 status 分支的工作副本里原地修改 active/latest/config/version。
**唯一的写 status 路径**；本地 pr.py 永不直接改 status。

用法::

    python -m prlib.ops.server --status-dir <dir> --op open \
        --payload '{"file":"a.js"}' --actor alice --nonce abc
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import string
import subprocess
import sys
from typing import Any, Dict, Optional, Tuple

from .. import __version__
from ..core import states, transition
from ..core.config import Config, parse_ini

OPS = {
    "create",
    "open",
    "commit",
    "close",
    "pr",
    "remove",
    "restore",
    "reset",
    "rebase",
    "move",
    "transfer",
    "delete",
    "switch",
    "config",
    "merge",
    "release",
    "init",
    "sync",
    "scan",
    "remind",
    "twice-check",
    "verify-twice-check",
}


def _read(status_dir: str, name: str, default: Any) -> Any:
    path = os.path.join(status_dir, name)
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    if name.endswith(".json"):
        return json.loads(text) if text.strip() else default
    return text


def _write(status_dir: str, name: str, value: Any) -> None:
    path = os.path.join(status_dir, name)
    if name.endswith(".json"):
        text = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    else:
        text = value if isinstance(value, str) else str(value)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def _gh(args):
    proc = subprocess.run(["gh"] + args, capture_output=True, text=True, check=False)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def _record(active: Dict[str, Any], path: str) -> Tuple[Optional[str], Optional[str]]:
    record = active.get(path)
    if isinstance(record, dict):
        return record.get("status"), record.get("operator")
    if isinstance(record, str):
        return record, None
    return None, None


def _set(active: Dict[str, Any], path: str, status: str, operator: str, **extra) -> None:
    record = {"status": status, "operator": operator, "updated_at": _now()}
    record.update(extra)
    active[path] = record


def _parse_ts(text: str):
    import datetime as _dt

    if not text:
        return None
    try:
        return _dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _expires_at(seconds: int) -> str:
    import datetime as _dt

    stamp = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(seconds=seconds)
    return stamp.strftime("%Y-%m-%dT%H:%M:%SZ")


def _now() -> str:
    import datetime as _dt

    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _generate_code(length: int = 8) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def apply_op(
    op: str,
    payload: Dict[str, Any],
    actor: str,
    status_dir: str,
    repo_dir: str = ".",
) -> Dict[str, Any]:
    if op not in OPS:
        return {"ok": False, "error": {"code": 2, "message": "未知 op：%s" % op}}

    active = _read(status_dir, "active.json", {})
    latest = _read(status_dir, "latest.json", {"branches": {}, "shas": []})
    version = _read(status_dir, "version.json", {})
    config = Config(parse_ini(_read(status_dir, "config.ini", "")), user=actor)
    branches = latest.setdefault("branches", {})

    if op == "init":
        defaults = {
            "active.json": {},
            "latest.json": {"branches": {}, "shas": []},
            "version.json": {
                "schema": 3,
                "latest": version.get("latest"),
                "assets": version.get("assets", {}),
                "tool": {"pr.py": {"version": __version__}},
            },
            "config.ini": "[global]\n",
        }
        created = []
        for name, default in defaults.items():
            path = os.path.join(status_dir, name)
            if not os.path.exists(path):
                _write(status_dir, name, default)
                created.append(name)
        return {"ok": True, "op": op, "data": {"initialized": created}}

    if op == "twice-check":
        original = str(payload.get("original_op") or "")
        target = str(payload.get("file") or payload.get("files") or "")
        length = int(config.get("twice-check-num"))
        code = _generate_code(length)
        expires = _expires_at(int(config.get("twice-check-timeout")))
        title = "[pr-twice-check] %s %s" % (original, target or "-")
        body = "验证码：`%s`\n操作：%s\n文件：%s\n发起人：%s\n过期：%s\n" % (
            code, original, target, actor, expires
        )
        rc, out, err = _gh(["issue", "create", "--title", title, "--body", body, "--label", "pr-twice-check"])
        tail = out.rstrip("/").rsplit("/", 1)[-1]
        number = int(tail) if tail.isdigit() else 0
        if rc != 0:
            return {"ok": False, "error": {"code": 8, "message": "创建验证 issue 失败：%s" % err}}
        return {"ok": True, "op": op, "data": {"issue": number, "code": code, "expires_at": expires}}

    if op == "verify-twice-check":
        code = str(payload.get("code") or "")
        target = str(payload.get("file") or "")
        initiator = str(payload.get("initiator") or actor)
        rc, out, err = _gh([
            "issue", "list", "--label", "pr-twice-check", "--state", "open",
            "--limit", "50", "--json", "number,body,createdAt",
        ])
        if rc != 0:
            return {"ok": False, "error": {"code": 8, "message": "查询验证 issue 失败：%s" % err}}
        try:
            issues = json.loads(out or "[]")
        except ValueError:
            issues = []
        body = ""
        expired_seen = False
        now = _parse_ts(_now())
        timeout = int(config.get("twice-check-timeout"))
        for item in sorted(issues, key=lambda entry: entry.get("createdAt") or "", reverse=True):
            text = item.get("body") or ""
            if target and not re.search(r"^\s*文件：%s\s*$" % re.escape(target), text, re.M):
                continue
            if initiator and not re.search(r"^\s*发起人：%s\s*$" % re.escape(initiator), text, re.M):
                continue
            created = _parse_ts(str(item.get("createdAt") or ""))
            if not created or not now:
                # 无法判定时效 → fail-closed，按过期处理
                expired_seen = True
                continue
            if (now - created).total_seconds() > timeout:
                expired_seen = True
                continue
            body = text
            break
        if not body:
            reason = "expired" if expired_seen else "no-open-issue"
            return {"ok": True, "op": op, "data": {"valid": False, "reason": reason}}
        match = re.search(r"验证码：`([a-z0-9]+)`", body)
        valid = bool(match and match.group(1) == code)
        return {"ok": True, "op": op, "data": {"valid": valid, "code_seen": bool(match)}}

    if op == "create":
        branch = str(payload.get("branch") or "")
        public = bool(payload.get("public"))
        branches[branch] = {
            "owner": states.EVERYONE if public else actor,
            "state": states.BRANCH_PUBLIC if public else states.BRANCH_NORMAL,
        }
        if public:
            names = [n.strip() for n in str(config.get("public-branches") or "").split(",") if n.strip()]
            if branch not in names:
                names.append(branch)
            cfg_text = _read(status_dir, "config.ini", "")
            _write(status_dir, "config.ini", _set_public(cfg_text, names))
        _write(status_dir, "latest.json", latest)
        return {"ok": True, "op": op, "data": {"branch": branch, "public": public}}

    if op == "scan":
        return {
            "ok": True,
            "op": op,
            "data": {
                "branches": {name: entry.get("state") if isinstance(entry, dict) else entry
                             for name, entry in branches.items()},
                "files": len(active),
            },
        }

    if op in ("merge", "release"):
        return {"ok": True, "op": op, "data": dict(payload), "todo": "由 workflow 完成 gh/release 侧动作"}

    if op in ("reset", "rebase", "sync"):
        return {"ok": True, "op": op, "data": dict(payload)}

    if op == "config":
        key, value, scope = payload.get("key"), payload.get("value"), payload.get("scope", "user")
        if not config.can_set(str(key), str(scope)):
            return {"ok": False, "error": {"code": 2, "message": "配置项 %s 不允许写入 %s" % (key, scope)}}
        text = _read(status_dir, "config.ini", "")
        _write(status_dir, "config.ini", _set_ini(text, str(scope), str(key), str(value)))
        return {"ok": True, "op": op, "data": {"key": key, "value": value, "scope": scope}}

    if op == "remind":
        users = payload.get("users") or []
        message = str(payload.get("message") or "")
        body = " ".join("@" + str(user) for user in users) + "\n\n" + message
        rc, out, err = _gh(["issue", "create", "--title", "[pr-notify] 拍一拍", "--body", body,
                            "--label", "pr-notify"])
        if rc != 0:
            return {"ok": False, "error": {"code": 8, "message": "创建通知失败：%s" % err}}
        return {"ok": True, "op": op, "data": {"users": users, "issue": out}}

    if op == "switch":
        branch = str(payload.get("branch") or "")
        owner = branches.get(branch)
        if isinstance(owner, dict):
            owner["owner"] = actor
            owner["state"] = states.BRANCH_NORMAL
        else:
            branches[branch] = {"owner": actor, "state": states.BRANCH_NORMAL}
        _write(status_dir, "latest.json", latest)
        return {"ok": True, "op": op, "data": {"branch": branch}}

    if op == "transfer":
        branch, target = str(payload.get("branch")), str(payload.get("user"))
        if branch in branches:
            if isinstance(branches[branch], dict):
                branches[branch]["owner"] = target
            else:
                branches[branch] = {"owner": target, "state": states.BRANCH_NORMAL}
        _write(status_dir, "latest.json", latest)
        return {"ok": True, "op": op, "data": {"branch": branch, "to": target}}

    if op == "delete":
        branch = str(payload.get("branch") or "")
        branches[branch] = {"owner": states.DANGLING_OWNER, "state": states.BRANCH_DANGLING}
        for path, record in list(active.items()):
            if isinstance(record, dict) and record.get("branch") == branch:
                _set(active, path, states.DANGLING, record.get("operator") or actor)
        _write(status_dir, "active.json", active)
        _write(status_dir, "latest.json", latest)
        return {"ok": True, "op": op, "data": {"branch": branch}}

    # -- 文件级操作（复用 core.transition） ----------------------------
    if op == "open":
        path = str(payload.get("file") or "")
        status, operator = _record(active, path)
        owner = payload.get("codeowners_owner")
        result = transition.try_open(
            status, operator, actor, owner, config,
            force=bool(payload.get("force")),
            twice_check_ok=bool(payload.get("twice_check")),
        )
        if not result.ok:
            return _deny(result)
        _set(active, path, states.OPENING, actor, branch=payload.get("branch"))
        data = {"file": path}
    elif op == "commit":
        files = payload.get("files") or []
        for path in files:
            _set(active, path, states.COMMITTED, actor, branch=payload.get("branch"))
        data = {"files": files}
    elif op == "close":
        path = str(payload.get("file") or "")
        _set(active, path, states.CLOSED, actor)
        data = {"file": path}
    elif op == "pr":
        if payload.get("cancel"):
            for path, record in active.items():
                if isinstance(record, dict) and record.get("operator") == actor \
                        and record.get("status") == states.WAITING:
                    _set(active, path, states.COMMITTED, actor, branch=record.get("branch"))
            data = {"cancelled": True}
        else:
            files = payload.get("files") or []
            for path in files:
                status, operator = _record(active, path)
                _set(active, path, states.WAITING, operator or actor)
            data = {"files": files}
    elif op == "remove":
        path = str(payload.get("file") or "")
        status, operator = _record(active, path)
        _set(active, path, states.REMOVED if status == states.REMOVED else states.DANGLING, actor)
        data = {"file": path, "status": active[path]["status"]}
    elif op == "restore":
        path = str(payload.get("file") or "")
        _set(active, path, states.DANGLING, actor)
        data = {"file": path}
    elif op == "move":
        src, dst = str(payload.get("src")), str(payload.get("dst"))
        _set(active, src, states.RENAMED, actor, to=dst)
        _set(active, dst, states.NEW, actor)
        data = {"src": src, "dst": dst}
    else:  # pragma: no cover - 其余 op 已在上面处理
        return {"ok": False, "error": {"code": 2, "message": "未实现的 op：%s" % op}}

    _write(status_dir, "active.json", active)
    _write(status_dir, "latest.json", latest)
    _write(status_dir, "version.json", version)
    return {"ok": True, "op": op, "data": data}


def _deny(result) -> Dict[str, Any]:
    rejection = result.rejection
    return {
        "ok": False,
        "error": {
            "code": rejection.exit_code if rejection else 7,
            "message": rejection.message if rejection else "拒绝",
            "hint": rejection.hint if rejection else "",
        },
    }


def _set_ini(text: str, section: str, key: str, value: str) -> str:
    lines = text.splitlines()
    out, current, done = [], "", False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            current = stripped[1:-1].strip().lower()
            out.append(line)
            continue
        if current == section and stripped.split("=")[0].strip().lower() == key:
            out.append("%s = %s" % (key, value))
            done = True
            continue
        out.append(line)
    if not done:
        out.append("[%s]" % section)
        out.append("%s = %s" % (key, value))
    return "\n".join(out) + "\n"


def _set_public(text: str, names) -> str:
    return _set_ini(text, "global", "public-branches", ",".join(names))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="prlib.ops.server")
    parser.add_argument("--status-dir", required=True)
    parser.add_argument("--op", required=True)
    parser.add_argument("--payload", default="{}")
    parser.add_argument("--actor", default="")
    parser.add_argument("--nonce", default="")
    parser.add_argument("--repo-dir", default=".")
    args = parser.parse_args(argv)

    if args.op not in OPS:
        print(json.dumps({"ok": False, "error": {"code": 2, "message": "未知 op"}}))
        return 0

    try:
        payload = json.loads(args.payload or "{}")
        result = apply_op(args.op, payload, args.actor, args.status_dir, args.repo_dir)
    except Exception as exc:  # pragma: no cover - Actions 兜底
        result = {"ok": False, "error": {"code": 8, "message": "内部错误：%s" % exc}}
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
