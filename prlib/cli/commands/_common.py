# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""命令共用小工具。"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple

from ...core import rules
from ..context import Context


def reject(ctx: Context, rejection) -> int:
    """把 Rejection 渲染为 stderr 并返回退出码。"""
    ctx.output.failure(ctx.args.command, rejection.exit_code, rejection.message, rejection.hint)
    return rejection.exit_code


def fail(ctx: Context, message: str, code: int = 3, hint: str = "") -> int:
    ctx.output.failure(ctx.args.command, code, message, hint)
    return code


def record_fields(record: Any) -> Tuple[Optional[str], Optional[str]]:
    if isinstance(record, dict):
        return record.get("status"), record.get("operator")
    if isinstance(record, str):
        return record, None
    return None, None


def owned_files(ctx: Context, statuses: Optional[Iterable[str]] = None) -> List[str]:
    allowed = set(statuses) if statuses is not None else None
    found = []
    for path, record in ctx.active().items():
        status, operator = record_fields(record)
        if operator != ctx.user:
            continue
        if allowed is not None and status not in allowed:
            continue
        found.append(path)
    return sorted(found)


TWICE_REASONS = {
    "empty-code": "缺少验证码",
    "expired": "验证码已过期",
    "no-open-issue": "没有未关闭的验证 issue",
}


def twice_reason_text(reason: str) -> str:
    return TWICE_REASONS.get(reason, "验证码错误或已过期")


def verify_twice_check(ctx: Context, op: str, file: str, code: str) -> Tuple[bool, str]:
    """把验证码交给 Actions 校验；返回 (是否通过, 失败原因)。"""
    if not code:
        return False, "empty-code"
    if ctx.dry_run:
        ctx.output.plan("将校验验证码：op=%s file=%s" % (op, file))
        return True, ""
    result = ctx.actions.trigger(
        "verify-twice-check",
        payload={"op": op, "file": file, "code": code, "initiator": ctx.user},
        actor=ctx.user,
    )
    data = result.result or {}
    if not data.get("ok"):
        error = data.get("error") or {}
        return False, str(error.get("message") or "remote-error")
    return bool(data.get("valid")), str(data.get("reason") or "")


def require_owner(ctx: Context) -> bool:
    """release / merge 仅仓库所有者可执行。"""
    if ctx.dry_run:
        return True
    try:
        return ctx.gh.is_repo_owner(ctx.user)
    except Exception:
        return False


def with_verification(ctx: Context, op: str, payload: Dict[str, Any], requirement) -> bool:
    """HIGH 风险时开验证码 issue（requirement LOW 只提示加 --force）。"""
    if requirement is not rules.ForceRequirement.HIGH:
        return False
    data = ctx.start_verification(op, payload)
    if data:
        ctx.output.warn(
            "高风险操作：验证码 %s（issue #%s，%s 前有效）；用 --force --twice-check %s 重试"
            % (
                data.get("code", "?"),
                data.get("issue", "?"),
                data.get("expires_at", "5 分钟"),
                data.get("code", "<code>"),
            )
        )
    return True
