# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""参数解析与分支约束（§6.1）。"""

from __future__ import annotations

import argparse
from typing import List, Tuple

# §6.1 分支归属
MAIN_ONLY = frozenset({"create", "list", "approve", "reject", "comment", "merge", "release"})
DEV_ONLY = frozenset(
    {
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
        "remind",
    }
)
ANY_BRANCH = frozenset(
    {"check", "status", "view", "config", "init", "sync", "log", "whoami", "doctor"}
)
OWNER_ONLY = frozenset({"release", "merge"})

COMMANDS = sorted(MAIN_ONLY | DEV_ONLY | ANY_BRANCH)


def _global_flags() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--dry-run", action="store_true", help="只校验与读远端，不写 status / 不 push / 不开 issue")
    parser.add_argument("--json", action="store_true", help="机器可读输出（§12 结构）")
    parser.add_argument("--short", action="store_true", help="精简输出")
    parser.add_argument("--tab", action="store_true", help="打印候选与可回填命令（一期不做 shell 集成）")
    return parser


def build_parser() -> argparse.ArgumentParser:
    parent = _global_flags()
    parser = argparse.ArgumentParser(
        prog="pr.py",
        description="仓库内 PR 流程管理工具（状态机 + 权限 + Actions）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "分支归属（§6.1）：\n"
            "  main      : create list approve reject comment merge release\n"
            "  dev/<me>  : open commit close pr remove restore reset rebase move\n"
            "              transfer delete switch remind\n"
            "  任意      : check status view config init sync log whoami doctor\n"
        ),
    )
    sub = parser.add_subparsers(dest="command", metavar="<command>")

    def cmd(name: str, help_text: str) -> argparse.ArgumentParser:
        return sub.add_parser(
            name,
            parents=[parent],
            help=help_text,
            description=help_text,
            formatter_class=argparse.RawDescriptionHelpFormatter,
        )

    p = cmd("create", "创建自己的 dev 分支")
    p.add_argument("branch", help="分支名，必须以 dev/ 开头")
    p.add_argument("--public", action="store_true", help="创建公有分支（owner=@everyone）")

    p = cmd("open", "把文件置为 opening（可跟重定向）")
    p.add_argument("files", nargs="+", help="要打开的文件路径")
    p.add_argument("--force", action="store_true", help="低风险跳过 / 高风险第一步")
    p.add_argument("--twice-check", metavar="CODE", help="高风险操作的验证码")

    p = cmd("commit", "提交已打开的文件")
    p.add_argument("-m", "--message", default="", help="提交信息")
    p.add_argument("--force", action="store_true")

    p = cmd("close", "关闭自己持有的文件")
    p.add_argument("files", nargs="+")

    p = cmd("pr", "把自己分支的改动提成 PR")
    p.add_argument("--cancel", action="store_true", help="撤回自己正在等待审批的 PR")
    p.add_argument("--force", action="store_true")
    p.add_argument("--twice-check", metavar="CODE")

    cmd("list", "列出文件状态与持有者")

    p = cmd("approve", "审批 PR（main）")
    p.add_argument("number", type=int)
    p.add_argument("-m", "--message", default="")

    p = cmd("reject", "驳回 PR（main）")
    p.add_argument("number", type=int)
    p.add_argument("-m", "--message", default="")

    p = cmd("comment", "评论 PR（main）")
    p.add_argument("number", type=int)
    p.add_argument("text", nargs="+")

    p = cmd("remove", "标记删除文件（dangling）")
    p.add_argument("files", nargs="+")
    p.add_argument("--force", action="store_true", required=False)

    p = cmd("restore", "把 removed 文件恢复为 dangling")
    p.add_argument("files", nargs="+")

    p = cmd("reset", "重置到 origin/main")
    p.add_argument("--hard", dest="mode", action="store_const", const="hard", default="hard")
    p.add_argument("--soft", dest="mode", action="store_const", const="soft")
    p.add_argument("--force", action="store_true")

    p = cmd("rebase", "rebase 到 origin/main")
    p.add_argument("--force", action="store_true")
    p.add_argument("--continue", dest="continue_", action="store_true")
    p.add_argument("--abort", action="store_true")

    p = cmd("check", "自检")
    p.add_argument("--fix", action="store_true", help="自动修复可修项")

    cmd("status", "查看仓库/分支状态")

    p = cmd("view", "查看 PR / 通知")
    p.add_argument("what", choices=["pr", "notification"])
    p.add_argument("number", nargs="?", type=int)
    p.add_argument("--since", default="", help="如 7d / 2026-11-01")
    p.add_argument("--last", type=int, default=20)

    p = cmd("remind", "拍一拍")
    p.add_argument("users", nargs="+")
    p.add_argument("-m", "--message", default="")

    p = cmd("transfer", "转让分支所有权")
    p.add_argument("branch")
    p.add_argument("user")
    p.add_argument("--force", action="store_true")

    p = cmd("delete", "删除分支（两阶段）")
    p.add_argument("--force", action="store_true")
    p.add_argument("--twice-check", metavar="CODE")

    p = cmd("switch", "切换到其他 dev 分支")
    p.add_argument("branch")
    p.add_argument("--force", action="store_true")

    p = cmd("move", "移动文件路径")
    p.add_argument("src")
    p.add_argument("dst")

    p = cmd("release", "发版（仅仓库所有者）")
    p.add_argument("version")
    p.add_argument("--no-latest", action="store_true")
    p.add_argument("--stop-after-draft", dest="stop_after_draft", action="store_true",
                   help="只创建 draft Release 并完成 build，不转正")

    p = cmd("merge", "把审批通过的 PR 合入 main（仅仓库所有者）")
    p.add_argument("number", type=int)
    p.add_argument("--bypass", action="store_true")

    cmd("init", "初始化 status 分支骨架（幂等）")

    p = cmd("sync", "同步远端 / 查询 no-wait 结果")
    p.add_argument("nonce", nargs="?", default="")

    p = cmd("log", "操作历史")
    p.add_argument("--limit", type=int, default=20)

    cmd("whoami", "我是谁 / 我在哪个分支")

    p = cmd("doctor", "check + 自动修复")
    p.add_argument("--fix", action="store_true", default=True)

    p = cmd("config", "读写配置（§5）")
    p.add_argument("key", nargs="?")
    p.add_argument("value", nargs="?")
    p.add_argument("--scope", default="user", choices=["user", "global"])

    return parser


def parse_args(argv=None) -> argparse.Namespace:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        raise SystemExit(0)
    if not hasattr(args, "force"):
        args.force = False
    if not hasattr(args, "twice_check"):
        args.twice_check = None
    return args


def branch_allowed(
    command: str,
    branch: str,
    dev_prefix: str = "dev/",
    default_branch: str = "main",
) -> bool:
    """§6.1 分支约束（main 名来自 config 的 default-branch）。"""
    if command in MAIN_ONLY:
        return branch == default_branch
    if command in DEV_ONLY:
        return branch.startswith(dev_prefix)
    return True


def forbidden_message(command: str, branch: str) -> Tuple[str, str]:
    """错误信息 + 提示。"""
    if command in MAIN_ONLY:
        return (
            "命令 %s 只能在 main 上执行（当前：%s）" % (command, branch),
            "切换：git switch main",
        )
    return (
        "命令 %s 只能在 dev/ 分支上执行（当前：%s）" % (command, branch),
        "先 pr.py create dev/<name> 并切换过去",
    )
