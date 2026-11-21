# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""sync：同步远端 / 查询 no-wait 结果（§7.24）。"""

from __future__ import annotations

from ._common import fail
from ..context import Context


def run(ctx: Context, args) -> int:
    try:
        ctx.git.fetch("origin", "status")
        ctx.store.invalidate()
    except Exception as exc:
        return fail(ctx, "fetch status 失败：%s" % exc, 9)
    if args.nonce:
        try:
            data = ctx.actions.read_result(args.nonce)
        except Exception as exc:
            return fail(ctx, "读取 %s 的结果失败：%s" % (args.nonce, exc), 8)
        ctx.output.success("sync", {"nonce": args.nonce, "result": data})
        return 0
    ctx.output.success("sync", {"fetched": True})
    return 0
