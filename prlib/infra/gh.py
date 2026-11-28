# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""gh CLI 适配层。

· 身份（``gh api user``）缓存 1h
· CODEOWNERS 一律读 **main**（§7.2 前置）
· 所有写操作带 ``dry_run``
"""

from __future__ import annotations

import base64
import fnmatch
import json
import subprocess
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .git import CommandResult, Runner

GH = "gh"


class GhError(RuntimeError):
    """gh 调用失败。"""


@dataclass(frozen=True)
class CodeownersRule:
    """CODEOWNERS 的一条规则（文件末尾优先级最高）。"""

    pattern: str
    owners: Tuple[str, ...]


def parse_codeowners(text: str) -> List[CodeownersRule]:
    """解析 CODEOWNERS 文本（纯函数）。"""
    rules: List[CodeownersRule] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        owners = tuple(owner.lstrip("@") for owner in parts[1:] if owner.startswith("@"))
        if owners:
            rules.append(CodeownersRule(parts[0], owners))
    return rules


def _matches(pattern: str, path: str) -> bool:
    if pattern == "*":
        return True
    if pattern.startswith("/"):
        target = pattern[1:]
        return fnmatch.fnmatch(path, target) or path.startswith(target.rstrip("/") + "/")
    if pattern.endswith("/"):
        return path.startswith(pattern)
    if "/" not in pattern:
        return fnmatch.fnmatch(path.rsplit("/", 1)[-1], pattern)
    return fnmatch.fnmatch(path, pattern) or path.startswith(pattern.rstrip("/") + "/")


def owner_for_path(path: str, rules: Sequence[CodeownersRule]) -> Optional[str]:
    """返回最后一条匹配规则的第一个 owner（无匹配返回 None）。"""
    owner: Optional[str] = None
    for rule in rules:
        if _matches(rule.pattern, path):
            owner = rule.owners[0]
    return owner


def _default_runner(cwd: Optional[str] = None) -> Runner:
    def run(args: List[str]) -> CommandResult:
        proc = subprocess.run(
            [GH] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
        )
        return CommandResult(tuple([GH] + args), proc.returncode, proc.stdout, proc.stderr)

    return run


class Gh:
    """gh 命令包装。"""

    def __init__(
        self,
        runner: Optional[Runner] = None,
        repo: Optional[str] = None,
        clock: Callable[[], float] = time.monotonic,
        user_ttl: float = 3600.0,
        cwd: Optional[str] = None,
    ):
        self.runner = runner or _default_runner(cwd)
        self._repo = repo
        self._clock = clock
        self._user_ttl = user_ttl
        self._cache: Dict[str, Tuple[float, object]] = {}
        self.last_plan: Optional[List[str]] = None

    # -- 内部 ---------------------------------------------------------
    def _gh(self, args: Sequence[str]) -> str:
        result = self.runner(list(args))
        if result.returncode != 0:
            raise GhError("gh %s 失败（%d）：%s" % (" ".join(args), result.returncode, result.stderr.strip()))
        return result.stdout.strip()

    def _json(self, args: Sequence[str]):
        text = self._gh(args)
        return json.loads(text) if text else None

    def repo(self) -> str:
        if not self._repo:
            self._repo = self._gh(
                ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]
            )
        return self._repo

    # -- 身份 / 协作者 -------------------------------------------------
    def current_user(self) -> str:
        """``gh api user --jq .login``，缓存 1h。"""
        cached = self._cache.get("user")
        now = self._clock()
        if cached and cached[0] > now:
            return str(cached[1])
        login = self._gh(["api", "user", "--jq", ".login"])
        self._cache["user"] = (now + self._user_ttl, login)
        return login

    def invalidate_user(self) -> None:
        self._cache.pop("user", None)

    def is_repo_owner(self, login: str) -> bool:
        """login 是否是仓库所有者（owner 名，或该用户对 repo 有 admin 角色）。

        注意：必须查 ``login`` 本人的角色，不能查 token 持有者的 ``.permissions.admin``
        （那样 bob 用 alice 的 token 也会被判成 owner）。
        """
        repo = self.repo()
        owner = self._gh(["api", "repos/%s" % repo, "--jq", ".owner.login"]).strip()
        if owner == login:
            return True
        try:
            role = self._gh([
                "api", "repos/%s/collaborators/%s/permission" % (repo, login), "--jq", ".role_name",
            ]).strip()
        except GhError:
            return False
        return role == "admin"

    def list_collaborators(self) -> List[str]:
        out = self._gh(
            [
                "api",
                "--paginate",
                "repos/%s/collaborators" % self.repo(),
                "--jq",
                ".[].login",
            ]
        )
        people = [line.strip() for line in out.splitlines() if line.strip()]
        return [person for person in people if not person.endswith("[bot]")]

    # -- CODEOWNERS（只读 main） ---------------------------------------
    def fetch_codeowners(self, ref: str = "main", path: str = ".github/CODEOWNERS") -> str:
        encoded = self._gh(
            [
                "api",
                "repos/%s/contents/%s?ref=%s" % (self.repo(), path, ref),
                "--jq",
                ".content",
            ]
        )
        cleaned = "".join(encoded.split())
        if not cleaned:
            return ""
        return base64.b64decode(cleaned).decode("utf-8", "replace")

    def codeowners_rules(self, ref: str = "main", owners_path: str = ".github/CODEOWNERS") -> List[CodeownersRule]:
        return parse_codeowners(self.fetch_codeowners(ref, owners_path))

    def codeowners_owner(
        self, path: str, ref: str = "main", owners_path: str = ".github/CODEOWNERS"
    ) -> Optional[str]:
        """main 的 CODEOWNERS 中该文件的所有者（§7.2 前置）。"""
        return owner_for_path(path, self.codeowners_rules(ref, owners_path))

    # -- PR -----------------------------------------------------------
    def list_prs(self, state: str = "open", limit: int = 30) -> List[dict]:
        data = self._json(
            [
                "pr",
                "list",
                "--state",
                state,
                "--limit",
                str(limit),
                "--json",
                "number,title,state,headRefName,baseRefName,author,reviewDecision,isDraft",
            ]
        )
        return list(data or [])

    def open_pr(
        self,
        base: str,
        head: str,
        title: str,
        body: str = "",
        dry_run: bool = False,
    ) -> int:
        args = ["pr", "create", "--base", base, "--head", head, "--title", title, "--body", body]
        if dry_run:
            self.last_plan = args
            return 0
        url = self._gh(args)
        tail = url.rstrip("/").rsplit("/", 1)[-1]
        return int(tail) if tail.isdigit() else 0

    def pr_review(self, number: int, approve: bool = True, body: str = "", dry_run: bool = False) -> None:
        args = ["pr", "review", str(number), "--approve" if approve else "--request-changes"]
        if body:
            args += ["--body", body]
        if dry_run:
            self.last_plan = args
            return
        self._gh(args)

    def pr_comment(self, number: int, body: str, dry_run: bool = False) -> None:
        args = ["pr", "comment", str(number), "--body", body]
        if dry_run:
            self.last_plan = args
            return
        self._gh(args)

    def pr_merge(self, number: int, method: str = "merge", admin: bool = False, dry_run: bool = False) -> None:
        args = ["pr", "merge", str(number), "--%s" % method]
        if admin:
            args.append("--admin")
        if dry_run:
            self.last_plan = args
            return
        self._gh(args)

    # -- issue --------------------------------------------------------
    def create_issue(
        self,
        title: str,
        body: str = "",
        labels: Sequence[str] = (),
        dry_run: bool = False,
    ) -> int:
        args = ["issue", "create", "--title", title, "--body", body]
        for label in labels:
            args += ["--label", label]
        if dry_run:
            self.last_plan = args
            return 0
        url = self._gh(args)
        tail = url.rstrip("/").rsplit("/", 1)[-1]
        return int(tail) if tail.isdigit() else 0

    def close_issue(self, number: int, dry_run: bool = False) -> None:
        args = ["issue", "close", str(number)]
        if dry_run:
            self.last_plan = args
            return
        self._gh(args)

    def list_issues(self, labels: Sequence[str] = (), limit: int = 20, since_days: int = 0) -> List[dict]:
        args = [
            "issue",
            "list",
            "--state",
            "all",
            "--limit",
            str(limit),
            "--json",
            "number,title,body,createdAt,state,labels",
        ]
        for label in labels:
            args += ["--label", label]
        data = self._json(args) or []
        if not since_days:
            return list(data)
        import datetime as _dt

        cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=since_days)
        fresh = []
        for item in data:
            created = item.get("createdAt")
            if not created:
                continue
            stamp = _dt.datetime.fromisoformat(created.replace("Z", "+00:00"))
            if stamp >= cutoff:
                fresh.append(item)
        return fresh

    def edit_issue_body(self, number: int, body: str, dry_run: bool = False) -> None:
        args = ["issue", "edit", str(number), "--body", body]
        if dry_run:
            self.last_plan = args
            return
        self._gh(args)

    # -- Actions ------------------------------------------------------
    def run_workflow(
        self,
        workflow: str,
        inputs: Optional[Dict[str, str]] = None,
        dry_run: bool = False,
    ) -> None:
        args = ["workflow", "run", workflow]
        for key, value in (inputs or {}).items():
            args += ["-f", "%s=%s" % (key, value)]
        if dry_run:
            self.last_plan = args
            return
        self._gh(args)

    def download_release_assets(self, tag: str, dest: str, dry_run: bool = False) -> None:
        if dry_run:
            self.last_plan = ["release", "download", tag, "--dir", dest, "--clobber"]
            return
        self._gh(["release", "download", tag, "--dir", dest, "--clobber"])

    def pr_view(self, number: int) -> dict:
        data = self._json([
            "pr", "view", str(number),
            "--json", "number,state,baseRefName,mergeCommit,files",
        ])
        return dict(data or {})

    def create_release(
        self,
        tag: str,
        draft: bool = True,
        target: str = "main",
        title: str = "",
        notes: str = "",
        dry_run: bool = False,
    ) -> None:
        args = ["release", "create", tag, "--target", target,
                "--title", title or tag, "--notes", notes or ("Release " + tag)]
        if draft:
            args.append("--draft")
        if dry_run:
            self.last_plan = args
            return
        self._gh(args)

    def edit_release(self, tag: str, draft: bool = False, dry_run: bool = False) -> None:
        args = ["release", "edit", tag, "--draft=%s" % ("true" if draft else "false")]
        if dry_run:
            self.last_plan = args
            return
        self._gh(args)

    def release_view(self, tag: str) -> dict:
        data = self._json(["release", "view", tag, "--json", "tagName,isDraft,assets,url"])
        return dict(data or {})

    def latest_run_any(self, workflow: str) -> dict:
        runs = self._json(
            ["run", "list", "--workflow", workflow, "--limit", "1",
             "--json", "databaseId,status,conclusion,createdAt"]
        ) or []
        return dict(runs[0]) if runs else {}

    def list_runs(self, workflow: str, limit: int = 10) -> List[dict]:
        data = self._json(
            [
                "run",
                "list",
                "--workflow",
                workflow,
                "--limit",
                str(limit),
                "--json",
                "databaseId,status,conclusion,createdAt",
            ]
        )
        return list(data or [])

    def run_view(self, run_id: int) -> dict:
        data = self._json(["run", "view", str(run_id), "--json", "status,conclusion"])
        return dict(data or {})
