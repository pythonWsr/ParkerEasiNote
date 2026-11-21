# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""拒绝原因与异常。

每个拒绝原因都映射到 §12 的退出码，CLI 只需要读 ``Rejection.exit_code``。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, Optional

# ---- §12 退出码 ----------------------------------------------------------
EXIT_OK = 0
EXIT_FAIL = 1
EXIT_USAGE = 2
EXIT_PRECONDITION = 3
EXIT_PERMISSION = 4
EXIT_NEED_FORCE = 5
EXIT_NEED_TWICE = 6
EXIT_CONFLICT = 7
EXIT_REMOTE = 8
EXIT_NETWORK = 9


class RejectionCode(Enum):
    """拒绝原因。值用于 --json 输出与日志，不作为人类文本。"""

    NOT_YOUR_BRANCH = "not-your-branch"
    NOT_COLLABORATOR = "not-collaborator"
    HELD_BY_SELF = "held-by-self"
    HELD_BY_OTHER = "held-by-other"
    WAITING_CANNOT_OPEN = "waiting-cannot-open"
    SYSTEM_CANNOT_OPEN = "system-cannot-open"
    REMOVED_ONLY_RESTORE = "removed-only-restore"
    NOT_OPENED_BY_SELF = "not-opened-by-self"
    WORKSPACE_DIRTY = "workspace-dirty"
    UNREVIEWED_PR = "unreviewed-pr"
    OPEN_FILES_REMAIN = "open-files-remain"
    DST_EXISTS = "dst-exists"
    NOTHING_TO_COMMIT = "nothing-to-commit"
    NEED_FORCE = "need-force"
    NEED_TWICE_CHECK = "need-twice-check"
    CODEOWNERS_MISMATCH = "codeowners-mismatch"
    INVALID_STATE = "invalid-state"
    FORCE_NOT_ALLOWED = "force-not-allowed"


EXIT_CODES: Dict[RejectionCode, int] = {
    RejectionCode.NOT_YOUR_BRANCH: EXIT_PERMISSION,
    RejectionCode.NOT_COLLABORATOR: EXIT_PERMISSION,
    RejectionCode.HELD_BY_SELF: EXIT_CONFLICT,
    RejectionCode.HELD_BY_OTHER: EXIT_CONFLICT,
    RejectionCode.WAITING_CANNOT_OPEN: EXIT_CONFLICT,
    RejectionCode.SYSTEM_CANNOT_OPEN: EXIT_CONFLICT,
    RejectionCode.REMOVED_ONLY_RESTORE: EXIT_CONFLICT,
    RejectionCode.NOT_OPENED_BY_SELF: EXIT_CONFLICT,
    RejectionCode.WORKSPACE_DIRTY: EXIT_PRECONDITION,
    RejectionCode.UNREVIEWED_PR: EXIT_PRECONDITION,
    RejectionCode.OPEN_FILES_REMAIN: EXIT_PRECONDITION,
    RejectionCode.DST_EXISTS: EXIT_CONFLICT,
    RejectionCode.NOTHING_TO_COMMIT: EXIT_PRECONDITION,
    RejectionCode.NEED_FORCE: EXIT_NEED_FORCE,
    RejectionCode.NEED_TWICE_CHECK: EXIT_NEED_TWICE,
    RejectionCode.CODEOWNERS_MISMATCH: EXIT_PERMISSION,
    RejectionCode.INVALID_STATE: EXIT_CONFLICT,
    RejectionCode.FORCE_NOT_ALLOWED: EXIT_USAGE,
}


@dataclass(frozen=True)
class Rejection(Exception):
    """一次被拒绝的操作。既是异常，也是可返回的数据（不可变）。"""

    code: RejectionCode
    message: str
    hint: str = ""

    @property
    def exit_code(self) -> int:
        return EXIT_CODES[self.code]

    def __str__(self) -> str:
        return self.message

    def __repr__(self) -> str:
        return "Rejection(%s, %r)" % (self.code.name, self.message)
