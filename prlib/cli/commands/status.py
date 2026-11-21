# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""status：查看仓库/分支状态。"""

from __future__ import annotations

from ... import __version__
from ..context import Context


def run(ctx: Context, args) -> int:
    branch = ctx.current_branch()
    owner = None
    try:
        for name, entry in (ctx.store.latest().get("branches") or {}).items():
            if name == branch:
                owner = entry.get("owner") if isinstance(entry, dict) else entry
    except Exception:
        owner = None
    data = {
        "pr.py": __version__,
        "user": ctx.user,
        "branch": branch,
        "branch_owner": owner,
        "dirty": ctx.git.is_dirty(),
    }
    if ctx.output.json_mode:
        ctx.output.success("status", data)
    else:
        for key, value in data.items():
            ctx.output.line("%-12s %s" % (key, value))
    return 0
