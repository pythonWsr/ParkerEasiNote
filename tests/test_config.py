# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""配置解析单测（§5.2 / §5.3）。"""

import pytest

from prlib.core.config import Config, parse_ini


def test_defaults():
    cfg = Config({}, user="alice")
    assert cfg.get("pr-branch") == "pr"
    assert cfg.get("default-branch") == "main"
    assert cfg.get("dev-prefix") == "dev/"
    assert cfg.get("twice-check-num") == 8
    assert cfg.get("twice-check-issue-close") == 330
    assert cfg.get("lock-issue-timeout") == 900
    assert cfg.get("confirm-twice-check") is True
    assert cfg.get("auto-push") is True
    assert cfg.get("auto-close") is False
    assert cfg.get("system-paths") == "pr.py,prlib/**,.github/**"
    assert cfg.get("scan-concurrency") == 1


def test_user_overrides_global():
    cfg = Config({"global": {"auto-close": "false"}, "alice": {"auto-close": "true"}}, user="alice")
    assert cfg.get("auto-close") is True
    assert cfg.source("auto-close") == "user"


def test_global_used_when_user_missing():
    cfg = Config({"global": {"auto-close": "true"}}, user="alice")
    assert cfg.get("auto-close") is True
    assert cfg.source("auto-close") == "global"


def test_global_force_wins_over_user():
    cfg = Config(
        {"global": {"auto-close": "true", "auto-close.force": "true"}, "alice": {"auto-close": "false"}},
        user="alice",
    )
    assert cfg.get("auto-close") is True
    assert cfg.is_forced("auto-close")
    assert cfg.source("auto-close") == "forced"


def test_force_with_invalid_value_is_ignored():
    cfg = Config({"global": {"auto-close.force": "maybe"}})
    assert not cfg.is_forced("auto-close")


def test_user_only_option_ignores_global():
    cfg = Config({"global": {"ban": "true"}}, user="alice")
    assert cfg.get("ban") is False


def test_user_only_option_reads_user():
    cfg = Config({"alice": {"ban": "true", "warn": "注意"}}, user="alice")
    assert cfg.get("ban") is True
    assert cfg.get("warn") == "注意"


def test_default_source():
    cfg = Config({})
    assert cfg.source("auto-close") == "default"
    assert cfg.raw("auto-close") is None


def test_parse_ini():
    text = """
    # 注释
    [global]
    auto-close = true
    Pr-Branch = release
    ; 另一种注释
    [alice]
    warn = 小心
    """
    sections = parse_ini(text)
    assert sections["global"]["auto-close"] == "true"
    assert sections["global"]["pr-branch"] == "release"
    assert sections["alice"]["warn"] == "小心"


def test_parse_ini_merges_sections_and_skips_noise():
    text = "[global]\na=1\n[global]\nb=2\nnonsense line\n[]\n=5\n"
    sections = parse_ini(text)
    assert sections["global"] == {"a": "1", "b": "2"}


def test_unknown_keys():
    cfg = Config({"global": {"nope": "1", "auto-close.force": "true"}})
    assert cfg.unknown_keys() == ["nope"]


def test_bad_int_raises():
    cfg = Config({"global": {"twice-check-num": "abc"}})
    with pytest.raises(ValueError):
        cfg.get("twice-check-num")


def test_bad_bool_raises():
    cfg = Config({"global": {"auto-close": "maybe"}})
    with pytest.raises(ValueError):
        cfg.get("auto-close")


def test_unknown_option_raises():
    cfg = Config({})
    with pytest.raises(KeyError):
        cfg.get("nope")


def test_public_branches():
    cfg = Config({"global": {"public-branches": "dev/x, dev/y ,"}})
    assert cfg.public_branches() == ["dev/x", "dev/y"]
    assert Config({}).public_branches() == []


def test_can_set():
    cfg = Config({})
    assert cfg.can_set("auto-close", "global")
    assert cfg.can_set("auto-close", "alice")
    assert not cfg.can_set("ban", "global")
    assert cfg.can_set("ban", "alice")
    assert not cfg.can_set("pr-branch", "alice")
    assert not cfg.can_set("review-self", "global")


def test_review_self_is_always_false():
    cfg = Config({"global": {"review-self": "true"}})
    assert cfg.get("review-self") is False
    assert cfg.raw("review-self") == "true"
    assert not cfg.can_set("review-self", "global")
