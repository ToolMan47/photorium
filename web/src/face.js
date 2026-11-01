/*
 * Photorium 人臉偵測
 *
 * 使用 pico（Pixel Intensity Comparison-based Object detection, Nenad Markus, MIT 授權）
 * https://github.com/nenadmarkus/pico ，https://github.com/nenadmarkus/picojs
 * 模型檔 facefinder（約 234 KB）在 build 時以 base64 嵌入，不需要網路，Artifact 內也能用。
 *
 * detect(imageData) → [{ cx, cy, size, score }]（座標以 0..1 正規化，size 為臉寬佔畫面寬的比例）
 * 只能偵測大致正面、直立的臉（左右轉頭約 ±30° 內）。
 */
(function (root) {
  'use strict';

  const CASCADE_B64 = '/*__FACEFINDER_B64__*/';

  // ---------- pico（依原始 picojs 改寫，演算法不變） ----------
  function unpackCascade(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 8;
    const tdepth = dv.getInt32(p, true); p += 4;
    const ntrees = dv.getInt32(p, true); p += 4;
    const pow2 = 1 << tdepth;
    const tcodes = new Int8Array(ntrees * 4 * pow2);
    const tpreds = new Float32Array(ntrees * pow2);
    const thresh = new Float32Array(ntrees);
    for (let t = 0; t < ntrees; t++) {
      const base = t * 4 * pow2;
      // 每棵樹的第一組 4 個位元組是空的（索引從 1 開始）
      for (let i = 0; i < 4 * pow2 - 4; i++) tcodes[base + 4 + i] = (bytes[p + i] << 24) >> 24;
      p += 4 * pow2 - 4;
      for (let i = 0; i < pow2; i++) { tpreds[t * pow2 + i] = dv.getFloat32(p, true); p += 4; }
      thresh[t] = dv.getFloat32(p, true); p += 4;
    }
    return function classify(r, c, s, pixels, ldim) {
      r = 256 * r; c = 256 * c;
      let rootIdx = 0, o = 0;
      for (let i = 0; i < ntrees; i++) {
        let idx = 1;
        for (let j = 0; j < tdepth; j++) {
          const k = rootIdx + 4 * idx;
          idx = 2 * idx + (pixels[((r + tcodes[k] * s) >> 8) * ldim + ((c + tcodes[k + 1] * s) >> 8)] <=
                           pixels[((r + tcodes[k + 2] * s) >> 8) * ldim + ((c + tcodes[k + 3] * s) >> 8)] ? 1 : 0);
        }
        o += tpreds[pow2 * i + idx - pow2];
        if (o <= thresh[i]) return -1;
        rootIdx += 4 * pow2;
      }
      return o - thresh[ntrees - 1];
    };
  }

  function runCascade(img, classify, prm) {
    const dets = [];
    let scale = prm.minsize;
    while (scale <= prm.maxsize) {
      const step = Math.max(prm.shiftfactor * scale, 1) | 0;
      const offset = (scale / 2 + 1) | 0;
      for (let r = offset; r <= img.nrows - offset; r += step) {
        for (let c = offset; c <= img.ncols - offset; c += step) {
          const q = classify(r, c, scale, img.pixels, img.ldim);
          if (q > 0) dets.push([r, c, scale, q]);
        }
      }
      scale *= prm.scalefactor;
    }
    return dets;
  }

  function cluster(dets, iouThr) {
    dets = dets.slice().sort((a, b) => b[3] - a[3]);
    const iou = (a, b) => {
      const ov = Math.max(0, Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2));
      const oc = Math.max(0, Math.min(a[1] + a[2] / 2, b[1] + b[2] / 2) - Math.max(a[1] - a[2] / 2, b[1] - b[2] / 2));
      return ov * oc / (a[2] * a[2] + b[2] * b[2] - ov * oc);
    };
    const used = new Uint8Array(dets.length), out = [];
    for (let i = 0; i < dets.length; i++) {
      if (used[i]) continue;
      let r = 0, c = 0, s = 0, q = 0, n = 0;
      for (let j = i; j < dets.length; j++) {
        if (!used[j] && iou(dets[i], dets[j]) > iouThr) {
          used[j] = 1; r += dets[j][0]; c += dets[j][1]; s += dets[j][2]; q += dets[j][3]; n++;
        }
      }
      out.push([r / n, c / n, s / n, q]);
    }
    return out;
  }

  // ---------- 對外介面 ----------
  let classify = null;
  function ensure() {
    if (classify) return true;
    if (CASCADE_B64.length < 1000) return false; // 尚未嵌入模型（例如直接載入 src/）
    const bin = atob(CASCADE_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    classify = unpackCascade(bytes);
    return true;
  }

  function toGray(img) {
    const w = img.width, h = img.height, d = img.data;
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) g[i] = (2 * d[j] + 7 * d[j + 1] + d[j + 2]) / 10;
    return { g, w, h };
  }
  function half(src) {
    const w = src.w >> 1, h = src.h >> 1, g = new Uint8Array(w * h), sw = src.w;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = 2 * y * sw + 2 * x;
      g[y * w + x] = (src.g[i] + src.g[i + 1] + src.g[i + sw] + src.g[i + sw + 1]) >> 2;
    }
    return { g, w, h };
  }
  function scan(G, minsize, maxsize, shift) {
    const raw = runCascade({ pixels: G.g, nrows: G.h, ncols: G.w, ldim: G.w }, classify,
      { shiftfactor: shift, scalefactor: 1.1, minsize, maxsize });
    return raw;
  }

  /*
   * 兩階段掃描：
   *  - 大臉：先把影像縮小一半，用 5% 的細步長掃描（自拍、半身人像）
   *  - 小臉：原尺寸掃描較小的臉（全身照、合照）
   * pico 的分數是群聚後的總和：真正的臉通常會被多個相鄰視窗命中，分數明顯較高。
   *
   * opts.threshold：分數門檻（預設 10）
   * opts.small：是否掃描小臉（即時取景可關閉以節省時間）
   */
  function detect(img, opts) {
    opts = opts || {};
    if (!ensure()) return [];
    const G = toGray(img);
    const short = Math.min(G.w, G.h);
    let dets = [];
    // 大臉：在縮半的影像上，臉寬約為短邊的 18% 以上
    const H = half(G), hs = Math.min(H.w, H.h);
    for (const d of scan(H, Math.max(20, Math.round(hs * 0.18)), Math.round(hs * 0.98), 0.05)) {
      dets.push([d[0] * 2, d[1] * 2, d[2] * 2, d[3]]);
    }
    if (opts.small !== false) {
      const minS = Math.max(20, Math.round(short * 0.04));
      const maxS = Math.round(short * 0.24);
      dets = dets.concat(scan(G, minS, maxS, opts.fast ? 0.1 : 0.05));
    }
    // 門檻依 40 張實拍照片調整（見 test/face.test.js）
    const thr = opts.threshold != null ? opts.threshold : 8;
    const minSkin = opts.minSkin != null ? opts.minSkin : 0.45;
    const minEyes = opts.minEyes != null ? opts.minEyes : 0.08;
    let faces = cluster(dets, 0.2)
      .filter((f) => f[3] > thr)
      .map((f) => ({ cx: f[1] / G.w, cy: f[0] / G.h, size: f[2] / G.w, sizeY: f[2] / G.h, score: f[3], skin: skinRatio(img, f), eyes: eyeContrast(G, f) }))
      .filter((f) => f.skin >= minSkin && f.eyes >= minEyes);
    // 同一張照片裡，分數遠低於最強那張臉的，多半是誤判
    const best = faces.reduce((m, f) => Math.max(m, f.score), 0);
    faces = faces.filter((f) => f.score >= best * 0.25);
    return faces.sort((a, b) => b.size - a.size);
  }

  /*
   * 眼睛驗證：真正的臉，眼睛與眉毛那一條（框的上半部）會比臉頰暗。
   * 回傳 1 - 眼帶亮度 / 臉頰亮度；明顯大於 0 表示有眼睛的暗帶。
   */
  function eyeContrast(G, f) {
    const r = f[0], c = f[1], s = f[2];
    const band = (ya, yb) => {
      let sum = 0, n = 0;
      const y0 = Math.max(0, Math.round(r + ya * s)), y1 = Math.min(G.h - 1, Math.round(r + yb * s));
      const x0 = Math.max(0, Math.round(c - 0.3 * s)), x1 = Math.min(G.w - 1, Math.round(c + 0.3 * s));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { sum += G.g[y * G.w + x]; n++; }
      return n ? sum / n : 0;
    };
    const eye = band(-0.22, -0.05), cheek = band(0.02, 0.2);
    return cheek > 0 ? 1 - eye / cheek : 0;
  }

  /*
   * 膚色驗證：pico 會把車燈、卡通圖案、樹皮紋理誤判成臉。
   * 檢查偵測框中央（臉頰與鼻子一帶）有多少像素落在膚色範圍（YCbCr），
   * 這個範圍涵蓋各種膚色，也容許暖色室內光。
   */
  function skinRatio(img, f) {
    const w = img.width, h = img.height, d = img.data;
    const r = f[0], c = f[1], s = f[2];
    const y0 = Math.max(0, Math.round(r - s * 0.25)), y1 = Math.min(h - 1, Math.round(r + s * 0.3));
    const x0 = Math.max(0, Math.round(c - s * 0.28)), x1 = Math.min(w - 1, Math.round(c + s * 0.28));
    const step = Math.max(1, Math.round(s / 24));
    let n = 0, k = 0;
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const i = (y * w + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
        const Y = 0.299 * R + 0.587 * G + 0.114 * B;
        const Cb = 128 - 0.1687 * R - 0.3313 * G + 0.5 * B;
        const Cr = 128 + 0.5 * R - 0.4187 * G - 0.0813 * B;
        if (Y > 45 && Cr > 133 && Cr < 178 && Cb > 80 && Cb < 132 && R > B) k++;
        n++;
      }
    }
    return n ? k / n : 0;
  }

  const api = { detect, ready: () => ensure() };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhotoriumFace = api;
})(typeof window !== 'undefined' ? window : globalThis);
