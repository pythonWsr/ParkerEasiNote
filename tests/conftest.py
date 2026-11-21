# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""pytest 公共 fixture。"""

import shutil
import subprocess
from pathlib import Path

import pytest

from prlib.core.config import Config
from prlib.core.errors import RejectionCode  # noqa: F401  (便于测试引用)
from tests.helpers import FakeRunner  # noqa: F401  (供各测试 import 使用)


@pytest.fixture
def cfg():
    """默认配置，当前用户 alice。"""
    return Config({}, user="alice")


@pytest.fixture
def cfg_autoforce():
    """打开 auto-force（只对低风险生效）。"""
    return Config({"global": {"auto-force": "true"}}, user="alice")


@pytest.fixture
def cfg_no_twice():
    """关闭二次验证（confirm-twice-check=false）。"""
    return Config({"global": {"confirm-twice-check": "false"}}, user="alice")


@pytest.fixture
def fake_runner():
    return FakeRunner()


@pytest.fixture
def bare_repo(tmp_path):
    """现场创建本地裸仓库 + 工作副本（不向仓库提交二进制对象）。"""
    git = shutil.which("git")
    if not git:
        pytest.skip("环境里没有 git")
    bare = tmp_path / "bare.git"
    work = tmp_path / "work"
    subprocess.run([git, "init", "--bare", str(bare)], check=True, capture_output=True)
    subprocess.run([git, "clone", str(bare), str(work)], check=True, capture_output=True)
    seed = Path(__file__).parent / "fixtures" / "bare_repo" / "seed" / "README.md"
    (work / "README.md").write_text(seed.read_text(encoding="utf-8"), encoding="utf-8")
    env = ["-c", "user.email=test@example.com", "-c", "user.name=tester"]
    subprocess.run([git, "-C", str(work), *env, "add", "README.md"], check=True, capture_output=True)
    subprocess.run(
        [git, "-C", str(work), *env, "commit", "-m", "seed"],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [git, "-C", str(work), "push", "origin", "HEAD"],
        check=True,
        capture_output=True,
    )
    return {"bare": bare, "work": work, "git": git}
