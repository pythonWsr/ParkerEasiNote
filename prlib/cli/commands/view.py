# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""view：查看 PR / 通知（§7.15）。"""

from __future__ import annotations

from ..context import Context


def run(ctx: Context, args) -> int:
    if args.what == "pr":
        rows = [(item.get("number"), item.get("state"), item.get("title")) for item in ctx.gh.list_prs()]
        ctx.output.table(["#", "状态", "标题"], rows)
        return 0
    issues = ctx.gh.list_issues(["pr-notify"], limit=args.last, since_days=_days(args.since))
    rows = [(item.get("number"), item.get("title")) for item in issues]
    ctx.output.table(["#", "通知"], rows)
    return 0


def _days(since: str) -> int:
    if not since:
        return 0
    if since.endswith("d") and since[:-1].isdigit():
        return int(since[:-1])
    return 0
