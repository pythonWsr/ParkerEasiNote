'use strict';
/*
 * 人机验证页面 → 单文件 EXE
 *
 * 加固手段（都是提高门槛，不是绝对防护）：
 *  1. 页面以 AES-256-GCM 密文随程序分发，运行时才解密到内存，再用 data: URL 装载；
 *  2. asar 打包 + 最高压缩，源码不以明文文件形式落盘；
 *  3. 关闭 DevTools、屏蔽 F12 / Ctrl+Shift+I / Ctrl+U / Ctrl+S 等快捷键；
 *  4. 屏蔽右键菜单、禁止新窗口与站外跳转。
 *
 * 注意：客户端加密无法做到真正保密 —— 有决心的人仍可从内存或调试器取出明文。
 *      这里的方案只能挡住「右键查看源代码」和随手翻 asar 的普通用户。
 */
const { app, BrowserWindow, Menu } = require('electron');
const crypto = require('crypto');
const payload = require('./secure-payload.js');

/* 密钥分段拼接：与 scripts/encrypt.js 保持一致 */
const K1 = 'easi';
const K2 = 'note';
const K3 = '-verify-';
const K4 = 'v1';
const SALT = 'ps.verify.2026';

function decryptPayload() {
    const key = crypto.scryptSync(K1 + K2 + K3 + K4, SALT, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
    const out = Buffer.concat([
        decipher.update(Buffer.from(payload.data, 'base64')),
        decipher.final()
    ]);
    return out.toString('utf8');
}

function harden(win) {
    win.removeMenu();
    Menu.setApplicationMenu(null);

    /* 屏蔽常见「看源码 / 开控制台」快捷键 */
    win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const k = String(input.key || '').toLowerCase();
        const ctrl = !!(input.control || input.meta);
        const blocked =
            k === 'f12' ||
            (ctrl && input.shift && (k === 'i' || k === 'j' || k === 'c')) ||
            (ctrl && (k === 'u' || k === 's')) ||
            (ctrl && input.alt && k === 'i');
        if (blocked) event.preventDefault();
    });

    /* 右键菜单 */
    win.webContents.on('context-menu', (e) => e.preventDefault());

    /* 双保险：即使被打开也立刻关闭 */
    win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());

    /* 禁止 window.open 与站外跳转 */
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => {
        if (!String(url).startsWith('data:')) e.preventDefault();
    });
}

app.whenReady().then(() => {
    const win = new BrowserWindow({
        width: 1000,
        height: 760,
        minWidth: 520,
        minHeight: 480,
        backgroundColor: '#222222',
        autoHideMenuBar: true,
        show: false,
        title: '机器人验证',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            devTools: false,
            spellcheck: false,
            webSecurity: true,
            allowRunningInsecureContent: false
        }
    });

    harden(win);

    const html = decryptPayload();
    const b64 = Buffer.from(html, 'utf8').toString('base64');
    win.loadURL('data:text/html;charset=utf-8;base64,' + b64);
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => app.quit());
});

app.on('window-all-closed', () => app.quit());
