# verify-build（test 分支专用）

把人机验证页面 `payload/verify.html` 打成**单个 Windows EXE**：Win32 + WebView2，
不打包浏览器内核，产物只有几百 KB（Electron 方案是 67 MB）。

> 本目录只存在于 `test` 分支，不合并进 `main`。

## 结构

```
verify-build/
├─ payload/verify.html     原始页面（唯一需要替换的文件）
├─ src/main.cpp            Win32 主程序：解密 + NavigateToString + 加固
├─ scripts/encrypt.js      构建期加密，产出 src/payload_data.h（不入库）
├─ .gitattributes          禁止 CRLF 转换，保证构建可复现
└─ .gitignore              dist/、*.obj、src/payload_data.h
.github/workflows/build-verify-exe.yml
```

## 构建

推送 `test` 分支（改动 `verify-build/**`）即触发 GitHub Actions，在
`windows-latest` 上：

1. 从 NuGet 拉 WebView2 SDK（`Microsoft.Web.WebView2`）
2. `node scripts/encrypt.js` 把页面加密成 C 数组头文件
3. `cl` 编译链接，产出 `verify-build/dist/VerifyDemo.exe`
4. 自检：体积 ≤ 3 MB、二进制中无可读页面内容
5. 上传 artifact `verify-exe`

本地（Windows + VS 2022 开发者命令行）等价命令：

```bat
node scripts/encrypt.js
cl /nologo /std:c++17 /EHsc /O1 /Os /MT /DUNICODE /D_UNICODE ^
   /I "<wv2>\build\native\include" src\main.cpp ^
   /link /SUBSYSTEM:WINDOWS /OUT:dist\VerifyDemo.exe ^
   user32.lib gdi32.lib ole32.lib oleaut32.lib bcrypt.lib ^
   "<wv2>\build\native\x64\WebView2LoaderStatic.lib"
```

## 加密方案

```
key  = PBKDF2-HMAC-SHA256("easinote", "ps.verify.2026", 100000, 32)
data = AES-256-CBC(key, IV16, PKCS#7)
```

- 构建期由 `scripts/encrypt.js` 生成 `src/payload_data.h`（IV + 密文字节数组）；
- 运行时由 `src/main.cpp` 用 CNG（`bcrypt.lib`）解密为 UTF-8 字符串，
  经 `MultiByteToWideChar` 转 UTF-16 后 `NavigateToString` 装载；
- 明文只存在于进程内存，磁盘上没有 `.html` 文件。

改口令需要同时改 `scripts/encrypt.js` 与 `src/main.cpp` 的 `PASS/SALT/ITER`。

## 加固

| 手段 | API |
|---|---|
| 关闭 DevTools（F12 / Ctrl+Shift+I） | `put_AreDevToolsEnabled(FALSE)` |
| 关闭浏览器快捷键（Ctrl+U / Ctrl+S / Ctrl+P 等） | `put_AreBrowserAcceleratorKeysEnabled(FALSE)`（Settings3） |
| 关闭右键菜单 | `put_AreDefaultContextMenusEnabled(FALSE)` |
| 关闭状态栏 / 缩放控件 | `put_IsStatusBarEnabled` / `put_IsZoomControlEnabled` |
| 禁止 `window.open` | `NewWindowRequested` → `put_Handled(TRUE)` |

## 运行依赖

需要系统自带的 **Microsoft Edge WebView2 Runtime**：

- Windows 11 默认预装；
- Windows 10 一般随 Edge 一起安装，缺失时程序会弹窗提示下载地址
  `https://go.microsoft.com/fwlink/p/?LinkId=2124703`。

这也是体积能压到几百 KB 的原因：浏览器内核用系统的，不打进 exe。

## 能挡住什么 / 挡不住什么

提高门槛，不是保密方案：

- 挡得住：右键「查看源代码」、F12、在安装目录里翻明文 html；
- 挡不住：调试器 attach、内存 dump、从二进制里逆出密钥再解密。

要真正保密，得把关键逻辑放到服务端。
