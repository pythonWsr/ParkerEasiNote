# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""git 适配层测试。"""

import pytest

from prlib.core import states
from prlib.infra.git import (
    CommandResult,
    Git,
    GitError,
    classify_changes,
    parse_porcelain,
)
from tests.helpers import FakeRunner


# ------------------------------------------------------------ porcelain 解析


def test_parse_porcelain_kinds():
    output = "R  old.js -> new.js\n D gone.js\n M a.js\nA  b.js\n?? c.js\nUU d.js\n"
    changes = {change.path: change for change in parse_porcelain(output)}
    assert changes["new.js"].kind == "R"
    assert changes["new.js"].old_path == "old.js"
    assert changes["gone.js"].kind == "D"
    assert changes["a.js"].kind == "M"
    assert changes["b.js"].kind == "A"
    assert changes["c.js"].kind == "untracked"
    assert changes["d.js"].kind == "conflict"


def test_parse_porcelain_ignores_short_lines():
    assert parse_porcelain("x\n\n M ok.js\n") == [
        parse_porcelain(" M ok.js\n")[0]
    ]


def test_parse_porcelain_quoted_filename_with_space():
    change = parse_porcelain('?? "my file.js"\n')[0]
    assert change.path == "my file.js"


def test_parse_porcelain_unquotes_utf8():
    raw = 'R  "a\\346\\226\\207b" -> c\n'
    change = parse_porcelain(raw)[0]
    assert change.old_path == "a文b"
    assert change.path == "c"


# ------------------------------------------------------------ 白名单判定


def test_classify_rename_allowed():
    decision = classify_changes("R  a.js -> b.js\n", {})[0]
    assert decision.allowed and "重命名" in decision.reason


def test_classify_delete_with_renamed_status_allowed():
    decision = classify_changes(" D a.js\n", {"a.js": {"status": states.RENAMED}})[0]
    assert decision.allowed


def test_classify_delete_with_removed_status_allowed():
    decision = classify_changes(" D a.js\n", {"a.js": {"status": states.REMOVED}})[0]
    assert decision.allowed


def test_classify_delete_other_status_rejected():
    decision = classify_changes(" D a.js\n", {"a.js": {"status": states.CLOSED}})[0]
    assert not decision.allowed and "remove" in decision.reason
    decision = classify_changes(" D a.js\n", {})[0]
    assert not decision.allowed


def test_classify_conflict_rejected():
    decision = classify_changes("UU a.js\n", {})[0]
    assert not decision.allowed


def test_classify_plain_change_allowed():
    for porcelain in (" M a.js\n", "A  a.js\n", "?? a.js\n"):
        assert classify_changes(porcelain, {})[0].allowed


# ------------------------------------------------------------ Git 读操作


def test_current_branch_and_head():
    runner = FakeRunner(
        {
            "rev-parse --abbrev-ref HEAD": (0, "dev/alice\n", ""),
            "rev-parse HEAD": (0, "abc123\n", ""),
        }
    )
    git = Git(runner=runner)
    assert git.current_branch() == "dev/alice"
    assert git.head_sha() == "abc123"


def test_is_dirty():
    assert Git(runner=FakeRunner({"status --porcelain=v1": (0, " M a.js\n", "")})).is_dirty()
    assert not Git(runner=FakeRunner({"status --porcelain=v1": (0, "", "")})).is_dirty()


def test_is_ancestor():
    git = Git(runner=FakeRunner({"merge-base --is-ancestor origin/main HEAD": (0, "", "")}))
    assert git.is_ancestor("origin/main", "HEAD")
    git = Git(runner=FakeRunner({"merge-base --is-ancestor origin/main HEAD": (1, "", "")}))
    assert not git.is_ancestor("origin/main", "HEAD")


def test_is_ancestor_error():
    git = Git(runner=FakeRunner({"merge-base --is-ancestor a b": (2, "", "bad")}))
    with pytest.raises(GitError):
        git.is_ancestor("a", "b")


def test_file_history_chain_b_standard():
    """判定标准 b：main 上该文件的提交必须都已在分支里（分支多出的提交不算违约）。"""
    key = "log --format=%H -n 50 dev/alice..origin/main -- a.js"
    assert Git(runner=FakeRunner({key: (0, "", "")})).file_history_chain(
        "a.js", "dev/alice", "origin/main"
    )
    assert not Git(runner=FakeRunner({key: (0, "s9\n", "")})).file_history_chain(
        "a.js", "dev/alice", "origin/main"
    )


def test_show_file_and_missing():
    git = Git(runner=FakeRunner({"show origin/status:active.json": (0, "{}", "")}))
    assert git.show_file("origin/status", "active.json") == "{}"
    git = Git(runner=FakeRunner({"show origin/status:nope.json": (128, "", "missing")}))
    assert git.show_file("origin/status", "nope.json") is None


def test_list_unregistered_shas():
    runner = FakeRunner({"rev-list origin/main..HEAD": (0, "aaa\nbbb\nccc\n", "")})
    assert Git(runner=runner).list_unregistered_shas({"aaa", "ccc"}) == ["bbb"]


def test_fetch():
    runner = FakeRunner({"fetch origin status": (0, "", "")})
    result = Git(runner=runner).fetch("origin", "status")
    assert result.returncode == 0


# ------------------------------------------------------------ Git 写操作


def test_rebase_onto_ok():
    outcome = Git(runner=FakeRunner({"rebase origin/main": (0, "", "")})).rebase_onto()
    assert outcome.ok and not outcome.conflict and not outcome.dry_run


def test_rebase_onto_conflict(tmp_path):
    (tmp_path / ".git" / "rebase-merge").mkdir(parents=True)
    outcome = Git(
        runner=FakeRunner({"rebase origin/main": (1, "", "CONFLICT (content)")}),
        cwd=str(tmp_path),
    ).rebase_onto()
    assert not outcome.ok and outcome.conflict
    assert outcome.error == "CONFLICT (content)"


def test_rebase_onto_non_conflict_failure(tmp_path):
    (tmp_path / ".git").mkdir()
    outcome = Git(
        runner=FakeRunner({"rebase origin/main": (1, "", "error: cannot rebase: dirty")}),
        cwd=str(tmp_path),
    ).rebase_onto()
    assert not outcome.ok and not outcome.conflict
    assert "非冲突" in outcome.message
    assert outcome.error == "error: cannot rebase: dirty"


def test_rebase_onto_dry_run_does_not_call_runner():
    runner = FakeRunner()
    outcome = Git(runner=runner).rebase_onto(dry_run=True)
    assert outcome.dry_run and outcome.ok
    assert runner.calls == []


def test_reset_hard_counts_and_dry_run():
    runner = FakeRunner(
        {
            "rev-list --count origin/main..HEAD": (0, "3\n", ""),
            "reset --hard origin/main": (0, "", ""),
        }
    )
    git = Git(runner=runner)
    plan = git.reset_hard(dry_run=True)
    assert plan.dry_run and plan.discarded == 3 and not plan.done
    assert "reset --hard origin/main" not in runner.commands()

    done = git.reset_hard()
    assert done.done and not done.dry_run and done.discarded == 3
    assert "reset --hard origin/main" in runner.commands()


def test_push_force_with_lease():
    runner = FakeRunner({"push --force-with-lease origin dev/alice": (0, "", "")})
    outcome = Git(runner=runner).push_force_with_lease("dev/alice")
    assert outcome.ok and not outcome.dry_run

    runner = FakeRunner()
    plan = Git(runner=runner).push_force_with_lease("dev/alice", dry_run=True)
    assert plan.dry_run and runner.calls == []


def test_push_failure_reports_message():
    runner = FakeRunner({"push --force-with-lease origin dev/alice": (1, "", "rejected")})
    outcome = Git(runner=runner).push_force_with_lease("dev/alice")
    assert not outcome.ok and "rejected" in outcome.message


def test_cherry_pick_dry_run_and_real():
    runner = FakeRunner({"cherry-pick abc": (0, "", "")})
    git = Git(runner=runner)
    git.cherry_pick("abc", dry_run=True)
    assert runner.calls == []
    git.cherry_pick("abc")
    assert runner.commands() == ["cherry-pick abc"]


def test_commit_dry_run():
    runner = FakeRunner({"commit -m msg -- a.js": (0, "", "")})
    git = Git(runner=runner)
    git.commit(["a.js"], "msg", dry_run=True)
    assert runner.calls == []
    git.commit(["a.js"], "msg")
    assert runner.commands() == ["commit -m msg -- a.js"]


def test_read_failure_raises_git_error():
    git = Git(runner=FakeRunner({"rev-parse HEAD": (128, "", "fatal")}))
    with pytest.raises(GitError):
        git.head_sha()


# ------------------------------------------------- 真实 git 集成（临时裸仓库）


def test_real_git_roundtrip(bare_repo):
    git = Git(cwd=str(bare_repo["work"]))
    assert len(git.head_sha()) == 40
    assert git.current_branch() in ("main", "master")
    assert not git.is_dirty()

    (bare_repo["work"] / "README.md").write_text("changed\n", encoding="utf-8")
    assert git.is_dirty()
    assert "README.md" in git.porcelain()

    plan = git.reset_hard("HEAD", dry_run=True)
    assert plan.dry_run and plan.discarded == 0
    assert git.is_dirty(), "dry-run 不允许改动工作区"
