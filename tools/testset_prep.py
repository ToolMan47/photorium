#!/usr/bin/env python3
"""
Photorium 測試照片集：把標註過的照片轉成分析用的快取。

用法（在專案資料夾執行）：
  python3 tools/testset_prep.py [照片資料夾] [labels.csv] [快取資料夾]

預設：照片資料夾 = test-photos、labels.csv = testset/labels.csv、快取 = testset/cache

- 支援 JPG、PNG、HEIC（HEIC 透過系統的 libheif 解碼，見 tools/heic2jpg.py）
- 每張照片縮到長邊 640 px、依 EXIF 轉正，存成 <檔名>.rgba（8 bytes 寬高＋RGBA 像素）
- labels.csv 裡列出但找不到的照片會列出來；已經轉過的會略過
"""
import csv, os, struct, sys
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def load(path):
    if path.lower().endswith((".heic", ".heif")):
        from heic2jpg import decode  # 需要系統有 libheif
        return decode(path)
    im = Image.open(path)
    return ImageOps.exif_transpose(im)


def main():
    root = os.path.dirname(HERE)
    photos = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "test-photos")
    labels = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "testset", "labels.csv")
    cache = sys.argv[3] if len(sys.argv) > 3 else os.path.join(root, "testset", "cache")
    os.makedirs(cache, exist_ok=True)

    with open(labels, encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if r.get("file")]
    # 照片可以放在子資料夾（例如 test-photos/food/），用檔名找
    index = {}
    for dirpath, _, files in os.walk(photos):
        for name in files:
            index.setdefault(name, os.path.join(dirpath, name))

    done = skipped = 0
    missing = []
    for r in rows:
        name = r["file"].strip()
        out = os.path.join(cache, name + ".rgba")
        if os.path.exists(out):
            skipped += 1
            continue
        src = index.get(name)
        if not src:
            missing.append(name)
            continue
        im = load(src).convert("RGBA")
        im.thumbnail((640, 640), Image.LANCZOS)
        with open(out, "wb") as o:
            o.write(struct.pack("<II", *im.size) + im.tobytes())
        done += 1
    print(f"轉換 {done} 張，已存在略過 {skipped} 張，共 {len(rows)} 筆標註")
    if missing:
        print(f"找不到 {len(missing)} 張：" + "、".join(missing[:20]) + ("…" if len(missing) > 20 else ""))


if __name__ == "__main__":
    main()
