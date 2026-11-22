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
    branch = ctx.current_branch()
    sha = ""
    if not ctx.dry_run:
        added = ctx.git.add(files)
        if added.returncode != 0:
            return fail(ctx, "git add 失败：%s" % added.stderr.strip(), 1)
        committed = ctx.git.commit(files, args.message or "pr.py commit")
        if committed.returncode != 0:
            return fail(
                ctx,
                "git commit 失败：%s" % (committed.stderr or committed.stdout).strip(),
                1,
            )
        sha = ctx.git.head_sha()
        pushed = ctx.git.push(branch)
        if pushed.returncode != 0:
            return fail(
                ctx,
                "git push 失败：%s" % pushed.stderr.strip(),
                1,
                "本地已提交但未推送；修好后 pr.py sync",
            )
    data = ctx.apply(
        "commit",
        {"files": files, "message": args.message, "sha": sha, "branch": branch},
    )
    ctx.output.success("commit", {"files": files, "sha": sha, "branch": branch, "result": data})
    return 0
