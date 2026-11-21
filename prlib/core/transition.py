# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
#
# This file is NOT covered by the repository's MIT license.
# It is an independent work authored solely by pythonWsr.
# Unauthorized copying, modification, or distribution is prohibited.
"""状态转移纯函数（M1 核心）。

约束：
· 只接收纯数据，不读文件、不碰 git/gh、不产生副作用
· 每次调用返回 :class:`TransitionResult`，被拒绝时携带 :class:`Rejection`
· 状态名不在此处硬编码字符串，全部走 :mod:`prlib.core.states`
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence, Tuple

from . import rules, states
from .config import Config
from .errors import Rejection, RejectionCode


@dataclass(frozen=True)
class TransitionResult:
    """一次状态转移的判定结果。"""

    ok: bool
    new_status: Optional[str] = None
    to: Optional[str] = None
    redirect: Optional[str] = None
    required: Optional[str] = None
    requirement: rules.ForceRequirement = rules.ForceRequirement.NONE
    rejection: Optional[Rejection] = None
    note: str = ""

    @property
    def exit_code(self) -> int:
        return 0 if self.ok else (self.rejection.exit_code if self.rejection else 1)

    # -- 便捷访问器：infra / CLI 直接读，不必层层穿透 .rejection --
    @property
    def code(self) -> Optional[RejectionCode]:
        return self.rejection.code if self.rejection else None

    @property
    def message(self) -> str:
        return self.rejection.message if self.rejection else ""

    @property
    def hint(self) -> str:
        return self.rejection.hint if self.rejection else ""


def allowed(
    new_status: Optional[str] = None,
    to: Optional[str] = None,
    redirect: Optional[str] = None,
    note: str = "",
) -> TransitionResult:
    """构造"允许"结果。"""
    return TransitionResult(True, new_status=new_status, to=to, redirect=redirect, note=note)


def denied(code: RejectionCode, message: str, hint: Optional[str] = None) -> TransitionResult:
    """构造"拒绝"结果。"""
    return TransitionResult(False, rejection=Rejection(code, message, hint))


def need(
    kind: str,
    code: RejectionCode,
    message: str,
    hint: Optional[str] = None,
    requirement: rules.ForceRequirement = rules.ForceRequirement.NONE,
) -> TransitionResult:
    """构造"缺少前置条件"结果（force / twice-check）。

    ``requirement`` 是给 infra 层的机器可读契约：
    LOW 只差一个 --force；HIGH 还要开验证码 issue。
    """
    return TransitionResult(
        False,
        required=kind,
        requirement=requirement,
        rejection=Rejection(code, message, hint),
    )


def _unpack(record: Any) -> Tuple[Optional[str], Optional[str]]:
    """从状态记录中取出 (status, operator)。

    接受三种形态：dict / (status, operator) 元组 / 纯状态字符串（operator 未知）。
    """
    if record is None:
        return None, None
    if isinstance(record, Mapping):
        return record.get("status"), record.get("operator")
    if isinstance(record, (tuple, list)):
        if len(record) >= 2:
            return record[0], record[1]
        if len(record) == 1:
            return record[0], None
        return None, None
    return str(record), None


# --------------------------------------------------------------------- open
def try_open(
    current_status: Optional[str],
    current_operator: Optional[str],
    actor: str,
    codeowners_owner: Optional[str],
    config: Config,
    *,
    force: bool = False,
    twice_check_ok: bool = False,
    renamed_to: Optional[str] = None,
) -> TransitionResult:
    """把文件状态改为 opening（§7.2）。

    · closed / request changes / pushed / dangling → 任何人可直接开
    · renamed → 重定向到新路径（由调用方再开一次）
    · removed → 只能 restore
    · waiting / system → 拒绝
    · 未关闭（自己持有）→ 拒绝，须先 close
    · 未关闭（他人）→ 按风险等级要求 --force（opening 还需二次验证）
    """
    if current_status == states.SYSTEM:
        return denied(RejectionCode.SYSTEM_CANNOT_OPEN, "system 文件不参与流程，不能 open")
    if current_status == states.WAITING:
        return denied(
            RejectionCode.WAITING_CANNOT_OPEN,
            "该文件正在等待审批，不能 open",
            "等待审批结束；若是你自己的 PR，可 pr.py pr --cancel 撤回",
        )
    if current_status == states.REMOVED:
        return denied(
            RejectionCode.REMOVED_ONLY_RESTORE,
            "removed 状态只能 restore",
            "python pr.py restore <file>",
        )
    if current_status == states.RENAMED:
        if not renamed_to:
            return denied(RejectionCode.INVALID_STATE, "renamed 记录缺少目标路径")
        return allowed(redirect=renamed_to, note="已重定向到新路径")

    if current_status in states.OPEN_STATES and current_operator == actor:
        return denied(
            RejectionCode.HELD_BY_SELF,
            "你已持有该文件（%s），不能重复 open" % states.display_status(current_status or ""),
            "先 python pr.py close <file>",
        )

    requirement = rules.required_force(current_status, current_operator, actor, codeowners_owner)
    policy = rules.force_policy(requirement, config, force=force, twice_check_ok=twice_check_ok)
    if policy == "force":
        hint = "高风险操作还需 --twice-check <code>" if requirement is rules.ForceRequirement.HIGH else ""
        return need(
            "force",
            RejectionCode.NEED_FORCE,
            "该文件需要 --force 才能打开",
            hint,
            requirement=requirement,
        )
    if policy == "twice-check":
        return need(
            "twice-check",
            RejectionCode.NEED_TWICE_CHECK,
            "高风险操作需要二次验证",
            "先 --force，再按验证码执行 --force --twice-check <code>",
            requirement=requirement,
        )
    return allowed(states.OPENING)


# -------------------------------------------------------------------- close
def try_close(
    current_status: Optional[str],
    current_operator: Optional[str],
    actor: str,
    workspace_clean: bool,
    config: Config,
) -> TransitionResult:
    """关闭自己持有的文件（§7.4）。"""
    if current_status not in states.OPEN_STATES:
        return denied(RejectionCode.NOT_OPENED_BY_SELF, "该文件未处于打开状态，无需 close")
    if current_operator != actor:
        return denied(
            RejectionCode.HELD_BY_OTHER,
            "该文件由 %s 持有" % (current_operator or "?"),
        )
    if not workspace_clean:
        return denied(
            RejectionCode.WORKSPACE_DIRTY,
            "工作区不干净，close 前请先 commit 或撤销改动",
        )
    return allowed(states.CLOSED)


# ------------------------------------------------------------------- commit
def try_commit(files_status: Mapping[str, Any], actor: str, config: Config) -> TransitionResult:
    """校验本次 commit 涉及的文件（§7.3 步骤 5）。"""
    if not files_status:
        return denied(RejectionCode.NOTHING_TO_COMMIT, "没有需要提交的文件")
    for path, record in files_status.items():
        status, operator = _unpack(record)
        if status == states.SYSTEM:
            return denied(RejectionCode.SYSTEM_CANNOT_OPEN, "system 文件不能手工提交: %s" % path)
        if operator != actor:
            return denied(
                RejectionCode.HELD_BY_OTHER,
                "%s 由 %s 持有" % (path, operator or "?"),
                "先 open 抢权（可能需要 --force）",
            )
        if status != states.OPENING:
            return denied(
                RejectionCode.NOT_OPENED_BY_SELF,
                "%s 的状态是 %s，不是 opening" % (path, states.display_status(status or "")),
                "只有 opening 的文件可以 commit",
            )
    return allowed(states.COMMITTED)


# ----------------------------------------------------------------------- pr
INCLUDE = "include"
CLOSE_THEN_INCLUDE = "close-then-include"
DELETE = "delete"
SKIP = "skip"


@dataclass(frozen=True)
class FilePlan:
    """单个文件在 PR 中的处理方案。"""

    path: str
    status: Optional[str]
    action: str
    next_status: Optional[str] = None
    note: str = ""


@dataclass(frozen=True)
class PrResult:
    ok: bool
    plans: Tuple[FilePlan, ...] = ()
    rejection: Optional[Rejection] = None
    required: Optional[str] = None
    requirement: rules.ForceRequirement = rules.ForceRequirement.NONE


def try_pr(
    files_status: Mapping[str, Any],
    actor: str,
    config: Config,
    *,
    force: bool = False,
    twice_check_ok: bool = False,
    workspace_clean: bool = True,
) -> PrResult:
    """计算一次 PR 中每个文件的处理方案（§7.5 表格）。"""
    if not files_status:
        return PrResult(False, rejection=Rejection(RejectionCode.NOTHING_TO_COMMIT, "没有可 PR 的文件"))

    plans = []
    for path in sorted(files_status):
        status, operator = _unpack(files_status[path])
        if status == states.SYSTEM or status == states.WAITING:
            plans.append(FilePlan(path, status, SKIP))
            continue
        if status == states.RENAMED:
            plans.append(FilePlan(path, status, SKIP, note="下一次 PR 后删除旧记录"))
            continue
        if status == states.REMOVED:
            if operator == actor:
                plans.append(FilePlan(path, status, DELETE, states.REMOVED))
            else:
                plans.append(FilePlan(path, status, SKIP))
            continue
        if status == states.DANGLING:
            plans.append(FilePlan(path, status, INCLUDE, states.REMOVED))
            continue
        if status in states.CLOSED_STATES:
            plans.append(FilePlan(path, status, INCLUDE, states.WAITING))
            continue
        if status in states.OPEN_STATES:
            if operator == actor:
                if not workspace_clean:
                    return PrResult(
                        False,
                        rejection=Rejection(
                            RejectionCode.WORKSPACE_DIRTY,
                            "%s 由你自己持有且有未提交改动，无法自动 close" % path,
                            "先 python pr.py commit，再 PR",
                        ),
                    )
                plans.append(FilePlan(path, status, CLOSE_THEN_INCLUDE, states.WAITING))
                continue
            requirement = rules.required_force(status, operator, actor, None)
            policy = rules.force_policy(requirement, config, force=force, twice_check_ok=twice_check_ok)
            if policy == "force":
                return PrResult(
                    False,
                    required="force",
                    requirement=requirement,
                    rejection=Rejection(
                        RejectionCode.NEED_FORCE,
                        "%s 由 %s 持有，纳入 PR 需要 --force" % (path, operator or "?"),
                    ),
                )
            if policy == "twice-check":
                return PrResult(
                    False,
                    required="twice-check",
                    requirement=requirement,
                    rejection=Rejection(
                        RejectionCode.NEED_TWICE_CHECK,
                        "%s 正被他人 opening，需要二次验证" % path,
                    ),
                )
            plans.append(FilePlan(path, status, INCLUDE, states.WAITING))
            continue
        plans.append(FilePlan(path, status, SKIP))
    return PrResult(True, plans=tuple(plans))


# ------------------------------------------------------------------- remove
def try_remove(
    current_status: Optional[str],
    current_operator: Optional[str],
    actor: str,
    codeowners_owner: Optional[str],
    config: Config,
    *,
    force: bool = False,
) -> TransitionResult:
    """标记删除（§7.9）：不实际删除，状态 → dangling。"""
    if current_status in states.OPEN_STATES:
        who = "你自己" if current_operator == actor else (current_operator or "?")
        return denied(
            RejectionCode.HELD_BY_SELF if current_operator == actor else RejectionCode.HELD_BY_OTHER,
            "该文件仍由%s持有（%s），不能 remove" % (who, states.display_status(current_status or "")),
            "先 close",
        )
    if current_status in (states.WAITING, states.SYSTEM):
        return denied(RejectionCode.INVALID_STATE, "%s 状态不能 remove" % states.display_status(current_status or ""))
    if current_status == states.RENAMED:
        return denied(RejectionCode.INVALID_STATE, "renamed 记录不能 remove")
    if not rules.is_codeowner(codeowners_owner, actor):
        return denied(
            RejectionCode.CODEOWNERS_MISMATCH,
            "该文件在 main CODEOWNERS 中属于 %s" % codeowners_owner,
        )
    if not force:
        return need(
            "force",
            RejectionCode.NEED_FORCE,
            "remove 必须带 --force",
            requirement=rules.ForceRequirement.LOW,
        )
    if current_status == states.REMOVED:
        return allowed(states.REMOVED, note="仅更新 operator")
    return allowed(states.DANGLING)


# ------------------------------------------------------------------ restore
def try_restore(
    current_status: Optional[str],
    actor: str,
    codeowners_owner: Optional[str],
    config: Config,
) -> TransitionResult:
    """removed → dangling（§7.10）。"""
    if current_status != states.REMOVED:
        return denied(
            RejectionCode.INVALID_STATE,
            "只有 removed 状态可以 restore（当前：%s）" % states.display_status(current_status or "无记录"),
        )
    if not rules.is_codeowner(codeowners_owner, actor):
        return denied(
            RejectionCode.CODEOWNERS_MISMATCH,
            "该文件在 main CODEOWNERS 中属于 %s" % codeowners_owner,
        )
    return allowed(states.DANGLING)


# --------------------------------------------------------------------- move
def try_move(
    current_status: Optional[str],
    current_operator: Optional[str],
    actor: str,
    dst_exists: bool,
    codeowners_owner: Optional[str],
    config: Config,
    *,
    force: bool = False,
    twice_check_ok: bool = False,
    dst: str = "",
) -> TransitionResult:
    """移动文件（§7.20）。目标已存在时**无** --force 出口。"""
    if dst_exists:
        return denied(
            RejectionCode.DST_EXISTS,
            "目标路径已存在：%s" % dst,
            "move 不提供 --force，避免覆盖他人文件",
        )
    if current_status != states.OPENING:
        return denied(
            RejectionCode.NOT_OPENED_BY_SELF,
            "旧文件必须由你自己 opening（当前：%s）" % states.display_status(current_status or "无记录"),
        )
    if current_operator != actor:
        return denied(RejectionCode.HELD_BY_OTHER, "旧文件由 %s 持有" % (current_operator or "?"))
    requirement = rules.required_force(current_status, current_operator, actor, codeowners_owner)
    policy = rules.force_policy(requirement, config, force=force, twice_check_ok=twice_check_ok)
    if policy == "force":
        return need(
            "force",
            RejectionCode.NEED_FORCE,
            "该文件在 main CODEOWNERS 中不属于你，需要 --force",
            requirement=requirement,
        )
    if policy == "twice-check":
        return need(
            "twice-check",
            RejectionCode.NEED_TWICE_CHECK,
            "高风险操作需要二次验证",
            requirement=requirement,
        )
    return allowed(states.RENAMED, to=dst)


# ----------------------------------------------------------------- transfer
def try_transfer(
    current_owner: Optional[str],
    actor: str,
    target: str,
    target_is_collaborator: bool,
    config: Config,
    *,
    branch_state: str = states.BRANCH_NORMAL,
    force: bool = False,
) -> TransitionResult:
    """转让分支所有权（§7.17）。"""
    if branch_state in (states.BRANCH_DANGLING, states.BRANCH_REMOVED):
        return denied(RejectionCode.INVALID_STATE, "悬空状态的分支不能转让")
    if current_owner != actor:
        return denied(
            RejectionCode.NOT_YOUR_BRANCH,
            "该分支属于 %s，只有所有者可以转让" % (current_owner or "?"),
        )
    if not target_is_collaborator:
        return denied(RejectionCode.NOT_COLLABORATOR, "%s 不是仓库协作者" % target)
    if not force:
        return need(
            "force",
            RejectionCode.NEED_FORCE,
            "transfer 必须带 --force",
            requirement=rules.ForceRequirement.LOW,
        )
    return allowed(to=target, note="分支 owner 与 CODEOWNERS 将改为 %s" % target)


# ------------------------------------------------------------------- delete
def try_delete(
    branch_owner: Optional[str],
    actor: str,
    *,
    open_files: Sequence[str] = (),
    waiting: Sequence[str] = (),
    config: Config,
    force: bool = False,
    twice_check_ok: bool = False,
    branch_state: str = states.BRANCH_NORMAL,
) -> TransitionResult:
    """标记删除分支（§7.18）：二次验证 + 所有文件关闭。"""
    if branch_state in (states.BRANCH_DANGLING, states.BRANCH_REMOVED):
        return denied(RejectionCode.INVALID_STATE, "该分支已被标记删除")
    if branch_owner != actor:
        return denied(
            RejectionCode.NOT_YOUR_BRANCH,
            "只有分支所有者可以删除（当前 owner：%s）" % (branch_owner or "?"),
        )
    if open_files or waiting:
        detail = ", ".join(list(open_files) + list(waiting))
        return denied(
            RejectionCode.OPEN_FILES_REMAIN,
            "还有未关闭/待审批文件：%s" % detail,
            "先 close 或等审批结束",
        )
    if not force:
        return need(
            "force",
            RejectionCode.NEED_FORCE,
            "delete 必须带 --force",
            requirement=rules.ForceRequirement.HIGH,
        )
    if not twice_check_ok:
        return need(
            "twice-check",
            RejectionCode.NEED_TWICE_CHECK,
            "delete 需要二次验证",
            requirement=rules.ForceRequirement.HIGH,
        )
    return allowed(states.BRANCH_DANGLING, note="分支标记为 dangling，不立即物理删除")


# ------------------------------------------------------------------- switch
def try_switch(
    branch_owner: Optional[str],
    actor: str,
    config: Config,
    *,
    branch_state: str = states.BRANCH_NORMAL,
    force: bool = False,
) -> TransitionResult:
    """切换分支（§7.19）。"""
    ok, rejection = rules.branch_switch_allowed(branch_owner, actor, branch_state, force)
    if not ok:
        if rejection and rejection.code is RejectionCode.NEED_FORCE:
            return TransitionResult(
                False,
                required="force",
                requirement=rules.ForceRequirement.LOW,
                rejection=rejection,
            )
        return TransitionResult(False, rejection=rejection)
    if branch_state in (states.BRANCH_DANGLING, states.BRANCH_REMOVED):
        return allowed(to=actor, note="切换后 owner=你，CODEOWNERS 恢复")
    return allowed()


# -------------------------------------------------------------------- reset
def try_reset(
    workspace_clean: bool,
    unreviewed_prs: Sequence[Any],
    *,
    mode: str = "hard",
    has_unpushed: bool = False,
    force: bool = False,
) -> TransitionResult:
    """reset 到 origin/main（§7.11）。"""
    if not workspace_clean:
        return denied(RejectionCode.WORKSPACE_DIRTY, "工作区不干净，不能 reset")
    if unreviewed_prs:
        return denied(
            RejectionCode.UNREVIEWED_PR,
            "还有未审批的 PR，不能 reset",
            "先等审批或撤回（pr.py pr --cancel）",
        )
    if mode == "hard" and has_unpushed and not force:
        return need(
            "force",
            RejectionCode.NEED_FORCE,
            "本地有未推送提交，--hard 会丢弃，需 --force 确认",
            requirement=rules.ForceRequirement.LOW,
        )
    return allowed(note="基线 origin/main")


# ------------------------------------------------------------------- rebase
def try_rebase(
    workspace_clean: bool,
    is_dev_branch: bool,
    owner_ok: bool,
    unreviewed_prs: Sequence[Any],
    open_files: Sequence[str],
    config: Config,
    *,
    force: bool = False,
) -> TransitionResult:
    """rebase 到 origin/main（§7.12）；--force 只跳过前置校验。"""
    if not is_dev_branch:
        return denied(RejectionCode.NOT_YOUR_BRANCH, "只能在 dev/ 分支执行 rebase")
    if not owner_ok:
        return denied(RejectionCode.NOT_YOUR_BRANCH, "只有分支所有者可以 rebase")
    if force:
        return allowed(note="已跳过前置校验")
    if not workspace_clean:
        return denied(RejectionCode.WORKSPACE_DIRTY, "工作区不干净，不能 rebase")
    if unreviewed_prs:
        return denied(RejectionCode.UNREVIEWED_PR, "还有未审批的 PR，不能 rebase")
    if open_files:
        return denied(
            RejectionCode.OPEN_FILES_REMAIN,
            "还有未关闭文件：%s" % ", ".join(open_files),
            "先 close，或用 --force 跳过",
        )
    return allowed(note="基线 origin/main")


# --------------------------------------------------------- 重定向（renamed）

REDIRECT_LIMIT = 3


@dataclass(frozen=True)
class RedirectResult:
    """沿 ``renamed`` 链解析后的最终落点。"""

    ok: bool
    path: str
    chain: Tuple[str, ...] = ()
    rejection: Optional[Rejection] = None


def follow_renames(
    records: Mapping[str, Any],
    path: str,
    limit: int = REDIRECT_LIMIT,
) -> RedirectResult:
    """沿 ``renamed`` 链找到最终路径（§7.2 / §7.20）。

    深度上限默认 3（超过视为异常，防止链式改名形成迷宫）。
    """
    chain = [path]
    seen = {path}
    current = path
    hops = 0
    while True:
        record = records.get(current)
        status, _ = _unpack(record)
        if status != states.RENAMED:
            return RedirectResult(True, current, tuple(chain))
        target = record.get("to") if isinstance(record, Mapping) else None
        if not target:
            return RedirectResult(
                False,
                current,
                tuple(chain),
                Rejection(RejectionCode.INVALID_STATE, "%s 的 renamed 记录缺少目标路径" % current),
            )
        hops += 1
        chain.append(target)
        if target in seen:
            return RedirectResult(
                False,
                target,
                tuple(chain),
                Rejection(
                    RejectionCode.INVALID_STATE,
                    "renamed 出现循环: %s" % " -> ".join(chain),
                ),
            )
        if hops > limit:
            return RedirectResult(
                False,
                target,
                tuple(chain),
                Rejection(
                    RejectionCode.INVALID_STATE,
                    "重定向层级超过 %d 层: %s" % (limit, " -> ".join(chain)),
                ),
            )
        seen.add(target)
        current = target
