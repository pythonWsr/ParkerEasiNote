# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""CLI 入口：分支约束 → 分发 → 退出码映射（§6 / §12）。"""

from __future__ import annotations

import sys
from typing import List

from ..core.errors import Rejection
from ..infra.actions import ActionsTimeout
from ..infra.gh import GhError
from ..infra.git import GitError
from ..infra.status_store import StatusError
from . import args as cli_args
from .commands import HANDLERS
from .context import Context, RemoteFailure
from .exit_codes import EXIT_FAIL, EXIT_NETWORK, EXIT_REMOTE, EXIT_USAGE
from .output import Output

WRITE_COMMANDS = frozenset(
    {
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
        "remind",
        "init",
    }
)


def _fail(out: Output, command: str, code: int, message: str, hint: str = "") -> int:
    out.failure(command, code, message, hint)
    return code


def _auto_check(ctx: Context) -> None:
    """配置 auto-check 时的轻量前置检查：只提示，不阻断（离线可用）。"""
    try:
        if not bool(ctx.config.get("auto-check")):
            return
        ctx.store.fetch()
        ctx.store.invalidate()
    except (GhError, GitError, StatusError, OSError) as exc:
        ctx.output.warn("自动 check 跳过：%s" % exc)


def _tab(ctx: Context, parsed) -> int:
    """一期：打印候选与可回填命令，不做 shell 集成。"""
    command = parsed.command
    try:
        if command in ("open", "close", "remove", "restore", "pr", "commit"):
            rows = []
            for path, record in sorted(ctx.active().items()):
                status = record.get("status") if isinstance(record, dict) else record
                operator = record.get("operator") if isinstance(record, dict) else "-"
                rows.append((path, status, operator))
            ctx.output.table(["文件", "状态", "持有者"], rows)
            ctx.output.line("")
            ctx.output.line("可回填：python pr.py %s <文件>" % command)
            return 0
        if command in ("switch", "transfer"):
            names = sorted((ctx.store.latest().get("branches") or {}))
            for name in names:
                ctx.output.line(name)
            return 0
        if command in ("approve", "reject", "merge", "comment"):
            for item in ctx.gh.list_prs():
                ctx.output.line("%s\t%s" % (item.get("number"), item.get("title")))
            return 0
    except Exception as exc:
        ctx.output.warn("生成候选失败：%s" % exc)
    ctx.output.line("该命令暂无候选值")
    return 0


def main(argv: List[str] = None) -> int:
    parsed = cli_args.parse_args(argv)
    out = Output(json_mode=parsed.json, short=parsed.short)
    ctx = Context(parsed, output=out)

    if parsed.tab:
        return _tab(ctx, parsed)

    try:
        branch = ctx.current_branch()
    except GitError as exc:
        return _fail(out, parsed.command, EXIT_FAIL, "当前目录不是 git 仓库：%s" % exc)

    dev_prefix = "dev/"
    default_branch = "main"
    if parsed.command in (cli_args.MAIN_ONLY | cli_args.DEV_ONLY):
        try:
            default_branch = str(ctx.config.get("default-branch"))
        except Exception:
            pass
    if parsed.command in cli_args.DEV_ONLY:
        try:
            dev_prefix = str(ctx.config.get("dev-prefix"))
        except Exception:
            pass
    if not cli_args.branch_allowed(parsed.command, branch, dev_prefix, default_branch):
        message, hint = cli_args.forbidden_message(parsed.command, branch)
        return _fail(out, parsed.command, EXIT_USAGE, message, hint)

    handler = HANDLERS.get(parsed.command)
    if handler is None:
        return _fail(out, parsed.command, EXIT_USAGE, "未知命令：%s" % parsed.command)

    if parsed.command in WRITE_COMMANDS:
        _auto_check(ctx)

    try:
        return int(handler(ctx, parsed) or 0)
    except Rejection as rejection:
        return _fail(out, parsed.command, rejection.exit_code, rejection.message, rejection.hint)
    except RemoteFailure as exc:
        return _fail(out, parsed.command, exc.exit_code, exc.message, exc.hint)
    except ActionsTimeout as exc:
        return _fail(
            out,
            parsed.command,
            EXIT_REMOTE,
            str(exc),
            "稍后用 pr.py sync <nonce> 查询结果",
        )
    except GhError as exc:
        return _fail(out, parsed.command, EXIT_NETWORK, "gh 调用失败：%s" % exc, "先执行 gh auth status")
    except StatusError as exc:
        return _fail(out, parsed.command, EXIT_FAIL, "status 分支内容异常：%s" % exc)
    except GitError as exc:
        return _fail(out, parsed.command, EXIT_FAIL, "git 调用失败：%s" % exc)
    except KeyboardInterrupt:  # pragma: no cover
        return 130
