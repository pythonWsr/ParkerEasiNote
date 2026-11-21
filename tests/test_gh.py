# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""gh 适配层测试（全部打桩，无真实网络调用）。"""

import base64
import json

import pytest

from prlib.infra.gh import Gh, GhError, owner_for_path, parse_codeowners
from tests.helpers import FakeClock, FakeRunner, now_iso


# ------------------------------------------------------------ CODEOWNERS 解析


def test_parse_codeowners_basic():
    rules = parse_codeowners(
        "# 注释\n"
        "\n"
        "* @pythonWsr\n"
        "/a.html @alice @bob\n"
        "/.github/ @carol\n"
        "no-owner-line\n"
    )
    assert [(rule.pattern, rule.owners) for rule in rules] == [
        ("*", ("pythonWsr",)),
        ("/a.html", ("alice", "bob")),
        ("/.github/", ("carol",)),
    ]


def test_owner_for_path_last_match_wins():
    rules = parse_codeowners("* @pythonWsr\n/a.html @alice\n")
    assert owner_for_path("a.html", rules) == "alice"
    assert owner_for_path("b.html", rules) == "pythonWsr"


def test_owner_for_path_pattern_kinds():
    rules = parse_codeowners(
        "* @root\n"
        "*.js @jsowner\n"
        "docs/ @docsowner\n"
        "/top.md @topowner\n"
    )
    assert owner_for_path("x/y.js", rules) == "jsowner"
    assert owner_for_path("docs/a.md", rules) == "docsowner"
    assert owner_for_path("top.md", rules) == "topowner"
    assert owner_for_path("deep/top.md", rules) == "root"


def test_owner_for_path_no_match():
    assert owner_for_path("a.js", []) is None


# ------------------------------------------------------------------ 身份


def test_current_user_cached_for_one_hour():
    clock = FakeClock()
    runner = FakeRunner({"api user --jq .login": (0, "alice\n", "")})
    gh = Gh(runner=runner, repo="o/r", clock=clock)
    assert gh.current_user() == "alice"
    assert gh.current_user() == "alice"
    assert len(runner.calls) == 1

    clock.advance(3601)
    runner.responses["api user --jq .login"] = (0, "bob\n", "")
    assert gh.current_user() == "bob"
    assert len(runner.calls) == 2


def test_invalidate_user():
    runner = FakeRunner({"api user --jq .login": (0, "alice\n", "")})
    gh = Gh(runner=runner, repo="o/r")
    gh.current_user()
    gh.invalidate_user()
    gh.current_user()
    assert len(runner.calls) == 2


def test_list_collaborators_filters_bots():
    runner = FakeRunner(
        {"api --paginate repos/o/r/collaborators --jq .[].login": (0, "alice\nbob\nbot[bot]\n", "")}
    )
    assert Gh(runner=runner, repo="o/r").list_collaborators() == ["alice", "bob"]


def test_repo_resolution():
    runner = FakeRunner({"repo view --json nameWithOwner --jq .nameWithOwner": (0, "o/r\n", "")})
    assert Gh(runner=runner).repo() == "o/r"


# ------------------------------------------------------------ CODEOWNERS 查 main


def test_codeowners_owner_reads_main():
    encoded = base64.b64encode("* @pythonWsr\n/a.html @alice\n".encode("utf-8")).decode("ascii")
    key = "api repos/o/r/contents/.github/CODEOWNERS?ref=main --jq .content"
    runner = FakeRunner({key: (0, encoded + "\n", "")})
    gh = Gh(runner=runner, repo="o/r")
    assert gh.codeowners_owner("a.html") == "alice"
    assert gh.codeowners_owner("b.html") == "pythonWsr"
    assert "ref=main" in runner.commands()[0]


# ---------------------------------------------------------------- PR / issue


def test_list_prs():
    payload = [{"number": 3, "title": "T"}]
    args = (
        "pr list --state open --limit 30 --json "
        "number,title,state,headRefName,baseRefName,author,reviewDecision,isDraft"
    )
    gh = Gh(runner=FakeRunner({args: (0, json.dumps(payload), "")}), repo="o/r")
    assert gh.list_prs() == payload


def test_open_pr_parses_number():
    args = "pr create --base pr --head dev/alice --title T --body B"
    runner = FakeRunner({args: (0, "https://github.com/o/r/pull/42\n", "")})
    assert Gh(runner=runner, repo="o/r").open_pr("pr", "dev/alice", "T", "B") == 42


def test_open_pr_dry_run():
    runner = FakeRunner()
    gh = Gh(runner=runner, repo="o/r")
    assert gh.open_pr("pr", "dev/alice", "T", dry_run=True) == 0
    assert runner.calls == []
    assert gh.last_plan and "--base" in gh.last_plan


def test_create_issue_dry_run_and_real():
    runner = FakeRunner()
    gh = Gh(runner=runner, repo="o/r")
    assert gh.create_issue("t", "b", ["pr-notify"], dry_run=True) == 0
    assert runner.calls == []

    args = "issue create --title t --body b --label pr-notify"
    runner = FakeRunner({args: (0, "https://github.com/o/r/issues/9\n", "")})
    assert Gh(runner=runner, repo="o/r").create_issue("t", "b", ["pr-notify"]) == 9


def test_pr_review_comment_merge_dry_run():
    runner = FakeRunner()
    gh = Gh(runner=runner, repo="o/r")
    gh.pr_review(1, approve=True, body="ok", dry_run=True)
    gh.pr_comment(1, "hi", dry_run=True)
    gh.pr_merge(1, admin=True, dry_run=True)
    assert runner.calls == []


def test_list_issues_since_days():
    payload = [
        {"number": 1, "title": "new", "createdAt": now_iso(-1)},
        {"number": 2, "title": "old", "createdAt": now_iso(-10)},
    ]
    args = (
        "issue list --state all --limit 20 --json "
        "number,title,body,createdAt,state,labels"
    )
    gh = Gh(runner=FakeRunner({args: (0, json.dumps(payload), "")}), repo="o/r")
    fresh = gh.list_issues(since_days=7)
    assert [item["number"] for item in fresh] == [1]


def test_edit_issue_body_dry_run():
    runner = FakeRunner()
    Gh(runner=runner, repo="o/r").edit_issue_body(5, "x", dry_run=True)
    assert runner.calls == []


# ---------------------------------------------------------------- Actions


def test_run_workflow_inputs():
    runner = FakeRunner()
    Gh(runner=runner, repo="o/r").run_workflow("pr-ops.yml", {"op": "open", "actor": "alice"})
    assert runner.commands() == ["workflow run pr-ops.yml -f op=open -f actor=alice"]


def test_run_workflow_dry_run():
    runner = FakeRunner()
    Gh(runner=runner, repo="o/r").run_workflow("pr-ops.yml", {"op": "open"}, dry_run=True)
    assert runner.calls == []


def test_run_view():
    args = "run view 7 --json status,conclusion"
    gh = Gh(runner=FakeRunner({args: (0, '{"status":"completed","conclusion":"success"}', "")}), repo="o/r")
    assert gh.run_view(7)["status"] == "completed"


def test_list_runs():
    args = "run list --workflow pr-ops.yml --limit 1 --json databaseId,status,conclusion,createdAt"
    gh = Gh(runner=FakeRunner({args: (0, '[{"databaseId":7,"status":"queued"}]', "")}), repo="o/r")
    assert gh.list_runs("pr-ops.yml", limit=1)[0]["databaseId"] == 7


def test_gh_error():
    gh = Gh(runner=FakeRunner({"api user --jq .login": (1, "", "bad credentials")}), repo="o/r")
    with pytest.raises(GhError) as excinfo:
        gh.current_user()
    assert "bad credentials" in str(excinfo.value)


def test_is_repo_owner_by_owner_name():
    runner = FakeRunner({"api repos/o/r --jq .owner.login": (0, "pythonWsr\n", "")})
    assert Gh(runner=runner, repo="o/r").is_repo_owner("pythonWsr")
    assert not Gh(runner=runner, repo="o/r").is_repo_owner("alice")


def test_is_repo_owner_by_collaborator_role_admin():
    runner = FakeRunner(
        {
            "api repos/o/r --jq .owner.login": (0, "pythonWsr\n", ""),
            "api repos/o/r/collaborators/alice/permission --jq .role_name": (0, "admin\n", ""),
        }
    )
    assert Gh(runner=runner, repo="o/r").is_repo_owner("alice")


def test_is_repo_owner_write_role_is_not_owner():
    runner = FakeRunner(
        {
            "api repos/o/r --jq .owner.login": (0, "pythonWsr\n", ""),
            "api repos/o/r/collaborators/bob/permission --jq .role_name": (0, "write\n", ""),
        }
    )
    assert not Gh(runner=runner, repo="o/r").is_repo_owner("bob")


def test_is_repo_owner_non_collaborator_returns_false():
    runner = FakeRunner(
        {
            "api repos/o/r --jq .owner.login": (0, "pythonWsr\n", ""),
            "api repos/o/r/collaborators/carol/permission --jq .role_name": (1, "", "Not Found"),
        }
    )
    assert not Gh(runner=runner, repo="o/r").is_repo_owner("carol")
