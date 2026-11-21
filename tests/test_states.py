# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""状态常量与分组单测。"""

from prlib.core import states


def test_is_open():
    assert states.is_open(states.OPENING)
    assert states.is_open(states.COMMITTED)
    assert states.is_open(states.NEW)
    assert not states.is_open(states.CLOSED)
    assert not states.is_open(None)


def test_is_closed():
    assert states.is_closed(states.CLOSED)
    assert states.is_closed(states.REQUEST_CHANGES)
    assert states.is_closed(states.PUSHED)
    assert not states.is_closed(states.OPENING)


def test_is_dangling():
    assert states.is_dangling(states.DANGLING)
    assert states.is_dangling(states.REMOVED)
    assert states.is_dangling(states.RENAMED)
    assert not states.is_dangling(states.CLOSED)


def test_groups_are_disjoint():
    assert not (states.OPEN_STATES & states.CLOSED_STATES)
    assert not (states.OPEN_STATES & states.DANGLING_STATES)
    assert states.ALL_STATES >= states.OPEN_STATES | states.CLOSED_STATES | states.DANGLING_STATES


def test_holds():
    assert states.holds(states.OPENING, "alice", "alice")
    assert not states.holds(states.OPENING, "alice", "bob")
    assert not states.holds(states.CLOSED, "alice", "alice")
    assert not states.holds(states.OPENING, "alice", "")


def test_display_status():
    assert states.display_status(states.REQUEST_CHANGES) == "request changes"
    assert states.display_status(states.RENAMED, "b.js") == "renamed to b.js"
    assert states.display_status(states.RENAMED) == "renamed to ?"


def test_is_valid_status():
    assert states.is_valid_status(states.COMMITTED)
    assert not states.is_valid_status("unknown")
    assert not states.is_valid_status(None)


def test_is_public_owner():
    assert states.is_public_owner(states.EVERYONE)
    assert not states.is_public_owner("alice")


def test_spelling_is_fixed():
    """committed 必须是双 t。"""
    assert states.COMMITTED == "committed"
    assert len("committed") == 9


def test_request_changes_keeps_space():
    assert states.REQUEST_CHANGES == "request changes"
