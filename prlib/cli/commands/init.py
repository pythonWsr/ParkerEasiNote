# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""init：初始化 status 分支骨架（§7.23，幂等）。"""

from __future__ import annotations

from ..context import Context


def run(ctx: Context, args) -> int:
    if ctx.dry_run:
        ctx.output.plan("将检查/创建 status 分支与 active.json / latest.json / config.ini")
        return 0
    data = ctx.apply("init", {})
    ctx.output.success("init", {"result": data})
    return 0
