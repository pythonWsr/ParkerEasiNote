# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""状态机表驱动单测（§7 各命令 + §10 附录速查表）。"""

import pytest

from prlib.core import rules, states
from prlib.core.errors import RejectionCode
from prlib.core.transition import (
    CLOSE_THEN_INCLUDE,
    DELETE,
    INCLUDE,
    SKIP,
    try_close,
    try_commit,
    try_delete,
    try_move,
    try_open,
    try_pr,
    try_rebase,
    try_remove,
    try_reset,
    try_restore,
    try_switch,
    try_transfer,
)

# ---------------------------------------------------------------- open 全表

CLOSED_LIKE = [states.CLOSED, states.REQUEST_CHANGES, states.PUSHED]


@pytest.mark.parametrize("status", CLOSED_LIKE + [states.DANGLING])
def test_open_closed_like_allowed(cfg, status):
    result = try_open(status, "bob", "alice", None, cfg)
    assert result.ok
    assert result.new_status == states.OPENING


@pytest.mark.parametrize("status", [states.CLOSED, states.DANGLING])
def test_open_without_record_allowed(cfg, status):
    result = try_open(None, None, "alice", None, cfg)
    assert result.ok and result.new_status == states.OPENING


@pytest.mark.parametrize("status", [states.OPENING, states.COMMITTED, states.NEW])
def test_open_held_by_self_rejected(cfg, status):
    for held in (states.OPENING, states.COMMITTED, states.NEW):
        result = try_open(held, "alice", "alice", None, cfg)
        assert not result.ok
        assert result.rejection.code is RejectionCode.HELD_BY_SELF


@pytest.mark.parametrize("status", [states.WAITING, states.SYSTEM, states.REMOVED])
def test_open_forbidden_states(cfg, status):
    expected = {
        states.WAITING: RejectionCode.WAITING_CANNOT_OPEN,
        states.SYSTEM: RejectionCode.SYSTEM_CANNOT_OPEN,
        states.REMOVED: RejectionCode.REMOVED_ONLY_RESTORE,
    }[status]
    result = try_open(status, "bob", "alice", None, cfg)
    assert not result.ok
    assert result.rejection.code is expected


def test_open_renamed_redirects(cfg):
    result = try_open(states.RENAMED, "bob", "alice", None, cfg, renamed_to="new.js")
    assert result.ok and result.redirect == "new.js"


def test_open_renamed_without_target_rejected(cfg):
    result = try_open(states.RENAMED, "bob", "alice", None, cfg)
    assert not result.ok
    assert result.rejection.code is RejectionCode.INVALID_STATE


# 他人持有 —— 风险分级
def test_open_other_opening_needs_force(cfg):
    result = try_open(states.OPENING, "bob", "alice", None, cfg)
    assert not result.ok and result.required == "force"
    assert result.rejection.code is RejectionCode.NEED_FORCE


def test_open_other_opening_force_needs_twice(cfg):
    result = try_open(states.OPENING, "bob", "alice", None, cfg, force=True)
    assert not result.ok and result.required == "twice-check"
    assert result.rejection.code is RejectionCode.NEED_TWICE_CHECK


def test_open_other_opening_full_verification(cfg):
    result = try_open(states.OPENING, "bob", "alice", None, cfg, force=True, twice_check_ok=True)
    assert result.ok and result.new_status == states.OPENING


@pytest.mark.parametrize("status", [states.COMMITTED, states.NEW])
def test_open_other_low_risk(cfg, status):
    assert try_open(status, "bob", "alice", None, cfg).required == "force"
    assert try_open(status, "bob", "alice", None, cfg, force=True).ok


def test_open_auto_force_only_low(cfg_autoforce):
    assert try_open(states.COMMITTED, "bob", "alice", None, cfg_autoforce).ok
    assert try_open(states.OPENING, "bob", "alice", None, cfg_autoforce).required == "force"


def test_open_high_risk_without_twice_gate(cfg_no_twice):
    result = try_open(states.OPENING, "bob", "alice", None, cfg_no_twice, force=True)
    assert result.ok


def test_open_codeowners_not_mine(cfg):
    result = try_open(states.CLOSED, "bob", "alice", "carol", cfg)
    assert not result.ok and result.required == "force"
    result = try_open(states.CLOSED, "bob", "alice", "carol", cfg, force=True, twice_check_ok=True)
    assert result.ok


def test_open_codeowners_mine(cfg):
    assert try_open(states.CLOSED, "bob", "alice", "alice", cfg).ok


# ------------------------------------------------------------------- close


def test_close_own_opening(cfg):
    assert try_close(states.OPENING, "alice", "alice", True, cfg).new_status == states.CLOSED


@pytest.mark.parametrize("status", CLOSED_LIKE + [states.WAITING, states.SYSTEM])
def test_close_not_open_rejected(cfg, status):
    result = try_close(status, "alice", "alice", True, cfg)
    assert not result.ok and result.rejection.code is RejectionCode.NOT_OPENED_BY_SELF


def test_close_other_rejected(cfg):
    result = try_close(states.OPENING, "bob", "alice", True, cfg)
    assert not result.ok and result.rejection.code is RejectionCode.HELD_BY_OTHER


def test_close_dirty_workspace_rejected(cfg):
    result = try_close(states.OPENING, "alice", "alice", False, cfg)
    assert not result.ok and result.rejection.code is RejectionCode.WORKSPACE_DIRTY


# ------------------------------------------------------------------ commit


def test_commit_ok(cfg):
    files = {"a.js": {"status": states.OPENING, "operator": "alice"}}
    result = try_commit(files, "alice", cfg)
    assert result.ok and result.new_status == states.COMMITTED


def test_commit_empty_rejected(cfg):
    assert try_commit({}, "alice", cfg).rejection.code is RejectionCode.NOTHING_TO_COMMIT


def test_commit_tuple_and_string_records(cfg):
    assert try_commit({"a": (states.OPENING, "alice")}, "alice", cfg).ok
    result = try_commit({"a": states.OPENING}, "alice", cfg)
    assert not result.ok and result.rejection.code is RejectionCode.HELD_BY_OTHER


def test_commit_other_holder_rejected(cfg):
    result = try_commit({"a": (states.OPENING, "bob")}, "alice", cfg)
    assert not result.ok and result.rejection.code is RejectionCode.HELD_BY_OTHER


def test_commit_non_opening_rejected(cfg):
    result = try_commit({"a": (states.COMMITTED, "alice")}, "alice", cfg)
    assert not result.ok and result.rejection.code is RejectionCode.NOT_OPENED_BY_SELF


def test_commit_system_rejected(cfg):
    result = try_commit({"pr.py": (states.SYSTEM, "alice")}, "alice", cfg)
    assert not result.ok and result.rejection.code is RejectionCode.SYSTEM_CANNOT_OPEN


# ---------------------------------------------------------------------- pr


def _plan_map(result):
    return {plan.path: plan for plan in result.plans}


def test_pr_empty_rejected(cfg):
    result = try_pr({}, "alice", cfg)
    assert not result.ok and result.rejection.code is RejectionCode.NOTHING_TO_COMMIT


@pytest.mark.parametrize("status", [states.SYSTEM, states.WAITING, states.RENAMED, None])
def test_pr_skipped_states(cfg, status):
    result = try_pr({"a": {"status": status, "operator": "alice"}}, "alice", cfg)
    assert result.ok and _plan_map(result)["a"].action == SKIP


def test_pr_dangling_advances_to_removed(cfg):
    result = try_pr({"a": {"status": states.DANGLING, "operator": "alice"}}, "alice", cfg)
    assert _plan_map(result)["a"].next_status == states.REMOVED


def test_pr_removed_owner_deletes(cfg):
    result = try_pr({"a": {"status": states.REMOVED, "operator": "alice"}}, "alice", cfg)
    assert _plan_map(result)["a"].action == DELETE


def test_pr_removed_other_skips(cfg):
    result = try_pr({"a": {"status": states.REMOVED, "operator": "bob"}}, "alice", cfg)
    assert _plan_map(result)["a"].action == SKIP


@pytest.mark.parametrize("status", CLOSED_LIKE)
def test_pr_closed_like_included(cfg, status):
    result = try_pr({"a": {"status": status, "operator": "bob"}}, "alice", cfg)
    assert _plan_map(result)["a"].action == INCLUDE
    assert _plan_map(result)["a"].next_status == states.WAITING


@pytest.mark.parametrize("status", [states.OPENING, states.COMMITTED, states.NEW])
def test_pr_self_held_closes_then_includes(cfg, status):
    result = try_pr({"a": {"status": status, "operator": "alice"}}, "alice", cfg)
    assert _plan_map(result)["a"].action == CLOSE_THEN_INCLUDE


def test_pr_self_held_dirty_rejected(cfg):
    result = try_pr(
        {"a": {"status": states.OPENING, "operator": "alice"}},
        "alice",
        cfg,
        workspace_clean=False,
    )
    assert not result.ok and result.rejection.code is RejectionCode.WORKSPACE_DIRTY


def test_pr_other_opening_needs_force_then_twice(cfg):
    files = {"a": {"status": states.OPENING, "operator": "bob"}}
    assert try_pr(files, "alice", cfg).required == "force"
    assert try_pr(files, "alice", cfg, force=True).required == "twice-check"
    assert try_pr(files, "alice", cfg, force=True, twice_check_ok=True).ok


def test_pr_other_committed_needs_force(cfg):
    files = {"a": {"status": states.COMMITTED, "operator": "bob"}}
    assert try_pr(files, "alice", cfg).required == "force"
    assert try_pr(files, "alice", cfg, force=True).ok


def test_pr_mixed_files(cfg):
    files = {
        "a.js": {"status": states.CLOSED, "operator": "bob"},
        "b.js": {"status": states.OPENING, "operator": "alice"},
        "c.js": {"status": states.SYSTEM, "operator": "alice"},
    }
    result = try_pr(files, "alice", cfg)
    assert result.ok
    assert [p.path for p in result.plans] == ["a.js", "b.js", "c.js"]


# ------------------------------------------------------------------ remove


@pytest.mark.parametrize("status", [states.OPENING, states.COMMITTED, states.NEW])
def test_remove_open_rejected(cfg, status):
    kinds = {states.OPENING: states.OPENING, states.COMMITTED: states.COMMITTED, states.NEW: states.NEW}
    result = try_remove(status, "alice", "alice", None, cfg)
    assert not result.ok
    assert result.rejection.code is RejectionCode.HELD_BY_SELF
    assert kinds[status] == status


def test_remove_other_open_rejected(cfg):
    result = try_remove(states.OPENING, "bob", "alice", None, cfg)
    assert not result.ok and result.rejection.code is RejectionCode.HELD_BY_OTHER


@pytest.mark.parametrize("status", [states.WAITING, states.SYSTEM, states.RENAMED])
def test_remove_invalid_states(cfg, status):
    result = try_remove(status, "alice", "alice", None, cfg)
    assert not result.ok and result.rejection.code is RejectionCode.INVALID_STATE


def test_remove_codeowners_mismatch(cfg):
    result = try_remove(states.CLOSED, "bob", "alice", "carol", cfg, force=True)
    assert not result.ok and result.rejection.code is RejectionCode.CODEOWNERS_MISMATCH


def test_remove_needs_force(cfg):
    result = try_remove(states.CLOSED, "bob", "alice", None, cfg)
    assert not result.ok and result.required == "force"


@pytest.mark.parametrize("status", [states.CLOSED, states.REQUEST_CHANGES, states.PUSHED, states.DANGLING])
def test_remove_closed_like_yields_dangling(cfg, status):
    result = try_remove(status, "bob", "alice", None, cfg, force=True)
    assert result.ok and result.new_status == states.DANGLING


def test_remove_removed_only_updates_operator(cfg):
    result = try_remove(states.REMOVED, "bob", "alice", None, cfg, force=True)
    assert result.ok and result.new_status == states.REMOVED


# ----------------------------------------------------------------- restore


def test_restore_removed(cfg):
    assert try_restore(states.REMOVED, "alice", None, cfg).new_status == states.DANGLING


@pytest.mark.parametrize("status", [states.CLOSED, states.DANGLING, None])
def test_restore_invalid(cfg, status):
    result = try_restore(status, "alice", None, cfg)
    assert not result.ok and result.rejection.code is RejectionCode.INVALID_STATE


def test_restore_codeowners_mismatch(cfg):
    result = try_restore(states.REMOVED, "alice", "bob", cfg)
    assert not result.ok and result.rejection.code is RejectionCode.CODEOWNERS_MISMATCH


# -------------------------------------------------------------------- move


def test_move_target_exists_rejected(cfg):
    result = try_move(states.OPENING, "alice", "alice", True, None, cfg, dst="b.js")
    assert not result.ok and result.rejection.code is RejectionCode.DST_EXISTS


def test_move_target_exists_even_with_force(cfg):
    result = try_move(
        states.OPENING, "alice", "alice", True, None, cfg, dst="b.js", force=True, twice_check_ok=True
    )
    assert not result.ok and result.rejection.code is RejectionCode.DST_EXISTS


def test_move_requires_ownership(cfg):
    assert (
        try_move(states.CLOSED, "alice", "alice", False, None, cfg, dst="b.js").rejection.code
        is RejectionCode.NOT_OPENED_BY_SELF
    )
    assert (
        try_move(states.OPENING, "bob", "alice", False, None, cfg, dst="b.js").rejection.code
        is RejectionCode.HELD_BY_OTHER
    )


def test_move_ok(cfg):
    result = try_move(states.OPENING, "alice", "alice", False, None, cfg, dst="b.js")
    assert result.ok and result.new_status == states.RENAMED and result.to == "b.js"


def test_move_codeowners_requires_verification(cfg):
    assert (
        try_move(states.OPENING, "alice", "alice", False, "bob", cfg, dst="b.js").required
        == "force"
    )
    assert (
        try_move(
            states.OPENING, "alice", "alice", False, "bob", cfg, dst="b.js", force=True
        ).required
        == "twice-check"
    )
    assert try_move(
        states.OPENING,
        "alice",
        "alice",
        False,
        "bob",
        cfg,
        dst="b.js",
        force=True,
        twice_check_ok=True,
    ).ok


# ---------------------------------------------------------------- transfer


def test_transfer_ok(cfg):
    result = try_transfer("alice", "alice", "bob", True, cfg, force=True)
    assert result.ok and result.to == "bob"


def test_transfer_not_owner(cfg):
    result = try_transfer("bob", "alice", "carol", True, cfg, force=True)
    assert not result.ok and result.rejection.code is RejectionCode.NOT_YOUR_BRANCH


def test_transfer_dangling_branch(cfg):
    result = try_transfer(
        "alice", "alice", "bob", True, cfg, branch_state=states.BRANCH_DANGLING, force=True
    )
    assert not result.ok and result.rejection.code is RejectionCode.INVALID_STATE


def test_transfer_target_not_collaborator(cfg):
    result = try_transfer("alice", "alice", "bob", False, cfg, force=True)
    assert not result.ok and result.rejection.code is RejectionCode.NOT_COLLABORATOR


def test_transfer_needs_force(cfg):
    result = try_transfer("alice", "alice", "bob", True, cfg)
    assert not result.ok and result.required == "force"


# ------------------------------------------------------------------ delete


def test_delete_ok(cfg):
    result = try_delete("alice", "alice", config=cfg, force=True, twice_check_ok=True)
    assert result.ok and result.new_status == states.BRANCH_DANGLING


def test_delete_needs_force_then_twice(cfg):
    assert try_delete("alice", "alice", config=cfg).required == "force"
    assert (
        try_delete("alice", "alice", config=cfg, force=True).required == "twice-check"
    )


def test_delete_not_owner(cfg):
    result = try_delete("bob", "alice", config=cfg, force=True, twice_check_ok=True)
    assert not result.ok and result.rejection.code is RejectionCode.NOT_YOUR_BRANCH


def test_delete_open_files_rejected(cfg):
    result = try_delete(
        "alice", "alice", open_files=["a.js"], config=cfg, force=True, twice_check_ok=True
    )
    assert not result.ok and result.rejection.code is RejectionCode.OPEN_FILES_REMAIN


def test_delete_waiting_rejected(cfg):
    result = try_delete(
        "alice", "alice", waiting=["a.js"], config=cfg, force=True, twice_check_ok=True
    )
    assert not result.ok


def test_delete_already_dangling(cfg):
    result = try_delete(
        "alice", "alice", config=cfg, branch_state=states.BRANCH_DANGLING, force=True, twice_check_ok=True
    )
    assert not result.ok and result.rejection.code is RejectionCode.INVALID_STATE


# ------------------------------------------------------------------ switch


def test_switch_own_branch(cfg):
    assert try_switch("alice", "alice", cfg).ok


def test_switch_public_branch(cfg):
    assert try_switch(states.EVERYONE, "alice", cfg).ok


def test_switch_other_private_rejected(cfg):
    result = try_switch("bob", "alice", cfg)
    assert not result.ok and result.rejection.code is RejectionCode.NOT_YOUR_BRANCH


def test_switch_dangling_needs_force(cfg):
    result = try_switch("bob", "alice", cfg, branch_state=states.BRANCH_DANGLING)
    assert not result.ok and result.required == "force"


def test_switch_dangling_with_force(cfg):
    result = try_switch("bob", "alice", cfg, branch_state=states.BRANCH_DANGLING, force=True)
    assert result.ok and result.to == "alice"


# ------------------------------------------------------------------- reset


def test_reset_clean(cfg):
    assert try_reset(True, []).ok


def test_reset_dirty(cfg):
    assert try_reset(False, []).rejection.code is RejectionCode.WORKSPACE_DIRTY


def test_reset_unreviewed_pr(cfg):
    assert try_reset(True, [{"number": 1}]).rejection.code is RejectionCode.UNREVIEWED_PR


def test_reset_hard_unpushed_needs_force(cfg):
    assert try_reset(True, [], mode="hard", has_unpushed=True).required == "force"
    assert try_reset(True, [], mode="hard", has_unpushed=True, force=True).ok


def test_reset_soft_unpushed_ok(cfg):
    assert try_reset(True, [], mode="soft", has_unpushed=True).ok


# ------------------------------------------------------------------ rebase


def test_rebase_ok(cfg):
    assert try_rebase(True, True, True, [], [], cfg).ok


def test_rebase_not_dev_branch(cfg):
    result = try_rebase(True, False, True, [], [], cfg)
    assert not result.ok and result.rejection.code is RejectionCode.NOT_YOUR_BRANCH


def test_rebase_not_owner(cfg):
    result = try_rebase(True, True, False, [], [], cfg)
    assert not result.ok and result.rejection.code is RejectionCode.NOT_YOUR_BRANCH


def test_rebase_dirty(cfg):
    assert try_rebase(False, True, True, [], [], cfg).rejection.code is RejectionCode.WORKSPACE_DIRTY


def test_rebase_unreviewed_pr(cfg):
    assert (
        try_rebase(True, True, True, [{"number": 1}], [], cfg).rejection.code
        is RejectionCode.UNREVIEWED_PR
    )


def test_rebase_open_files(cfg):
    result = try_rebase(True, True, True, [], ["a.js"], cfg)
    assert not result.ok and result.rejection.code is RejectionCode.OPEN_FILES_REMAIN


def test_rebase_force_skips_preconditions(cfg):
    assert try_rebase(False, True, True, [{"number": 1}], ["a.js"], cfg, force=True).ok


# --------------------------------------------------------------- 退出码映射


def test_transition_result_exit_code(cfg):
    ok = try_open(states.CLOSED, "bob", "alice", None, cfg)
    assert ok.exit_code == 0
    assert ok.rejection is None

    need_force = try_open(states.OPENING, "bob", "alice", None, cfg)
    assert need_force.exit_code == 5

    need_twice = try_open(states.OPENING, "bob", "alice", None, cfg, force=True)
    assert need_twice.exit_code == 6

    conflict = try_open(states.SYSTEM, "bob", "alice", None, cfg)
    assert conflict.exit_code == 7


def test_commit_empty_tuple_record(cfg):
    result = try_commit({"a": ()}, "alice", cfg)
    assert not result.ok and result.rejection.code is RejectionCode.HELD_BY_OTHER


def test_unpack_list_record(cfg):
    result = try_commit({"a": [states.OPENING, "alice"]}, "alice", cfg)
    assert result.ok


def test_unpack_single_item_record(cfg):
    result = try_commit({"a": [states.OPENING]}, "alice", cfg)
    assert not result.ok and result.rejection.code is RejectionCode.HELD_BY_OTHER


def test_unpack_none_record(cfg):
    assert try_pr({"a": None}, "alice", cfg).ok
    result = try_commit({"a": None}, "alice", cfg)
    assert not result.ok and result.rejection.code is RejectionCode.HELD_BY_OTHER


def test_open_committed_other_low_risk_no_codeowners(cfg):
    """committed（他人）→ LOW；并锁定 try_open 不接收分支参数的架构约束。

    公有分支的互斥由分层保证（core 根本不知道分支），不靠这条用例；
    这里保留 inspect 检查，防止将来给 try_open 加分支参数绕过分层。
    """
    import inspect

    params = inspect.signature(try_open).parameters
    assert "branch_owner" not in params
    assert "is_public" not in params
    result = try_open(states.COMMITTED, "bob", "alice", None, cfg)
    assert not result.ok and result.required == "force"
    assert try_open(states.COMMITTED, "bob", "alice", None, cfg, force=True).ok


# ------------------------------------------- requirement 契约（M1 核心接口）


def test_need_force_low_carries_requirement(cfg):
    """低风险 need(force) 必须带 LOW，infra 据此不开验证码 issue。"""
    r = try_open(states.COMMITTED, "bob", "alice", None, cfg)
    assert r.required == "force"
    assert r.requirement is rules.ForceRequirement.LOW
    assert r.code is RejectionCode.NEED_FORCE
    assert r.message
    assert r.hint == ""


def test_need_force_high_carries_requirement(cfg):
    """高风险 need(force) 必须带 HIGH，infra 据此开 issue。"""
    r = try_open(states.OPENING, "bob", "alice", None, cfg)
    assert r.required == "force"
    assert r.requirement is rules.ForceRequirement.HIGH
    assert "twice-check" in r.hint


def test_need_twice_check_carries_requirement(cfg):
    r = try_open(states.OPENING, "bob", "alice", None, cfg, force=True)
    assert r.required == "twice-check"
    assert r.requirement is rules.ForceRequirement.HIGH
    assert r.code is RejectionCode.NEED_TWICE_CHECK


def test_command_mandated_force_requirement(cfg):
    """命令自带的强制参数也要带等级，infra 不再二次计算。"""
    assert try_remove(states.CLOSED, "bob", "alice", None, cfg).requirement is rules.ForceRequirement.LOW
    assert try_transfer("alice", "alice", "bob", True, cfg).requirement is rules.ForceRequirement.LOW
    assert try_delete("alice", "alice", config=cfg).requirement is rules.ForceRequirement.HIGH
    assert (
        try_delete("alice", "alice", config=cfg, force=True).requirement
        is rules.ForceRequirement.HIGH
    )
    assert (
        try_reset(True, [], mode="hard", has_unpushed=True).requirement
        is rules.ForceRequirement.LOW
    )
    assert (
        try_switch("bob", "alice", cfg, branch_state=states.BRANCH_DANGLING).requirement
        is rules.ForceRequirement.LOW
    )


def test_pr_plan_carries_requirement(cfg):
    committed = {"a": {"status": states.COMMITTED, "operator": "bob"}}
    r = try_pr(committed, "alice", cfg)
    assert r.required == "force" and r.requirement is rules.ForceRequirement.LOW

    opening = {"a": {"status": states.OPENING, "operator": "bob"}}
    assert try_pr(opening, "alice", cfg).requirement is rules.ForceRequirement.HIGH
    r = try_pr(opening, "alice", cfg, force=True)
    assert r.required == "twice-check" and r.requirement is rules.ForceRequirement.HIGH


def test_result_accessors_without_rejection(cfg):
    ok = try_open(states.CLOSED, "bob", "alice", None, cfg)
    assert ok.code is None
    assert ok.message == ""
    assert ok.hint == ""


# ------------------------------------------------------------- 重定向递归


def test_follow_renames_plain_path(cfg):
    from prlib.core.transition import follow_renames

    result = follow_renames({"a": {"status": states.CLOSED}}, "a")
    assert result.ok and result.path == "a" and result.chain == ("a",)


def test_follow_renames_single_hop():
    from prlib.core.transition import follow_renames

    records = {"old": {"status": states.RENAMED, "to": "new"}}
    result = follow_renames(records, "old")
    assert result.ok and result.path == "new" and result.chain == ("old", "new")


def test_follow_renames_three_hops_allowed():
    from prlib.core.transition import follow_renames

    records = {
        "a": {"status": states.RENAMED, "to": "b"},
        "b": {"status": states.RENAMED, "to": "c"},
        "c": {"status": states.RENAMED, "to": "d"},
    }
    result = follow_renames(records, "a")
    assert result.ok and result.path == "d"


def test_follow_renames_too_deep():
    from prlib.core.transition import follow_renames

    records = {
        "a": {"status": states.RENAMED, "to": "b"},
        "b": {"status": states.RENAMED, "to": "c"},
        "c": {"status": states.RENAMED, "to": "d"},
        "d": {"status": states.RENAMED, "to": "e"},
    }
    result = follow_renames(records, "a")
    assert not result.ok and result.rejection.code is RejectionCode.INVALID_STATE


def test_follow_renames_cycle():
    from prlib.core.transition import follow_renames

    records = {
        "a": {"status": states.RENAMED, "to": "b"},
        "b": {"status": states.RENAMED, "to": "a"},
    }
    result = follow_renames(records, "a")
    assert not result.ok and "循环" in result.rejection.message


def test_follow_renames_missing_target():
    from prlib.core.transition import follow_renames

    result = follow_renames({"a": {"status": states.RENAMED}}, "a")
    assert not result.ok and "目标路径" in result.rejection.message
