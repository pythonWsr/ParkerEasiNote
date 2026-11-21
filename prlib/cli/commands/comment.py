# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""comment：评论 PR（main，§7.8）。"""

from __future__ import annotations

from ..context import Context


def run(ctx: Context, args) -> int:
    text = " ".join(args.text)
    if not ctx.dry_run:
        ctx.gh.pr_comment(args.number, text)
    ctx.output.success("comment", {"pr": args.number})
    return 0
