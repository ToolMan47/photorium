#!/usr/bin/env python3
"""
把 iPhone 的 HEIC 照片轉成 JPG，供 Photorium 測試用。
使用系統內建的 libheif（透過 ctypes），不需要另外安裝 pillow-heif。

用法：
  python3 tools/heic2jpg.py <來源資料夾> <輸出資料夾> [--count N] [--max-side 2400]
  --count N  只均勻抽樣 N 張（預設全部）
"""
import argparse, ctypes, ctypes.util, os, sys
from PIL import Image

lib = ctypes.CDLL(ctypes.util.find_library("heif") or "libheif.so.1")

class HeifError(ctypes.Structure):
    _fields_ = [("code", ctypes.c_int), ("subcode", ctypes.c_int), ("message", ctypes.c_char_p)]

lib.heif_context_alloc.restype = ctypes.c_void_p
lib.heif_context_free.argtypes = [ctypes.c_void_p]
lib.heif_context_read_from_file.restype = HeifError
lib.heif_context_read_from_file.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p]
lib.heif_context_get_primary_image_handle.restype = HeifError
lib.heif_context_get_primary_image_handle.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
lib.heif_decode_image.restype = HeifError
lib.heif_decode_image.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
lib.heif_image_get_width.restype = ctypes.c_int
lib.heif_image_get_width.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.heif_image_get_height.restype = ctypes.c_int
lib.heif_image_get_height.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.heif_image_get_plane_readonly.restype = ctypes.POINTER(ctypes.c_uint8)
lib.heif_image_get_plane_readonly.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
lib.heif_image_release.argtypes = [ctypes.c_void_p]
lib.heif_image_handle_release.argtypes = [ctypes.c_void_p]

COLORSPACE_RGB, CHROMA_RGB, CHANNEL_INTERLEAVED = 1, 10, 10

def check(err, what):
    if err.code != 0:
        raise RuntimeError(f"{what}: {err.message.decode(errors='replace') if err.message else err.code}")

def decode(path):
    ctx = lib.heif_context_alloc()
    handle, img = ctypes.c_void_p(), ctypes.c_void_p()
    try:
        check(lib.heif_context_read_from_file(ctx, path.encode(), None), "read")
        check(lib.heif_context_get_primary_image_handle(ctx, ctypes.byref(handle)), "handle")
        # libheif 預設會套用 HEIC 內的旋轉／鏡像，輸出就是正確方向
        check(lib.heif_decode_image(handle, ctypes.byref(img), COLORSPACE_RGB, CHROMA_RGB, None), "decode")
        w = lib.heif_image_get_width(img, CHANNEL_INTERLEAVED)
        h = lib.heif_image_get_height(img, CHANNEL_INTERLEAVED)
        stride = ctypes.c_int()
        p = lib.heif_image_get_plane_readonly(img, CHANNEL_INTERLEAVED, ctypes.byref(stride))
        buf = ctypes.string_at(p, stride.value * h)
        return Image.frombuffer("RGB", (w, h), buf, "raw", "RGB", stride.value, 1).copy()
    finally:
        if img: lib.heif_image_release(img)
        if handle: lib.heif_image_handle_release(handle)
        lib.heif_context_free(ctx)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--count", type=int, default=0)
    ap.add_argument("--max-side", type=int, default=2400)
    a = ap.parse_args()
    files = sorted(f for f in os.listdir(a.src) if f.lower().endswith((".heic", ".heif")))
    if a.count and a.count < len(files):
        step = len(files) / a.count
        files = [files[int(i * step)] for i in range(a.count)]
    os.makedirs(a.dst, exist_ok=True)
    ok = 0
    for f in files:
        out = os.path.join(a.dst, os.path.splitext(f)[0] + ".jpg")
        if os.path.exists(out): ok += 1; continue
        try:
            im = decode(os.path.join(a.src, f))
            im.thumbnail((a.max_side, a.max_side), Image.LANCZOS)
            im.save(out, "JPEG", quality=88)
            ok += 1
            print("ok ", f, im.size)
        except Exception as e:
            print("ERR", f, e, file=sys.stderr)
    print(f"done: {ok}/{len(files)}")

if __name__ == "__main__":
    main()
