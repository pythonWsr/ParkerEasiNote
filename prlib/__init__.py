# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""pr.py —— 仓库内 PR 流程管理工具。

分层：
· :mod:`prlib.core`  —— 纯函数状态机与规则（零 IO）
· :mod:`prlib.infra` —— git / gh / status / Actions 适配层
· :mod:`prlib.cli`   —— 参数、输出、退出码
"""

__version__ = "1.0.0"
TOOL_NAME = "pr.py"
