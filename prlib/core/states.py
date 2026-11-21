# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""pr.py 状态常量。

所有状态名只在这里定义一次：代码中禁止裸字符串比较，
展示层通过 :func:`display_status` 拼接人类可读文本。
"""

from __future__ import annotations

from typing import Optional

# ---- 文件级状态（§2.2） -------------------------------------------------
OPENING = "opening"
COMMITTED = "committed"  # 双 t（拼写修正）
NEW = "new"
WAITING = "waiting"
CLOSED = "closed"
REQUEST_CHANGES = "request changes"  # 含空格，保持不变
PUSHED = "pushed"
DANGLING = "dangling"
REMOVED = "removed"
RENAMED = "renamed"
SYSTEM = "system"

OPEN_STATES = frozenset({OPENING, COMMITTED, NEW})
CLOSED_STATES = frozenset({CLOSED, REQUEST_CHANGES, PUSHED})
DANGLING_STATES = frozenset({DANGLING, REMOVED, RENAMED})
ALL_STATES = OPEN_STATES | CLOSED_STATES | DANGLING_STATES | frozenset({WAITING, SYSTEM})

# ---- 分支级状态（§2.2 末尾） --------------------------------------------
BRANCH_NORMAL = "normal"
BRANCH_PUBLIC = "public"
BRANCH_DANGLING = "dangling"  # 与文件级同名，但语义是"分支已标记删除"
BRANCH_REMOVED = "removed"
BRANCH_STATES = frozenset({BRANCH_NORMAL, BRANCH_PUBLIC, BRANCH_DANGLING, BRANCH_REMOVED})

# ---- 所有者哨兵 ----------------------------------------------------------
EVERYONE = "@everyone"
DANGLING_OWNER = "dangling"  # 仅用于分支级 owner 字段


def is_open(status: Optional[str]) -> bool:
    """是否属于"未关闭"（持有中）状态。"""
    return status in OPEN_STATES


def is_closed(status: Optional[str]) -> bool:
    """是否属于"已关闭"状态。"""
    return status in CLOSED_STATES


def is_dangling(status: Optional[str]) -> bool:
    """是否属于悬空类状态。"""
    return status in DANGLING_STATES


def holds(status: Optional[str], operator: Optional[str], actor: Optional[str]) -> bool:
    """actor 是否正持有该文件（未关闭且 operator 是自己）。"""
    return bool(actor) and operator == actor and status in OPEN_STATES


def display_status(status: str, to: Optional[str] = None) -> str:
    """把内部状态渲染为人类可读文本（展示层专用）。"""
    if status == RENAMED:
        return "renamed to %s" % (to or "?")
    return status


def is_valid_status(status: Optional[str]) -> bool:
    """状态是否为合法文件级状态。"""
    return status in ALL_STATES


def is_public_owner(owner: Optional[str]) -> bool:
    """分支 owner 是否为"公有"哨兵。"""
    return owner == EVERYONE
