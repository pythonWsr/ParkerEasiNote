# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""pr：把改动提成 PR（§7.5）。"""

from __future__ import annotations

from ...core import rules, transition
from ...core.errors import Rejection, RejectionCode
from ._common import fail, record_fields, reject, twice_reason_text, verify_twice_check, with_verification
from ..context import Context

SKIP = "skip"


def run(ctx: Context, args) -> int:
    if args.cancel:
        data = ctx.apply("pr", {"cancel": True})
        ctx.output.success("pr", {"cancelled": True, "result": data})
        return 0

    active = ctx.active()
    mine = {
        path: record_fields(record)
        for path, record in active.items()
        if record_fields(record)[1] == ctx.user
    }
    # 只收本分支真正改过的文件，避免把"自己持有但本分支没动"的文件也带进 PR
    changed = set(ctx.git.changed_files("origin/main"))
    mine = {path: value for path, value in mine.items() if path in changed}
    if not mine:
        return fail(ctx, "本分支相对 origin/main 没有文件改动", 3)
    twice_ok = False
    if args.twice_check:
        twice_ok, reason = verify_twice_check(ctx, "pr", ",".join(sorted(mine)) or "-", args.twice_check)
        if not twice_ok:
            return reject(
                ctx,
                Rejection(
                    RejectionCode.NEED_TWICE_CHECK,
                    twice_reason_text(reason),
                    "重新用 --force 获取新码",
                ),
            )
    plan = transition.try_pr(
        mine,
        ctx.user,
        ctx.config,
        force=bool(args.force),
        twice_check_ok=twice_ok,
        workspace_clean=not ctx.git.is_dirty(),
    )
    if not plan.ok:
        if not args.twice_check and plan.required in ("force", "twice-check"):
            with_verification(ctx, "pr", {"files": sorted(mine)}, plan.requirement)
        return reject(ctx, plan.rejection)
    included = [item.path for item in plan.plans if item.action != SKIP]
    number = 0
    if not ctx.dry_run:
        base = str(ctx.config.get("pr-branch"))
        head = ctx.current_branch()
        number = ctx.gh.open_pr(base, head, "PR: %s" % head, body="\n".join(included))
    payload = {"files": included, "force": bool(args.force), "pr": number}
    if args.twice_check:
        payload["twice_check"] = True
    data = ctx.apply("pr", payload)
    ctx.output.success("pr", {"files": included, "result": data})
    return 0
