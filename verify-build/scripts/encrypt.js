'use strict';
/*
 * 构建期脚本：把页面加密成 src/payload_data.h（纯 C 字节数组，编译进 exe）
 *
 * 方案（与 src/main.cpp 一一对应）：
 *   key  = PBKDF2-HMAC-SHA256(pass, salt, 100000, 32)
 *   data = AES-256-CBC(key, randomIV16, PKCS#7)
 *
 * 用法：
 *   node scripts/encrypt.js                # 默认：payload/verify.html
 *   node scripts/encrypt.js verify         # 人机验证演示页
 *   node scripts/encrypt.js easinote       # 仓库根的 快捷白板10.html
 *   node scripts/encrypt.js <源文件> [输出头文件]
 *
 * 用预设名而不是直接传中文路径，避免 cmd.exe 传参的编码问题。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* 与 src/main.cpp 的 kPassA / kPassB / kSalt / kIter 保持一致 */
const PASS = 'easi' + 'note';
const SALT = 'ps.verify.2026';
const ITER = 100000;

const ROOT = path.join(__dirname, '..');
const PRESETS = {
    verify: path.join(ROOT, 'payload', 'verify.html'),
    easinote: path.join(ROOT, '..', '快捷白板10.html')
};

function toArray(name, buf) {
    const lines = [];
    for (let i = 0; i < buf.length; i += 16) {
        const chunk = [];
        for (let j = i; j < Math.min(i + 16, buf.length); j++) {
            chunk.push('0x' + buf[j].toString(16).padStart(2, '0'));
        }
        lines.push('    ' + chunk.join(', '));
    }
    return 'static const unsigned char ' + name + '[] = {\n' + lines.join(',\n') + '\n};\n';
}

function main() {
    const arg = process.argv[2];
    const srcPath = !arg ? PRESETS.verify
        : (PRESETS[arg] ? PRESETS[arg] : path.resolve(arg));
    const outPath = process.argv[3]
        ? path.resolve(process.argv[3])
        : path.join(ROOT, 'src', 'payload_data.h');

    if (!fs.existsSync(srcPath)) {
        console.error('[encrypt] 找不到源文件: ' + srcPath);
        process.exit(1);
    }
    const plain = fs.readFileSync(srcPath);
    const key = crypto.pbkdf2Sync(PASS, SALT, ITER, 32, 'sha256');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);

    const header =
        '// 由 scripts/encrypt.js 生成，请勿手改。\n' +
        '// source: ' + path.basename(srcPath) + '\n' +
        '#pragma once\n\n' +
        toArray('PAYLOAD_IV', iv) + '\n' +
        'static const unsigned int PAYLOAD_LEN = ' + data.length + 'u;\n\n' +
        toArray('PAYLOAD_DATA', data);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, header, 'utf8');
    console.log('[encrypt] ' + path.basename(srcPath) + ': ' + plain.length +
        ' B → ' + data.length + ' B 密文 → ' + path.relative(process.cwd(), outPath) +
        ' (AES-256-CBC / PBKDF2-' + ITER + ')');
}

main();
