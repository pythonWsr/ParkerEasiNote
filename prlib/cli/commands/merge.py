"""merge：把 PR 合入 main（main，仅仓库所有者，§7.22 / M4-4）。

两步：
1. PR 未合时先合入它的 base（通常是 pr 分支）
2. 若 base 不是 main，再自动创建/合并 pr→main，让改动真正落到 main
3. op=merge 把相关文件状态改为 pushed，并记 merge commit
"""

from __future__ import annotations

from ._common import fail, require_owner
from ..context import Context


def run(ctx: Context, args) -> int:
    if not require_owner(ctx):
        return fail(ctx, "只有仓库所有者可以合并 PR", 4)

    info = ctx.gh.pr_view(args.number)
    if not info:
        return fail(ctx, "找不到 PR #%s" % args.number, 8)
    base = info.get("baseRefName")

    if ctx.dry_run:
        ctx.output.plan("gh pr merge %s --merge%s" % (args.number, " --admin" if args.bypass else ""))
        if base and base != "main":
            ctx.output.plan("PR base=%s，随后创建/合并 pr→main" % base)
        ctx.output.plan("op=merge 把 PR 文件状态改为 pushed")
        ctx.output.success("merge", {"pr": args.number, "base": base, "dry_run": True})
        return 0

    if info.get("state") != "MERGED":
        ctx.gh.pr_merge(args.number, method="merge", admin=bool(args.bypass))
        info = ctx.gh.pr_view(args.number)

    files = [item.get("path") for item in info.get("files") or [] if item.get("path")]
    sha = (info.get("mergeCommit") or {}).get("oid", "")
    if base and base != "main":
        _promote_to_main(ctx)

    data = ctx.apply("merge", {"pr": args.number, "files": files, "sha": sha})
    ctx.output.success(
        "merge",
        {"pr": args.number, "files": files, "sha": sha, "result": data},
    )
    return 0


def _promote_to_main(ctx: Context) -> None:
    """把 pr 分支合入 main（已有 open PR 则复用）。"""
    for item in ctx.gh.list_prs(state="open"):
        if item.get("headRefName") == "pr" and item.get("baseRefName") == "main":
            ctx.gh.pr_merge(int(item["number"]), method="merge", admin=True)
            return
    number = ctx.gh.open_pr("main", "pr", "chore: 同步 pr 到 main", body="由 pr.py merge 自动创建")
    if number:
        ctx.gh.pr_merge(number, method="merge", admin=True)
