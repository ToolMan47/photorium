/*
 * Photorium 構圖分析引擎（純 JavaScript，不需要模型檔）
 *
 * analyze(imageData)  → 畫面分析：顯著性、主體、水平線、對稱性、線條方向
 * suggest(analysis)   → 依分析結果產生構圖建議（依適合度排序）
 * fitCrop(...)        → 計算讓主體落在目標位置的裁切框
 *
 * 所有座標都以 0..1 正規化（相對於整個畫面寬高）。
 */
(function (root) {
  'use strict';

  const PHI = 0.381966; // 1 - 1/φ

  // ---------- 影像工具 ----------
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const win = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / win;
        const xa = Math.min(w - 1, x + r + 1);
        const xs = Math.max(0, x - r);
        acc += src[row + xa] - src[row + xs];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / win;
        const ya = Math.min(h - 1, y + r + 1);
        const ys = Math.max(0, y - r);
        acc += tmp[ya * w + x] - tmp[ys * w + x];
      }
    }
    return out;
  }

  function normalize(a) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < a.length; i++) { if (a[i] < mn) mn = a[i]; if (a[i] > mx) mx = a[i]; }
    const d = mx - mn || 1;
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - mn) / d;
    return a;
  }

  function meanStd(a) {
    let s = 0, s2 = 0;
    for (let i = 0; i < a.length; i++) { s += a[i]; s2 += a[i] * a[i]; }
    const m = s / a.length;
    return { mean: m, std: Math.sqrt(Math.max(0, s2 / a.length - m * m)) };
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // ---------- 分析 ----------
  /*
   * opts.faces：face.js 偵測到的人臉（可省略）。有人臉時，以人物作為主體。
   */
  function analyze(img, opts) {
    opts = opts || {};
    const w = img.width, h = img.height, d = img.data, n = w * h;
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = d[j], g = d[j + 1], b = d[j + 2];
      L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      A[i] = r - g;
      B[i] = (r + g) / 2 - b;
    }
    const Lb = boxBlur(L, w, h, 1), Ab = boxBlur(A, w, h, 2), Bb = boxBlur(B, w, h, 2);
    const mL = meanStd(Lb), mA = meanStd(Ab).mean, mB = meanStd(Bb).mean;

    // 梯度（Sobel）
    const gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n);
    const gyB = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const tl = Lb[i - w - 1], t = Lb[i - w], tr = Lb[i - w + 1];
        const l = Lb[i - 1], r = Lb[i + 1];
        const bl = Lb[i + w - 1], b = Lb[i + w], br = Lb[i + w + 1];
        gx[i] = (tr + 2 * r + br) - (tl + 2 * l + bl);
        gy[i] = (bl + 2 * b + br) - (tl + 2 * t + tr);
        mag[i] = Math.hypot(gx[i], gy[i]);
        gyB[i] = (Bb[i + w] - Bb[i - w]) * 2;
      }
    }

    // 顯著性：色彩對比（frequency-tuned）+ 邊緣密度 + 輕微中心先驗
    const sal = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dl = Lb[i] - mL.mean, da = Ab[i] - mA, db = Bb[i] - mB;
      sal[i] = Math.sqrt(dl * dl + 0.7 * da * da + 0.7 * db * db);
    }
    normalize(sal);
    // 局部對比（中央-周邊差）：找出「跟周圍不一樣」的小區塊，例如海上的帆船
    const r1 = Math.max(6, Math.round(w / 14));
    const Ls = boxBlur(Lb, w, h, r1), As = boxBlur(Ab, w, h, r1), Bs = boxBlur(Bb, w, h, r1);
    const loc = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dl = Lb[i] - Ls[i], da = Ab[i] - As[i], db = Bb[i] - Bs[i];
      loc[i] = Math.sqrt(dl * dl + 0.7 * da * da + 0.7 * db * db);
    }
    const locN = normalize(boxBlur(loc, w, h, 2));
    for (let i = 0; i < n; i++) sal[i] = 0.4 * sal[i] + 0.6 * locN[i];
    normalize(sal);
    const edgeDen = normalize(boxBlur(mag, w, h, 3));
    const S = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const nx = x / w - 0.5, ny = y / h - 0.5;
        const center = Math.exp(-(nx * nx + ny * ny) / (2 * 0.32 * 0.32));
        const border = Math.min(1, Math.min(x, y, w - 1 - x, h - 1 - y) / (0.04 * w) + 0.3);
        S[i] = (0.62 * sal[i] + 0.38 * edgeDen[i]) * (0.65 + 0.35 * center) * border;
      }
    }
    const horizon = findHorizon(gx, gy, gyB, mag, w, h, Lb, Bb);
    // 水平線本身是很強的邊緣，但它是背景結構，不是主體：沿著水平線降低顯著性
    if (horizon.valid) {
      const t = Math.tan(horizon.angle * Math.PI / 180), band = Math.max(2, h * 0.035);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ly = horizon.y * h + t * (x - (w - 1) / 2);
          const dd = Math.abs(y - ly);
          if (dd < band * 2) S[y * w + x] *= 0.35 + 0.65 * Math.min(1, dd / (band * 2));
        }
      }
    }
    const Sal = normalize(boxBlur(S, w, h, 2));
    const person = opts.faces && opts.faces.length ? buildPerson(opts.faces) : null;
    const salSubject = findSubject(Sal, w, h);
    const dishes = opts.food ? findDishes(d, w, h, mag) : null;
    let subject;
    const mainDish = dishes && dishes.length && dishes[0].area >= 0.04 ? dishes[0] : null;
    if (person) subject = person;
    else if (opts.subject) subject = null; // 點選的主體優先（下面處理）
    else if (mainDish) {
      // 美食：以主要的盤子／碗為主體（構圖時整個盤子一起考慮）
      const b = { x: clamp(mainDish.cx - mainDish.rx, 0, 1), y: clamp(mainDish.cy - mainDish.ry, 0, 1) };
      b.w = clamp(mainDish.cx + mainDish.rx, 0, 1) - b.x; b.h = clamp(mainDish.cy + mainDish.ry, 0, 1) - b.y;
      subject = { kind: 'dish', cx: mainDish.cx, cy: mainDish.cy, box: b, area: b.w * b.h, conf: 1, dish: mainDish };
    } else if (dishes && dishes.foodBlob) {
      const fb = dishes.foodBlob;
      subject = { kind: 'food', cx: fb.cx, cy: fb.cy, box: fb.box, area: fb.box.w * fb.box.h, conf: 0.7 };
    }
    if (subject) { /* 已決定 */ }
    else if (opts.subject) {
      // 使用者點選並追蹤中的主體
      const b = opts.subject.box;
      subject = { kind: 'locked', cx: opts.subject.cx, cy: opts.subject.cy, box: b, area: b.w * b.h, conf: 1 };
    } else subject = salSubject;
    const sym = symmetry(Lb, w, h, mL.std);
    const lines = lineOrientation(gx, gy, mag, w, h);

    // 主體以外的「空白」程度，以及左右兩側的視覺重量
    let empty = 0, leftMass = 0, rightMass = 0, topMass = 0, bottomMass = 0;
    const bx0 = subject.box.x * w, bx1 = (subject.box.x + subject.box.w) * w;
    const by0 = subject.box.y * h, by1 = (subject.box.y + subject.box.h) * h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Sal[y * w + x];
        if (v < 0.22) empty++;
        const inBox = x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
        if (inBox) continue;
        if (x < subject.cx * w) leftMass += v; else rightMass += v;
        if (y < subject.cy * h) topMass += v; else bottomMass += v;
      }
    }
    // 換算成「每單位面積」的重量，避免面積大小影響判斷
    const leftArea = Math.max(1, subject.cx * w * h), rightArea = Math.max(1, (1 - subject.cx) * w * h);

    return {
      width: w, height: h,
      saliency: Sal,
      subject,
      person,
      horizon,
      symLR: sym.lr, symTB: sym.tb,
      lines,
      emptiness: empty / n,
      sideWeight: { left: leftMass / leftArea, right: rightMass / rightArea, top: topMass, bottom: bottomMass },
      brightness: mL.mean / 255,
      contrast: mL.std / 128,
      salSubject,
      dishes,
      stats: sceneStats(d, Lb, mag, w, h),
      vanish: vanishingPoint(gx, gy, mag, w, h),
    };
  }

  /*
   * 找主體：先用一個門檻切出顯著區域；若最強的區域是橫跨畫面的長條
   *（例如夕陽下的亮天空），就逐步提高門檻，把它拆開，找出裡面較緊湊的物體。
   */
  function findSubject(S, w, h) {
    const st = meanStd(S);
    const t0 = Math.max(0.42, st.mean + 1.1 * st.std);
    let first = null;
    for (let t = t0; t < 0.95; t += 0.07) {
      const r = subjectAt(S, w, h, t);
      if (!first) first = r;
      if (!r.wide) return r;
      if (r.conf === 0) break;
    }
    return first;
  }

  function subjectAt(S, w, h, t) {
    const label = new Int32Array(w * h).fill(-1);
    const comps = [];
    const stack = [];
    for (let i = 0; i < w * h; i++) {
      if (S[i] < t || label[i] !== -1) continue;
      const id = comps.length;
      const c = { sum: 0, sx: 0, sy: 0, x0: w, y0: h, x1: 0, y1: 0, px: 0 };
      label[i] = id; stack.push(i);
      while (stack.length) {
        const k = stack.pop();
        const x = k % w, y = (k / w) | 0, v = S[k];
        c.sum += v; c.sx += x * v; c.sy += y * v; c.px++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x;
        if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        const nb = [k - 1, k + 1, k - w, k + w];
        for (let q = 0; q < 4; q++) {
          const m = nb[q];
          if (m < 0 || m >= w * h) continue;
          if ((q === 0 && x === 0) || (q === 1 && x === w - 1)) continue;
          if (label[m] === -1 && S[m] >= t) { label[m] = id; stack.push(m); }
        }
      }
      comps.push(c);
    }
    let total = 0;
    for (let i = 0; i < S.length; i++) total += S[i];
    if (!comps.length) {
      return { cx: 0.5, cy: 0.5, box: { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }, area: 0.09, conf: 0, wide: false };
    }
    // 橫跨整個畫面的長條（天空亮帶、地平線）通常是背景，不是主體：降低它們的權重
    for (const c of comps) {
      const wf = (c.x1 - c.x0 + 1) / w, hf = (c.y1 - c.y0 + 1) / h;
      c.rank = c.sum * (wf > 0.7 ? 0.3 : 1) * (hf > 0.85 ? 0.3 : 1) * (wf * hf > 0.45 ? 0.5 : 1);
    }
    comps.sort((a, b) => b.rank - a.rank);
    const best = Object.assign({}, comps[0]);
    // 把靠近的碎塊合併進主體（例如人的頭與身體）
    const pad = 0.06 * w;
    for (let k = 1; k < comps.length; k++) {
      const c = comps[k];
      if (c.sum < comps[0].sum * 0.12 || c.rank < c.sum) continue;
      const near = c.x0 <= best.x1 + pad && c.x1 >= best.x0 - pad && c.y0 <= best.y1 + pad && c.y1 >= best.y0 - pad;
      if (!near) continue;
      best.sum += c.sum; best.sx += c.sx; best.sy += c.sy; best.px += c.px;
      best.x0 = Math.min(best.x0, c.x0); best.y0 = Math.min(best.y0, c.y0);
      best.x1 = Math.max(best.x1, c.x1); best.y1 = Math.max(best.y1, c.y1);
    }
    const box = { x: best.x0 / w, y: best.y0 / h, w: (best.x1 - best.x0 + 1) / w, h: (best.y1 - best.y0 + 1) / h };
    const massFrac = best.sum / (total || 1);
    // 信心度：主體佔總顯著性的比例，相對於它的面積
    const area = box.w * box.h;
    const conf = clamp((massFrac - area * 0.6) * 2.2 + 0.15, 0, 1);
    // 太寬、太高，或是又長又扁的條狀區域，都當成背景結構
    const wide = box.w > 0.7 || box.h > 0.85 || (box.w > 0.4 && box.w / box.h > 3.5);
    return { cx: best.sx / best.sum / w, cy: best.sy / best.sum / h, box, area, conf, wide };
  }

  function findHorizon(gx, gy, gyB, mag, w, h, Lb, Bb) {
    const n = w * h;
    const hE = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = Math.abs(gy[i]) + 0.6 * Math.abs(gyB[i]) - 0.6 * Math.abs(gx[i]);
      hE[i] = v > 0 ? v : 0;
    }
    let best = { sum: -1 }, sums = [];
    const y0min = Math.round(h * 0.1), y0max = Math.round(h * 0.9);
    const cx = (w - 1) / 2;
    for (let a = -14; a <= 14; a += 1) {
      const t = Math.tan(a * Math.PI / 180);
      for (let y0 = y0min; y0 <= y0max; y0++) {
        let s = 0;
        for (let x = 0; x < w; x++) {
          const y = Math.round(y0 + t * (x - cx));
          if (y < 1 || y >= h - 1) continue;
          // 取上下一列的最大值，讓 1px 的誤差不影響
          const i = y * w + x;
          s += Math.max(hE[i], hE[i - w] * 0.8, hE[i + w] * 0.8);
        }
        s /= w;
        if (a === 0) sums.push(s);
        if (s > best.sum) best = { sum: s, a, y0 };
      }
    }
    sums.sort((p, q) => p - q);
    const median = sums[sums.length >> 1] || 1e-6;
    // 覆蓋率：這條線上有多少欄有明顯的水平邊緣
    const t = Math.tan(best.a * Math.PI / 180);
    let covered = 0, above = 0, below = 0, na = 0, nb = 0;
    const thr = best.sum * 0.35;
    for (let x = 0; x < w; x++) {
      const y = Math.round(best.y0 + t * (x - cx));
      if (y < 1 || y >= h - 1) continue;
      const i = y * w + x;
      if (Math.max(hE[i], hE[i - w], hE[i + w]) > thr) covered++;
    }
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const ly = best.y0 + t * (x - cx);
        if (y < ly - 3) { above += mag[y * w + x]; na++; }
        else if (y > ly + 3) { below += mag[y * w + x]; nb++; }
      }
    }
    const strength = best.sum / (median + 1e-6);
    const coverage = covered / w;
    return {
      y: best.y0 / h,
      angle: best.a, // 正值 = 右邊比左邊低（順時針傾斜）
      strength,
      coverage,
      // 角度落在搜尋範圍的邊界（±14°），通常不是真的水平線，而是斜向的結構
      // 真正的水平線（天空與地面、水面）上下兩側的亮度或色調會明顯不同；
      // 桌緣、路緣、招牌邊這類線條兩側常常很接近，不算水平線
      regionDiff: sideDiff(Lb, Bb, w, h, best.y0, t),
      // 門檻依 20 張實拍照片調整：太靠近上下緣、斜度大、強度弱的通常是桌緣或招牌邊
      valid: strength > 3 && coverage > 0.62 && Math.abs(best.a) <= 6 &&
        best.y0 / h > 0.2 && best.y0 / h < 0.85 && sideDiff(Lb, Bb, w, h, best.y0, t) > 12,
      aboveTexture: na ? above / na : 0,
      belowTexture: nb ? below / nb : 0,
    };
  }

  function sideDiff(Lb, Bb, w, h, y0, t) {
    const cx = (w - 1) / 2, gap = Math.max(2, Math.round(h * 0.03)), band = Math.max(3, Math.round(h * 0.12));
    let la = 0, lb = 0, ba = 0, bb = 0, na = 0, nb = 0;
    for (let x = 0; x < w; x++) {
      const ly = Math.round(y0 + t * (x - cx));
      for (let k = gap; k < gap + band; k++) {
        const ya = ly - k, yb = ly + k;
        if (ya >= 0) { la += Lb[ya * w + x]; ba += Bb[ya * w + x]; na++; }
        if (yb < h) { lb += Lb[yb * w + x]; bb += Bb[yb * w + x]; nb++; }
      }
    }
    if (!na || !nb) return 0;
    return Math.abs(la / na - lb / nb) + 0.7 * Math.abs(ba / na - bb / nb);
  }

  function symmetry(Lb, w, h, std) {
    let dLR = 0, dTB = 0, c1 = 0, c2 = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < (w >> 1); x++) {
        dLR += Math.abs(Lb[y * w + x] - Lb[y * w + (w - 1 - x)]); c1++;
      }
    }
    for (let y = 0; y < (h >> 1); y++) {
      for (let x = 0; x < w; x++) {
        dTB += Math.abs(Lb[y * w + x] - Lb[(h - 1 - y) * w + x]); c2++;
      }
    }
    const s = std * 1.6 + 1;
    return { lr: clamp(1 - dLR / c1 / s, 0, 1), tb: clamp(1 - dTB / c2 / s, 0, 1) };
  }

  function lineOrientation(gx, gy, mag, w, h) {
    const st = meanStd(mag);
    const thr = st.mean + st.std;
    let hor = 0, ver = 0, d1 = 0, d2 = 0, tot = 0;
    for (let i = 0; i < mag.length; i++) {
      const m = mag[i];
      if (m < thr) continue;
      // 線的方向 = 梯度方向轉 90°；換成 0..180°，0 = 水平
      let ang = Math.atan2(gy[i], gx[i]) * 180 / Math.PI + 90;
      ang = ((ang % 180) + 180) % 180;
      tot += m;
      if (ang < 20 || ang > 160) hor += m;
      else if (ang > 70 && ang < 110) ver += m;
      else if (ang >= 20 && ang <= 70) d1 += m; // 影像座標中 y 向下，這是「\」方向
      else d2 += m; // 「/」方向
    }
    tot = tot || 1;
    return {
      horizontal: hor / tot, vertical: ver / tot, diagonal: (d1 + d2) / tot,
      diagDir: d1 > d2 ? '\\' : '/',
      diagDominance: Math.max(d1, d2) / ((d1 + d2) || 1),
    };
  }

  // ---------- 盤子偵測（美食模式） ----------
  /*
   * 盤子、碗大多是淺色、低彩度的陶瓷。做法：
   *  1. 標出「盤子色」像素：亮、顏色淡
   *  2. 補洞：盤子裡的食物不是盤子色，會變成洞；從畫面邊緣走不到的非盤子色區域就是洞，補起來
   *  3. 連通區域 → 用二階動差算出等效橢圓（中心、長短軸、角度）
   *  4. 區域和橢圓重疊夠高（IoU）才算盤子，可以排除淺色桌面、牆壁
   * 回傳的橢圓以正規化座標表示；ratio = 短軸／長軸（像素尺度），接近 1 代表接近正上方俯拍。
   */
  function findDishes(d, w, h, mag) {
    const n = w * h;
    // 白平衡（灰色世界假設）：室內暖光下白盤子會偏黃，先把整體色偏拉回來
    let mr = 0, mg = 0, mb = 0;
    for (let j = 0; j < n * 4; j += 4) { mr += d[j]; mg += d[j + 1]; mb += d[j + 2]; }
    const avg = (mr + mg + mb) / 3 || 1;
    const kr = avg / (mr || 1), kg = avg / (mg || 1), kb = avg / (mb || 1);
    const lum = new Float32Array(n), satA = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = d[j] * kr, g = d[j + 1] * kg, b = d[j + 2] * kb;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      lum[i] = (r + g + b) / 3; satA[i] = mx ? (mx - mn) / mx : 0;
    }
    // 亮度門檻依畫面調整：至少比畫面中位數亮
    const sorted = Array.from(lum).sort((a, b) => a - b);
    const lThr = Math.max(105, sorted[Math.floor(n * 0.55)]);
    let mMean = 0; for (let i = 0; i < n; i++) mMean += mag[i]; mMean /= n;
    const plate = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // 強邊緣（盤緣、陰影）不算盤子色，讓相鄰的白色物體分開
      if (lum[i] > lThr && satA[i] < 0.22 && mag[i] < mMean * 2.5) plate[i] = 1;
    }
    if (findDishes.debug) findDishes.debug.plate = plate;
    // 盤緣有強邊緣的地方被排除，會留下小缺口；補洞前先把盤子色區域加粗 2 px，封住缺口
    const wall = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!plate[y * w + x]) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) wall[yy * w + xx] = 1;
      }
    }
    // 補洞：從邊緣開始，把能走到的非盤子像素標成「外面」
    const outside = new Uint8Array(n), stack = [];
    const push = (i) => { if (!wall[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w); if (y < h - 1) push(i + w);
    }
    const filled = new Uint8Array(n);
    for (let i = 0; i < n; i++) filled[i] = wall[i] || !outside[i] ? 1 : 0;
    if (findDishes.debug) findDishes.debug.filled = filled;
    // 到「非盤子區域」的距離（chamfer 距離轉換）：用來逐步收縮，切斷和桌面、紙巾之間的細窄連接
    const dist = new Float32Array(n);
    for (let i = 0; i < n; i++) dist[i] = filled[i] ? 1e9 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!dist[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { dist[i] = 1; continue; }
      dist[i] = Math.min(dist[i], dist[i - 1] + 1, dist[i - w] + 1, dist[i - w - 1] + 1.4, dist[i - w + 1] + 1.4);
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; if (!dist[i]) continue;
      if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < h - 1) { dist[i] = Math.min(dist[i], dist[i + w] + 1); if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + w + 1] + 1.4); if (x > 0) dist[i] = Math.min(dist[i], dist[i + w - 1] + 1.4); }
    }
    const cands = [];
    const short = Math.min(w, h);
    for (const lvl of [0, 2, 4, 7, 10]) {
      if (lvl > short * 0.08) break;
      const label = new Int32Array(n).fill(-1);
      let id = 0;
      for (let i = 0; i < n; i++) {
        if (dist[i] <= lvl || label[i] >= 0) continue;
        const c = { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, plate: 0, px: [] };
        label[i] = id; stack.push(i);
        while (stack.length) {
          const k = stack.pop(), x = k % w, y = (k / w) | 0;
          c.n++; c.sx += x; c.sy += y; c.sxx += x * x; c.syy += y * y; c.sxy += x * y; c.plate += plate[k]; c.px.push(k);
          const nb = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1];
          for (const m of nb) if (m >= 0 && dist[m] > lvl && label[m] < 0) { label[m] = id; stack.push(m); }
        }
        const e = ellipseOf(c, id, label, lvl);
        if (e) cands.push(e);
        id++;
      }
    }
    function ellipseOf(c, id, label, lvl) {
      if (c.n < n * 0.02) return null;            // 太小
      if (c.plate < c.n * 0.25) return null;      // 幾乎都是洞，不像盤子
      if (c.plate > c.n * 0.93) return null;      // 裡面沒有東西（天空、牆、空白紙）
      const mx = c.sx / c.n, my = c.sy / c.n;
      const vxx = c.sxx / c.n - mx * mx, vyy = c.syy / c.n - my * my, vxy = c.sxy / c.n - mx * my;
      // 共變異數矩陣的特徵值 → 均勻橢圓的半軸長 = 2√λ
      const tr = vxx + vyy, det = vxx * vyy - vxy * vxy;
      const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
      const A0 = 2 * Math.sqrt(l1), B0 = 2 * Math.sqrt(l2);
      const ang = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      let inter = 0, ell = 0;
      const x0 = Math.max(0, Math.floor(mx - A0)), x1 = Math.min(w - 1, Math.ceil(mx + A0));
      const y0 = Math.max(0, Math.floor(my - A0)), y1 = Math.min(h - 1, Math.ceil(my + A0));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x - mx, dy = y - my;
        const u = (dx * ca + dy * sa) / A0, v = (-dx * sa + dy * ca) / B0;
        if (u * u + v * v <= 1) { ell++; if (label[y * w + x] === id) inter++; }
      }
      const iou = inter / (c.n + ell - inter);
      if (iou < 0.75) return null;
      // 收縮過的區域要把收縮量加回去
      const A = A0 + lvl, B = B0 + lvl;
      const ex = Math.sqrt((A * ca) ** 2 + (B * sa) ** 2), ey = Math.sqrt((A * sa) ** 2 + (B * ca) ** 2);
      let fx = 0, fy = 0, fn = 0, fx0 = w, fx1 = 0, fy0 = h, fy1 = 0;
      for (const k of c.px) {
        if (plate[k]) continue;
        const x = k % w, y = (k / w) | 0;
        fx += x; fy += y; fn++;
        if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y;
      }
      return {
        cx: mx / w, cy: my / h, rx: ex / w, ry: ey / h, A, B,
        ratio: B / A, angle: ang * 180 / Math.PI, iou, area: Math.PI * A * B / n, level: lvl,
        food: fn > c.n * 0.07 ? { cx: fx / fn / w, cy: fy / fn / h, box: { x: fx0 / w, y: fy0 / h, w: (fx1 - fx0 + 1) / w, h: (fy1 - fy0 + 1) / h } } : null,
        touches: mx - ex < 1 || mx + ex > w - 2 || my - ey < 1 || my + ey > h - 2,
      };
    }
    // 排除：貼著畫面上緣、中心在上方的淺色區域（天空）；過大又不夠像橢圓的（多個盤子和桌面黏在一起）
    const ok = cands.filter((c) => !(c.cy - c.ry < 0.02 && c.cy < 0.4) && !(c.area > 0.6 && c.iou < 0.88));
    // 分數：越像橢圓越好（四次方，比大小重要）、裡面有食物加分
    const score = (c) => Math.sqrt(c.area) * c.iou ** 4 * (c.food ? 1 : 0.5);
    // 同一個位置在不同收縮程度可能都找到：留下分數最高的那個
    ok.sort((a, b) => score(b) - score(a));
    cands.length = 0; cands.push(...ok);
    const dishes = [];
    for (const c of cands) {
      const dup = dishes.some((d) => Math.abs(d.cx - c.cx) < Math.max(d.rx, c.rx) * 0.6 && Math.abs(d.cy - c.cy) < Math.max(d.ry, c.ry) * 0.6);
      if (!dup) dishes.push(c);
    }
    // 食物洞：被盤子色包圍的非盤子區域（盤子邊緣不清楚時，食物仍然會是白色區域裡的洞）
    const hl = new Int32Array(n).fill(-1), holes = [];
    for (let i = 0; i < n; i++) {
      if (!filled[i] || wall[i] || hl[i] >= 0) continue;
      const c = { n: 0, x0: w, x1: 0, y0: h, y1: 0, sx: 0, sy: 0 };
      hl[i] = holes.length; stack.push(i);
      while (stack.length) {
        const k = stack.pop(), x = k % w, y = (k / w) | 0;
        c.n++; c.sx += x; c.sy += y;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        const nb = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1];
        for (const m of nb) if (m >= 0 && filled[m] && !wall[m] && hl[m] < 0) { hl[m] = holes.length; stack.push(m); }
      }
      holes.push(c);
    }
    const big = holes.filter((c) => c.n > n * 0.015).sort((a, b) => b.n - a.n);
    let foodBlob = null;
    if (big.length) {
      const keep = big.filter((c) => c.n >= big[0].n * 0.3);
      let x0 = w, x1 = 0, y0 = h, y1 = 0, sx = 0, sy = 0, cn = 0;
      for (const c of keep) { x0 = Math.min(x0, c.x0); x1 = Math.max(x1, c.x1); y0 = Math.min(y0, c.y0); y1 = Math.max(y1, c.y1); sx += c.sx; sy += c.sy; cn += c.n; }
      foodBlob = { cx: sx / cn / w, cy: sy / cn / h, box: { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h }, area: cn / n };
    }
    const out = dishes.slice(0, 4);
    out.foodBlob = foodBlob;
    return out;
  }

  // ---------- 場景統計（拍攝類型判斷用） ----------
  function sceneStats(d, Lb, mag, w, h) {
    const n = w * h;
    let mSum = 0;
    for (let i = 0; i < n; i++) mSum += mag[i];
    const mMean = mSum / n || 1;
    // 上方 30%：平滑（天空、天花板）的比例
    const topRows = Math.round(h * 0.3);
    let smooth = 0, edges = 0, warm = 0, cN = 0, satSum = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, j = i * 4;
        if (y < topRows && mag[i] < mMean * 0.5) smooth++;
        if (mag[i] > mMean * 1.5) edges++;
        const r = d[j], g = d[j + 1], b = d[j + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx ? (mx - mn) / mx : 0;
        satSum += sat;
        // 畫面中央 60%：暖色（橘、褐、黃）的比例，食物常見的色調
        if (x > w * 0.2 && x < w * 0.8 && y > h * 0.2 && y < h * 0.8) {
          cN++;
          if (r >= g && g >= b && sat > 0.25 && mx > 60) warm++;
        }
      }
    }
    return {
      topSmooth: smooth / (topRows * w || 1),
      edgeDensity: edges / n,
      warmCenter: cN ? warm / cN : 0,
      saturation: satSum / n,
    };
  }

  /*
   * 消失點：每個強邊緣像素沿著自己的線條方向，替線條經過的位置投票；
   * 很多線條交會在同一點 → 有收斂感（道路、走廊、街道、建築透視）。
   * 接近水平或垂直的線（正面看的建築、地平線）不投票，它們在畫面中是平行的。
   * 候選點範圍包含畫面外一點（-25%～125%），消失點常落在畫面邊緣外。
   */
  function vanishingPoint(gx, gy, mag, w, h) {
    const st = meanStd(mag);
    const thr = st.mean + 1.5 * st.std;
    const G = 24, lo = -0.25, span = 1.5;
    const acc = new Float32Array(G * G);
    let total = 0;
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const i = y * w + x, m = mag[i];
        if (m < thr) continue;
        // 線的方向 = 梯度轉 90°
        let dx = -gy[i], dy = gx[i];
        const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        if (Math.abs(dx) < 0.2 || Math.abs(dy) < 0.2) continue; // 太接近垂直或水平
        const px = x / w, py = y / h;
        total += m;
        for (let c = 0; c < G; c++) {
          const cx = lo + (c + 0.5) / G * span;
          // 只投給離自己夠遠的位置：否則邊緣多的地方會因為「線經過自己」而得到假的高分
          if (Math.abs(cx - px) < 0.2) continue;
          const t = (cx - px) / dx;
          const cy = py + t * dy * (w / h); // 換算成正規化的 y
          const r = Math.floor((cy - lo) / span * G);
          if (r >= 0 && r < G) acc[r * G + c] += m;
        }
      }
    }
    if (!total) return { x: 0.5, y: 0.5, score: 0 };
    // 3×3 平滑後找最高點；分數 = 最高點比平均高幾倍（沒有收斂時投票會均勻散開）
    let accSum = 0;
    for (let i = 0; i < acc.length; i++) accSum += acc[i];
    const avg3 = accSum / acc.length * 9 || 1;
    let best = -1, bi = 0;
    for (let r = 1; r < G - 1; r++) for (let c = 1; c < G - 1; c++) {
      let v = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) v += acc[(r + a) * G + c + b];
      if (v > best) { best = v; bi = r * G + c; }
    }
    const r = Math.floor(bi / G), c = bi % G;
    return { x: lo + (c + 0.5) / G * span, y: lo + (r + 0.5) / G * span, score: best / avg3, edges: total };
  }

  /*
   * 拍攝類型的特徵向量（每個值大約落在 0～1）。
   * 順序必須和 scene-model.js 的 features 一致。
   */
  const SCENE_FEATURES = ['horizon', 'linesH', 'linesV', 'linesDiag', 'vanish', 'vanishInside',
    'symLR', 'emptiness', 'subjectConf', 'subjectArea', 'edgeDensity', 'warmCenter', 'brightness', 'contrast'];
  function sceneFeatures(a) {
    const L = a.lines, st = a.stats, ss = a.salSubject;
    const V = a.vanish;
    const inside = V.x > 0.05 && V.x < 0.95 && V.y > 0.05 && V.y < 0.95 ? 1 : 0;
    return [
      a.horizon.valid ? 1 : 0,
      L.horizontal, L.vertical, L.diagonal,
      Math.min(1, Math.max(0, (V.score - 1) / 8)), inside * Math.min(1, Math.max(0, (V.score - 1) / 8)),
      a.symLR, a.emptiness,
      ss.conf, Math.min(1, ss.area * 3),
      Math.min(1, st.edgeDensity * 4), st.warmCenter,
      a.brightness, Math.min(1, a.contrast),
    ];
  }

  const SCENE_TYPES = {
    portrait: '人像', food: '美食', landscape: '風景', perspective: '延伸', object: '物品',
  };

  /*
   * 自動判斷拍攝類型：
   *  - 偵測到夠大的人臉 → 人像（人臉偵測比其他特徵可靠）
   *  - 其他類型用「最近中心點」：和每種類型的平均特徵比距離（各特徵先除以標準差），越近機率越高
   * model 由 tools/testset.js fit 從標註照片產生；照片越多越準。
   */
  function classifyScene(a, model) {
    const P = a.person;
    return classifyFeatures(sceneFeatures(a), P ? P.faceSize : 0, model);
  }

  // 依特徵向量與最大臉寬判斷（測試工具會快取特徵，直接呼叫這個）
  function classifyFeatures(f, faceSize, model) {
    const probs = {};
    if (faceSize >= 0.05) {
      for (const k of Object.keys(SCENE_TYPES)) probs[k] = k === 'portrait' ? 0.9 : 0.1 / 4;
      return { type: 'portrait', conf: 0.9, probs };
    }
    if (!model || !model.centroids) return { type: 'object', conf: 0, probs: {} };
    const sd = model.std;
    // 只用模型挑選過的特徵（由 tools/testset.js fit 依標註照片選出）
    const use = (model.use || SCENE_FEATURES).map((n) => SCENE_FEATURES.indexOf(n)).filter((i) => i >= 0);
    const dist = {};
    for (const [k, c] of Object.entries(model.centroids)) {
      let d2 = 0;
      for (const i of use) { const z = (f[i] - c[i]) / sd[i]; d2 += z * z; }
      dist[k] = d2 / use.length;
    }
    // 距離 → 機率（溫度依資料調整）
    let sum = 0;
    for (const k in dist) { probs[k] = Math.exp(-dist[k] / (model.temperature || 1)); sum += probs[k]; }
    let best = null;
    for (const k in probs) { probs[k] /= sum; if (!best || probs[k] > probs[best]) best = k; }
    // 有小人臉（例如風景中的人）時，人像也列為可能
    if (faceSize > 0) { probs.portrait = 0.3; }
    return { type: best, conf: probs[best], probs };
  }

  /*
   * 各拍攝類型的構圖設定：
   *   drop：這個類型不適用的構圖
   *   bonus：加減分（讓適合的構圖排前面）
   *   faces：是否把人臉當成主體（美食、延伸、物品模式下，背景路人不該變成主體）
   *   tip：顯示在說明區的一行拍攝要點
   * 「general」= 不分類型，維持原本的邏輯（自動模式沒有把握時使用）。
   * 之後的美食模式、延伸模式會在這裡加入各自專用的構圖。
   */
  const PROFILES = {
    general: { drop: [], bonus: {}, faces: true, tip: '' },
    portrait: {
      drop: ['diagonal'], bonus: { 'p-thirds': 6, 'p-center': 6, 'p-headshot': 6, 'p-group': 6, space: -8, horizon: -8 },
      faces: true, tip: '人像：眼睛放在上三分線，頭頂留一點空間，不要切在關節。',
      noPersonTip: '沒有偵測到正面的臉：點畫面上的人，指定為主體',
    },
    food: {
      drop: ['horizon', 'reflection', 'diagonal', 'center', 'thirds', 'golden', 'fill', 'space'], bonus: {},
      faces: false, tip: '美食：平的料理從正上方拍，有高度的食物（漢堡、飲料）從斜 45° 拍；畫面邊緣避開手機、紙巾等雜物。',
    },
    landscape: {
      drop: ['fill'], bonus: { horizon: 12, reflection: 10, space: 8, golden: 4 },
      faces: true, tip: '風景：先把水平線拉平，再決定天空和地面各佔多少。',
    },
    perspective: {
      drop: ['fill', 'space'], bonus: { center: 20, diagonal: 22, thirds: -5, horizon: -10 },
      faces: false, tip: '延伸：讓道路、走廊、建築的線條往遠方收斂，盡頭放在中央或三分點。',
    },
    object: {
      drop: ['horizon', 'reflection'], bonus: { fill: 16, thirds: 2, center: 6 },
      faces: false, tip: '物品：主體清楚、背景簡單，靠近一點讓細節成為主角。',
    },
  };

  function applyProfile(out, type, a) {
    const pf = PROFILES[type] || PROFILES.general;
    let list = out.filter((c) => !pf.drop.includes(c.id));
    if (!list.length) list = out; // 保底：不要讓清單變空
    for (const c of list) c.score += pf.bonus[c.id] || 0;
    if (pf.noPersonTip && a.subject.kind !== 'person') for (const c of list) if (!c.tips.includes(pf.noPersonTip)) c.tips.unshift(pf.noPersonTip);
    return list;
  }

  // ---------- 人物 ----------
  /*
   * 由人臉推估人物：pico 的偵測框大致是臉的正方形（框中心約在鼻樑）。
   * 依實拍照片校正：眼睛約在框中心上方 0.12 倍框高，頭頂約在上方 0.68 倍，下巴約在下方 0.55 倍；
   * 站立時從頭頂到腳底約 8 倍框高。
   */
  function buildPerson(faces) {
    const sorted = faces.slice().sort((a, b) => b.size - a.size);
    // 背景裡很小的路人臉不算主體
    const main = sorted.filter((f) => f.size >= sorted[0].size * 0.45);
    let x0 = 1, x1 = 0, top = 1, chin = 0, shoulders = 0, ex = 0, ey = 0, fs = 0, fsy = 0;
    let eyeMin = 1, eyeMax = 0;
    for (const f of main) {
      const sy = f.sizeY || f.size;
      x0 = Math.min(x0, f.cx - 0.6 * f.size); x1 = Math.max(x1, f.cx + 0.6 * f.size);
      top = Math.min(top, f.cy - 0.68 * sy);
      chin = Math.max(chin, f.cy + 0.55 * sy);
      shoulders = Math.max(shoulders, f.cy + 1.3 * sy);
      const eye = f.cy - 0.12 * sy;
      ex += f.cx; ey += eye; fs += f.size; fsy += sy;
      eyeMin = Math.min(eyeMin, eye); eyeMax = Math.max(eyeMax, eye);
    }
    const n = main.length;
    x0 = clamp(x0, 0, 1); x1 = clamp(x1, 0, 1);
    const yTop = clamp(top, 0, 1), yBot = clamp(shoulders, 0, 1);
    const box = { x: x0, y: yTop, w: Math.max(0.01, x1 - x0), h: Math.max(0.01, yBot - yTop) };
    return {
      kind: 'person',
      cx: ex / n, cy: ey / n,              // 主體點 = 眼睛
      box, area: box.w * box.h, conf: 1,
      count: n,
      faces: main,
      faceSize: fs / n, faceSizeY: fsy / n,
      headTop: top, chin, shoulders,
      eyeSpread: eyeMax - eyeMin,
      // 估計的全身範圍（頭頂到腳底約 8 倍框高），裁切時避免切到身體
      bodyBox: (() => {
        const feet = Math.min(1, top + 8 * (fsy / n));
        const bx0 = clamp(x0 - 0.6 * fs / n, 0, 1), bx1 = clamp(x1 + 0.6 * fs / n, 0, 1);
        return { x: bx0, y: yTop, w: bx1 - bx0, h: Math.max(0.01, feet - yTop) };
      })(),
    };
  }

  // 人像的共通提示（頭頂、下巴、脖子、關節、邊緣、合照眼線）
  function portraitTips(P) {
    const tips = [];
    const sy = P.faceSizeY;
    if (P.headTop < 0.01) tips.push('頭頂被切到了：鏡頭往上一點，或退後一步');
    else if (P.chin > 0.99) tips.push('下巴被切到了：鏡頭往下一點，或退後一步');
    else if (P.shoulders > 1 && 1 - P.chin < 0.5 * sy) tips.push('畫面下緣切在脖子：往下多拍一些到胸口，看起來比較自然');
    const f0 = P.faces[0];
    if (f0.cx - 0.6 * f0.size < 0.01 || f0.cx + 0.6 * f0.size > 0.99) tips.push('臉太貼近畫面邊緣：讓臉完整留在畫面內');
    // 關節（只對單人、看得到身體的照片估計）
    if (P.count === 1 && P.faceSize < 0.13) {
      // 依實拍照片校正：站立的人從頭頂到腳底約 8 個臉框高，膝蓋約在 5.8，腳踝約在 7.6
      const knee = P.headTop + 5.8 * sy, ankle = P.headTop + 7.6 * sy;
      const near = (y) => Math.abs(1 - y) < 0.35 * sy;
      if (near(knee)) tips.push('畫面下緣大約切在膝蓋：切在關節會顯得突兀，建議切在大腿中段，或拍到全身（依比例估計）');
      else if (near(ankle)) tips.push('畫面下緣大約切在腳踝：把腳完整拍進來，腳下再留一點空間（依比例估計）');
    }
    if (P.count >= 2 && P.eyeSpread > 0.6 * sy) tips.push('每個人的眼睛高度差很多：請高的人站後面或微蹲，讓視線大致在同一條線上');
    return tips;
  }

  // 眼睛的目標高度：上三分線，但要保證頭頂至少留 4% 的空間
  function eyeTargetY(P, base) {
    const eyeToTop = P.cy - P.headTop;
    return clamp(Math.max(base, eyeToTop + 0.04), 0.2, 0.6);
  }

  // ---------- 裁切 ----------
  /*
   * 讓點 C 落在裁切框內的相對位置 p，同時保持原畫面比例。
   * 回傳 crop（正規化座標，寬高同比例 s）與主體在裁切框中的實際位置。
   */
  function fitCrop(C, p, box, opt) {
    opt = opt || {};
    const minS = opt.minScale || 0.5;
    if (opt.fixed) {
      const s0 = clamp(opt.fixed, minS, 1);
      const x0 = clamp(C.x - p.x * s0, 0, 1 - s0), y0 = clamp(C.y - p.y * s0, 0, 1 - s0);
      const pos0 = { x: (C.x - x0) / s0, y: (C.y - y0) / s0 };
      return { crop: { x: x0, y: y0, w: s0, h: s0 }, pos: pos0, residual: dist(pos0, p) };
    }
    const big = 9;
    const lim = [
      p.x > 0 ? C.x / p.x : big,
      p.x < 1 ? (1 - C.x) / (1 - p.x) : big,
      p.y > 0 ? C.y / p.y : big,
      p.y < 1 ? (1 - C.y) / (1 - p.y) : big,
    ];
    let s = Math.min(1, ...lim);
    if (opt.scale) s = Math.min(s, opt.scale);
    // 裁切框至少要包得住主體
    const need = box ? Math.max(box.w, box.h) * 1.12 : 0;
    s = clamp(s, Math.max(minS, Math.min(1, need)), 1);
    const x = clamp(C.x - p.x * s, 0, 1 - s);
    const y = clamp(C.y - p.y * s, 0, 1 - s);
    const pos = { x: (C.x - x) / s, y: (C.y - y) / s };
    return { crop: { x, y, w: s, h: s }, pos, residual: dist(pos, p) };
  }

  /*
   * 比較好看的裁切：在可行的大小範圍內試幾種，挑「主體位置準、邊緣不切過物體、保留越多越好」的。
   * 邊緣有沒有切過物體，用裁切框四邊上的顯著性平均值判斷。
   */
  function bestCrop(a, C, p, box, opt) {
    opt = opt || {};
    const keep = opt.keep || box;
    const outside = (k) => {
      if (!keep) return 0;
      const ix = Math.max(0, Math.min(k.x + k.w, keep.x + keep.w) - Math.max(k.x, keep.x));
      const iy = Math.max(0, Math.min(k.y + k.h, keep.y + keep.h) - Math.max(k.y, keep.y));
      return 1 - (ix * iy) / Math.max(1e-6, keep.w * keep.h);
    };
    const base = fitCrop(C, p, box, opt);
    if (!a || !a.saliency) return base;
    const need = box ? Math.max(box.w, box.h) * 1.12 : 0;
    const lo = Math.max(opt.minScale || 0.5, Math.min(1, need));
    const hi = opt.scale ? Math.min(1, Math.max(opt.scale, lo)) : 1;
    let best = null;
    for (let i = 0; i <= 8; i++) {
      const sc = lo + (hi - lo) * i / 8;
      const f = fitCrop(C, p, box, Object.assign({}, opt, { fixed: sc }));
      const border = edgeSaliency(a, f.crop);
      const cost = f.residual * 3 + border * 0.9 + (1 - sc) * 0.6 + (opt.scale ? Math.abs(sc - opt.scale) * 1.5 : 0) + outside(f.crop) * 4;
      if (!best || cost < best.cost) best = Object.assign(f, { cost, border });
    }
    return best.residual <= base.residual + 0.02 || outside(base.crop) > 0.05 ? best : base;
  }

  function edgeSaliency(a, k) {
    if (k.w > 0.995) return 0;
    const w = a.width, h = a.height, S = a.saliency;
    const x0 = Math.round(k.x * (w - 1)), x1 = Math.round((k.x + k.w) * (w - 1));
    const y0 = Math.round(k.y * (h - 1)), y1 = Math.round((k.y + k.h) * (h - 1));
    let sum = 0, n = 0;
    const at = (x, y) => { sum += S[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)]; n++; };
    // 只計算真的有被裁掉的那幾條邊
    for (let x = x0; x <= x1; x += 2) { if (k.y > 0.005) at(x, y0); if (k.y + k.h < 0.995) at(x, y1); }
    for (let y = y0; y <= y1; y += 2) { if (k.x > 0.005) at(x0, y); if (k.x + k.w < 0.995) at(x1, y); }
    return n ? sum / n : 0;
  }

  // 目標點不能讓主體被推出畫面：依主體框相對於主體點的位置，限制目標的範圍
  function keepInside(t, C, box) {
    if (!box) return t;
    const m = 0.03;
    const l = C.x - box.x, r = box.x + box.w - C.x, u = C.y - box.y, d = box.y + box.h - C.y;
    const fx = (v, a, b) => (a <= b ? clamp(v, a, b) : (a + b) / 2);
    return { x: fx(t.x, l + m, 1 - r - m), y: fx(t.y, u + m, 1 - d - m) };
  }

  // 大的主體不硬推到三分點：越大越接近中央
  function sizeAware(t, S) {
    const big = Math.max(S.box.w, S.box.h);
    const k = clamp((big - 0.35) / 0.35, 0, 1);
    return { x: t.x + (0.5 - t.x) * k, y: t.y + (0.5 - t.y) * k };
  }

  // 黏著：之前選過的目標點如果仍是候選，就繼續用它，避免目標在幾個點之間跳來跳去
  function sticky(prev, id, best, cands, cost) {
    const pv = prev && prev[id];
    if (!pv) return best;
    const same = cands.find((c) => Math.abs(c.x - pv.x) < 0.02 && Math.abs(c.y - pv.y) < 0.02);
    if (!same) return best;
    return cost(same) < cost(best) + 0.25 ? same : best;
  }

  // ---------- 構圖建議 ----------
  const SIDE = (p) => (p.x < 0.5 ? '左' : '右') + (p.y < 0.5 ? '上' : '下');

  /*
   * opts.prev：上一次各構圖的目標點（{ id: {x, y} }），讓目標點保持穩定
   */
  function suggest(a, opts) {
    opts = opts || {};
    const prev = opts.prev || null;
    const S = a.subject;
    const C = { x: S.cx, y: S.cy };
    const out = [];
    const sizeOk = S.area > 0.015 && S.area < 0.4 ? 1 : 0;
    // 哪一側比較空：差距不明顯時，維持主體目前所在的那一側
    const wl = a.sideWeight.left, wr = a.sideWeight.right;
    const emptierRight = wr < wl * 0.85 ? true : wl < wr * 0.85 ? false : C.x < 0.5;
    // 左右對稱只有在畫面有直向結構（建築、人像）時才有意義；
    // 單純的水平線風景左右「看起來對稱」，但不該因此建議置中
    const symEff = a.symLR * clamp(a.lines.vertical * 3 + S.conf * 0.4, 0, 1);

    const P = S.kind === 'person' ? S : null;
    if (P) suggestPortrait(P, a, out, emptierRight, symEff, prev);
    if (!P && opts.type === 'food') suggestFood(S, a, out, emptierRight, prev, opts.tilt);

    // 1. 三分法（有人像時改用人像版本）
    if (!P) {
      const pts = [{ x: 1 / 3, y: 1 / 3 }, { x: 2 / 3, y: 1 / 3 }, { x: 1 / 3, y: 2 / 3 }, { x: 2 / 3, y: 2 / 3 }];
      const cost = (p) => {
        let c = dist(C, p);
        const wantLeft = emptierRight; // 右邊空 → 主體放左邊，視線往空的方向延伸
        if ((p.x < 0.5) !== wantLeft) c += 0.1;
        // 有水平線時，避免主體和水平線同高
        if (a.horizon.valid && Math.abs(p.y - a.horizon.y) < 0.08) c += 0.05;
        return c;
      };
      let best = pts.reduce((m, p) => (cost(p) < cost(m) ? p : m), pts[0]);
      best = sticky(prev, 'thirds', best, pts, cost);
      const score = 58 + 22 * S.conf + 10 * sizeOk - 30 * Math.max(0, symEff - 0.65);
      out.push(make('thirds', '三分法', score, best, a, {
        reason: `把主體放在${SIDE(best)}的三分點，${best.x < 0.5 ? '右' : '左'}側留出空間讓視線延伸，比置中更有張力。`,
        guide: 'thirds',
      }));
    }

    // 2. 黃金比例
    if (!P) {
      const pts = [{ x: PHI, y: PHI }, { x: 1 - PHI, y: PHI }, { x: PHI, y: 1 - PHI }, { x: 1 - PHI, y: 1 - PHI }];
      const cost = (p) => dist(C, p) + ((p.x < 0.5) !== emptierRight ? 0.1 : 0);
      let best = pts.reduce((m, p) => (cost(p) < cost(m) ? p : m), pts[0]);
      best = sticky(prev, 'golden', best, pts, cost);
      const small = S.area > 0.005 && S.area < 0.2 ? 1 : 0;
      const score = 50 + 18 * S.conf + 10 * small + 12 * a.emptiness - 30 * Math.max(0, symEff - 0.65);
      out.push(make('golden', '黃金比例', score, best, a, {
        reason: `主體落在黃金分割點（約 0.382）。比三分法更靠近中央一點，畫面較柔和，適合主體小、背景簡潔的場景。`,
        guide: 'golden',
      }));
    }

    // 3. 中央對稱
    if (!P) {
      const centerDist = dist(C, { x: 0.5, y: 0.5 });
      const symBonus = 56 * clamp((symEff - 0.45) / 0.5, 0, 1);
      const score = 32 + symBonus + (centerDist < 0.12 ? 10 : 0) + (S.area > 0.25 ? 10 : 0);
      out.push(make('center', '中央對稱', score, { x: 0.5, y: 0.5 }, a, {
        reason: symEff > 0.7
          ? `畫面左右對稱度 ${(a.symLR * 100).toFixed(0)}%，把對稱軸放在正中央，穩定又有秩序感。`
          : `主體${S.area > 0.25 ? '佔畫面比例大' : '明確'}，置中能直接吸引視線；建議讓兩側背景盡量一致。`,
        guide: 'center',
      }));
    }

    // 4. 水平線
    if (a.horizon.valid) {
      const skyRich = a.horizon.aboveTexture > a.horizon.belowTexture * 1.15;
      let ty = skyRich ? 2 / 3 : 1 / 3;
      if (prev && prev.horizon && Math.abs(a.horizon.aboveTexture - a.horizon.belowTexture) < 0.4 * Math.max(a.horizon.aboveTexture, a.horizon.belowTexture)) ty = prev.horizon.y;
      const strengthN = clamp((a.horizon.strength - 2.4) / 3, 0, 1);
      const score = 50 + 22 * strengthN + 8 * a.horizon.coverage;
      const tips = [];
      if (Math.abs(a.horizon.angle) >= 2) tips.push(`水平線傾斜約 ${Math.abs(a.horizon.angle)}°，請把手機往${a.horizon.angle > 0 ? '左（逆時針）' : '右（順時針）'}轉正`);
      const c = make('horizon', '水平線三分', score, { x: C.x, y: ty }, a, {
        reason: skyRich
          ? '天空的層次比地面豐富，把水平線壓到下三分之一，讓天空佔三分之二。'
          : '地面或水面的細節比天空多，把水平線放在上三分之一，避免畫面被切成兩半。',
        guide: 'horizon',
        anchor: { x: 0.5, y: a.horizon.y },
        tips,
      });
      c.horizonTarget = ty;
      out.push(c);
    }

    // 5. 倒影對稱（上下）
    if (a.horizon.valid && a.symTB > 0.62 && Math.abs(a.horizon.y - 0.5) < 0.22) {
      const score = 45 + 50 * clamp((a.symTB - 0.6) / 0.35, 0, 1);
      const c = make('reflection', '倒影對稱', score, { x: C.x, y: 0.5 }, a, {
        reason: `上下對稱度 ${(a.symTB * 100).toFixed(0)}%，像是水面倒影。把分界線放在正中央，讓上下互相呼應。`,
        guide: 'reflection',
        anchor: { x: 0.5, y: a.horizon.y },
      });
      c.horizonTarget = 0.5;
      out.push(c);
    }

    // 6. 留白
    if (S.area < 0.09 && a.emptiness > 0.45) {
      const p = { x: emptierRight ? 0.28 : 0.72, y: C.y < 0.5 ? 0.38 : 0.62 };
      const score = 46 + 40 * clamp((a.emptiness - 0.45) / 0.45, 0, 1) + 6 * S.conf;
      out.push(make('space', '大量留白', score, p, a, {
        reason: `背景約 ${(a.emptiness * 100).toFixed(0)}% 是乾淨的空白，主體小而清楚。把主體推到邊緣，讓空白成為畫面的一部分，營造寧靜感。`,
        guide: 'space',
        size: 'small',
      }));
    }

    // 7. 填滿畫面（裁切成特寫）
    if (!P && S.conf > 0.3 && S.area > 0.01 && S.area < 0.3) {
      const score = 42 + 26 * S.conf + (S.area < 0.12 ? 10 : 0);
      const c = make('fill', '主體特寫', score, { x: 0.5, y: 0.5 }, a, {
        reason: `主體只佔畫面 ${(S.area * 100).toFixed(0)}%，周圍資訊偏多。靠近一點讓主體填滿畫面，細節與情緒會更明顯。`,
        guide: 'fill',
        scale: clamp(Math.max(S.box.w, S.box.h) * 1.45, 0.3, 1),
        minScale: 0.3,
        size: 'large',
      });
      out.push(c);
    }

    // 8. 對角線
    if (a.lines.diagonal > 0.42 && a.lines.diagDominance > 0.6) {
      const pts = a.lines.diagDir === '/'
        ? [{ x: 1 / 3, y: 2 / 3 }, { x: 2 / 3, y: 1 / 3 }]
        : [{ x: 1 / 3, y: 1 / 3 }, { x: 2 / 3, y: 2 / 3 }];
      const p = dist(C, pts[0]) < dist(C, pts[1]) ? pts[0] : pts[1];
      const score = 44 + 70 * (a.lines.diagonal - 0.42) + 10 * (a.lines.diagDominance - 0.6);
      const c = make('diagonal', '對角線', score, p, a, {
        reason: `畫面中有明顯的「${a.lines.diagDir}」方向斜線，讓線條沿著對角線延伸，主體放在對角線與三分線的交點，帶出動感與縱深。`,
        guide: 'diagonal',
      });
      c.diagDir = a.lines.diagDir;
      out.push(c);
    }

    if (P) {
      // 人物夠大時，風景類構圖（水平線、留白、對角線）退居次要
      const big = P.faceSize >= 0.1;
      const tips = portraitTips(P);
      for (const c of out) {
        if (!c.id.startsWith('p-') && big) c.score -= 14;
        for (const t of tips) if (!c.tips.includes(t)) c.tips.push(t);
      }
    }
    const list = applyProfile(out, opts.type || 'general', a);
    for (const c of list) c.score = Math.round(clamp(c.score, 5, 98));
    list.sort((p, q) => q.score - p.score);
    return list;
  }

  function suggestPortrait(P, a, out, emptierRight, symEff, prev) {
    const fsz = P.faceSize;
    const who = P.count > 1 ? `${P.count} 個人` : '人物';

    if (P.count >= 2) {
      const ty = eyeTargetY(P, 0.36);
      out.push(make('p-group', '合照置中', 88, { x: 0.5, y: ty }, a, {
        reason: `偵測到 ${P.count} 張臉。讓整群人置中，眼睛連成的線放在上三分線附近，左右各留一點空間，避免邊上的人被切到。`,
        guide: 'portrait',
      }));
    }

    // 人像三分：眼睛在上三分線，人物偏一側，另一側留給視線
    {
      let tx = emptierRight ? 1 / 3 : 2 / 3;
      // 左右兩側差不多空時，沿用上一次的那一側
      const wl = a.sideWeight.left, wr = a.sideWeight.right;
      if (prev && prev['p-thirds'] && Math.abs(wl - wr) < 0.3 * Math.max(wl, wr)) tx = prev['p-thirds'].x;
      const ty = eyeTargetY(P, 1 / 3);
      const score = 80 + (fsz > 0.05 && fsz < 0.3 ? 6 : 0) - (P.count >= 2 ? 10 : 0);
      out.push(make('p-thirds', '人像三分', score, { x: tx, y: ty }, a, {
        reason: `把${who}的眼睛放在上三分線、人物偏${tx < 0.5 ? '左' : '右'}，${tx < 0.5 ? '右' : '左'}側留空間。如果${who}臉朝另一邊，改把人放在另一條三分線，讓視線前方有空間。`,
        guide: 'portrait',
      }));
    }

    // 人像置中：臉大、正對鏡頭（自拍、證件感的人像）
    if (P.count === 1) {
      const ty = eyeTargetY(P, 1 / 3);
      const score = 62 + (fsz > 0.25 ? 18 : 0) + 14 * clamp((symEff - 0.5) / 0.4, 0, 1);
      out.push(make('p-center', '人像置中', score, { x: 0.5, y: ty }, a, {
        reason: fsz > 0.25
          ? '臉部佔畫面比例大、正對鏡頭（像自拍），置中最自然；眼睛仍放在上三分線附近，頭頂留一點空間。'
          : '人物置中、背景左右平衡時，畫面穩定有力；眼睛放在上三分線附近。',
        guide: 'portrait',
      }));
    }

    // 頭肩特寫：人物在畫面中偏小時，靠近或裁切成特寫
    if (fsz < 0.2) {
      const scale = clamp(fsz / 0.3, 0.25, 1);
      const score = 58 + (fsz < 0.1 ? 10 : 0) - (P.count >= 2 ? 8 : 0);
      out.push(make('p-headshot', '頭肩特寫', score, { x: 0.5, y: 1 / 3 }, a, {
        reason: `臉只佔畫面寬度的 ${(fsz * 100).toFixed(0)}%。靠近一點、拍到肩膀或胸口，讓表情成為主角；畫面下緣不要切在脖子或關節。`,
        guide: 'portrait',
        scale, minScale: 0.25,
        size: 'large',
      }));
    }
  }

  /*
   * 拍攝角度（0° = 鏡頭朝正下方的俯拍，90° = 水平拍）：
   *  - 有手機傾斜感測器的值就用它（最準）
   *  - 否則用盤子橢圓的扁度估計：圓盤看起來的短軸／長軸 ≈ cos(角度)
   */
  function cameraAngle(a, tilt) {
    if (tilt != null && isFinite(tilt)) return { deg: tilt, source: 'sensor' };
    const d = a.subject.dish;
    if (d) return { deg: Math.acos(clamp(d.ratio, 0, 1)) * 180 / Math.PI, source: 'dish' };
    return null;
  }

  /*
   * 畫面邊緣的雜物：四邊各取 8% 寬的帶狀區域，排除主體範圍，看顯著性高不高。
   * 門檻依 27 張美食照片調整。
   */
  function edgeClutter(a, keepBox) {
    const w = a.width, h = a.height, S = a.saliency;
    const band = 0.08, sides = { 上: [0, 0], 下: [0, 0], 左: [0, 0], 右: [0, 0] };
    const kb = keepBox;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      if (kb && u >= kb.x && u <= kb.x + kb.w && v >= kb.y && v <= kb.y + kb.h) continue;
      const val = S[y * w + x];
      if (v < band) { sides.上[0] += val; sides.上[1]++; }
      if (v > 1 - band) { sides.下[0] += val; sides.下[1]++; }
      if (u < band) { sides.左[0] += val; sides.左[1]++; }
      if (u > 1 - band) { sides.右[0] += val; sides.右[1]++; }
    }
    const out = {};
    for (const k in sides) out[k] = sides[k][1] ? sides[k][0] / sides[k][1] : 0;
    return out;
  }
  const CLUTTER_THR = 0.28;

  function suggestFood(S, a, out, emptierRight, prev, tilt) {
    const span = Math.max(S.box.w, S.box.h);
    const ang = cameraAngle(a, tilt);
    const angTxt = ang ? `目前約 ${Math.round(ang.deg / 5) * 5}°${ang.source === 'dish' ? '（依盤子形狀估計）' : ''}` : '';
    const dish = S.dish;
    const foodBox = dish && dish.food ? dish.food.box : S.box;
    // 共通提示：邊緣雜物
    const tips = [];
    const cl = edgeClutter(a, S.box);
    const messy = Object.keys(cl).filter((k) => cl[k] > CLUTTER_THR);
    if (messy.length) tips.push(`畫面${messy.join('、')}側邊緣有搶眼的東西（餐具、紙巾、手機？），可以移開，或讓畫面避開`);
    const topDownHint = ang && ang.deg > 25 ? [`手機抬高、鏡頭朝正下方（${angTxt}）`] : [];

    // 1. 俯拍置中
    out.push(make('f-top', '俯拍置中', 76 + (ang && ang.deg < 20 ? 8 : 0), { x: 0.5, y: 0.5 }, a, {
      reason: '從正上方拍，盤子放在正中央、佔畫面約八成。最適合平的料理（麵、飯、披薩）和一桌多盤菜。',
      guide: 'center', tips: tips.slice(), span: { min: 0.6, max: 0.95 }, extra: topDownHint,
    }));

    // 2. 俯拍留白：盤子放三分點，另一側留白
    {
      const pts = [{ x: 1 / 3, y: 1 / 3 }, { x: 2 / 3, y: 1 / 3 }, { x: 1 / 3, y: 2 / 3 }, { x: 2 / 3, y: 2 / 3 }];
      const cost = (p) => dist({ x: S.cx, y: S.cy }, p) + ((p.x < 0.5) !== emptierRight ? 0.1 : 0);
      let best = pts.reduce((m, p) => (cost(p) < cost(m) ? p : m), pts[0]);
      best = sticky(prev, 'f-flatlay', best, pts, cost);
      out.push(make('f-flatlay', '俯拍留白', 70 + (ang && ang.deg < 20 ? 6 : 0), best, a, {
        reason: `從正上方拍，盤子放在${SIDE(best)}的三分點，${best.x < 0.5 ? '右' : '左'}側留白，可以放筷子、飲料或配菜，畫面更有生活感。`,
        guide: 'thirds', tips: tips.slice(), span: { min: 0.4, max: 0.7 }, extra: topDownHint,
      }));
    }

    // 3. 斜拍主角（約 45°）
    {
      const extra = [];
      if (ang && ang.deg < 25) extra.push(`手機往後傾，改成斜約 45° 拍（${angTxt}）`);
      else if (ang && ang.deg > 70) extra.push(`手機稍微往下，斜約 45° 最好（${angTxt}）`);
      const good = ang && ang.deg >= 30 && ang.deg <= 60;
      out.push(make('f-angle', '斜拍主角', 72 + (good ? 8 : 0), { x: 0.5, y: 0.58 }, a, {
        reason: '從斜 45° 拍，食物放在畫面中下方、佔滿寬度，能拍出高度和層次。適合漢堡、飲料、甜點這類有高度的食物。',
        guide: 'thirds', tips: tips.slice(), span: { min: 0.7, max: 1 }, extra,
      }));
    }

    // 4. 填滿畫面：靠近到盤緣被切掉，讓食物本身成為畫面
    out.push(make('f-fill', '填滿畫面', 64, { x: 0.5, y: 0.5 }, a, {
      reason: '再靠近一點，讓食物塞滿畫面，盤緣切掉也沒關係。食物的質感、醬汁和熱氣會更明顯。',
      guide: 'fill', tips: tips.slice(), span: { min: 1.05, max: 9 },
      // 裁切到食物本身的範圍（稍微留一點），盤緣切掉
      scale: clamp(Math.max(foodBox.w, foodBox.h) * 1.05, 0.3, 1), minScale: 0.3, keep: foodBox, noKeepInside: true,
    }));
  }

  function make(id, name, score, target, a, o) {
    const S = a.subject;
    const C = { x: S.cx, y: S.cy };
    const pick = target; // 調整前的候選點，供下一次「黏著」比對
    let fit;
    if (o.anchor && (id === 'horizon' || id === 'reflection')) {
      // 以水平線為準：讓水平線落在目標高度，水平方向以主體為準置中
      const sure = S.kind === 'person' || S.kind === 'locked' || S.conf >= 0.5;
      fit = bestCrop(a, { x: 0.5, y: o.anchor.y }, { x: 0.5, y: target.y }, null, { minScale: sure ? 0.6 : 0.8, keep: sure ? S.box : null });
    } else {
      if (S.kind !== 'person' && id !== 'center' && id !== 'fill' && !id.startsWith('f-')) target = sizeAware(target, S);
      if (!o.noKeepInside) target = keepInside(target, C, S.box);
      const sure = S.kind === 'person' || S.kind === 'locked' || S.conf >= 0.5;
      const minScale = sure ? o.minScale : Math.max(o.minScale || 0.5, 0.85);
      // 人像（特寫除外）要保住估計的全身，避免切在腿或腳
      const keep = o.keep || (S.kind === 'person' && id !== 'p-headshot' && S.faceSize < 0.13 ? S.bodyBox : S.box);
      fit = bestCrop(a, C, target, S.box, { scale: sure ? o.scale : undefined, minScale, keep });
    }
    // 拍攝時的移動提示：主體要從 C 移到 target（整個畫面座標）
    const aimFrom = o.anchor || C;
    const aimTo = o.anchor ? { x: o.anchor.x, y: target.y } : target;
    // 額外的拍攝提示（主體大小、拍攝角度）：沒做到就不算「到位」
    const extra = (o.extra || []).slice();
    extra.sized = !!o.span;
    if (o.span) {
      const span = Math.max(S.box.w, S.box.h);
      if (span < o.span.min) extra.push('靠近一點');
      else if (span > o.span.max) extra.push('退後一點');
    }
    return {
      id, name, score, target, pick,
      reason: o.reason,
      tips: o.tips || [],
      guide: o.guide,
      size: o.size || null,
      extra,
      crop: fit.crop,
      cropPos: fit.pos,
      cropResidual: fit.residual,
      aim: aimHint(aimFrom, aimTo, S, o.size, extra),
    };
  }

  /*
   * 移動提示：主體在畫面中要從 from 移到 to。
   * 手機往右移時，畫面中的東西會往左跑，所以「主體要往左」＝「手機往右」。
   * dx、dy 是主體在畫面中需要移動的量；sizeText 是遠近提示。
   */
  function aimHint(from, to, S, size, extra) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    const parts = [];
    const thr = 0.045;
    if (Math.abs(dx) > thr) parts.push(dx < 0 ? '手機往右' : '手機往左');
    if (Math.abs(dy) > thr) parts.push(dy < 0 ? '手機往下' : '手機往上');
    const nDir = parts.length;
    if (size === 'large' && S && (S.kind === 'person' ? S.faceSize < 0.2 : S.area < 0.12)) parts.push('靠近一點');
    if (size === 'small' && S && S.area > 0.12) parts.push('退後一點');
    // 有自己大小規則的構圖（extra 已處理靠近／退後）不套用一般的「主體太大就退後」
    if (!size && !(extra && extra.sized) && S && S.kind !== 'person' && S.area > 0.55) parts.push('退後一點');
    if (S && S.kind === 'person' && (S.headTop < 0.01 || S.chin > 0.99)) parts.push('退後一點');
    for (const e of extra || []) if (!parts.includes(e)) parts.push(e);
    return { dx, dy, dist: d, text: parts.join('、'), sizeText: parts.slice(nDir).join('、'), ok: parts.length === 0 };
  }

  const api = { analyze, suggest, findDishes, edgeClutter, fitCrop, bestCrop, aimHint, classifyScene, classifyFeatures, sceneFeatures, SCENE_FEATURES, SCENE_TYPES, PROFILES, PHI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhotoriumEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
