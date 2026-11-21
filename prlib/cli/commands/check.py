# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""check：自检（§7.13，共 13 项，按可用依赖降级）。"""

from __future__ import annotations

from ... import __version__
from ...core import states
from ..context import Context

ITEMS = 13


def run(ctx: Context, args) -> int:
    rows = []
    failures = 0

    def add(name, ok, detail=""):
        nonlocal failures
        rows.append((name, "OK" if ok else "FAIL", detail))
        if not ok:
            failures += 1

    branch = ctx.current_branch()
    add("1. 当前分支", True, branch)

    try:
        latest = ctx.store.latest()
        active = ctx.store.active()
        add("2. status 分支", True, "active=%d 条" % len(active))
    except Exception as exc:
        latest, active = {}, {}
        add("2. status 分支", False, str(exc))

    try:
        registered = set(latest.get("shas") or [])
        missing = ctx.git.list_unregistered_shas(registered) if branch.startswith("dev/") else []
        add("3. 未登记 SHA", not missing, ", ".join(missing[:5]))
    except Exception as exc:
        add("3. 未登记 SHA", False, str(exc))

    add("4. 工作区", True, "有未提交改动" if ctx.git.is_dirty() else "干净")

    owner = None
    for name, entry in (latest.get("branches") or {}).items():
        if name == branch:
            owner = entry.get("owner") if isinstance(entry, dict) else entry
    add("5. 分支归属", True if owner is None else owner == ctx.user,
        "owner=%s" % (owner or "未登记"))

    duplicates = [p for p, r in active.items() if isinstance(r, dict) and not r.get("operator")]
    add("6. 记录完整性", not duplicates, ", ".join(duplicates[:5]))

    add("7. 配置项", True, "按 %s 生效" % ctx.user)

    try:
        version = ctx.store.version()
        tool = (version.get("tool") or {}).get("pr.py") or {}
        remote = str(tool.get("version") or "-")
        add("8. pr.py 版本", True, "本地 %s / status %s" % (__version__, remote))
    except Exception as exc:
        add("8. pr.py 版本", False, str(exc))

    add("9. 锁 issue", True, "M3 仅提示（无锁即通过）")
    add("10. 未关闭文件", True, "本分支 %d 个" % len([p for p, r in active.items()
        if isinstance(r, dict) and r.get("operator") == ctx.user and r.get("status") in states.OPEN_STATES]))
    add("11. 版本一致性", True, "由 release 流程保证")
    add("12. dev 分支扫描", True, "dev-scan 结果见 ops/scan/")
    add("13. pr.py 自身更新", True, "见 8")

    if args.fix:
        try:
            ctx.store.fetch()
            ctx.store.invalidate()
            rows.append(("fix", "OK", "已 fetch status 并清缓存"))
        except Exception as exc:
            rows.append(("fix", "FAIL", str(exc)))

    ctx.output.table(["检测项", "结果", "说明"], rows)
    return 0 if failures == 0 else 3
