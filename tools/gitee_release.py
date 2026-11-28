#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地把 GitHub Release 产物同步到 Gitee（token 只从环境变量读取，不落盘）。

用法：
    GITEE_TOKEN=<私人令牌> python3 tools/gitee_release.py v10.2.7 [--dir out]

只上传 apk / exe / ipa / dmg 四个文件；html 单文件不进 Release。
"""

import argparse
import os
import sys
from pathlib import Path

import requests

OWNER = "pythonWsr"
REPO = "ParkerEasiNote"
API = "https://gitee.com/api/v5/repos/%s/%s" % (OWNER, REPO)
ASSETS = ("apk", "exe", "ipa", "dmg")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tag", help="如 v10.2.7")
    ap.add_argument("--dir", default="out", help="产物目录（默认 out/）")
    ap.add_argument("--notes", default="", help="Release 说明（可选）")
    a = ap.parse_args()

    token = os.environ.get("GITEE_TOKEN", "").strip()
    if not token:
        print("请先设置环境变量 GITEE_TOKEN", file=sys.stderr)
        return 2

    ver = a.tag.lstrip("v")
    files = []
    for ext in ASSETS:
        p = Path(a.dir) / ("ParkerEasiNote-%s.%s" % (ver, ext))
        if not p.exists():
            print("缺少产物：%s" % p, file=sys.stderr)
            return 2
        files.append(p)

    s = requests.Session()
    r = s.get("%s/releases/tags/%s" % (API, a.tag), params={"access_token": token}, timeout=30)
    rel = None
    if r.status_code == 200:
        try:
            rel = r.json()
        except ValueError:
            rel = None

    if not rel or "id" not in rel:
        data = {
            "access_token": token,
            "tag_name": a.tag,
            "name": "快捷白板10 %s" % ver,
            "body": a.notes or ("快捷白板10 %s" % ver),
            "target_commitish": "main",
            "prerelease": "false",
        }
        r = s.post("%s/releases" % API, data=data, timeout=120)
        if not r.ok:
            print("创建 Gitee Release 失败：HTTP %s %s" % (r.status_code, r.text[:300]),
                  file=sys.stderr)
            return 1
        rel = r.json()

    rid = rel["id"]
    existing = {x.get("name") for x in rel.get("assets") or []}
    for p in files:
        if p.name in existing:
            print("已存在，跳过 %s" % p.name)
            continue
        with p.open("rb") as fh:
            r = s.post(
                "%s/releases/%s/attach_files" % (API, rid),
                data={"access_token": token},
                files={"file": (p.name, fh, "application/octet-stream")},
                timeout=3600,
            )
        if r.status_code not in (200, 201):
            print("上传 %s 失败：HTTP %s %s" % (p.name, r.status_code, r.text[:300]),
                  file=sys.stderr)
            return 1
        print("已上传 %s" % p.name)

    print("完成：https://gitee.com/%s/%s/releases/tag/%s" % (OWNER, REPO, a.tag))
    return 0


if __name__ == "__main__":
    sys.exit(main())
