# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""config：读写配置（§5）。"""

from __future__ import annotations

from ._common import fail
from ..context import Context


def run(ctx: Context, args) -> int:
    if not args.key:
        options = []
        for name in sorted(ctx.config.sections.get("global", {})):
            options.append((name, ctx.config.get(name) if name in _known() else "-", "global"))
        for name in sorted(ctx.config.sections.get(ctx.user, {})):
            options.append((name, ctx.config.get(name) if name in _known() else "-", "user"))
        ctx.output.table(["配置项", "值", "来源"], options)
        return 0

    if args.value is None:
        value = ctx.config.get(args.key) if args.key in _known() else None
        ctx.output.success("config", {args.key: value, "source": ctx.config.source(args.key) if args.key in _known() else "unknown"})
        return 0

    if not ctx.config.can_set(args.key, args.scope):
        return fail(ctx, "配置项 %s 不允许写入作用域 %s" % (args.key, args.scope), 2)
    data = ctx.apply("config", {"key": args.key, "value": args.value, "scope": args.scope})
    ctx.output.success("config", {"key": args.key, "value": args.value, "result": data})
    return 0


def _known():
    from ...core.config import OPTIONS_BY_KEY

    return OPTIONS_BY_KEY
