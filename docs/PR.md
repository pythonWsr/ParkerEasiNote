<!--
Copyright (c) 2026 pythonWsr. All rights reserved.
SPDX-License-Identifier: LicenseRef-Proprietary
This document is NOT covered by the repository's MIT license.
-->

# pr.py 使用手册

> 本文件与 `pr.py` / `prlib/` 同为 pythonWsr 独立编写的工具，协议见 `LICENSE-PRPY`。

## 1. 它解决什么问题

仓库里所有文件改动都要走 `open → commit → pr → approve → merge`；
"谁能改哪个文件"由远端 `status` 分支的 `active.json` 唯一决定，本地改不了它。

- `main`：基准分支，只执行 `create / list / approve / reject / comment / merge / release`
- `dev/<你>`：工作分支，执行 `open / commit / close / pr / remove / restore / reset / rebase / move / transfer / delete / switch / remind`
- `status`：由 GitHub Actions 写入的状态分支（`active.json` / `latest.json` / `config.ini` / `version.json`）

## 2. 快速开始

```bash
python pr.py create dev/alice          # 在 main 上创建自己的工作分支
git switch dev/alice

python pr.py open 快捷白板10.html      # 打开文件（他人持有时需要 --force）
# ... 编辑 ...
python pr.py commit -m "改了什么"
python pr.py pr                        # 提 PR 到 pr 分支

# 在 main 上：
python pr.py approve <PR编号>
python pr.py merge <PR编号>            # 仅仓库所有者；自动完成 pr → main 并 admin 合并
```

全程可加 `--dry-run`：只校验、不写 status、不 push、不开 issue。

## 3. 命令总表

| 分支 | 命令 |
|---|---|
| main | `create list approve reject comment merge release` |
| dev/&lt;你&gt; | `open commit close pr remove restore reset rebase move transfer delete switch remind` |
| 任意 | `check status view config init sync log whoami doctor` |

## 4. 状态机

```
无记录 ──open──> opening ──commit──> committed ──pr──> waiting
                    │                     │              │
                    └──close──> closed <──┘        approve → pushed
                                   │              reject  → request changes
                                   └──pr──> waiting
remove: 任意已关闭状态 → dangling → (PR) → removed → restore → dangling
move:   旧路径 → renamed(to=新路径)；新路径 → new
system: pr.py / .github/** 永远不参与 PR
```

`renamed` 是结构化存储：`{"status": "renamed", "to": "新路径"}`，解析时最多跟 3 层。

## 5. 权限与验证码

| 场景 | 要求 |
|---|---|
| 他人 `committed` / `new` 的文件 | `--force`（低风险，`auto-force` 可自动补） |
| 他人 `opening` 的文件 | `--force` + `--twice-check <code>` |
| 文件在 main CODEOWNERS 中不属于你 | `--force` + `--twice-check <code>` |
| 你自己持有的文件 | 先 `close`，不能重复 open |

验证码由 Actions 创建 issue 生成，**只用于防误操作**，明文可见，不加密。
`requirement=HIGH` 时，无论你第一次带不带 `--force`，客户端都会开验证码 issue 并直接打印
「验证码 + issue 编号 + 过期时间」；拿到码后用 `--force --twice-check <code>` 重试。
（当前每次请求都会新建 issue；同一操作重复触发会堆积，超时由 pr-twice-cleanup 关闭。）

## 6. 常见问题

**Q：`open` 报"该文件正在等待审批"？**
A：先用 `python pr.py pr --cancel` 撤回自己的 PR。

**Q：`commit` 报"删除文件必须走 remove"？**
A：删除一律 `pr.py remove <文件> --force`，不要直接 `git rm`。

**Q：`rebase` 冲突了？**
A：现场保留，处理完 `git add` 后 `pr.py rebase --continue`，或 `pr.py rebase --abort`。

**Q：`--no-wait` 触发了但没结果？**
A：`pr.py sync <nonce>` 查结果，结果文件在 status 分支 `ops/nonce/<nonce>.json`。

**Q：多文件命令失败了一半怎么办？**
A：`open` / `close` / `remove` / `restore` 等命令按"任一失败即整体失败"处理，成功处会提示已处理到哪个文件。

**Q：`--dry-run` 能确认我有权限吗？**
A：不能。`--dry-run` 不联网校验 owner 权限（`merge` / `release` 在 dry-run 下直接放行），
真实权限只在真正执行时检查。

**Q：`check` 和 auto-check 有什么区别？**
A：auto-check（配置项 `auto-check`）只在写命令前做一次 `fetch status + 清缓存`，离线可用、不阻断；
完整 13 项检测请用 `python pr.py check`。

**Q：`review-self` 明明是 true 却不生效？**
A：该配置项被强制关闭（仓库不允许自我审批），`pr.py` 会提示并忽略。

**Q：`merge` 为什么把别人的 PR 也带进了 main？**
A：`merge` 会把 `pr` 分支当前**全部内容**合入 main，包括尚未单独 merge 的其它 PR。
单 PR 顺序合并没有问题；多协作者并发提交的语义待定（`docs/TECH_DEBT.md` TD-8）。

**Q：approve 之后还需要额外 merge 一次 pr 分支吗？**
A：不需要。`pr.py merge` 会先合 PR，再自动创建/复用 `pr → main` 的 PR 并 admin 合并。

## 7. 配置（status 分支 `config.ini`）

- 优先级：`[global]` 的 `<key>.force = true` > `[<user>]` > `[global]` > 内置默认
- `ban` / `warn` 只写在 `[<user>]`；`ban` 由 Actions 侧强制
- 常用项：`auto-check`（命令前自检）、`auto-force`（只补低风险）、`twice-check-num`、
  `twice-check-timeout`、`lock-issue-timeout`、`system-paths`、`public-branches`
- 查看：`python pr.py config <key>`；修改：`python pr.py config <key> <value> [--scope global]`

## 8. 目录

```
pr.py                 入口
prlib/core/           纯函数状态机与规则（零 IO）
prlib/infra/          git / gh / status / Actions 适配
prlib/cli/            参数、输出、退出码、命令
prlib/ops/server.py   Actions 侧唯一写 status 的实现
.github/workflows/    pr-ops / dev-scan / main-notify / build
docs/TECH_DEBT.md     已知技术债
```

## 9. 实战用例与历史错误（M4/M5）

### 9.1 merge：一步合入 main

`pr.py merge <PR>` 做三件事：

1. 若 PR 未合并，先合入它的 base（通常是 `pr` 分支）
2. 自动创建/复用 `pr → main` 的 PR，并用 admin 合并（对应"owner 手动 merge"）
3. 把 PR 涉及文件置为 `pushed`，并记录 merge commit 到 `latest.json`

> ⚠️ 会把 `pr` 分支当前全部内容合入 main，包括尚未单独 merge 的其它 PR。
> 单 PR 顺序合并没有问题；并发语义见 `docs/TECH_DEBT.md` TD-8。

### 9.2 `--cancel`：恢复"僵尸 waiting"

场景：PR 已在网页或别处关闭，但 status 仍是 `waiting`，文件无法再次 open。

```bash
git switch <你的 dev 分支>
python pr.py pr --cancel
```

文件回到 `committed`，之后可重新 `pr.py pr` 创建新 PR。

### 9.3 release：draft → build → publish

```bash
python pr.py release v10.1.7 --dry-run          # 只看计划
python pr.py release v10.1.7 --stop-after-draft # 只到 draft + build，不发布
python pr.py release v10.1.7                    # 全流程
```

流程：创建 draft Release → 触发 `build.yml`（html/exe/apk/ipa/dmg 并行）→ 等待成功 →
draft 转正 → `op=release` 写 `status/version.json`。
IPA 只进 artifact（§27，需协作者签名后手动上传），其余四个附件进 Release。

### 9.4 历史错误记录（均已修复）

| 现象 | 原因 | 修复 |
|---|---|---|
| `create` 后 `git switch dev/x` 失败 | 只写 status，没建本地分支 | create 成功后 `git switch -c` |
| `commit` 成功但远端没有提交 | 只写 status，没执行 add/commit/push | 真正 add → commit → push，并记录 SHA |
| `merge` 后 main 没有任何变化 | 只合入 base=`pr`，未提升到 main | 自动 `pr→main` + 状态置 `pushed` |

## 10. 上手须知（交付前必读）

1. **`pr` 分支没有保护**：仓库目前只有 `main-protection`（main）与 `status-protection`（status）
   两个规则集，`pr` 分支不受规则集约束。请勿直接 `git push origin pr`，所有改动一律走
   `dev/* → pr` 的 PR（`pr.py pr`）。
2. **`merge` 会把 `pr` 分支当前全部内容合入 main**：`pr.py merge A` 时，`pr` 上尚未单独
   merge 的 B、C（`waiting` 状态）也会一并进入 main。多人并行开发时先协调合并顺序。
3. **`--dry-run` 不等于有权限**：dry-run 跳过 owner 校验（`merge` / `release` 在 dry-run 下直接放行），
   真实执行时才检查仓库所有者身份。

> M5.1 给 `pr` 分支补规则集后，第 1、2 条的行为会变化，届时同步更新本文档。
