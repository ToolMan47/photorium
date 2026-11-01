/* Photorium 構圖相機：相機、即時分析、參考線、預覽與拍照 */
(function () {
  'use strict';
  const E = window.PhotoriumEngine;
  const $ = (id) => document.getElementById(id);
  const els = {
    stageWrap: $('stageWrap'), stage: $('stage'), view: $('view'), hint: $('hint'), srcTag: $('srcTag'),
    readout: $('readout'), camToggle: $('camToggle'), notice: $('notice'),
    modeAim: $('modeAim'), modeCrop: $('modeCrop'), chips: $('chips'),
    detailTitle: $('detailTitle'), reason: $('reason'), tips: $('tips'),
    fileIn: $('fileIn'), fileBtn: $('fileBtn'), shutter: $('shutter'), sceneBtn: $('sceneBtn'), sceneLabel: $('sceneLabel'),
    result: $('result'), resultImg: $('resultImg'), resultMeta: $('resultMeta'), resultTitle: $('resultTitle'),
    showCrop: $('showCrop'), showOrig: $('showOrig'), saveCrop: $('saveCrop'), saveOrig: $('saveOrig'),
    closeResult: $('closeResult'), toast: $('toast'), video: $('video'),
    lockTag: $('lockTag'), howto: $('howto'),
  };
  const ctx = els.view.getContext('2d');
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });

  const state = {
    source: 'none',        // 'live' | 'still'
    still: null,           // canvas / image
    stillName: '',
    sceneIndex: -1,
    cameraOk: false,
    facing: 'environment',
    stream: null,
    mode: 'aim',           // 'aim' | 'crop'
    analysis: null,
    smooth: null,
    comps: [],
    selectedId: null,
    lastChipRender: 0,
    lastAnalyze: 0,
    shot: null,
    lock: null,            // 使用者點選的主體：{ type: 'patch' | 'face', ... }
    prevTargets: {},       // 各構圖上一次的目標點（讓目標保持穩定）
    okLatched: false,      // 「構圖到位」狀態（加遲滯，避免一直閃）
    lostAt: -1e9,
    frozen: null,          // 選定構圖的固定目標：{ id, kind, target, horizonTarget }
    jump: 0,               // 自動主體突然跳到別處的連續次數
    disp: null,            // 畫面上實際繪製的位置（逐格平滑）
    dir: { axis: null },   // 目前提示的方向（加遲滯，避免左右來回）
    chipIds: '',
  };

  // ---------- 示範場景（程式繪製，不需外部圖片） ----------
  const SCENES = [
    { name: '海上日落', draw: drawSunset },
    { name: '霧中孤樹', draw: drawTree },
    { name: '對稱拱廊', draw: drawArcade },
  ];

  function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

  function drawSunset(c) {
    const g = c.getContext('2d'), W = c.width, H = c.height, R = rng(7);
    g.save();
    g.translate(W / 2, H / 2); g.rotate(3 * Math.PI / 180); g.translate(-W / 2, -H / 2);
    const hy = H * 0.5;
    let sky = g.createLinearGradient(0, -H * 0.1, 0, hy);
    sky.addColorStop(0, '#2b2152'); sky.addColorStop(0.45, '#a8436a'); sky.addColorStop(0.8, '#f08a4b'); sky.addColorStop(1, '#ffc46b');
    g.fillStyle = sky; g.fillRect(-W, -H, W * 3, hy + H);
    // 雲
    g.globalAlpha = 0.35;
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i % 2 ? '#ffd9a8' : '#7a3a6a';
      g.beginPath(); g.ellipse(R() * W, H * 0.08 + R() * H * 0.3, 80 + R() * 160, 8 + R() * 14, 0, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // 太陽
    g.fillStyle = '#fff1c2'; g.beginPath(); g.arc(W * 0.38, hy - 10, 46, Math.PI, 0); g.fill();
    // 海
    let sea = g.createLinearGradient(0, hy, 0, H * 1.2);
    sea.addColorStop(0, '#5a2c4a'); sea.addColorStop(1, '#120d22');
    g.fillStyle = sea; g.fillRect(-W, hy, W * 3, H * 2);
    // 倒影與波光
    for (let i = 0; i < 120; i++) {
      const y = hy + 6 + Math.pow(R(), 1.6) * H * 0.5;
      const spread = 30 + (y - hy) * 0.5;
      g.fillStyle = `rgba(255,${180 + R() * 50 | 0},120,${0.5 - (y - hy) / H})`;
      g.fillRect(W * 0.38 + (R() - 0.5) * spread * 2, y, 10 + R() * 40, 2);
    }
    g.restore();
    // 帆船剪影（不隨水平線傾斜的位置）
    g.fillStyle = '#0d0912';
    const bx = W * 0.71, by = H * 0.545;
    g.beginPath(); g.moveTo(bx - 50, by); g.lineTo(bx + 54, by); g.lineTo(bx + 36, by + 16); g.lineTo(bx - 36, by + 16); g.fill();
    g.beginPath(); g.moveTo(bx, by - 4); g.lineTo(bx, by - 120); g.lineTo(bx + 46, by - 10); g.fill();
    g.beginPath(); g.moveTo(bx - 4, by - 100); g.lineTo(bx - 4, by - 6); g.lineTo(bx - 44, by - 6); g.fill();
  }

  function drawTree(c) {
    const g = c.getContext('2d'), W = c.width, H = c.height, R = rng(3);
    let sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#d9dee0'); sky.addColorStop(0.7, '#eef0ec'); sky.addColorStop(1, '#c9cfc4');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // 山丘
    g.fillStyle = '#b7bfae';
    g.beginPath(); g.moveTo(0, H * 0.78);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, H * 0.76 - Math.sin(x / W * Math.PI) * H * 0.05);
    g.lineTo(W, H); g.lineTo(0, H); g.fill();
    // 樹
    const tx = W * 0.57, ty = H * 0.71;
    g.strokeStyle = '#2d2a24'; g.lineCap = 'round';
    g.lineWidth = 9; g.beginPath(); g.moveTo(tx, ty + 20); g.lineTo(tx + 2, ty - 50); g.stroke();
    g.fillStyle = '#2f3a2a';
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, r = R() * 46;
      g.beginPath(); g.arc(tx + Math.cos(a) * r * 1.2, ty - 80 + Math.sin(a) * r * 0.8, 18 + R() * 16, 0, Math.PI * 2); g.fill();
    }
    // 霧
    const fog = g.createLinearGradient(0, H * 0.55, 0, H);
    fog.addColorStop(0, 'rgba(238,240,236,0)'); fog.addColorStop(1, 'rgba(238,240,236,0.45)');
    g.fillStyle = fog; g.fillRect(0, 0, W, H);
  }

  function drawArcade(c) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    g.fillStyle = '#e8dcc6'; g.fillRect(0, 0, W, H);
    // 地面透視
    g.fillStyle = '#b9a787';
    g.beginPath(); g.moveTo(0, H); g.lineTo(W * 0.4, H * 0.62); g.lineTo(W * 0.6, H * 0.62); g.lineTo(W, H); g.fill();
    g.strokeStyle = '#a08f70'; g.lineWidth = 2;
    for (let i = -6; i <= 6; i++) { g.beginPath(); g.moveTo(W / 2 + i * 120, H); g.lineTo(W / 2 + i * 14, H * 0.62); g.stroke(); }
    // 拱門（左右對稱、越遠越小）
    for (let k = 0; k < 5; k++) {
      const s = Math.pow(0.72, k);
      const aw = W * 0.7 * s, ah = H * 0.8 * s;
      const x0 = W / 2 - aw / 2, y1 = H * 0.62 + (H * 0.38) * s;
      g.fillStyle = k % 2 ? '#d7c7a9' : '#c9b48f';
      g.fillRect(x0 - 40 * s, y1 - ah - 30 * s, aw + 80 * s, ah + 30 * s);
      g.fillStyle = k % 2 ? '#8a7454' : '#6f5c43';
      g.beginPath();
      g.moveTo(x0, y1); g.lineTo(x0, y1 - ah + aw / 2);
      g.arc(W / 2, y1 - ah + aw / 2, aw / 2, Math.PI, 0);
      g.lineTo(x0 + aw, y1); g.closePath(); g.fill();
    }
    // 盡頭的紅門
    g.fillStyle = '#b8342a'; g.fillRect(W / 2 - 34, H * 0.47, 68, 110);
    g.fillStyle = '#f2d16b'; g.beginPath(); g.arc(W / 2, H * 0.47, 34, Math.PI, 0); g.fill();
  }

  function loadScene(i) {
    state.sceneIndex = i % SCENES.length;
    const sc = SCENES[state.sceneIndex];
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    sc.draw(c);
    setStill(c, '示範：' + sc.name);
    els.sceneLabel.textContent = `示範 ${state.sceneIndex + 1}/${SCENES.length}`;
  }

  function setStill(src, label) {
    stopCamera();
    state.source = 'still';
    state.still = src;
    state.stillName = label;
    state.smooth = null;
    state.selectedId = null;
    state.prevTargets = {};
    state.lastChipRender = 0;
    setLock(null);
    els.srcTag.textContent = label;
    els.camToggle.hidden = !state.cameraOk;
    els.camToggle.textContent = '回到相機';
    analyzeNow(true);
    layout();
  }

  // ---------- 相機 ----------
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      state.stream = stream;
      els.video.srcObject = stream;
      await els.video.play().catch(() => {});
      await new Promise((res) => {
        if (els.video.videoWidth) return res();
        els.video.onloadedmetadata = () => res();
        setTimeout(res, 2500);
      });
      if (!els.video.videoWidth) throw new Error('no frames');
      state.cameraOk = true;
      state.source = 'live';
      state.smooth = null;
      state.selectedId = null;
      state.prevTargets = {};
      setLock(null);
      els.srcTag.textContent = '';
      els.camToggle.hidden = false;
      els.camToggle.textContent = '切換鏡頭';
      els.notice.hidden = true;
      layout();
      return true;
    } catch (e) {
      console.warn('camera unavailable', e);
      return false;
    }
  }

  function stopCamera() {
    if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  }

  function srcEl() { return state.source === 'live' ? els.video : state.still; }
  function srcSize() {
    if (state.source === 'live') return { w: els.video.videoWidth || 4, h: els.video.videoHeight || 3 };
    if (state.still) return { w: state.still.naturalWidth || state.still.width, h: state.still.naturalHeight || state.still.height };
    return { w: 4, h: 3 };
  }

  // ---------- 版面 ----------
  function layout() {
    const { w, h } = srcSize();
    const box = els.stageWrap.getBoundingClientRect();
    const scale = Math.min(box.width / w, box.height / h);
    const cw = Math.max(50, Math.floor(w * scale)), ch = Math.max(50, Math.floor(h * scale));
    els.stage.style.width = cw + 'px';
    els.stage.style.height = ch + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    els.view.width = Math.round(cw * dpr);
    els.view.height = Math.round(ch * dpr);
  }
  window.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe(els.stageWrap);

  // ---------- 分析 ----------
  /*
   * 人臉偵測：
   *  - 照片：長邊 640 px，完整兩階段掃描，每張照片只算一次
   *  - 即時：長邊 320 px、快速模式，每 0.45 秒一次；短暫偵測不到時沿用上一次（避免閃爍）
   */
  const faceCanvas = document.createElement('canvas');
  const fctx = faceCanvas.getContext('2d', { willReadFrequently: true });
  const faceState = { forStill: null, faces: [], lastRun: 0, lastSeen: 0 };
  function detectFaces(src, w, h, isStill) {
    const F = window.PhotoriumFace;
    if (!F) return [];
    if (isStill && faceState.forStill === src) return faceState.faces;
    const now = performance.now();
    if (!isStill && now - faceState.lastRun < 450) return faceState.faces;
    faceState.lastRun = now;
    const long = isStill ? 640 : 320;
    const k = long / Math.max(w, h);
    faceCanvas.width = Math.max(8, Math.round(w * k)); faceCanvas.height = Math.max(8, Math.round(h * k));
    fctx.drawImage(src, 0, 0, faceCanvas.width, faceCanvas.height);
    let faces = [];
    try { faces = F.detect(fctx.getImageData(0, 0, faceCanvas.width, faceCanvas.height), { fast: !isStill }); }
    catch (e) { console.warn('face detection failed', e); }
    if (isStill) { faceState.forStill = src; faceState.faces = faces; return faces; }
    if (faces.length) { faceState.faces = faces; faceState.lastSeen = now; }
    else if (now - faceState.lastSeen > 1000) faceState.faces = [];
    return faceState.faces;
  }

  function analyzeNow(isStill) {
    const src = srcEl();
    if (!src) return;
    const { w, h } = srcSize();
    const aw = isStill ? 200 : 160;
    work.width = aw; work.height = Math.max(8, Math.round(aw * h / w));
    wctx.drawImage(src, 0, 0, work.width, work.height);
    const data = wctx.getImageData(0, 0, work.width, work.height);
    let faces = detectFaces(src, w, h, isStill);
    const opts = {};
    if (state.lock && state.lock.type === 'face') {
      // 鎖定某個人：只用離鎖定位置最近的那張臉
      const L = state.lock;
      let best = null, bd = 0.25;
      for (const f of faces) { const d = Math.hypot(f.cx - L.cx, f.cy - L.cy); if (d < bd) { bd = d; best = f; } }
      if (best) { L.cx = best.cx; L.cy = best.cy; L.seen = performance.now(); faces = [best]; }
      else if (performance.now() - L.seen > 1500) { lostLock(); }
      else faces = L.last ? [L.last] : [];
      if (best) L.last = best;
    } else if (state.lock && state.lock.type === 'patch') {
      faces = [];
      const L = state.lock;
      if (!isStill) trackPatch(L, data);
      if (state.lock) opts.subject = { cx: L.cx, cy: L.cy, box: { x: L.cx - L.bw / 2, y: L.cy - L.bh / 2, w: L.bw, h: L.bh } };
    }
    opts.faces = faces;
    state.lastGray = data;
    const a = E.analyze(data, opts);
    // 自動偵測的主體突然跳到很遠的地方：要連續出現約 1 秒才採用，否則沿用原本的主體
    if (!isStill && state.smooth && !a.subject.kind && !state.smooth.subject.kind) {
      const ps = state.smooth.subject;
      if (Math.hypot(a.subject.cx - ps.cx, a.subject.cy - ps.cy) > 0.15) {
        state.jump++;
        if (state.jump < 5) a.subject = Object.assign({}, ps, { box: Object.assign({}, ps.box) });
        else { state.jump = 0; state.frozen = null; }
      } else state.jump = 0;
    }
    if (!isStill && state.smooth && state.smooth.subject.kind === a.subject.kind) {
      // 追蹤中的主體（人臉、點選）本身就準，平滑少一點；自動偵測的主體平滑多一點
      const k = a.subject.kind ? 0.5 : 0.25, s = state.smooth, n = a.subject;
      const lerp = (p, q) => p + (q - p) * k;
      n.cx = lerp(s.subject.cx, n.cx); n.cy = lerp(s.subject.cy, n.cy);
      n.box = { x: lerp(s.subject.box.x, n.box.x), y: lerp(s.subject.box.y, n.box.y), w: lerp(s.subject.box.w, n.box.w), h: lerp(s.subject.box.h, n.box.h) };
      n.area = n.box.w * n.box.h;
      n.conf = lerp(s.subject.conf, n.conf);
      if (a.horizon.valid && s.horizon.valid) {
        a.horizon.y = lerp(s.horizon.y, a.horizon.y);
        a.horizon.angle = Math.round(lerp(s.horizon.angle, a.horizon.angle) * 2) / 2;
      }
    }
    state.smooth = a;
    state.analysis = a;
    const comps = E.suggest(a, { prev: state.prevTargets });
    for (const c of comps) state.prevTargets[c.id] = c.pick;
    const now = performance.now();
    // 選中的構圖暫時從清單消失時（分數邊界），2.5 秒內沿用它，不要自動換掉
    let cur = comps.find((c) => c.id === state.selectedId);
    if (!cur && state.selSnap && state.selSnap.id === state.selectedId && now - state.selSnap.at < 2500 && !isStill) {
      cur = Object.assign({}, state.selSnap.comp);
      comps.push(cur);
    }
    if (!cur) { state.selectedId = comps[0] && comps[0].id; cur = comps[0]; state.frozen = null; }
    if (cur) {
      // 固定目標：同一個構圖選定後，目標點不再跟著主體跳動
      const S = a.subject;
      if (!state.frozen || state.frozen.id !== cur.id || state.frozen.kind !== (S.kind || 'auto')) {
        state.frozen = { id: cur.id, kind: S.kind || 'auto', target: cur.target, horizonTarget: cur.horizonTarget, reason: cur.reason };
      }
      const F = state.frozen;
      cur.target = F.target;
      cur.reason = F.reason; // 說明文字要和固定的目標一致
      if (F.horizonTarget != null) cur.horizonTarget = F.horizonTarget;
      const hz = cur.guide === 'horizon' || cur.guide === 'reflection';
      const from = hz ? { x: 0.5, y: a.horizon.y } : { x: S.cx, y: S.cy };
      const to = hz ? { x: 0.5, y: cur.horizonTarget } : (cur.guide === 'fill' ? { x: 0.5, y: 0.5 } : cur.target);
      cur.aim = E.aimHint(from, to, S, cur.size);
      if (comps.includes(cur)) state.selSnap = { id: cur.id, comp: cur, at: now };
    }
    state.comps = comps;
    // 建議清單：只在「有哪些構圖」改變時才重排，而且至少間隔 3 秒，避免一直跳
    const ids = comps.slice(0, 5).map((c) => c.id).join(',');
    if (isStill || (ids !== state.chipIds && now - state.lastChipRender > 3000) || !state.lastChipRender) {
      renderChips(); state.lastChipRender = now; state.chipIds = ids;
    }
    renderDetail();
    renderReadout();
  }

  // ---------- 點畫面指定主體 ----------
  const PATCH = 16; // 模板取樣格數（16×16）
  function grayAt(img, x, y) {
    const xi = Math.max(0, Math.min(img.width - 1, x | 0)), yi = Math.max(0, Math.min(img.height - 1, y | 0));
    const i = (yi * img.width + xi) * 4;
    return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  }
  function samplePatch(img, cx, cy, bw, bh) {
    const v = new Float32Array(PATCH * PATCH);
    let m = 0;
    for (let j = 0; j < PATCH; j++) for (let i = 0; i < PATCH; i++) {
      const x = (cx + (i / (PATCH - 1) - 0.5) * bw) * (img.width - 1);
      const y = (cy + (j / (PATCH - 1) - 0.5) * bh) * (img.height - 1);
      const g = grayAt(img, x, y); v[j * PATCH + i] = g; m += g;
    }
    m /= v.length;
    for (let k = 0; k < v.length; k++) v[k] -= m; // 去掉平均亮度，曝光變化時仍能比對
    return v;
  }
  function patchDiff(a, b) { let d = 0; for (let k = 0; k < a.length; k++) d += Math.abs(a[k] - b[k]); return d / a.length; }

  /* 模板比對追蹤：在上一次位置附近找最像的位置 */
  function trackPatch(L, img) {
    const R = 0.18, step = 1 / (img.width - 1);
    let best = null;
    for (let dy = -R; dy <= R; dy += step * 2) {
      for (let dx = -R; dx <= R; dx += step * 2) {
        const cx = L.cx + dx, cy = L.cy + dy;
        if (cx < 0 || cx > 1 || cy < 0 || cy > 1) continue;
        const d = patchDiff(L.tpl, samplePatch(img, cx, cy, L.bw, L.bh));
        if (!best || d < best.d) best = { d, cx, cy };
      }
    }
    if (!best) return;
    // 在最佳位置附近再細找一次
    const c0 = best;
    for (let dy = -step * 2; dy <= step * 2; dy += step) {
      for (let dx = -step * 2; dx <= step * 2; dx += step) {
        const d = patchDiff(L.tpl, samplePatch(img, c0.cx + dx, c0.cy + dy, L.bw, L.bh));
        if (d < best.d) best = { d, cx: c0.cx + dx, cy: c0.cy + dy };
      }
    }
    if (best.d > Math.max(14, L.base * 2.2)) {
      L.miss = (L.miss || 0) + 1;
      if (L.miss > 6) lostLock();
      return;
    }
    L.miss = 0;
    L.cx = best.cx; L.cy = best.cy;
    // 模板慢慢更新，適應角度與光線變化
    const now = samplePatch(img, L.cx, L.cy, L.bw, L.bh);
    for (let k = 0; k < now.length; k++) L.tpl[k] = L.tpl[k] * 0.9 + now[k] * 0.1;
  }

  function setLock(L) {
    state.lock = L;
    els.lockTag.hidden = !L;
    els.howto.hidden = !!L;
    state.prevTargets = {};
    state.okLatched = false;
    state.frozen = null;
    state.disp = null;
  }
  function lostLock() {
    setLock(null);
    state.lostAt = performance.now();
  }

  function onStageTap(ev) {
    if (!state.analysis || !els.result.hidden) return;
    const r = els.view.getBoundingClientRect();
    let u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    const mirror = state.source === 'live' && state.facing === 'user';
    if (mirror) u = 1 - u;
    const c = selected();
    if (state.mode === 'crop' && c) { u = c.crop.x + u * c.crop.w; v = c.crop.y + v * c.crop.h; }
    // 點到人臉 → 鎖定那個人
    for (const f of faceState.faces) {
      const sy = f.sizeY || f.size;
      if (Math.abs(u - f.cx) < f.size * 0.8 && Math.abs(v - f.cy) < sy * 1.3) {
        setLock({ type: 'face', cx: f.cx, cy: f.cy, seen: performance.now(), last: f });
        analyzeNow(state.source === 'still');
        return;
      }
    }
    // 其他 → 以點的位置建立模板；若點在自動偵測的主體框內，沿用框的大小
    const S = state.analysis.subject;
    const { w, h } = srcSize();
    let bw = 0.2, bh = 0.2 * w / h;
    const inBox = u >= S.box.x && u <= S.box.x + S.box.w && v >= S.box.y && v <= S.box.y + S.box.h;
    if (inBox && S.kind !== 'person' && S.box.w < 0.6 && S.box.h < 0.6) { bw = Math.max(0.08, S.box.w); bh = Math.max(0.08, S.box.h); }
    const img = state.lastGray;
    const tpl = samplePatch(img, u, v, bw, bh);
    // 基準差異：模板和自己附近一點點位移的差，用來判斷之後是否跟丟
    const base = patchDiff(tpl, samplePatch(img, u + 2 / img.width, v, bw, bh));
    setLock({ type: 'patch', cx: u, cy: v, bw, bh, tpl, base, miss: 0 });
    analyzeNow(state.source === 'still');
  }
  els.view.addEventListener('click', onStageTap);
  els.lockTag.addEventListener('click', () => { setLock(null); analyzeNow(state.source === 'still'); });

  function selected() { return state.comps.find((c) => c.id === state.selectedId) || state.comps[0]; }

  function renderReadout() {
    const a = state.analysis;
    if (!a) return;
    const s = a.subject;
    const hz = a.horizon.valid ? `${a.horizon.angle > 0 ? '+' : ''}${a.horizon.angle.toFixed(1)}°` : '—';
    const who = s.kind === 'person' ? `人臉 ${s.count} · 臉寬 ${(s.faceSize * 100).toFixed(0)}%` : `主體 ${(s.area * 100).toFixed(0)}% · 信心 ${(s.conf * 100).toFixed(0)}`;
    els.readout.textContent = `${who} · 水平線 ${hz} · 對稱 ${(a.symLR * 100).toFixed(0)}`;
  }

  function renderChips() {
    const top = state.comps.slice(0, 5);
    els.chips.textContent = '';
    for (const c of top) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', c.id === state.selectedId ? 'true' : 'false');
      b.dataset.id = c.id;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name;
      const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = c.score;
      const bar = document.createElement('span'); bar.className = 'bar';
      const fill = document.createElement('i'); fill.style.width = c.score + '%'; bar.appendChild(fill);
      b.append(nm, sc, bar);
      b.addEventListener('click', () => { state.selectedId = c.id; state.okLatched = false; state.frozen = null; state.dir.axis = null; renderChips(); renderDetail(); analyzeNow(state.source === 'still'); });
      els.chips.appendChild(b);
    }
  }

  function renderDetail() {
    const c = selected();
    if (!c) return;
    els.detailTitle.textContent = c.name;
    els.reason.textContent = c.reason;
    els.tips.textContent = '';
    for (const t of c.tips) { const li = document.createElement('li'); li.textContent = t; els.tips.appendChild(li); }
    // 選中的晶片同步
    for (const b of els.chips.children) b.setAttribute('aria-selected', b.dataset.id === c.id ? 'true' : 'false');
  }

  // ---------- 繪製 ----------
  function frame() {
    requestAnimationFrame(frame);
    const src = srcEl();
    const W = els.view.width, H = els.view.height;
    if (!src || !W) return;
    if (state.source === 'live') {
      const now = performance.now();
      if (now - state.lastAnalyze > 220 && els.video.readyState >= 2) { state.lastAnalyze = now; analyzeNow(false); }
    }
    const c = selected();
    const a = state.analysis;
    const { w: sw, h: sh } = srcSize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const dpr = W / els.stage.clientWidth;
    let T; // 畫面座標（0..1）→ 畫布像素
    const mirror = state.source === 'live' && state.facing === 'user';
    smoothDisplay(c, a);
    if (state.mode === 'crop' && c) {
      const k = state.disp ? state.disp.crop : c.crop;
      drawSrc(src, k.x * sw, k.y * sh, k.w * sw, k.h * sh, W, H, mirror);
      T = (p) => ({ x: mx((p.x - k.x) / k.w) * W, y: (p.y - k.y) / k.h * H });
    } else {
      drawSrc(src, 0, 0, sw, sh, W, H, mirror);
      T = (p) => ({ x: mx(p.x) * W, y: p.y * H });
    }
    function mx(x) { return mirror ? 1 - x : x; }
    if (!c || !a) return;
    drawOverlay(c, a, T, W, H, dpr);
    updateHint(c, a);
  }

  function drawSrc(src, sx, sy, sw, sh, W, H, mirror) {
    ctx.save();
    if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
    ctx.restore();
  }

  const COL = { guide: 'rgba(255,255,255,0.55)', faint: 'rgba(255,255,255,0.28)', focus: '#ffc531', ok: '#62e08f' };

  function line(x1, y1, x2, y2, color, width, dash) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }

  /*
   * 畫面上實際畫的點（主體黃點、目標圓圈、裁切框）每一格往最新的分析結果靠近，
   * 分析一秒只有約 4 次，直接畫會一頓一頓地跳。
   */
  function smoothDisplay(c, a) {
    if (!c || !a) return;
    const S = a.subject;
    const hz = c.guide === 'horizon' || c.guide === 'reflection';
    const from = hz ? { x: 0.5, y: a.horizon.y } : { x: S.cx, y: S.cy };
    const to = hz ? { x: 0.5, y: c.horizonTarget } : (c.guide === 'fill' ? { x: 0.5, y: 0.5 } : c.target);
    const now = performance.now();
    if (!state.disp || state.disp.id !== c.id || state.source === 'still') {
      state.disp = { id: c.id, from: { ...from }, to: { ...to }, crop: { ...c.crop }, t: now };
      return;
    }
    const D = state.disp;
    const dt = Math.min(0.1, (now - D.t) / 1000); D.t = now;
    const k = 1 - Math.exp(-dt / 0.15);
    const ease = (p, q) => { p.x += (q.x - p.x) * k; p.y += (q.y - p.y) * k; };
    ease(D.from, from); ease(D.to, to);
    for (const key of ['x', 'y', 'w', 'h']) D.crop[key] += (c.crop[key] - D.crop[key]) * k;
  }

  /*
   * 疊在取景畫面上的東西刻意只有三樣：淡淡的參考線、目標圓圈、主體黃點。
   * 移動方向只在上方的提示文字說一次。水平線歪掉時才另外畫出實際的水平線。
   */
  function drawOverlay(c, a, T, W, H, dpr) {
    const lw = 1 * dpr;
    const inCrop = state.mode === 'crop';
    const faint = 'rgba(255,255,255,0.32)';
    const vline = (f) => line(f * W, 0, f * W, H, faint, lw);
    const hline = (f) => line(0, f * H, W, f * H, faint, lw);
    switch (c.guide) {
      case 'golden': [E.PHI, 1 - E.PHI].forEach((f) => { vline(f); hline(f); }); break;
      case 'center': case 'reflection': vline(0.5); hline(0.5); break;
      case 'diagonal': if (c.diagDir === '/') line(0, H, W, 0, faint, lw); else line(0, 0, W, H, faint, lw); break;
      case 'fill': break;
      default: [1 / 3, 2 / 3].forEach((f) => { vline(f); hline(f); });
    }

    // 水平線歪了才畫出實際的水平線
    if (a.horizon.valid && Math.abs(a.horizon.angle) >= 2) {
      const t = Math.tan(a.horizon.angle * Math.PI / 180);
      const sz = srcSize(), ar = sz.w / sz.h;
      const p1 = T({ x: 0, y: a.horizon.y - t * 0.5 * ar }), p2 = T({ x: 1, y: a.horizon.y + t * 0.5 * ar });
      line(p1.x, p1.y, p2.x, p2.y, 'rgba(255,138,92,0.85)', 1.4 * dpr, [4 * dpr, 4 * dpr]);
    }

    if (inCrop && (c.guide === 'horizon' || c.guide === 'reflection')) return;
    const D = state.disp;
    const mirror = state.source === 'live' && state.facing === 'user';
    let from, to;
    if (inCrop) {
      const S = a.subject;
      from = T({ x: S.cx, y: S.cy });
      to = { x: (mirror ? 1 - c.target.x : c.target.x) * W, y: c.target.y * H };
      if (c.guide === 'fill') to = from;
    } else {
      from = T(D ? D.from : { x: a.subject.cx, y: a.subject.cy });
      to = T(D ? D.to : c.target);
    }
    const ok = inCrop ? c.cropResidual < 0.04 : state.okLatched;
    const col = ok ? COL.ok : COL.focus;
    const R = 18 * dpr;
    ctx.beginPath(); ctx.arc(to.x, to.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 4.5 * dpr; ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5 * dpr; ctx.stroke();
    ctx.beginPath(); ctx.arc(from.x, from.y, 7 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = state.lock ? '#fff' : 'rgba(0,0,0,0.55)'; ctx.lineWidth = (state.lock ? 2.5 : 1.5) * dpr; ctx.stroke();
  }

  /*
   * 手機移動方向（以螢幕上看到的方向計算，前鏡頭的鏡像也正確）。
   * 一次只提示一個方向（差最多的那一軸），而且加遲滯：
   * 開始提示要差 5% 以上，已經在提示的方向要回到 2% 以內才換。
   */
  function phoneDir(c) {
    const mirror = state.source === 'live' && state.facing === 'user';
    const ddx = mirror ? -c.aim.dx : c.aim.dx, ddy = c.aim.dy; // 主體在螢幕上要移動的量
    const D = state.dir;
    const ax = Math.abs(ddx), ay = Math.abs(ddy);
    if (D.axis === 'x' && ax < 0.02) D.axis = null;
    if (D.axis === 'y' && ay < 0.02) D.axis = null;
    // 另一軸明顯差更多時就換過去提示
    if (D.axis === 'x' && ay > ax * 1.5 + 0.03) D.axis = 'y';
    else if (D.axis === 'y' && ax > ay * 1.5 + 0.03) D.axis = 'x';
    if (!D.axis) { if (Math.max(ax, ay) > 0.05) D.axis = ax >= ay ? 'x' : 'y'; }
    if (D.axis === 'x') return ddx < 0 ? '→ 手機往右' : '← 手機往左';
    if (D.axis === 'y') return ddy < 0 ? '↓ 手機往下' : '↑ 手機往上';
    return '';
  }

  let lastHint = '';
  function updateHint(c, a) {
    let text, ok = false;
    const dist = c.aim.dist;
    const sizeIssue = !!c.aim.sizeText;
    // 遲滯：距離 < 0.04 進入「到位」，> 0.075 才離開，避免在邊界一直閃
    state.okLatched = state.okLatched ? (dist < 0.075 && !sizeIssue) : (dist < 0.04 && !sizeIssue);
    if (state.mode === 'crop') {
      const keep = Math.round(c.crop.w * c.crop.h * 100);
      if (c.crop.w > 0.97) text = '不需裁切，直接拍就是這個構圖';
      else if (keep < 15) text = `只保留 ${keep}% 畫面，建議直接靠近拍`;
      else text = `拍下後裁成這樣（保留 ${keep}%）`;
      ok = c.cropResidual < 0.04;
    } else {
      ok = state.okLatched;
      const move = phoneDir(c) || c.aim.sizeText || '';
      if (state.source === 'still') text = ok ? '構圖到位' : `拍攝時：${move.replace(/^[→←↑↓] /, '') || '微調位置'}`;
      else if (ok) text = '構圖到位，可以拍了';
      else if (performance.now() - state.lostAt < 2500) text = '主體跟丟了，請再點一次';
      else if (c.tips.length && /傾斜/.test(c.tips[0])) text = '先把水平線轉正';
      else text = move || '讓黃點進入圓圈';
    }
    const key = text + ok;
    if (key !== lastHint) {
      els.hint.textContent = text;
      els.hint.classList.toggle('ok', ok);
      els.shutter.classList.toggle('ready', ok && state.source === 'live');
      lastHint = key;
    }
  }

  // ---------- 拍照與輸出 ----------
  function capture() {
    const c = selected();
    const src = srcEl();
    if (!src || !c) return;
    const { w, h } = srcSize();
    const full = document.createElement('canvas');
    full.width = w; full.height = h;
    const fg = full.getContext('2d');
    const mirror = state.source === 'live' && state.facing === 'user';
    if (mirror) { fg.translate(w, 0); fg.scale(-1, 1); }
    fg.drawImage(src, 0, 0, w, h);
    const k = c.crop;
    const cw = Math.round(k.w * w), ch = Math.round(k.h * h);
    const crop = document.createElement('canvas');
    crop.width = cw; crop.height = ch;
    const kx = mirror ? (1 - k.x - k.w) : k.x;
    crop.getContext('2d').drawImage(full, Math.round(kx * w), Math.round(k.y * h), cw, ch, 0, 0, cw, ch);
    state.shot = {
      comp: c,
      full, crop,
      fullUrl: full.toDataURL('image/jpeg', 0.92),
      cropUrl: crop.toDataURL('image/jpeg', 0.92),
      time: new Date(),
    };
    // 取景提示模式：照著提示對好後拍，成片就是取景畫面；裁切預覽模式：成片是裁切版本
    state.shot.primary = state.mode === 'crop' ? 'crop' : 'orig';
    state.shot.hasCrop = k.w < 0.97;
    els.showCrop.hidden = !state.shot.hasCrop;
    els.showOrig.hidden = !state.shot.hasCrop;
    els.saveOrig.hidden = !state.shot.hasCrop;
    showResult(state.shot.primary);
    els.result.hidden = false;
    els.closeResult.focus();
  }

  function showResult(which) {
    const s = state.shot;
    if (!s) return;
    const isCrop = which === 'crop';
    els.resultImg.src = isCrop ? s.cropUrl : s.fullUrl;
    els.saveCrop.dataset.which = isCrop ? 'crop' : 'orig';
    els.saveCrop.textContent = '儲存這張照片';
    els.saveOrig.dataset.which = isCrop ? 'orig' : 'crop';
    els.saveOrig.textContent = isCrop ? '另存取景畫面' : '另存裁切版本';
    els.showCrop.classList.toggle('on', isCrop);
    els.showOrig.classList.toggle('on', !isCrop);
    els.resultTitle.textContent = `${s.comp.name}構圖`;
    const keep = Math.round(s.comp.crop.w * s.comp.crop.h * 100);
    els.resultMeta.textContent = isCrop
      ? `${s.crop.width} × ${s.crop.height} px · 保留 ${keep}% 畫面 · 適合度 ${s.comp.score}`
      : `${s.full.width} × ${s.full.height} px · 取景畫面`;
    els.toast.textContent = '';
  }

  function stamp(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  async function save(which) {
    const s = state.shot;
    if (!s) return;
    const canvas = which === 'crop' ? s.crop : s.full;
    const name = `photorium-${stamp(s.time)}-${which === 'crop' ? s.comp.id : 'original'}.jpg`;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    // 在 Claude 內：使用 downloads 能力；一般瀏覽器：直接下載
    let dl = null;
    if (window.claude && window.claude.use) { try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; } }
    if (dl) {
      try { await dl.save({ filename: name, data: blob }); els.toast.textContent = '已儲存 ' + name; }
      catch (e) { els.toast.textContent = e && e.code === 'declined' ? '已取消儲存' : '這裡無法儲存檔案，可以長按圖片另存'; }
      return;
    }
    if (window.claude) { els.toast.textContent = '這裡無法儲存檔案，可以長按或右鍵圖片另存'; return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    els.toast.textContent = '已下載 ' + name;
  }

  // ---------- 事件 ----------
  function setMode(m) {
    state.mode = m;
    els.modeAim.classList.toggle('on', m === 'aim'); els.modeAim.setAttribute('aria-selected', m === 'aim');
    els.modeCrop.classList.toggle('on', m === 'crop'); els.modeCrop.setAttribute('aria-selected', m === 'crop');
    lastHint = '';
  }
  els.modeAim.addEventListener('click', () => setMode('aim'));
  els.modeCrop.addEventListener('click', () => setMode('crop'));
  els.shutter.addEventListener('click', capture);
  els.sceneBtn.addEventListener('click', () => loadScene(state.sceneIndex + 1));
  els.camToggle.addEventListener('click', async () => {
    if (state.source === 'live') { state.facing = state.facing === 'user' ? 'environment' : 'user'; }
    await startCamera();
  });
  /*
   * 讀取照片：
   * 1. createImageBitmap 直接解碼檔案（不經過 blob: 網址，預覽環境的安全政策擋不到；會套用 EXIF 方向）
   * 2. 不支援時改用 FileReader 轉成 data: 網址再載入
   * 最後一律畫進畫布並把長邊縮到 2400 px，避免手機上大照片超出畫布限制。
   */
  const MAX_SIDE = 2400;
  function toCanvas(src, w, h) {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  async function decodeFile(f) {
    if (window.createImageBitmap) {
      try {
        let bmp;
        try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); }
        catch (e) { bmp = await createImageBitmap(f); }
        const c = toCanvas(bmp, bmp.width, bmp.height);
        if (bmp.close) bmp.close();
        return c;
      } catch (e) { console.warn('createImageBitmap failed', e); }
    }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = () => rej(r.error);
      r.readAsDataURL(f);
    });
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => rej(new Error('decode failed'));
      im.src = dataUrl;
    });
    return toCanvas(img, img.naturalWidth, img.naturalHeight);
  }
  /*
   * HEIC（iPhone 預設格式）：Safari 能直接解碼，Chrome／Edge／Firefox 不行。
   * 需要時才從 CDN 載入 heic2any（約 1.3 MB，內含 libheif），先轉成 JPEG 再解碼。
   */
  const isHeic = (f) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name || '');
  let heicLib = null;
  function loadHeicLib() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    if (heicLib) return heicLib;
    heicLib = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
      const timer = setTimeout(() => rej(new Error('timeout')), 20000);
      s.onload = () => { clearTimeout(timer); window.heic2any ? res(window.heic2any) : rej(new Error('no global')); };
      s.onerror = () => { clearTimeout(timer); rej(new Error('load failed')); };
      document.head.appendChild(s);
    });
    heicLib.catch(() => { heicLib = null; });
    return heicLib;
  }
  async function decodeHeic(f) {
    const heic2any = await loadHeicLib();
    let out = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.92 });
    if (Array.isArray(out)) out = out[0];
    return decodeFile(out);
  }

  els.fileIn.addEventListener('change', async () => {
    const f = els.fileIn.files && els.fileIn.files[0];
    els.fileIn.value = '';
    if (!f) return;
    els.notice.hidden = true;
    try {
      let c;
      try { c = await decodeFile(f); }
      catch (e) {
        if (!isHeic(f)) throw e;
        els.notice.hidden = false;
        els.notice.textContent = '正在轉換 HEIC 照片…（第一次需要下載解碼器，約 1.3 MB）';
        c = await decodeHeic(f);
        els.notice.hidden = true;
      }
      setStill(c, '照片：' + (f.name || '未命名'));
    } catch (e) {
      console.warn('photo load failed', f.type, f.name, e);
      els.notice.hidden = false;
      els.notice.textContent = isHeic(f)
        ? 'HEIC 照片轉換失敗（可能是網路擋住了解碼器）。可以改用 Safari 開啟，或先用 tools/heic2jpg.py 把照片轉成 JPG。'
        : `這張照片無法讀取（格式：${f.type || '未知'}）。請換一張 JPG、PNG 或 WebP 照片。`;
    }
  });
  els.showCrop.addEventListener('click', () => showResult('crop'));
  els.showOrig.addEventListener('click', () => showResult('orig'));
  els.saveCrop.addEventListener('click', () => save(els.saveCrop.dataset.which || 'crop'));
  els.saveOrig.addEventListener('click', () => save(els.saveOrig.dataset.which || 'orig'));
  els.closeResult.addEventListener('click', () => { els.result.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.result.hidden) els.result.hidden = true;
    if (e.key === ' ' && els.result.hidden && e.target === document.body) { e.preventDefault(); capture(); }
  });

  window.PhotoriumDebug = { state, analyzeNow };

  // ---------- 啟動 ----------
  async function boot() {
    loadScene(0);
    requestAnimationFrame(frame);
    const ok = await startCamera();
    if (!ok) {
      els.notice.hidden = false;
      els.notice.textContent = window.claude || window.self !== window.top
        ? '這個預覽環境不允許即時相機，目前顯示示範場景。可以點「照片」拍一張或從相簿選，看看構圖建議；要用即時取景，請開啟獨立網頁版本。'
        : '無法開啟相機（需要 HTTPS 或 localhost，並允許相機權限）。目前顯示示範場景，也可以點「照片」分析自己的照片。';
    }
  }
  boot();
})();
