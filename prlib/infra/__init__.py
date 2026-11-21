# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""infra 层：git / gh / status / Actions 适配。

本层允许 IO（subprocess、网络），但所有写操作都必须带 ``dry_run``。
"""

from .actions import Actions, ActionsTimeout, TriggerResult
from .gh import Gh, GhError, owner_for_path, parse_codeowners
from .git import (
    Change,
    ChangeDecision,
    CommandResult,
    Git,
    GitError,
    classify_changes,
    parse_porcelain,
)
from .status_store import StatusError, StatusStore

__all__ = [
    "Actions",
    "ActionsTimeout",
    "TriggerResult",
    "Gh",
    "GhError",
    "owner_for_path",
    "parse_codeowners",
    "Change",
    "ChangeDecision",
    "CommandResult",
    "Git",
    "GitError",
    "classify_changes",
    "parse_porcelain",
    "StatusError",
    "StatusStore",
]
