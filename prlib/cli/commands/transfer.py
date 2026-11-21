# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""transfer：转让分支所有权（§7.17）。"""

from __future__ import annotations

from ...core import states, transition
from ._common import reject
from ..context import Context


def run(ctx: Context, args) -> int:
    branch_state = states.BRANCH_NORMAL
    owner = None
    try:
        entry = (ctx.store.latest().get("branches") or {}).get(args.branch)
        if isinstance(entry, dict):
            owner, branch_state = entry.get("owner"), entry.get("state", states.BRANCH_NORMAL)
        elif isinstance(entry, str):
            owner = entry
    except Exception:
        pass
    collaborators = []
    try:
        collaborators = ctx.gh.list_collaborators()
    except Exception:
        pass
    result = transition.try_transfer(
        owner,
        ctx.user,
        args.user,
        args.user in collaborators,
        ctx.config,
        branch_state=branch_state,
        force=bool(args.force),
    )
    if not result.ok:
        return reject(ctx, result.rejection)
    data = ctx.apply("transfer", {"branch": args.branch, "user": args.user})
    ctx.output.success("transfer", {"branch": args.branch, "to": args.user, "result": data})
    return 0
