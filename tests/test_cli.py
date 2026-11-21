# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""CLI 参数与分支约束测试。"""

import pytest

from prlib.cli import args as cli_args
from prlib.cli.exit_codes import exit_code_for
from prlib.core.errors import Rejection, RejectionCode


def test_branch_rules_main_commands():
    assert cli_args.branch_allowed("create", "main")
    assert cli_args.branch_allowed("merge", "main")
    assert not cli_args.branch_allowed("create", "dev/x")
    assert not cli_args.branch_allowed("open", "main")


def test_branch_rules_dev_commands():
    assert cli_args.branch_allowed("open", "dev/alice")
    assert cli_args.branch_allowed("commit", "dev/bob")
    assert not cli_args.branch_allowed("commit", "main")


def test_branch_rules_any():
    for command in ("check", "status", "view", "config", "init", "sync", "log", "whoami", "doctor"):
        assert cli_args.branch_allowed(command, "main")
        assert cli_args.branch_allowed(command, "dev/alice")


def test_forbidden_message():
    message, hint = cli_args.forbidden_message("open", "main")
    assert "dev/" in message and "create" in hint
    message, hint = cli_args.forbidden_message("create", "dev/x")
    assert "main" in message and "switch" in hint


def test_parse_args_global_flags():
    parsed = cli_args.parse_args(["open", "a.js", "--dry-run", "--json", "--force"])
    assert parsed.command == "open" and parsed.dry_run and parsed.json and parsed.force


def test_parse_args_requires_command():
    with pytest.raises(SystemExit):
        cli_args.parse_args([])


def test_exit_code_for():
    rejection = Rejection(RejectionCode.NEED_FORCE, "x")
    assert exit_code_for(rejection) == 5


def test_branch_allowed_uses_configured_default_branch():
    assert cli_args.branch_allowed("create", "trunk", "dev/", "trunk")
    assert not cli_args.branch_allowed("create", "main", "dev/", "trunk")
