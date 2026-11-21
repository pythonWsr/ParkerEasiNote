# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""delete：删除分支（§7.18，两阶段）。"""

from __future__ import annotations

from ...core import states, transition
from ...core.errors import Rejection, RejectionCode
from ._common import reject, twice_reason_text, verify_twice_check, with_verification
from ..context import Context


def run(ctx: Context, args) -> int:
    branch = ctx.current_branch()
    active = ctx.active()
    open_files = [p for p, r in active.items() if isinstance(r, dict)
                  and r.get("operator") == ctx.user and r.get("status") in states.OPEN_STATES]
    waiting = [p for p, r in active.items() if isinstance(r, dict)
               and r.get("operator") == ctx.user and r.get("status") == states.WAITING]
    twice_ok = False
    if args.twice_check:
        twice_ok, reason = verify_twice_check(ctx, "delete", branch, args.twice_check)
        if not twice_ok:
            return reject(
                ctx,
                Rejection(
                    RejectionCode.NEED_TWICE_CHECK,
                    twice_reason_text(reason),
                    "重新用 --force 获取新码",
                ),
            )
    result = transition.try_delete(
        ctx.user,
        ctx.user,
        open_files=open_files,
        waiting=waiting,
        config=ctx.config,
        force=bool(args.force),
        twice_check_ok=twice_ok,
        branch_state=states.BRANCH_NORMAL,
    )
    if not result.ok:
        if not args.twice_check and result.required in ("force", "twice-check"):
            with_verification(ctx, "delete", {"branch": branch}, result.requirement)
        return reject(ctx, result.rejection)
    data = ctx.apply("delete", {"branch": branch, "twice_check": True})
    ctx.output.success("delete", {"branch": branch, "result": data})
    return 0
