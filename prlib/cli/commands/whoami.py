# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""whoami：我是谁 / 我在哪个分支（§7.26）。"""

from __future__ import annotations

from ..context import Context


def run(ctx: Context, args) -> int:
    branch = ctx.current_branch()
    data = {
        "user": ctx.user,
        "branch": branch,
        "owned_files": len([1 for _, record in ctx.active().items()
                           if isinstance(record, dict) and record.get("operator") == ctx.user]),
    }
    if ctx.output.json_mode:
        ctx.output.success("whoami", data)
    else:
        ctx.output.line("用户 %s / 分支 %s / 持有文件 %d 个" % (data["user"], data["branch"], data["owned_files"]))
    return 0
