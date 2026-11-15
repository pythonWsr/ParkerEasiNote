'use strict';
/*
 * 构建期脚本：把 payload/verify.html 加密成 src/payload_data.h
 *
 * 方案（与 src/main.cpp 一一对应）：
 *   key  = PBKDF2-HMAC-SHA256(pass, salt, 100000, 32)
 *   data = AES-256-CBC(key, randomIV16, PKCS#7)
 *
 * 产物是纯 C 数组，编译进 exe；明文不在磁盘上留存。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* 与 src/main.cpp 的 kPassA / kPassB / kSalt / kIter 保持一致 */
const PASS = 'easi' + 'note';
const SALT = 'ps.verify.2026';
const ITER = 100000;

const SRC = path.join(__dirname, '..', 'payload', 'verify.html');
const OUT = path.join(__dirname, '..', 'src', 'payload_data.h');

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
    if (!fs.existsSync(SRC)) {
        console.error('[encrypt] 缺少 payload: ' + SRC);
        process.exit(1);
    }
    const plain = fs.readFileSync(SRC);
    const key = crypto.pbkdf2Sync(PASS, SALT, ITER, 32, 'sha256');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);

    const header =
        '// 由 scripts/encrypt.js 生成，请勿手改。\n' +
        '#pragma once\n\n' +
        toArray('PAYLOAD_IV', iv) + '\n' +
        'static const unsigned int PAYLOAD_LEN = ' + data.length + 'u;\n\n' +
        toArray('PAYLOAD_DATA', data);

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, header, 'utf8');
    console.log('[encrypt] payload ' + plain.length + ' B → cipher ' + data.length +
        ' B → ' + path.relative(process.cwd(), OUT) +
        ' (AES-256-CBC / PBKDF2-' + ITER + ')');
}

main();
