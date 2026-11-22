"""release：发版（main，仅仓库所有者，§7.21 / M5 决策 2）。

流程：draft Release → 触发 build.yml → 等待 → 转正 → op=release 写 status。
IPA 只进 artifact（§27），由协作者签名后手动上传。
"""

from __future__ import annotations

import re
import time

from ...infra.gh import GhError
from ._common import fail, require_owner
from ..context import Context, RemoteFailure

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
BUILD_WORKFLOW = "build.yml"
BUILD_TIMEOUT = 1800.0


def run(ctx: Context, args) -> int:
    if not require_owner(ctx):
        return fail(ctx, "只有仓库所有者可以 release", 4)

    raw = str(args.version).strip()
    tag = raw if raw.startswith("v") else "v" + raw
    version = tag[1:]
    if not VERSION_RE.match(version):
        return fail(ctx, "版本号格式应为 vX.Y.Z（收到：%s）" % args.version, 2)

    if ctx.dry_run:
        ctx.output.plan("1) gh release create %s --draft --target main" % tag)
        ctx.output.plan("2) gh workflow run %s -f platform=all -f tag=%s" % (BUILD_WORKFLOW, tag))
        ctx.output.plan("3) gh run watch <run_id>（等待 5 个平台打包）")
        if args.stop_after_draft:
            ctx.output.plan("4) --stop-after-draft：停在 draft，不转正")
        else:
            ctx.output.plan("4) gh release edit %s --draft=false" % tag)
            ctx.output.plan("5) op=release 写 status/version.json（html/exe/apk/dmg，ipa 占位）")
        ctx.output.success("release", {"version": version, "tag": tag, "dry_run": True})
        return 0

    open_prs = ctx.gh.list_prs(state="open")
    if open_prs:
        return fail(ctx, "还有 %d 个未合并 PR，先处理再发版" % len(open_prs), 3, "pr.py list / merge")

    try:
        ctx.gh.create_release(tag, draft=True, target="main",
                              title="快捷白板10 %s" % version,
                              notes="自动化发版草稿，由 pr.py release 创建。")
    except GhError as exc:
        ctx.output.warn("创建 draft Release 失败（可能已存在）：%s" % exc)

    baseline = int(ctx.gh.latest_run_any(BUILD_WORKFLOW).get("databaseId") or 0)
    ctx.gh.run_workflow(BUILD_WORKFLOW, {"platform": "all", "tag": tag})
    run_id = _wait_for_build(ctx, baseline)

    if args.stop_after_draft:
        ctx.output.success(
            "release",
            {"version": version, "tag": tag, "draft": True, "run_id": run_id},
        )
        return 0

    ctx.gh.edit_release(tag, draft=False)
    data = ctx.apply("release", {"version": version, "tag": tag, "latest": not args.no_latest})
    ctx.output.success(
        "release",
        {"version": version, "tag": tag, "published": True, "run_id": run_id, "result": data},
    )
    return 0


def _wait_for_build(ctx: Context, baseline: int) -> int:
    """等 build.yml 本次触发的 run 完成（基线在触发前抓取，避免把自己当成旧 run）。"""
    deadline = time.time() + BUILD_TIMEOUT
    while time.time() < deadline:
        info = ctx.gh.latest_run_any(BUILD_WORKFLOW)
        run_id = int(info.get("databaseId") or 0)
        if run_id > baseline and info.get("status") == "completed":
            if info.get("conclusion") != "success":
                raise RemoteFailure(
                    8, "build 失败（conclusion=%s，run %s）" % (info.get("conclusion"), run_id)
                )
            return run_id
        time.sleep(5)
    raise RemoteFailure(8, "等待 build 超时（%d 秒）" % int(BUILD_TIMEOUT))
