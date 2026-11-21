# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""release：发版（main，仅仓库所有者，§7.21）。"""

from __future__ import annotations

from ._common import fail, require_owner
from ..context import Context


def run(ctx: Context, args) -> int:
    if not require_owner(ctx):
        return fail(ctx, "只有仓库所有者可以 release", 4)
    payload = {"version": args.version, "latest": not args.no_latest}
    data = ctx.apply("release", payload)
    ctx.output.success("release", {"version": args.version, "result": data})
    return 0
