# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""core 层：纯函数，零 IO。"""

from . import config, errors, rules, states, transition
from .config import Config, Option, OPTIONS

__all__ = ["config", "errors", "rules", "states", "transition", "Config", "Option", "OPTIONS"]
