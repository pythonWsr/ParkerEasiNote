# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""remind：拍一拍（§7.16）。"""

from __future__ import annotations

from ..context import Context


def run(ctx: Context, args) -> int:
    message = args.message or str(ctx.config.get("remind-default"))
    data = ctx.apply("remind", {"users": list(args.users), "message": message})
    ctx.output.success("remind", {"users": list(args.users), "result": data})
    return 0
