'use strict';
/*
 * 构建期脚本：把 payload/verify.html 加密成 electron/secure-payload.js
 * 产物不提交仓库（见 verify-build/.gitignore），每次构建重新生成。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* 与 electron/main.js 保持一致；改这里必须同步改 main.js */
const K1 = 'easi';
const K2 = 'note';
const K3 = '-verify-';
const K4 = 'v1';
const SALT = 'ps.verify.2026';

const SRC = path.join(__dirname, '..', 'payload', 'verify.html');
const OUT = path.join(__dirname, '..', 'electron', 'secure-payload.js');

function main() {
    if (!fs.existsSync(SRC)) {
        console.error('[encrypt] 缺少 payload: ' + SRC);
        process.exit(1);
    }
    const plain = fs.readFileSync(SRC);
    const key = crypto.scryptSync(K1 + K2 + K3 + K4, SALT, 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();

    const body = 'module.exports=' + JSON.stringify({
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: data.toString('base64')
    }) + ';\n';

    fs.writeFileSync(OUT, body, 'utf8');
    console.log('[encrypt] ' + path.relative(process.cwd(), SRC) +
        ' (' + plain.length + ' B) → ' + path.relative(process.cwd(), OUT) +
        ' (' + body.length + ' B, AES-256-GCM)');
}

main();
