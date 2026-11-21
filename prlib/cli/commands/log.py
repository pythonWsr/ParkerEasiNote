# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""log：操作历史（§7.25）。"""

from __future__ import annotations

from ..context import Context


def run(ctx: Context, args) -> int:
    issues = ctx.gh.list_issues(["pr-notify"], limit=args.limit)
    rows = [(item.get("number"), item.get("title")) for item in issues]
    ctx.output.table(["#", "记录"], rows)
    return 0
