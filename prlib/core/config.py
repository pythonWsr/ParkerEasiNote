# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""配置解析（纯函数）。

输入是已经从 status 分支读到的 INI 文本 / 字典，输出 :class:`Config`。
本模块不读文件、不碰 git、不碰 gh。

优先级（§5.2）：
1. ``[global]`` 里 ``<key>.force = true`` → 全局强制，忽略用户值
2. ``[<user>]`` 有值 → 用用户值
3. ``[global]`` 有值 → 用全局值
4. 都没有 → 内置默认
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Mapping, Optional, Tuple

# ---- 作用域 --------------------------------------------------------------
SCOPE_GLOBAL = "global"
SCOPE_USER = "user"
SCOPE_BOTH = "both"

# ---- 类型 ----------------------------------------------------------------
KIND_BOOL = "bool"
KIND_INT = "int"
KIND_STR = "str"

_TRUE = frozenset({"true", "1", "yes", "on"})
_FALSE = frozenset({"false", "0", "no", "off", ""})


@dataclass(frozen=True)
class Option:
    """一个配置项的定义（§5.3）。"""

    key: str
    scope: str
    kind: str
    default: object
    meaning: str


# 顺序与 §5.3 表格一致，编号即下标 +1。
OPTIONS: Tuple[Option, ...] = (
    Option("auto-close", SCOPE_BOTH, KIND_BOOL, False, "满足条件自动 close"),
    Option("auto-force", SCOPE_BOTH, KIND_BOOL, False, "自动补 --force（仅低风险）"),
    Option("twice-check-num", SCOPE_BOTH, KIND_INT, 8, "验证码位数"),
    Option("auto-check", SCOPE_BOTH, KIND_BOOL, True, "命令前自动 check"),
    Option("auto-push", SCOPE_BOTH, KIND_BOOL, True, "自动 push"),
    Option("auto-remind-back", SCOPE_BOTH, KIND_BOOL, False, "自动回拍"),
    Option("auto-accept-transfer", SCOPE_BOTH, KIND_BOOL, False, "自动接收转让"),
    Option("auto-short", SCOPE_BOTH, KIND_BOOL, False, "默认 --short"),
    Option("auto-help", SCOPE_BOTH, KIND_BOOL, False, "缺参数/出错时自动显示帮助"),
    Option("ban", SCOPE_USER, KIND_BOOL, False, "封禁用户，拒绝其所有操作"),
    Option("warn", SCOPE_USER, KIND_STR, "", "每次操作时显示警告（stderr）"),
    Option("twice-check-timeout", SCOPE_BOTH, KIND_INT, 300, "验证码有效期（秒）"),
    Option("twice-check-issue-close", SCOPE_BOTH, KIND_INT, 330, "验证 issue 自动关闭延时（秒）"),
    Option("lock-issue-timeout", SCOPE_BOTH, KIND_INT, 900, "锁 issue 超时释放（秒）"),
    Option("auto-push-branch", SCOPE_BOTH, KIND_BOOL, True, "rebase 后是否 push --force-with-lease"),
    Option("push-force-with-lease", SCOPE_GLOBAL, KIND_BOOL, True, "push 强制用 --force-with-lease"),
    Option("notification-retention-days", SCOPE_BOTH, KIND_INT, 7, "通知默认显示天数"),
    Option("notification-retention-count", SCOPE_BOTH, KIND_INT, 20, "通知默认显示条数"),
    Option("remind-default", SCOPE_BOTH, KIND_STR, "拍了拍", "无 -m 时拍一拍文案"),
    Option("pr-branch", SCOPE_GLOBAL, KIND_STR, "pr", "PR 目标分支名"),
    Option("default-branch", SCOPE_GLOBAL, KIND_STR, "main", "基准分支名"),
    Option("dev-prefix", SCOPE_GLOBAL, KIND_STR, "dev/", "dev 分支前缀"),
    Option("status-branch", SCOPE_GLOBAL, KIND_STR, "status", "status 分支名"),
    Option("codeowners-path", SCOPE_GLOBAL, KIND_STR, ".github/CODEOWNERS", "CODEOWNERS 路径"),
    Option("branch-owner-public", SCOPE_GLOBAL, KIND_STR, "@everyone", "公有分支所有者标识"),
    Option("dangling-owner", SCOPE_GLOBAL, KIND_STR, "dangling", "悬空所有者标识"),
    Option("check-silent", SCOPE_BOTH, KIND_BOOL, True, "check 前置是否静默"),
    Option("confirm-twice-check", SCOPE_GLOBAL, KIND_BOOL, True, "二次验证是否默认开启"),
    Option("auto-approve", SCOPE_GLOBAL, KIND_BOOL, False, "自动触发他人审批"),
    Option("review-self", SCOPE_GLOBAL, KIND_BOOL, False, "自我审批（恒 false，不可开启）"),
    Option("pr-merge-bypass", SCOPE_GLOBAL, KIND_BOOL, False, "是否默认允许 --bypass"),
    Option("system-paths", SCOPE_GLOBAL, KIND_STR, "pr.py,prlib/**,.github/**", "system 文件路径匹配规则"),
    Option("public-branches", SCOPE_GLOBAL, KIND_STR, "", "公有分支清单（逗号分隔）"),
    Option("scan-concurrency", SCOPE_GLOBAL, KIND_INT, 1, "dev-scan.yml 并发上限"),
)

OPTIONS_BY_KEY: Dict[str, Option] = {opt.key: opt for opt in OPTIONS}


def option(key: str) -> Option:
    """取配置项定义；未定义抛 :class:`KeyError`。"""
    try:
        return OPTIONS_BY_KEY[key]
    except KeyError:
        raise KeyError("未知配置项: %s" % key)


def as_bool(value: str, key: str = "") -> bool:
    """按 true/false 语义解析布尔值。"""
    text = (value or "").strip().lower()
    if text in _TRUE:
        return True
    if text in _FALSE:
        return False
    raise ValueError("配置项 %s 不是合法布尔值: %r" % (key or "?", value))


def parse_ini(text: str) -> Dict[str, Dict[str, str]]:
    """把 INI 文本解析成 ``{section: {key: value}}``（纯函数）。

    · 支持 ``#`` / ``;`` 行注释
    · key 统一小写、去空白
    · 同名 section 合并；同名 key 后者覆盖
    """
    sections: Dict[str, Dict[str, str]] = {}
    current = ""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line[0] in "#;":
            continue
        if line.startswith("[") and line.endswith("]"):
            current = line[1:-1].strip().lower()
            sections.setdefault(current, {})
            continue
        if "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip().lower()
        if not name:
            continue
        sections.setdefault(current, {})[name] = value.strip()
    return sections


class Config:
    """一次解析后的配置快照。"""

    def __init__(
        self,
        sections: Optional[Mapping[str, Mapping[str, str]]] = None,
        user: Optional[str] = None,
    ):
        normalized: Dict[str, Dict[str, str]] = {}
        for name, values in (sections or {}).items():
            normalized[name.strip().lower()] = {
                str(k).strip().lower(): str(v).strip() for k, v in values.items()
            }
        self.sections = normalized
        self.user = (user or "").strip().lower()
        self._global = normalized.get(SCOPE_GLOBAL, {})
        self._user = normalized.get(self.user, {}) if self.user else {}
        self._forced = frozenset(
            name[: -len(".force")]
            for name, value in self._global.items()
            if name.endswith(".force") and _safe_true(value)
        )

    # -- 查询 ---------------------------------------------------------
    def is_forced(self, key: str) -> bool:
        """该配置项是否被全局 force 锁定。"""
        option(key)
        return key in self._forced

    def source(self, key: str) -> str:
        """值来自哪里：forced / user / global / default。"""
        opt = option(key)
        if self.is_forced(key) and opt.scope in (SCOPE_GLOBAL, SCOPE_BOTH):
            return "forced" if key in self._global else "default"
        if opt.scope in (SCOPE_BOTH, SCOPE_USER) and key in self._user:
            return "user"
        if opt.scope in (SCOPE_GLOBAL, SCOPE_BOTH) and key in self._global:
            return "global"
        return "default"

    def raw(self, key: str) -> Optional[str]:
        """取解析前的字符串值（无值时返回 None）。"""
        opt = option(key)
        if self.is_forced(key) and opt.scope in (SCOPE_GLOBAL, SCOPE_BOTH):
            return self._global.get(key)
        if opt.scope in (SCOPE_BOTH, SCOPE_USER) and key in self._user:
            return self._user[key]
        if opt.scope in (SCOPE_GLOBAL, SCOPE_BOTH):
            return self._global.get(key)
        return None

    def get(self, key: str):
        """取该配置项的生效值（已按类型转换）。

        ``review-self`` 恒为 False（§5.3 #30：即使被写入 true 也忽略；
        调用方可用 :meth:`raw` 读到原值以便告警）。
        """
        opt = option(key)
        if key == "review-self":
            return False
        raw = self.raw(key)
        if raw is None:
            return opt.default
        if opt.kind == KIND_BOOL:
            return as_bool(raw, key)
        if opt.kind == KIND_INT:
            try:
                return int(raw)
            except (TypeError, ValueError):
                raise ValueError("配置项 %s 不是合法整数: %r" % (key, raw))
        return raw

    def public_branches(self) -> List[str]:
        """公有分支清单（逗号分隔，去空）。"""
        text = self.get("public-branches") or ""
        return [item.strip() for item in str(text).split(",") if item.strip()]

    def unknown_keys(self) -> List[str]:
        """配置里出现的未定义项（供 check 报告）。"""
        found = set(self._global) | set(self._user)
        return sorted(name for name in found if not name.endswith(".force") and name not in OPTIONS_BY_KEY)

    def can_set(self, key: str, scope: str) -> bool:
        """在给定作用域下是否允许写该配置项。"""
        opt = option(key)
        scope = scope.strip().lower()
        if opt.key == "review-self":
            return False
        if scope == SCOPE_GLOBAL:
            return opt.scope in (SCOPE_GLOBAL, SCOPE_BOTH)
        return opt.scope in (SCOPE_BOTH, SCOPE_USER)


def _safe_true(value: str) -> bool:
    """宽松判断 .force 标记（非法值视为未开启）。"""
    try:
        return as_bool(value)
    except ValueError:
        return False
