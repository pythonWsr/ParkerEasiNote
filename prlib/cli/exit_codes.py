# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""退出码映射（§12）。

core 的 :class:`Rejection` 自带 ``exit_code``，这里只做兜底与常量导出。
"""

from __future__ import annotations

from ..core.errors import (
    EXIT_CONFLICT,
    EXIT_FAIL,
    EXIT_NETWORK,
    EXIT_NEED_FORCE,
    EXIT_NEED_TWICE,
    EXIT_OK,
    EXIT_PERMISSION,
    EXIT_PRECONDITION,
    EXIT_REMOTE,
    EXIT_USAGE,
    EXIT_CODES,
    Rejection,
    RejectionCode,
)

__all__ = [
    "EXIT_OK",
    "EXIT_FAIL",
    "EXIT_USAGE",
    "EXIT_PRECONDITION",
    "EXIT_PERMISSION",
    "EXIT_NEED_FORCE",
    "EXIT_NEED_TWICE",
    "EXIT_CONFLICT",
    "EXIT_REMOTE",
    "EXIT_NETWORK",
    "EXIT_CODES",
    "Rejection",
    "RejectionCode",
    "exit_code_for",
]


def exit_code_for(rejection: Rejection) -> int:
    """拒绝 → 退出码（供 main 统一使用）。"""
    return EXIT_CODES.get(rejection.code, EXIT_FAIL)
