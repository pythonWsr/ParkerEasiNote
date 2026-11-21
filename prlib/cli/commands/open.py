# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""open：把文件置为 opening（§7.2，含重定向与 HIGH 验证码链路）。"""

from __future__ import annotations

from ...core import rules, transition
from ...core.errors import Rejection, RejectionCode
from ._common import reject, twice_reason_text, verify_twice_check, with_verification
from ..context import Context


def run(ctx: Context, args) -> int:
    config = ctx.config
    records = ctx.active()
    for raw in args.files:
        resolved = transition.follow_renames(records, raw)
        if not resolved.ok:
            return reject(ctx, resolved.rejection)
        target = resolved.path
        status, operator = ctx.record(target)
        owner = ctx.codeowner(target)
        twice_ok = False
        if args.twice_check:
            twice_ok, reason = verify_twice_check(ctx, "open", target, args.twice_check)
            if not twice_ok:
                return reject(
                    ctx,
                    Rejection(
                        RejectionCode.NEED_TWICE_CHECK,
                        twice_reason_text(reason),
                        "重新用 --force 获取新码",
                    ),
                )
        result = transition.try_open(
            status,
            operator,
            ctx.user,
            owner,
            config,
            force=bool(args.force),
            twice_check_ok=twice_ok,
        )
        if not result.ok:
            if not args.twice_check and result.required in ("force", "twice-check"):
                with_verification(ctx, "open", {"file": target}, result.requirement)
            return reject(ctx, result.rejection)

        payload = {"file": target, "force": bool(args.force)}
        if args.twice_check:
            payload["twice_check"] = True
        data = ctx.apply("open", payload)
        ctx.output.success(
            "open",
            {
                "file": target,
                "status": "opening",
                "redirect": list(resolved.chain) if len(resolved.chain) > 1 else [],
                "result": data,
            },
        )
    return 0
