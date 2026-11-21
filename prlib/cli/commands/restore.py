# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""restore：removed → dangling（§7.10）。"""

from __future__ import annotations

from ...core import transition
from ._common import reject
from ..context import Context


def run(ctx: Context, args) -> int:
    for path in args.files:
        status, _ = ctx.record(path)
        owner = ctx.codeowner(path)
        result = transition.try_restore(status, ctx.user, owner, ctx.config)
        if not result.ok:
            return reject(ctx, result.rejection)
        data = ctx.apply("restore", {"file": path})
        ctx.output.success("restore", {"file": path, "result": data})
    return 0
