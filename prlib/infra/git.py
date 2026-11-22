# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""git 适配层。

· 纯解析函数（:func:`parse_porcelain` / :func:`classify_changes`）不碰进程
· :class:`Git` 通过注入的 runner 调 git，测试可完全打桩
· **所有写操作都带 ``dry_run``**：True 时只返回"将执行什么"，不真执行
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from typing import Callable, Iterable, List, Mapping, Optional, Sequence, Tuple

from ..core import states

Runner = Callable[[List[str]], "CommandResult"]

GIT = "git"


@dataclass(frozen=True)
class CommandResult:
    """一次子进程调用的结果。"""

    command: Tuple[str, ...]
    returncode: int = 0
    stdout: str = ""
    stderr: str = ""
    dry_run: bool = False


class GitError(RuntimeError):
    """git 调用失败。"""


@dataclass(frozen=True)
class Change:
    """一条工作区改动。"""

    kind: str  # R / D / M / A / untracked / conflict
    path: str
    old_path: Optional[str] = None


@dataclass(frozen=True)
class ChangeDecision:
    """提交白名单判定（§7.3）。"""

    path: str
    kind: str
    allowed: bool
    reason: str


@dataclass(frozen=True)
class RebaseOutcome:
    """rebase 结果。

    ``conflict=True`` 才表示"真的卡在冲突现场"；其余失败 ``error`` 带原因原文。
    """

    ok: bool
    conflict: bool
    command: Tuple[str, ...] = ()
    dry_run: bool = False
    message: str = ""
    error: str = ""


@dataclass(frozen=True)
class ResetOutcome:
    """reset 结果。"""

    discarded: int = 0
    command: Tuple[str, ...] = ()
    dry_run: bool = False
    done: bool = False


@dataclass(frozen=True)
class PushOutcome:
    """push 结果。"""

    ok: bool
    command: Tuple[str, ...] = ()
    dry_run: bool = False
    message: str = ""


# ----------------------------------------------------------- porcelain 解析

_UNQUOTE_MAP = {"n": b"\n", "t": b"\t", "r": b"\r", '"': b'"', "\\": b"\\"}


def _unquote(text: str) -> str:
    """还原 git 的 C 风格路径转义（含八进制 UTF-8 字节）。"""
    if not (text.startswith('"') and text.endswith('"')) or len(text) < 2:
        return text
    body = text[1:-1]
    out = bytearray()
    i = 0
    while i < len(body):
        char = body[i]
        if char == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt in "01234567":
                digits = ""
                j = i + 1
                while j < len(body) and len(digits) < 3 and body[j] in "01234567":
                    digits += body[j]
                    j += 1
                out.append(int(digits, 8))
                i = j
                continue
            out.extend(_UNQUOTE_MAP.get(nxt, nxt.encode("utf-8")))
            i += 2
            continue
        out.extend(char.encode("utf-8"))
        i += 1
    return out.decode("utf-8", "replace")


def parse_porcelain(output: str) -> List[Change]:
    """解析 ``git status --porcelain=v1``。

    支持：R（重命名）、D（删除）、M/T（修改）、A（新增）、??（未跟踪）、
    UU/AA/DD 等冲突标记。
    """
    changes: List[Change] = []
    for raw in output.splitlines():
        if len(raw) < 3:
            continue
        code = raw[:2]
        rest = raw[3:]
        if code == "??":
            changes.append(Change("untracked", _unquote(rest)))
            continue
        if code.strip() in ("UU", "AA", "DD", "AU", "UA", "DU", "UD"):
            changes.append(Change("conflict", _unquote(rest)))
            continue
        if "R" in code or code.startswith("R"):
            old, _, new = rest.partition(" -> ")
            changes.append(Change("R", _unquote(new), _unquote(old)))
            continue
        if "D" in code:
            changes.append(Change("D", _unquote(rest)))
            continue
        if code.startswith("A") or "A" in code:
            changes.append(Change("A", _unquote(rest)))
            continue
        changes.append(Change("M", _unquote(rest)))
    return changes


def _status_of(value: object) -> Optional[str]:
    """从状态记录中取 status（兼容 dict / 字符串）。"""
    if value is None:
        return None
    if isinstance(value, Mapping):
        return value.get("status")  # type: ignore[return-value]
    if isinstance(value, str):
        return value
    return None


def classify_changes(
    porcelain: str,
    active_status_map: Mapping[str, object],
) -> List[ChangeDecision]:
    """提交白名单（§7.3 步骤 7）。

    · R（重命名）→ 放行
    · D 且 active.json 中状态为 renamed / removed → 放行
    · 其余 D → 拒绝（须用 remove）
    · 冲突未解决 → 拒绝
    """
    decisions: List[ChangeDecision] = []
    for change in parse_porcelain(porcelain):
        if change.kind == "R":
            decisions.append(ChangeDecision(change.path, change.kind, True, "重命名放行"))
            continue
        if change.kind == "D":
            status = _status_of(active_status_map.get(change.path))
            if status in (states.RENAMED, states.REMOVED):
                decisions.append(
                    ChangeDecision(change.path, change.kind, True, "renamed/removed 删除放行")
                )
            else:
                decisions.append(
                    ChangeDecision(change.path, change.kind, False, "删除文件必须走 remove")
                )
            continue
        if change.kind == "conflict":
            decisions.append(ChangeDecision(change.path, change.kind, False, "存在未解决冲突"))
            continue
        decisions.append(ChangeDecision(change.path, change.kind, True, "普通改动"))
    return decisions


# ------------------------------------------------------------------ Git 本体


def _default_runner(cwd: Optional[str] = None) -> Runner:
    def run(args: List[str]) -> CommandResult:
        proc = subprocess.run(
            [GIT] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
        )
        return CommandResult(tuple([GIT] + args), proc.returncode, proc.stdout, proc.stderr)

    return run


class Git:
    """git 命令包装。"""

    def __init__(self, runner: Optional[Runner] = None, cwd: Optional[str] = None):
        self.runner = runner or _default_runner(cwd)
        self.cwd = cwd

    # -- 内部 ---------------------------------------------------------
    def _run(
        self,
        args: Sequence[str],
        *,
        dry_run: bool = False,
        mutating: bool = False,
        check: bool = True,
    ) -> CommandResult:
        command = tuple([GIT] + list(args))
        if mutating and dry_run:
            return CommandResult(command, 0, "", "", True)
        result = self.runner(list(args))
        if check and result.returncode != 0:
            raise GitError("%s 失败（%d）：%s" % (" ".join(command), result.returncode, result.stderr.strip()))
        return result

    # -- 读 -----------------------------------------------------------
    def current_branch(self) -> str:
        """当前分支名；兼容 unborn HEAD（首次提交前）。"""
        result = self._run(["rev-parse", "--abbrev-ref", "HEAD"], check=False)
        name = result.stdout.strip()
        if result.returncode == 0 and name and name != "HEAD":
            return name
        symbolic = self._run(["symbolic-ref", "--short", "HEAD"], check=False)
        fallback = symbolic.stdout.strip()
        if symbolic.returncode == 0 and fallback:
            return fallback
        raise GitError("无法确定当前分支（HEAD 可能尚未指向任何提交）")

    def head_sha(self) -> str:
        return self._run(["rev-parse", "HEAD"]).stdout.strip()

    def porcelain(self) -> str:
        return self._run(["status", "--porcelain=v1"]).stdout

    def is_dirty(self) -> bool:
        return bool(self.porcelain().strip())

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        result = self._run(
            ["merge-base", "--is-ancestor", ancestor, descendant],
            check=False,
        )
        if result.returncode not in (0, 1):
            raise GitError("merge-base --is-ancestor 失败（%d）" % result.returncode)
        return result.returncode == 0

    def file_history_chain(self, path: str, branch: str, main: str, limit: int = 50) -> bool:
        """文件级历史链（§7.3 步骤 6，判定标准 b）。

        ``git log <branch>..<main> -- <path>`` 为空即通过：
        main 上该文件的提交必须都已在分支里；分支上新增的提交（含 revert）不算违约。
        """
        missing = self._run(
            ["log", "--format=%H", "-n", str(limit), "%s..%s" % (branch, main), "--", path]
        ).stdout.split()
        return not missing

    def fetch(self, remote: str = "origin", ref: str = "", dry_run: bool = False) -> CommandResult:
        args = ["fetch", remote] + ([ref] if ref else [])
        return self._run(args, dry_run=dry_run, mutating=True, check=False)

    def show_file(self, ref: str, path: str) -> Optional[str]:
        """读取某 ref 下的文件（不存在返回 None）。"""
        result = self._run(["show", "%s:%s" % (ref, path)], check=False)
        if result.returncode != 0:
            return None
        return result.stdout

    def list_unregistered_shas(self, registered: Iterable[str], base: str = "origin/main") -> List[str]:
        """分支上未登记到 latest.json 的提交（§4.1.5）。"""
        known = {sha.strip() for sha in registered if sha}
        shas = self._run(["rev-list", "%s..HEAD" % base]).stdout.split()
        return [sha for sha in shas if sha not in known]

    # -- 写（全部带 dry_run） ------------------------------------------
    def cherry_pick(self, sha: str, dry_run: bool = False) -> CommandResult:
        return self._run(["cherry-pick", sha], dry_run=dry_run, mutating=True, check=False)

    def git_dir(self) -> str:
        """``.git`` 目录（支持 worktree 的 gitfile 形态）。"""
        result = self._run(["rev-parse", "--git-dir"], check=False)
        path = result.stdout.strip()
        if result.returncode == 0 and path:
            return path if os.path.isabs(path) else os.path.join(self.cwd or os.getcwd(), path)
        return os.path.join(self.cwd or os.getcwd(), ".git")

    def _rebase_in_progress(self) -> bool:
        """是否卡在 rebase 现场（存在 rebase-merge / rebase-apply）。"""
        base = self.git_dir()
        return any(
            os.path.isdir(os.path.join(base, name)) for name in ("rebase-merge", "rebase-apply")
        )

    def rebase_onto(self, main: str = "origin/main", dry_run: bool = False) -> RebaseOutcome:
        """rebase 到 main；区分"真冲突"与"其它失败"。"""
        command = tuple([GIT, "rebase", main])
        if dry_run:
            return RebaseOutcome(True, False, command, True, "将执行 git rebase %s" % main)
        result = self._run(["rebase", main], mutating=True, check=False)
        detail = (result.stderr or result.stdout).strip()
        if result.returncode == 0:
            return RebaseOutcome(True, False, command, False, (result.stdout or "").strip())
        if self._rebase_in_progress():
            return RebaseOutcome(False, True, command, False, detail, detail)
        return RebaseOutcome(
            False,
            False,
            command,
            False,
            "rebase 失败（非冲突）: %s" % detail,
            detail,
        )

    def reset_hard(self, target: str = "origin/main", dry_run: bool = False) -> ResetOutcome:
        command = tuple([GIT, "reset", "--hard", target])
        count = self._run(["rev-list", "--count", "%s..HEAD" % target], check=False).stdout.strip()
        discarded = int(count or 0) if count.isdigit() else 0
        if dry_run:
            return ResetOutcome(discarded, command, True, False)
        self._run(["reset", "--hard", target], mutating=True)
        return ResetOutcome(discarded, command, False, True)

    def push_force_with_lease(self, branch: str, dry_run: bool = False) -> PushOutcome:
        command = tuple([GIT, "push", "--force-with-lease", "origin", branch])
        if dry_run:
            return PushOutcome(True, command, True, "将执行 %s" % " ".join(command))
        result = self._run(command[1:], mutating=True, check=False)
        ok = result.returncode == 0
        return PushOutcome(ok, command, False, (result.stderr or "").strip())

    def create_branch(self, name: str, base: str = "origin/main", dry_run: bool = False) -> CommandResult:
        """新建本地分支并切换（失败时调用方再试 switch）。"""
        return self._run(
            ["switch", "-c", name, base], dry_run=dry_run, mutating=True, check=False
        )

    def switch(self, name: str, dry_run: bool = False) -> CommandResult:
        return self._run(["switch", name], dry_run=dry_run, mutating=True, check=False)

    def changed_files(self, base: str = "origin/main") -> List[str]:
        """本分支相对 base 改动过的文件（用于 pr 只收本分支真正改过的文件）。"""
        out = self._run(["diff", "--name-only", "%s...HEAD" % base]).stdout
        return [line.strip() for line in out.splitlines() if line.strip()]

    def add(self, paths: Sequence[str], dry_run: bool = False) -> CommandResult:
        return self._run(["add", "--"] + list(paths), dry_run=dry_run, mutating=True, check=False)

    def commit(self, paths: Sequence[str], message: str = "", dry_run: bool = False) -> CommandResult:
        args = ["commit", "-m", message or "pr.py commit"] + (["--"] + list(paths) if paths else [])
        return self._run(args, dry_run=dry_run, mutating=True, check=False)

    def push(self, branch: str, dry_run: bool = False) -> CommandResult:
        return self._run(["push", "origin", branch], dry_run=dry_run, mutating=True, check=False)
