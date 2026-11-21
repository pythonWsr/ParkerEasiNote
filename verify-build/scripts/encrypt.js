'use strict';
/*
 * 构建期脚本：把 web/ 目录打包成自描述容器，再加密成 src/payload_data.h
 * （纯 C 字节数组，编译进 exe）。
 *
 * 容器格式（明文，与 src/main.cpp 的 ParseContainer 一一对应）：
 *   EN10WEB/1\n
 *   <文件数>\n
 *   <mime>\t<size>\t<相对路径>\n        × 文件数
 *   \n
 *   <各文件字节，按上面的顺序依次拼接>
 *
 * 加密方案（与 src/main.cpp 一一对应）：
 *   key  = PBKDF2-HMAC-SHA256(pass, salt, 100000, 32)
 *   data = AES-256-CBC(key, randomIV16, PKCS#7)
 *
 * 用法：
 *   node scripts/encrypt.js                 # 默认：打包 ../web
 *   node scripts/encrypt.js easinote        # 同上（build.bat 用的预设名）
 *   node scripts/encrypt.js verify          # 旧的人机验证页（单文件）
 *   node scripts/encrypt.js <源文件或目录> [输出头文件]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* 与 src/main.cpp 的 kPassA / kPassB / kSalt / kIter 保持一致 */
const PASS = 'easi' + 'note';
const SALT = 'ps.verify.2026';
const ITER = 100000;

const ROOT = path.join(__dirname, '..');
const WEB_DIR = path.join(ROOT, '..', 'web');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.bin': 'application/octet-stream',
    '.pdf': 'application/pdf',
    '.wasm': 'application/wasm',
};

function mimeOf(file) {
    return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function walk(dir) {
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) out.push(...walk(full));
        else out.push(full);
    }
    return out;
}

/* 把一个目录或单个文件打包成容器 Buffer */
function buildContainer(srcPath) {
    let files;
    if (fs.statSync(srcPath).isDirectory()) {
        files = walk(srcPath).map((full) => ({
            path: path.relative(srcPath, full).split(path.sep).join('/'),
            mime: mimeOf(full),
            data: fs.readFileSync(full),
        }));
    } else {
        files = [{ path: 'index.html', mime: mimeOf(srcPath), data: fs.readFileSync(srcPath) }];
    }

    let head = 'EN10WEB/1\n' + files.length + '\n';
    for (const f of files) head += f.mime + '\t' + f.data.length + '\t' + f.path + '\n';
    head += '\n';

    const parts = [Buffer.from(head, 'utf8')];
    for (const f of files) parts.push(f.data);
    return { buf: Buffer.concat(parts), count: files.length };
}

/* 输出成 C 头文件（保持与旧版格式一致：PAYLOAD_IV / PAYLOAD_LEN / PAYLOAD_DATA） */
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
    const arg = process.argv[2] || 'web';
    let srcPath;
    if (arg === 'web' || arg === 'easinote') srcPath = WEB_DIR;
    else if (arg === 'verify') srcPath = path.join(ROOT, 'payload', 'verify.html');
    else srcPath = path.resolve(arg);

    const outPath = process.argv[3]
        ? path.resolve(process.argv[3])
        : path.join(ROOT, 'src', 'payload_data.h');

    if (!fs.existsSync(srcPath)) {
        console.error('[encrypt] 找不到源路径: ' + srcPath);
        process.exit(1);
    }

    const built = buildContainer(srcPath);
    const plain = built.buf;

    const key = crypto.pbkdf2Sync(PASS, SALT, ITER, 32, 'sha256');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);

    const header =
        '// 由 scripts/encrypt.js 生成，请勿手改。\n' +
        '// source: ' + path.basename(srcPath) + '（' + built.count + ' 个文件）\n' +
        '#pragma once\n\n' +
        toArray('PAYLOAD_IV', iv) + '\n' +
        'static const unsigned int PAYLOAD_LEN = ' + data.length + 'u;\n\n' +
        toArray('PAYLOAD_DATA', data);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, header, 'utf8');
    console.log('[encrypt] ' + path.basename(srcPath) + ': ' + built.count + ' 个文件，' +
        plain.length + ' B 明文 → ' + data.length + ' B 密文 → ' +
        path.relative(process.cwd(), outPath) + ' (AES-256-CBC / PBKDF2-' + ITER + ')');
}

main();
