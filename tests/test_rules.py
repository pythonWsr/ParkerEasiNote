# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""权限 / 风险规则单测（§2.3 + §5.1 + §8.7）。"""

import pytest

from prlib.core import rules, states
from prlib.core.config import Config
from prlib.core.errors import RejectionCode


@pytest.mark.parametrize(
    "status,operator,owner,expected",
    [
        # §2.3 五种场景
        (states.CLOSED, "bob", "alice", rules.ForceRequirement.NONE),
        (states.COMMITTED, "bob", None, rules.ForceRequirement.LOW),
        (states.NEW, "bob", None, rules.ForceRequirement.LOW),
        (states.OPENING, "bob", None, rules.ForceRequirement.HIGH),
        (states.CLOSED, "bob", "carol", rules.ForceRequirement.HIGH),
        # 自己持有：不算风险（由 transition 拒绝）
        (states.OPENING, "alice", None, rules.ForceRequirement.NONE),
        (states.COMMITTED, "alice", None, rules.ForceRequirement.NONE),
        # 无记录 / 悬空
        (None, None, None, rules.ForceRequirement.NONE),
        (states.DANGLING, "bob", None, rules.ForceRequirement.NONE),
        # CODEOWNERS 属于自己
        (states.OPENING, "bob", "alice", rules.ForceRequirement.HIGH),
    ],
)
def test_required_force(status, operator, owner, expected):
    assert rules.required_force(status, operator, "alice", owner) is expected


def test_force_policy_none(cfg):
    assert (
        rules.force_policy(rules.ForceRequirement.NONE, cfg, force=False, twice_check_ok=False)
        == "ok"
    )


def test_force_policy_low(cfg, cfg_autoforce):
    assert (
        rules.force_policy(rules.ForceRequirement.LOW, cfg, force=False, twice_check_ok=False)
        == "force"
    )
    assert rules.force_policy(rules.ForceRequirement.LOW, cfg, force=True, twice_check_ok=False) == "ok"
    assert (
        rules.force_policy(rules.ForceRequirement.LOW, cfg_autoforce, force=False, twice_check_ok=False)
        == "ok"
    )


def test_force_policy_high(cfg, cfg_no_twice, cfg_autoforce):
    assert (
        rules.force_policy(rules.ForceRequirement.HIGH, cfg, force=False, twice_check_ok=False)
        == "force"
    )
    assert (
        rules.force_policy(rules.ForceRequirement.HIGH, cfg, force=True, twice_check_ok=False)
        == "twice-check"
    )
    assert (
        rules.force_policy(rules.ForceRequirement.HIGH, cfg, force=True, twice_check_ok=True) == "ok"
    )
    # auto-force 对高风险无效
    assert (
        rules.force_policy(rules.ForceRequirement.HIGH, cfg_autoforce, force=False, twice_check_ok=False)
        == "force"
    )
    # 关闭二次验证后，force 即可
    assert (
        rules.force_policy(rules.ForceRequirement.HIGH, cfg_no_twice, force=True, twice_check_ok=False)
        == "ok"
    )


def test_needs_twice_check(cfg, cfg_no_twice):
    assert rules.needs_twice_check(rules.ForceRequirement.HIGH, cfg)
    assert not rules.needs_twice_check(rules.ForceRequirement.LOW, cfg)
    assert not rules.needs_twice_check(rules.ForceRequirement.HIGH, cfg_no_twice)


def test_is_codeowner():
    assert rules.is_codeowner(None, "alice")
    assert rules.is_codeowner("alice", "alice")
    assert not rules.is_codeowner("bob", "alice")


def test_is_public_branch():
    assert rules.is_public_branch(states.EVERYONE)
    assert not rules.is_public_branch("alice")
    assert not rules.is_public_branch(None)


def test_branch_switch_allowed():
    ok, rejection = rules.branch_switch_allowed("alice", "alice", states.BRANCH_NORMAL, False)
    assert ok and rejection is None

    ok, rejection = rules.branch_switch_allowed(None, "alice", states.BRANCH_NORMAL, False)
    assert not ok and rejection.code is RejectionCode.NOT_YOUR_BRANCH

    ok, rejection = rules.branch_switch_allowed("bob", "alice", states.BRANCH_DANGLING, False)
    assert not ok and rejection.code is RejectionCode.NEED_FORCE

    ok, _ = rules.branch_switch_allowed("bob", "alice", states.BRANCH_DANGLING, True)
    assert ok

    ok, _ = rules.branch_switch_allowed(states.EVERYONE, "alice", states.BRANCH_PUBLIC, False)
    assert ok


@pytest.mark.parametrize(
    "name,existing,ok",
    [
        ("dev/ok", [], True),
        ("feature/x", [], False),
        ("dev/ok", ["dev/ok"], False),
        ("dev/", [], False),
    ],
)
def test_validate_branch_name(name, existing, ok):
    rejection = rules.validate_branch_name(name, existing)
    assert (rejection is None) is ok


def test_system_paths_and_match(cfg):
    assert "prlib/**" in rules.system_paths(cfg)
    assert rules.is_system_path("pr.py", cfg)
    assert rules.is_system_path("prlib/core/transition.py", cfg)
    assert rules.is_system_path("prlib", cfg)
    assert rules.is_system_path(".github/workflows/pr-ops.yml", cfg)
    assert not rules.is_system_path("README.md", cfg)


def test_system_paths_single_star():
    cfg = Config({"global": {"system-paths": "docs/*"}})
    assert rules.is_system_path("docs/a.md", cfg)
    assert not rules.is_system_path("docs/a/b.md", cfg)
    assert not rules.is_system_path("docsx/a.md", cfg)
    assert not rules.is_system_path("other", cfg)
