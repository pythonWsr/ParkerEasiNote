# mobile-build（test 分支专用）

把 `快捷白板10.html` 打成 **Android APK** 与 **iOS IPA**，同样走轻量化路线：
不用 AndroidX、不用 CocoaPods、不引第三方框架，只保留系统 WebView。

| 产物 | 壳 | 构建机 | 说明 |
|---|---|---|---|
| `EasiNote.apk` | Android `WebView` | ubuntu-latest | 调试密钥签名，可侧载安装 |
| `EasiNote.ipa` | iOS `WKWebView` | macos-latest | **未签名**，安装前需自行重签 |

对应工作流：`.github/workflows/build-apk.yml`、`.github/workflows/build-ipa.yml`。

## Android：不用 Gradle

`aapt2 → javac → d8 → zip → zipalign → apksigner` 全手工，避免 AGP 拉几百 MB 依赖：

```bash
bash mobile-build/android/build.sh
# 产物：mobile-build/android/out/EasiNote.apk
```

- 清单 `minSdk 21 / targetSdk 34`，`INTERNET` 权限（CDN 与在线功能需要）
- 页面打进 `assets/index.html`，启动时 `file:///android_asset/index.html`
- 开启 `setDomStorageEnabled(true)`，否则 `localStorage` 不可用
- 图标由 `快捷白板10.ico` 生成 5 个密度（48/72/96/144/192）
- 签名用构建时生成的调试 keystore（口令 `android`），仅用于测试安装

体积参考：图标约 15 KB + dex 约 10 KB + 页面压缩后约 90 KB。

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

两边都只打包系统 WebView 壳，页面本体压缩后仅几十 KB，产物都在几百 KB 量级；
CI 里设了 ≤ 3 MB 的门槛。

## 限制

- 两个壳都是最小实现：没有下载管理器、没有文件选择器的额外适配，
  导出/导入行为取决于系统 WebView 的默认实现。
- 页面里的 AI 功能需要联网与 API Key，移动端未做额外加固。
