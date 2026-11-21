# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""reset：重置到 origin/main（§7.11）。"""

from __future__ import annotations

from ...core import transition
from ._common import reject
from ..context import Context


def run(ctx: Context, args) -> int:
    unregistered = _unregistered(ctx)
    result = transition.try_reset(
        not ctx.git.is_dirty(),
        [],
        mode=args.mode,
        has_unpushed=bool(unregistered),
        force=bool(args.force),
    )
    if not result.ok:
        return reject(ctx, result.rejection)
    data = ctx.apply("reset", {"mode": args.mode, "force": bool(args.force)})
    ctx.output.success("reset", {"mode": args.mode, "result": data})
    return 0


def _unregistered(ctx: Context):
    try:
        registered = set(ctx.store.latest().get("shas") or [])
        return ctx.git.list_unregistered_shas(registered)
    except Exception:
        return []
