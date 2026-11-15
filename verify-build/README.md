# verify-build（test 分支专用）

把 HTML 打成**单个 Windows EXE**：Win32 + WebView2，不打包浏览器内核，
产物几百 KB（Electron 方案是 67 MB）。

两个产物共用同一份宿主 `src/main.cpp`：

| 产物 | 页面 | 说明 |
|---|---|---|
| `EasiNote.exe` | 仓库根的 `快捷白板10.html` | 主程序 |
| `VerifyDemo.exe` | `payload/verify.html` | 人机验证演示页 |

> 本目录只存在于 `test` 分支，不合并进 `main`。

## 结构

```
verify-build/
├─ payload/verify.html     演示页
├─ src/main.cpp            宿主：解密 + 内存服务页面 + 加固 + DPI
├─ scripts/encrypt.js      构建期加密（支持 verify / easinote 预设）
├─ res/app.ico             应用图标（现用 快捷白板10.ico）
├─ res/app.manifest        PerMonitorV2 DPI 感知 + asInvoker
├─ app.rc                  图标与清单资源
├─ build.bat               一键构建：加密 → rc → cl
└─ .gitattributes          禁止 CRLF 转换，保证构建可复现
```

## 构建

```bat
build.bat verify  VerifyDemo.exe
build.bat easinote EasiNote.exe
```

CI（`.github/workflows/build-verify-exe.yml`）在 `windows-latest` 上：

1. NuGet 拉 WebView2 SDK
2. `node scripts/encrypt.js <预设>` 生成 `src/payload_data.h`
3. `rc` 编译图标 + 清单，`cl` 编译链接
4. 自检：体积 ≤ 5 MB、二进制无可读页面内容、UTF-16 中文串存在
5. 用 `--selftest` 在真实二进制里跑一遍解密，校验退出码
6. 上传 `verify-exe` / `easinote-exe` 两个 artifact

## 页面装载方式

不写临时文件、也不用 `NavigateToString`（那是不透明源，`localStorage` 会抛异常）。
宿主拦截 `https://app.easinote.local/*` 的请求，`/` 与 `/index.html` 从内存返回解密后的
HTML，其余路径一律 404（不触网）。这样页面运行在正常的 https 源上，
`localStorage` / `IndexedDB` / 全屏 / 下载都能用。

## 加密方案

```
key  = PBKDF2-HMAC-SHA256("easinote", "ps.verify.2026", 100000, 32)
data = AES-256-CBC(key, IV16, PKCS#7)
```

- 构建期生成 `src/payload_data.h`（IV + 密文字节数组），直接编进 exe；
- 运行时 CNG（`bcrypt.lib`）解密为 UTF-8 字符串，仅存于进程内存；
- 改口令需同时改 `scripts/encrypt.js` 与 `src/main.cpp`。

## 加固

| 手段 | API |
|---|---|
| 关闭 DevTools | `put_AreDevToolsEnabled(FALSE)` |
| 关闭浏览器快捷键 | `put_AreBrowserAcceleratorKeysEnabled(FALSE)`（Settings3） |
| 关闭右键菜单 | `put_AreDefaultContextMenusEnabled(FALSE)` |
| 关闭状态栏 / 缩放控件 | `put_IsStatusBarEnabled` / `put_IsZoomControlEnabled` |
| 站外链接 | `NavigationStarting` 取消并交给系统浏览器 |
| `window.open` | `NewWindowRequested` 取消并交给系统浏览器 |
| 下载/导出 | `DownloadStarting` 落到 `%USERPROFILE%\Downloads` |
| 放映全屏 | `ContainsFullScreenElementChanged` 同步窗口全屏 |

## 高分屏模糊的修复

之前 exe 没有 DPI 感知声明，Windows 在 125%/150% 缩放下会对整窗做**位图拉伸**，
所以字发虚。现在：

- `res/app.manifest` 声明 `dpiAware=true/pm` + `dpiAwareness=PerMonitorV2`；
- 启动时再动态调用一次 `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` 兜底；
- 处理 `WM_DPICHANGED`，跨屏拖动时按系统建议矩形重排。

## 运行依赖

需要系统自带的 **Microsoft Edge WebView2 Runtime**（Win11 预装，Win10 一般随 Edge 安装），
缺失时程序会弹窗给出下载地址。这也是体积能压到几百 KB 的原因。

## 能挡住什么 / 挡不住什么

提高门槛，不是保密方案：挡得住右键看源码、F12、翻安装目录；挡不住调试器 attach
与内存 dump。要真正保密得把关键逻辑放服务端。
