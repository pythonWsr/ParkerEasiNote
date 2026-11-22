#!/usr/bin/env bash
# 无 Gradle 的极简 APK 构建：aapt2 → javac → d8 → zip → zipalign → apksigner
# 依赖：Android SDK（ANDROID_HOME）、JDK
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
OUT="$HERE/out"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
    echo "[apk] 找不到 Android SDK（ANDROID_HOME/ANDROID_SDK_ROOT）" >&2
    exit 1
fi

BT=$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)
PLATFORM=$(ls -d "$SDK"/platforms/android-* 2>/dev/null | sort -V | tail -1)
JAR="$PLATFORM/android.jar"
[ -f "$JAR" ] || { echo "[apk] 找不到 android.jar: $JAR" >&2; exit 1; }

echo "[apk] build-tools: $BT"
echo "[apk] platform:    $PLATFORM"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/assets"

# 1) 资源
"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/resources.zip"
"$BT/aapt2" link -o "$OUT/base.apk" \
    -I "$JAR" \
    --manifest "$HERE/AndroidManifest.xml" \
    -R "$OUT/resources.zip" \
    --java "$OUT/gen" \
    --min-sdk-version 21 --target-sdk-version 34

# 2) Java → class
find "$HERE/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -source 8 -target 8 -nowarn -encoding UTF-8 \
      -bootclasspath "$JAR" \
      -d "$OUT/classes" @"$OUT/sources.txt"

# 3) class → dex
find "$OUT/classes" -name '*.class' > "$OUT/classlist.txt"
"$BT/d8" --lib "$JAR" --min-api 21 --release --output "$OUT/dex" @"$OUT/classlist.txt"

# 4) 组装：资源 APK + classes.dex + assets/www（多文件页面，原样打包 web/）
cp "$OUT/base.apk" "$OUT/app.apk"
mkdir -p "$OUT/assets/www"
cp -R "$REPO/web/." "$OUT/assets/www/"
cp "$OUT/dex/classes.dex" "$OUT/classes.dex"
( cd "$OUT" && zip -q -r app.apk classes.dex assets )

# 5) 对齐 + 签名（调试密钥，仅用于测试安装）
( cd "$OUT" && "$BT/zipalign" -f 4 app.apk aligned.apk )

# 固定签名：证书必须与历史版本一致，否则无法覆盖安装。
# 说明：这是公开的调试密钥（密码 easinote），仅用于侧载分发；
# 若以后要上架或做正式签名，改用 GitHub Secrets 注入正式 keystore。
KEYSTORE="$HERE/easinote-debug.jks"
[ -f "$KEYSTORE" ] || { echo "[apk] 缺少固定签名文件: $KEYSTORE" >&2; exit 1; }
# 显式开启 v1/v2/v3：Android 11+ 对 targetSdk>=30 强制要求 v2，
# 明确写出来避免不同 build-tools 的默认值差异导致"部分设备装不上"。
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias easinote \
    --ks-pass pass:easinote --key-pass pass:easinote \
    --min-sdk-version 21 \
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
    --out "$OUT/EasiNote.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --verbose "$OUT/EasiNote.apk" | sed -n '1,12p'
echo "[apk] --- 权限 ---"
"$BT/aapt2" dump badging "$OUT/EasiNote.apk" | grep '^uses-permission' || true
echo "[apk] --- 签名证书 SHA-256（应与历史版本一致）---"
"$BT/apksigner" verify --print-certs "$OUT/EasiNote.apk" | grep -i "SHA-256" || true

ls -l "$OUT/EasiNote.apk"
