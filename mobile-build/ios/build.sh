#!/usr/bin/env bash
# 未签名 .ipa 构建：clang 直接编译 ObjC 壳 → 手工组装 .app → 打成 ipa
# 需要 macOS + Xcode（xcrun / iPhoneOS SDK）
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
BUILD="$HERE/build"
APP="$BUILD/EasiNote.app"

SDK=$(xcrun --sdk iphoneos --show-sdk-path)
echo "[ipa] SDK: $SDK"

rm -rf "$BUILD"
mkdir -p "$APP"

# 1) 编译可执行文件（arm64，iOS 12+）
xcrun --sdk iphoneos clang \
    -arch arm64 \
    -mios-version-min=12.0 \
    -isysroot "$SDK" \
    -fobjc-arc \
    -O2 \
    -framework UIKit -framework WebKit \
    -o "$APP/EasiNote" \
    "$HERE/main.m"

# 去符号，减小体积
xcrun --sdk iphoneos strip -x "$APP/EasiNote" || true

# 2) 组装 .app
cp "$HERE/Info.plist" "$APP/Info.plist"
mkdir -p "$APP/www"
cp -R "$REPO/web/." "$APP/www/"
printf 'APPL????' > "$APP/PkgInfo"

# 2.1) 图标：从 1024 母版生成 iOS 需要的各尺寸（否则侧载后是白图标）
ICON_SRC="$HERE/AppIcon-1024.png"
if [ -f "$ICON_SRC" ]; then
    gen_icon() {
        sips -z "$2" "$2" "$ICON_SRC" --out "$APP/$1" >/dev/null
    }
    gen_icon "AppIcon60x60@2x.png" 120
    gen_icon "AppIcon60x60@3x.png" 180
    gen_icon "AppIcon40x40@2x.png" 80
    gen_icon "AppIcon40x40@3x.png" 120
    gen_icon "AppIcon29x29@2x.png" 58
    gen_icon "AppIcon29x29@3x.png" 87
    gen_icon "AppIcon76x76@2x.png" 152
    gen_icon "AppIcon83.5x83.5@2x.png" 167
    cp "$ICON_SRC" "$APP/AppIcon1024x1024.png"
    echo "[ipa] 图标已生成：$(ls "$APP"/AppIcon*.png | wc -l) 个"
else
    echo "[ipa] 警告：缺少 mobile-build/ios/AppIcon-1024.png，将使用白图标" >&2
fi

# 3) 打包成 ipa（未签名，安装前需自行重签）
mkdir -p "$BUILD/Payload"
cp -R "$APP" "$BUILD/Payload/"
( cd "$BUILD" && zip -qry EasiNote.ipa Payload )

ls -l "$BUILD/EasiNote.ipa"
