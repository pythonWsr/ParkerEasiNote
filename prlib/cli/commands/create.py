# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""create：创建 dev 分支（main，§7.1）。"""

from __future__ import annotations

from ...core import rules
from ._common import reject
from ..context import Context


def run(ctx: Context, args) -> int:
    prefix = str(ctx.config.get("dev-prefix"))
    rejection = rules.validate_branch_name(args.branch, _existing(ctx), prefix)
    if rejection is not None:
        return reject(ctx, rejection)
    payload = {"branch": args.branch, "public": bool(args.public)}
    data = ctx.apply("create", payload)
    if not ctx.dry_run:
        created = ctx.git.create_branch(args.branch)
        if created.returncode != 0:
            switched = ctx.git.switch(args.branch)
            if switched.returncode != 0:
                ctx.output.warn("本地分支创建失败，请手动 git switch --create %s" % args.branch)
    ctx.output.success(
        "create",
        {"branch": args.branch, "public": bool(args.public), "result": data},
    )
    return 0


def _existing(ctx: Context):
    try:
        return [str(name) for name in (ctx.store.latest().get("branches") or {})]
    except Exception:
        return []
