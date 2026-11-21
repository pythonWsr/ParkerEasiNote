#!/usr/bin/env python3
# Copyright (c) 2026 pythonWsr. All rights reserved.
# SPDX-License-Identifier: LicenseRef-Proprietary
"""把 web/ 下的多文件应用打包成一个完全离线的单文件 HTML。

输入：web/index.html + css/ + js/ + vendor/ + data/ + assets/
输出：一个可直接双击打开、断网可用的 .html

做四件事：
1. <link rel="stylesheet"> 内联成 <style>，并把 @font-face 的 url() 转成 data URI
2. <script src> 内联成 <script>，其中 data/hanzi.js、data/poems.js 提前注入，
   使运行时的懒加载直接命中全局变量
3. PDF.js 的 worker 源码转 base64 → Blob URL，替换 workerSrc
4. 图片/头像路径转 data URI；把启动自检里已内联的文件探针改为「已知存在」

用法：
    python3 tools/bundle_html.py                     # 输出到 快捷白板10.html
    python3 tools/bundle_html.py --out /tmp/a.html
    python3 tools/bundle_html.py --drop-ttf          # 只保留 woff2，省约 0.7MB
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import re
import sys
from pathlib import Path

MIME = {
    ".css": "text/css;charset=utf-8",
    ".js": "text/javascript;charset=utf-8",
    ".json": "application/json;charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".bin": "application/octet-stream",
}

# 启动自检里会探测的文件；单文件版里都已经内联，直接视为存在
PROBE_FIXES = [
    ("probe('data/hanzi.js')", "Promise.resolve(null)"),
    ("probe('data/poems.js')", "Promise.resolve(null)"),
    ("probe('vendor/faceapi/face-api.min.js')", "Promise.resolve(null)"),
    ("probe('vendor/faceapi/model/tiny_face_detector_model.bin')", "Promise.resolve(null)"),
    ("probe('vendor/pdf.worker.min.js')", "Promise.resolve(null)"),
    ("probe('assets/fonts/PatrickHand.ttf')", "Promise.resolve(null)"),
    ("probeImage('assets/img/logo.png')", "Promise.resolve(true)"),
]

PDF_WORKER_LITERAL = '"vendor/pdf.worker.min.js"'


def data_uri(path: Path) -> str:
    mime = MIME.get(path.suffix.lower(), "application/octet-stream")
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return "data:%s;base64,%s" % (mime, b64)


def escape_inline(text: str) -> str:
    """避免内联脚本/样式提前闭合标签。"""
    return text.replace("</script", "<\\/script").replace("</style", "<\\/style")


def rewrite_css_urls(css: str, css_path: Path, root: Path, drop_ttf: bool) -> str:
    def exists(ref: str) -> bool:
        if ref.startswith(("data:", "http://", "https://", "//", "#")):
            return True
        return (css_path.parent / ref).resolve().is_file()

    if drop_ttf:
        # 只保留 woff2：在 url() 转 data URI 之前先摘掉 truetype 回退源
        css = re.sub(r",\s*url\([^)]*\.ttf[^)]*\)\s*format\(['\"]truetype['\"]\)", "", css)

    # 先摘掉整条「源文件不存在」的字体条目（FontAwesome 的 v4 兼容字体未随包发布），
    # 否则整条 src 列表里会留下指向空文件的 url()
    css = re.sub(
        r",\s*url\(\s*(['\"]?)([^'\")]+)\1\s*\)\s*format\([^)]*\)",
        lambda m: m.group(0) if exists(m.group(2).strip()) else "",
        css,
    )

    def repl(m: re.Match) -> str:
        quote = m.group(1) or ""
        ref = m.group(2).strip()
        if ref.startswith(("data:", "http://", "https://", "//")):
            return m.group(0)
        target = (css_path.parent / ref).resolve()
        if not target.is_file():
            print("[warn] CSS 引用的文件不存在，已丢弃：%s（来自 %s）" % (ref, css_path.name), file=sys.stderr)
            return ""
        return "url(%s%s%s)" % (quote, data_uri(target), quote)

    css = re.sub(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)", repl, css)

    return css


def build(root: Path, drop_ttf: bool) -> str:
    index_path = root / "index.html"
    html = index_path.read_text(encoding="utf-8")

    # ---- 1) 字体/图片在 CSS 里的相对引用 ----
    def css_repl(m: re.Match) -> str:
        href = m.group(1)
        css_path = (root / href).resolve()
        css = rewrite_css_urls(css_path.read_text(encoding="utf-8"), css_path, root, drop_ttf)
        return '<style data-inlined="%s">\n%s\n</style>' % (href, escape_inline(css))

    html, n_css = re.subn(
        r'<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', css_repl, html
    )

    # ---- 2) 懒加载的数据文件提前内联（保证全局变量先就位）----
    head_marker = '<script src="js/config.js"></script>'
    if head_marker in html:
        inject = (
            '<script src="data/hanzi.js"></script>\n'
            '<script src="data/poems.js"></script>\n'
        )
        html = html.replace(head_marker, inject + head_marker)
    else:
        raise SystemExit("[error] 找不到 js/config.js 的 script 标签，无法注入数据文件")

    # ---- 3) 内联所有外链脚本 ----
    def js_repl(m: re.Match) -> str:
        src = m.group(1)
        code = (root / src).read_text(encoding="utf-8")
        return '<script data-inlined="%s">\n%s\n</script>' % (src, escape_inline(code))

    html, n_js = re.subn(r'<script\s+src="([^"]+)"\s*>\s*</script>', js_repl, html)

    # ---- 4) PDF.js worker：base64 → Blob URL ----
    worker = root / "vendor" / "pdf.worker.min.js"
    if PDF_WORKER_LITERAL in html and worker.is_file():
        # 按文本读再编码，统一 CRLF→LF，保证不同平台产出一致
        worker_src = worker.read_text(encoding="utf-8").encode("utf-8")
        worker_b64 = base64.b64encode(worker_src).decode("ascii")
        blob_script = (
            "<script>\n"
            "window.__EN10_PDF_WORKER_URL__=(function(){try{"
            'var b=atob("%s");'
            "var a=new Uint8Array(b.length);"
            "for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);"
            'return URL.createObjectURL(new Blob([a],{type:"text/javascript"}));'
            '}catch(e){return "";}})();\n'
            "</script>\n"
        ) % worker_b64
        html = html.replace(
            PDF_WORKER_LITERAL, "window.__EN10_PDF_WORKER_URL__ || " + PDF_WORKER_LITERAL
        )
        # 定义脚本放在第一个内联脚本之前即可（DOM 尚未构建也不影响）
        marker = "<script>\n/* PDF.js 的 worker"
        if marker in html:
            html = html.replace(marker, blob_script + marker, 1)
        else:
            html = html.replace("</head>", blob_script + "</head>", 1)
        print("[info] PDF worker 已转为 Blob URL（%.0f KB 源码）" % (worker.stat().st_size / 1024))
    else:
        print("[warn] 未找到 PDF worker 引用，跳过", file=sys.stderr)

    # ---- 5) 启动自检：把已内联文件的探针改成「已知存在」----
    for old, new in PROBE_FIXES:
        if old in html:
            html = html.replace(old, new)

    # ---- 6) 图片/头像等静态路径 → data URI ----
    asset_root = root / "assets"
    n_assets = 0
    for path in sorted(asset_root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if rel not in html:
            continue
        uri = data_uri(path)
        for quote in ("'", '"'):
            old = quote + rel + quote
            if old in html:
                html = html.replace(old, quote + uri + quote)
                n_assets += 1

    print(
        "[info] 内联：%d 个样式表、%d 个脚本、%d 处静态资源"
        % (n_css, n_js, n_assets)
    )

    # ---- 7) 校验：不应再残留本地相对引用 ----
    problems = []
    for m in re.finditer(r'<script[^>]*\ssrc="([^"]+)"', html):
        if not m.group(1).startswith(("data:", "http://", "https://")):
            problems.append("残留 script src: " + m.group(1))
    for m in re.finditer(r'<link[^>]*\shref="([^"]+)"', html):
        if not m.group(1).startswith(("data:", "http://", "https://")):
            problems.append("残留 link href: " + m.group(1))
    # 只检查 <style> 块里的 url()：JS 字符串里出现 url( 是正常的
    for style_block in re.findall(r"<style[^>]*>(.*?)</style>", html, re.S):
        for m in re.finditer(r"url\(\s*['\"]?([^'\")]+)", style_block):
            if not m.group(1).startswith(("data:", "http://", "https://")):
                problems.append("残留 css url: " + m.group(1))
    if problems:
        print("[error] 单文件仍有外链引用：", file=sys.stderr)
        for p in problems[:20]:
            print("  - " + p, file=sys.stderr)
        raise SystemExit(1)

    return html


def main() -> int:
    here = Path(__file__).resolve().parent
    repo = here.parent
    ap = argparse.ArgumentParser(description="把 web/ 打包成单文件 HTML")
    ap.add_argument("--root", default=str(repo / "web"), help="web 源码目录")
    ap.add_argument("--out", default=str(repo / "快捷白板10.html"), help="输出文件")
    ap.add_argument("--drop-ttf", action="store_true", help="只保留 woff2 字体")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not (root / "index.html").is_file():
        raise SystemExit("[error] 找不到 %s/index.html" % root)

    html = build(root, args.drop_ttf)

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    data = html.encode("utf-8")
    out.write_bytes(data)

    digest = hashlib.sha256(data).hexdigest()
    print("[done] %s" % out)
    print("[done] %.2f MB (%d 字节)" % (len(data) / 1024 / 1024, len(data)))
    print("[done] sha256 %s" % digest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
