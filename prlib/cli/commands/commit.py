# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""commit：提交已打开的文件（§7.3）。"""

from __future__ import annotations

from ...core import transition
from ...infra.git import classify_changes
from ._common import fail, record_fields, reject
from ..context import Context


def run(ctx: Context, args) -> int:
    porcelain = ctx.git.porcelain()
    if not porcelain.strip():
        return fail(ctx, "没有需要提交的改动", 3)
    active = ctx.active()
    decisions = classify_changes(porcelain, active)
    blocked = [item for item in decisions if not item.allowed]
    if blocked:
        detail = ", ".join("%s（%s）" % (item.path, item.reason) for item in blocked)
        return fail(ctx, "以下改动不能提交：%s" % detail, 3, "删除/重命名请走 pr.py remove / pr.py move")
    files = [item.path for item in decisions]
    records = {path: record_fields(active.get(path)) for path in files}
    result = transition.try_commit(records, ctx.user, ctx.config)
    if not result.ok:
        return reject(ctx, result.rejection)
    data = ctx.apply("commit", {"files": files, "message": args.message})
    ctx.output.success("commit", {"files": files, "result": data})
    return 0
