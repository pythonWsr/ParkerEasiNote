# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""rebase：rebase 到 origin/main（§7.12）。"""

from __future__ import annotations

from ._common import fail, reject
from ..context import Context


def run(ctx: Context, args) -> int:
    if args.abort or args.continue_:
        if ctx.dry_run:
            ctx.output.plan("将执行 git rebase --%s" % ("abort" if args.abort else "continue"))
            return 0
        flag = "--abort" if args.abort else "--continue"
        result = ctx.git._run(["rebase", flag], mutating=True, check=False)
        if result.returncode != 0:
            return fail(ctx, "git rebase %s 失败：%s" % (flag, (result.stderr or result.stdout).strip()), 3)
        ctx.output.success("rebase", {"action": flag})
        return 0

    outcome = ctx.git.rebase_onto("origin/main", dry_run=ctx.dry_run)
    if not outcome.ok:
        if outcome.conflict:
            return fail(ctx, "rebase 冲突，现场已保留", 3, "处理：pr.py rebase --continue 或 pr.py rebase --abort")
        return fail(ctx, outcome.message or "rebase 失败", 3)
    data = ctx.apply("rebase", {"force": bool(args.force)})
    ctx.output.success("rebase", {"result": data})
    return 0
