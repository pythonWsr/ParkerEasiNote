# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""move：移动文件路径（§7.20）。"""

from __future__ import annotations

import os

from ...core import transition
from ._common import reject
from ..context import Context


def run(ctx: Context, args) -> int:
    status, operator = ctx.record(args.src)
    dst_exists = os.path.exists(args.dst) or args.dst in ctx.active()
    owner = ctx.codeowner(args.src)
    result = transition.try_move(
        status,
        operator,
        ctx.user,
        dst_exists,
        owner,
        ctx.config,
        dst=args.dst,
    )
    if not result.ok:
        return reject(ctx, result.rejection)
    data = ctx.apply("move", {"src": args.src, "dst": args.dst})
    ctx.output.success("move", {"src": args.src, "dst": args.dst, "result": data})
    return 0
