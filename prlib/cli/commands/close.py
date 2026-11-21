# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""close：关闭自己持有的文件（§7.4）。"""

from __future__ import annotations

from ...core import transition
from ._common import reject
from ..context import Context


def run(ctx: Context, args) -> int:
    clean = not ctx.git.is_dirty()
    for path in args.files:
        status, operator = ctx.record(path)
        result = transition.try_close(status, operator, ctx.user, clean, ctx.config)
        if not result.ok:
            return reject(ctx, result.rejection)
        data = ctx.apply("close", {"file": path})
        ctx.output.success("close", {"file": path, "result": data})
    return 0
