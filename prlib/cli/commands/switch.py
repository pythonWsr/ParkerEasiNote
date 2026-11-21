# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""switch：切换到其他 dev 分支（§7.19）。"""

from __future__ import annotations

from ...core import states, transition
from ._common import fail, reject
from ..context import Context


def run(ctx: Context, args) -> int:
    owner = None
    branch_state = states.BRANCH_NORMAL
    try:
        entry = (ctx.store.latest().get("branches") or {}).get(args.branch)
        if isinstance(entry, dict):
            owner, branch_state = entry.get("owner"), entry.get("state", states.BRANCH_NORMAL)
        elif isinstance(entry, str):
            owner = entry
    except Exception:
        pass
    result = transition.try_switch(
        owner, ctx.user, ctx.config, branch_state=branch_state, force=bool(args.force)
    )
    if not result.ok:
        return reject(ctx, result.rejection)
    if not ctx.dry_run:
        check = ctx.git._run(["switch", args.branch], mutating=True, check=False)
        if check.returncode != 0:
            return fail(ctx, "git switch %s 失败：%s" % (args.branch, check.stderr.strip()), 1)
    data = ctx.apply("switch", {"branch": args.branch})
    ctx.output.success("switch", {"branch": args.branch, "result": data})
    return 0
