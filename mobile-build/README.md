# mobile-build（test 分支专用）

把 `web/` **多文件目录**直接打成 **Android APK** 与 **iOS IPA**（macOS 的 DMG 在
`desktop-build/macos/`、Windows 的 exe 在 `verify-build/`），同样走轻量化路线：
不用 AndroidX、不用 CocoaPods、不引第三方框架，只保留系统 WebView。

打包方式：整个 `web/` 目录原样放进壳里（APK 的 `assets/www/`、IPA 的
`EasiNote.app/www/`、DMG 的 `Contents/Resources/www/`、EXE 的加密容器），
不再先生成单文件 HTML。单文件 HTML 只作为独立的可选产物（`build-html.yml`）。

| 产物 | 壳 | 构建机 | 说明 |
|---|---|---|---|
| `EasiNote.apk` | Android `WebView` | ubuntu-latest | 包名 `com.ParkerEasiNote`，调试密钥签名，可侧载安装 |
| `EasiNote.ipa` | iOS `WKWebView` | macos-latest | **未签名**，安装前需自行重签 |
| `EasiNote.dmg` | macOS `WKWebView` | macos-latest | **未签名**，首次打开需在「隐私与安全性」放行 |

对应工作流：`.github/workflows/build-html.yml`、`build-apk.yml`、`build-ipa.yml`、
`build-dmg.yml`；Windows exe 见 `build-verify-exe.yml`。各工作流只上传 artifact，
**不创建 tag / release**；体积只记录不设硬门槛。

## Android：不用 Gradle

`aapt2 → javac → d8 → zip → zipalign → apksigner` 全手工，避免 AGP 拉几百 MB 依赖：

```bash
bash mobile-build/android/build.sh
# 产物：mobile-build/android/out/EasiNote.apk
```

- 清单 `minSdk 21 / targetSdk 34`，包名 `com.ParkerEasiNote`，`INTERNET` 权限
- 页面打进 `assets/index.html`，启动时 `file:///android_asset/index.html`
- 开启 `setDomStorageEnabled(true)`，否则 `localStorage` 不可用
- 签名用构建时生成的调试 keystore（口令 `android`），仅用于测试安装

体积参考：10.1.7 的单文件页面约 10 MB，APK 压缩后约 4 MB 量级；CI 只打印体积，
不再设 3 MB 硬门槛。

## iOS：不签名

`clang` 直接编译 ObjC 壳，手工组装 `.app`，再 zip 成 `.ipa`：

```bash
bash mobile-build/ios/build.sh
# 产物：mobile-build/ios/build/EasiNote.ipa
```

- arm64，最低 iOS 12
- `Payload/EasiNote.app/` 内含 `EasiNote`（可执行）、`Info.plist`、`index.html`
- **无代码签名**：真机安装前需要用自有证书重签（`codesign` + `ldid`/`altool` 等方式）
- 未提供 App 图标资源（需要 Asset Catalog），当前为系统默认图标

## 体积

两边都只打包系统 WebView 壳；页面本体是 10.1.7 的完全离线单文件（约 10 MB），
APK/IPA 压缩后约 3–4 MB 量级。CI 只记录体积，不再设硬门槛。

## 限制

- 两个壳都是最小实现：没有下载管理器、没有文件选择器的额外适配，
  导出/导入行为取决于系统 WebView 的默认实现。
- 页面里的 AI 功能需要联网与 API Key，移动端未做额外加固。
- 单文件版里 `vendor/faceapi/model` 无法内联，人脸选人功能会优雅降级。
