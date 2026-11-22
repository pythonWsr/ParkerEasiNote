# pr.py 技术债清单

M2 结项时确认、**不阻塞 M3** 的已知问题。每项都记录了位置与计划，避免口头承诺丢失。

| ID | 项 | 位置 | 影响 | 计划 |
|---|---|---|---|---|
| TD-3 | 通知按 `createdAt` 在本地过滤 | `prlib/infra/gh.py::list_issues` | 分页场景可能漏数据、issue 多时拉取慢 | M3 加 `--since/--last` 参数映射到 `gh issue list --search "created:>=YYYY-MM-DD"`，本地只做兜底 |
| TD-5 | `follow_renames` 对字符串形态的 `renamed` 提示不够精确 | `prlib/core/transition.py` | 报"缺少目标路径"可能让人误以为记录是 dict 只是漏字段 | 低优先：文案改为"renamed 记录不是带 to 的对象" |
| TD-6 | `rebase_onto` 的非冲突失败没有细分原因 | `prlib/infra/git.py` | 只能看到 stderr 原文（工作区脏 / 已在 rebase / 分支即 main） | 已保留 `error` 字段；后续可按 stderr 关键字映射成 `reason` 枚举 |
| TD-7 | `op=release` 写 `status/version.json` 时 `assets.*.size/sha256` 仍是占位（0 / ""） | `prlib/ops/server.py::release` | 客户端若校验大小/摘要会拿到空值 | 从 Release API 回填：`gh api /repos/{repo}/releases/tags/{tag}/assets` |
| TD-8 | `merge <PR>` 会把 `pr` 分支当前全部内容合入 main，多 PR 并发时可能把尚未单独 merge 的 PR 一起带入 | `prlib/cli/commands/merge.py::_promote_to_main` | 多协作者时语义不明确；单 PR 顺序合并正确 | 需定语义：按 PR 精确 cherry-pick，或要求 pr 分支在合并前只含该 PR 的改动 |
| TD-9 | `pr` 分支没有任何规则集/CODEOWNERS 保护（仓库只有 main-protection 与 status-protection），pr→main 由 merge 自动 admin 合并 | `merge.py` / 仓库设置 | 审批闸门只在原始 PR 上；直接向 pr 推送不会被拦 | 评估给 pr 加规则集（要求 PR + 批准），或改为按 PR 提交内容精确提升到 main |

## 已解决（不进债表）

- **run id 竞态**：改为 **nonce 索引**。`trigger` 本地生成 nonce 并入参，workflow 写 `ops/nonce/<nonce>.json`，客户端只轮询该文件；`_latest_run_id` 已删除，结果不可能错配。
- **结果文件日期分目录**：改为 `ops/nonce/<nonce>.json`，不再有跨午夜/跨时区问题。审计归档（`ops/audit/<YYYYMM>/<nonce>.json`）由 workflow 侧可选写入，客户端不依赖。
- **rebase 冲突误判**：`RebaseOutcome` 增加 `error` 字段；`_rebase_in_progress()` 通过 `.git/rebase-merge`、`.git/rebase-apply` 判定真冲突，其余失败标为"非冲突"并保留 stderr 原文。
- **文件级历史链判定**：采用标准 **b**——`git log <branch>..<main> -- <file>` 为空即通过；分支上新增提交（含 revert）允许。已写入补丁 §7.3（v1.6-B）。
- **`fetch()` 后缓存陈旧**：`StatusStore.fetch()` 内部自动 `invalidate()`。
- **`twice-check` 契约**：M3 的 `pr-ops.yml` 把 `op` 定义为 `string` + 运行时校验；payload 固定 `{"original_op", "initiator", ...}`。
