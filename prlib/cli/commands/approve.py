# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""approve：审批 PR（main，§7.7）。"""

from __future__ import annotations

from ..context import Context


def run(ctx: Context, args) -> int:
    if not ctx.dry_run:
        ctx.gh.pr_review(args.number, approve=True, body=args.message)
    data = ctx.apply("approve", {"pr": args.number, "message": args.message})
    ctx.output.success("approve", {"pr": args.number, "result": data})
    return 0
