# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""权限 / 风险判定规则（纯函数）。

风险分级见 §2.3：
· NONE —— 无需强制
· LOW  —— 一次 ``--force``（``auto-force`` 可自动补）
· HIGH —— ``--force`` + 二次验证码（``auto-force`` 不管用）
"""

from __future__ import annotations

from enum import Enum
from typing import List, Optional, Sequence

from . import states
from .config import Config
from .errors import Rejection, RejectionCode

# 强制等级
NONE = "none"
LOW = "low"
HIGH = "high"


class ForceRequirement(Enum):
    """一次操作需要的强制等级。"""

    NONE = NONE
    LOW = LOW
    HIGH = HIGH


def required_force(
    status: Optional[str],
    operator: Optional[str],
    actor: str,
    codeowners_owner: Optional[str],
) -> ForceRequirement:
    """按 §2.3 计算所需的强制等级。

    :param codeowners_owner: main 的 CODEOWNERS 中该文件的所有者；
        ``None`` 表示 CODEOWNERS 中无记录（不构成限制）。
    """
    if codeowners_owner is not None and codeowners_owner != actor:
        return ForceRequirement.HIGH
    if status in states.OPEN_STATES and operator != actor:
        if status == states.OPENING:
            return ForceRequirement.HIGH
        return ForceRequirement.LOW
    return ForceRequirement.NONE


def is_codeowner(owner: Optional[str], actor: str) -> bool:
    """actor 是否是该文件在 main CODEOWNERS 中的所有者。"""
    if owner is None:
        return True
    return owner == actor


def force_policy(
    requirement: ForceRequirement,
    config: Config,
    *,
    force: bool,
    twice_check_ok: bool,
) -> str:
    """判定当前 flag 是否满足强制要求。

    返回 ``"ok"`` / ``"force"`` / ``"twice-check"``。
    """
    if requirement is ForceRequirement.NONE:
        return "ok"
    if requirement is ForceRequirement.LOW:
        if force or bool(config.get("auto-force")):
            return "ok"
        return "force"
    # HIGH：auto-force 不生效；二次验证受 confirm-twice-check 控制
    if not force:
        return "force"
    if bool(config.get("confirm-twice-check")) and not twice_check_ok:
        return "twice-check"
    return "ok"


def needs_twice_check(requirement: ForceRequirement, config: Config) -> bool:
    """该等级是否需要二次验证。"""
    return requirement is ForceRequirement.HIGH and bool(config.get("confirm-twice-check"))


def is_public_branch(owner: Optional[str]) -> bool:
    """分支是否公有（分支级 owner 为 @everyone）。"""
    return states.is_public_owner(owner)


def branch_switch_allowed(owner: Optional[str], actor: str, branch_state: str, force: bool):
    """``switch`` 的目标分支是否可切（§7.19）。

    返回 ``(allowed, rejection)``：悬空分支需 ``--force``，其余按 owner 判定。
    """
    if branch_state in (states.BRANCH_DANGLING, states.BRANCH_REMOVED):
        if not force:
            return False, Rejection(
                RejectionCode.NEED_FORCE,
                "目标分支处于悬空状态，切换需 --force",
                "切换后 owner 与 CODEOWNERS 都会恢复为你",
            )
        return True, None
    if owner == actor or is_public_branch(owner):
        return True, None
    return False, Rejection(
        RejectionCode.NOT_YOUR_BRANCH,
        "该分支属于 %s，不能切换" % (owner or "?"),
        "分支所有者可先 transfer 给你，或用 pr.py switch 目标之外的命令",
    )


def validate_branch_name(
    name: str,
    existing: Sequence[str],
    prefix: str = "dev/",
) -> Optional[Rejection]:
    """校验 ``create`` 的分支名（§7.1）。"""
    if not name.startswith(prefix):
        return Rejection(
            RejectionCode.INVALID_STATE,
            "分支名必须以 %s 开头" % prefix,
            "例：python pr.py create %s<name>" % prefix,
        )
    if name in existing:
        return Rejection(RejectionCode.INVALID_STATE, "分支 %s 已存在" % name)
    if name == prefix:
        return Rejection(RejectionCode.INVALID_STATE, "分支名不完整")
    return None


def system_paths(config: Config) -> List[str]:
    """``system-paths`` 的匹配模式列表。"""
    text = str(config.get("system-paths") or "")
    return [item.strip() for item in text.split(",") if item.strip()]


def is_system_path(path: str, config: Config) -> bool:
    """路径是否属于 system（不参与 PR）。"""
    for pattern in system_paths(config):
        if pattern.endswith("/**"):
            if path == pattern[:-3] or path.startswith(pattern[:-2]):
                return True
        elif pattern.endswith("/*"):
            head = pattern[:-2]
            rest = path[len(head):] if path.startswith(head) else None
            if rest is not None and rest.startswith("/") and "/" not in rest[1:]:
                return True
        elif path == pattern:
            return True
    return False
