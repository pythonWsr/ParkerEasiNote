# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""remove：标记删除文件（§7.9）。"""

from __future__ import annotations

from ...core import transition
from ._common import reject
from ..context import Context


def run(ctx: Context, args) -> int:
    for path in args.files:
        status, operator = ctx.record(path)
        owner = ctx.codeowner(path)
        result = transition.try_remove(
            status, operator, ctx.user, owner, ctx.config, force=bool(args.force)
        )
        if not result.ok:
            return reject(ctx, result.rejection)
        data = ctx.apply("remove", {"file": path})
        ctx.output.success("remove", {"file": path, "result": data})
    return 0
