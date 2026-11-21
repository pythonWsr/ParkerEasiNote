# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""merge：把审批通过的 PR 合入 main（仅仓库所有者，§7.22）。"""

from __future__ import annotations

from ._common import fail, require_owner
from ..context import Context


def run(ctx: Context, args) -> int:
    if not require_owner(ctx):
        return fail(ctx, "只有仓库所有者可以合并 PR", 4)
    if not ctx.dry_run:
        try:
            ctx.gh.pr_merge(args.number, method="merge", admin=bool(args.bypass))
        except Exception as exc:
            return fail(ctx, "合并失败：%s" % exc, 8, "需要 admin 权限或改用网页合并")
    data = ctx.apply("merge", {"pr": args.number, "bypass": bool(args.bypass)})
    ctx.output.success("merge", {"pr": args.number, "result": data})
    return 0
