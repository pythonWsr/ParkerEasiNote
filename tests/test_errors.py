# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""拒绝对象测试（不可变 + 退出码映射）。"""

import dataclasses

import pytest

from prlib.core.errors import EXIT_CODES, Rejection, RejectionCode


def test_rejection_is_frozen():
    rejection = Rejection(RejectionCode.NEED_FORCE, "需要 --force", "加 --force")
    with pytest.raises(dataclasses.FrozenInstanceError):
        rejection.message = "changed"


def test_rejection_str_and_repr():
    rejection = Rejection(RejectionCode.NEED_FORCE, "需要 --force")
    assert str(rejection) == "需要 --force"
    assert repr(rejection) == "Rejection(NEED_FORCE, '需要 --force')"


def test_rejection_can_be_raised():
    with pytest.raises(Rejection) as excinfo:
        raise Rejection(RejectionCode.NEED_TWICE_CHECK, "需要验证码")
    assert excinfo.value.exit_code == 6


def test_every_code_has_exit_code():
    for code in RejectionCode:
        assert code in EXIT_CODES
        assert Rejection(code, "x").exit_code == EXIT_CODES[code]


def test_rejection_hint_default():
    assert Rejection(RejectionCode.WORKSPACE_DIRTY, "脏").hint == ""
