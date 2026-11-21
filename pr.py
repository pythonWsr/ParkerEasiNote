#!/usr/bin/env python3
# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""pr.py 入口：python pr.py <command> [options]（详见 docs/PR.md）。"""

from __future__ import annotations

import sys

from prlib.cli.main import main

if __name__ == "__main__":
    sys.exit(main())
