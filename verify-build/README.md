# verify-build（test 分支专用）

把人机验证页面 `payload/verify.html` 打成**单个 Windows EXE**，并做了源码加密与
「禁止右键查看源码 / 打开开发者工具」的加固。

> 本目录只存在于 `test` 分支，不合并进 `main`。

## 结构

```
verify-build/
├─ payload/verify.html        原始页面（唯一需要替换的文件）
├─ electron/main.js           主进程：解密 + 装载 + 加固
├─ scripts/encrypt.js         构建期加密脚本
└─ package.json               electron-builder 配置
.github/workflows/build-verify-exe.yml   CI 工作流
```

## 构建

推送 `test` 分支（改动 `verify-build/**` 时）会触发 GitHub Actions，
在 `windows-latest` 上产出 `VerifyDemo-0.1.0.exe`，作为 artifact `verify-exe` 上传。

本地构建（Windows / 装有 wine 的环境）：

```bash
cd verify-build
npm install
npm run dist        # = node scripts/encrypt.js && electron-builder --win portable
```

产物：`verify-build/dist/VerifyDemo-0.1.0.exe`（portable，免安装）。

## 加固内容

| 手段 | 说明 |
|---|---|
| AES-256-GCM 加密 | `payload/verify.html` 构建时加密为 `electron/secure-payload.js`，运行时解密到内存，用 `data:` URL 装载，磁盘上没有明文页面 |
| asar + 最高压缩 | 源代码不以明文文件形式落盘 |
| 关闭 DevTools | `webPreferences.devTools = false`，并通过 `devtools-opened` 兜底强制关闭 |
| 快捷键屏蔽 | F12、Ctrl+Shift+I/J/C、Ctrl+U、Ctrl+S、Ctrl+Alt+I |
| 右键屏蔽 | `context-menu` 事件 `preventDefault()`，页面内也监听一次 |
| 跳转限制 | 禁止 `window.open` 与站外导航 |

## 能挡住什么 / 挡不住什么

这是**提高门槛**，不是保密方案：

- 挡得住：普通用户右键「查看源代码」、按 F12、扒 asar 里的明文文件；
- 挡不住：有决心的人用调试器 attach、抓内存、或直接解 IDE 里的密文
  （密钥必须随程序分发，否则程序自己解不开）。

如果需要真正的保护，得把关键逻辑放到服务端，或用商业壳/加壳工具。

## 换页面

直接替换 `payload/verify.html` 即可，其余不用改；密钥改动需同时改
`scripts/encrypt.js` 与 `electron/main.js` 里的 `K1..K4` / `SALT`。
