# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""list：列出文件状态（main）。"""

from __future__ import annotations

from ...core import states
from ..context import Context


def run(ctx: Context, args) -> int:
    rows = []
    for path, record in sorted(ctx.active().items()):
        if isinstance(record, dict):
            status = record.get("status")
            operator = record.get("operator") or "-"
        else:
            status, operator = record, "-"
        rows.append((path, states.display_status(status or "-"), operator))
    ctx.output.table(["文件", "状态", "持有者"], rows)
    return 0
