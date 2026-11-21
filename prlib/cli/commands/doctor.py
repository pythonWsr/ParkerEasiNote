# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""doctor：check + 自动修复（§7.27）。"""

from __future__ import annotations

from ..context import Context
from . import check


def run(ctx: Context, args) -> int:
    args.fix = True
    return check.run(ctx, args)
