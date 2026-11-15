#!/usr/bin/env node
/*
 * Photorium 測試照片集工具
 *
 * 先用 tools/testset_prep.py 把照片轉成分析用的快取（testset/cache/*.rgba），再執行：
 *
 *   node tools/testset.js eval   [labels.csv] [cache]   類型判斷準確率（留一交叉驗證）與混淆矩陣
 *   node tools/testset.js fit    [labels.csv] [cache]   用全部標註照片重新產生 web/src/scene-model.js
 *   node tools/testset.js report [labels.csv] [cache]   每張照片的判斷結果與前三名構圖
 *
 * 預設 labels.csv = testset/labels.csv，cache = testset/cache
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'web/src/engine.js'));
const F = require(path.join(ROOT, 'test/face-load.js'));

const [cmd = 'eval', labelsPath = path.join(ROOT, 'testset/labels.csv'), cacheDir = path.join(ROOT, 'testset/cache')] = process.argv.slice(2);

function readLabels(p) {
  const rows = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).slice(1);
  return rows.map((r) => { const [file, type, note = ''] = r.split(','); return { file: file.trim(), type: type.trim(), note }; })
    .filter((r) => r.file && E.SCENE_TYPES[r.type]);
}

function loadRgba(file) {
  const p = path.join(cacheDir, file + '.rgba');
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
  return { width: w, height: h, data: new Uint8ClampedArray(b.buffer, b.byteOffset + 8, w * h * 4) };
}

// 縮到寬 200 px（和網頁版分析照片時一樣）
function downscale(img, long) {
  const k = long / img.width;
  const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.width - 1, Math.floor(x / k)), sy = Math.min(img.height - 1, Math.floor(y / k));
    const si = (sy * img.width + sx) * 4, di = (y * w + x) * 4;
    out[di] = img.data[si]; out[di + 1] = img.data[si + 1]; out[di + 2] = img.data[si + 2]; out[di + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

function analyzeFile(file) {
  const img = loadRgba(file);
  if (!img) return null;
  const faces = F.detect(img); // 快取是長邊 640 px，和網頁版照片模式相同
  const small = downscale(img, 200);
  const a = E.analyze(small, { faces });
  a._img = small;
  return a;
}

// 留一交叉驗證：用 use 這組特徵時，有幾張判斷正確（人像由人臉決定，不在此計算）
function looScore(samples, use) {
  let ok = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.type === 'portrait' || (s.a.person && s.a.person.faceSize >= 0.05)) continue;
    const m = fitModel(samples.filter((_, j) => j !== i), use);
    if (E.classifyScene(s.a, m).type === s.type) ok++;
  }
  return ok;
}

// 貪婪前向挑選特徵：每次加入最能提高準確率的特徵，直到不再進步
function selectFeatures(samples) {
  const names = E.SCENE_FEATURES;
  let use = [], cur = -1;
  for (;;) {
    let bestName = null, bestV = cur;
    for (const n of names) {
      if (use.includes(n)) continue;
      const v = looScore(samples, [...use, n]);
      if (v > bestV) { bestV = v; bestName = n; }
    }
    if (!bestName) break;
    use.push(bestName); cur = bestV;
  }
  return use;
}

function fitModel(samples, use) {
  // 人像由人臉決定，不放進中心點
  const groups = {};
  for (const s of samples) if (s.type !== 'portrait') (groups[s.type] = groups[s.type] || []).push(s.f);
  const dim = samples[0].f.length;
  const all = samples.filter((s) => s.type !== 'portrait').map((s) => s.f);
  const mean = Array(dim).fill(0), std = Array(dim).fill(0);
  for (const f of all) f.forEach((v, i) => { mean[i] += v / all.length; });
  for (const f of all) f.forEach((v, i) => { std[i] += (v - mean[i]) ** 2 / all.length; });
  for (let i = 0; i < dim; i++) std[i] = Math.max(0.05, Math.sqrt(std[i])); // 下限避免樣本少時過度放大
  const centroids = {}, counts = {};
  for (const [k, fs_] of Object.entries(groups)) {
    centroids[k] = Array(dim).fill(0);
    for (const f of fs_) f.forEach((v, i) => { centroids[k][i] += v / fs_.length; });
    counts[k] = fs_.length;
  }
  return { features: E.SCENE_FEATURES, use: use || E.SCENE_FEATURES, centroids, std, counts, temperature: 0.5 };
}

const round = (a) => a.map((v) => +v.toFixed(4));

function main() {
  const labels = readLabels(labelsPath);
  const samples = [];
  for (const L of labels) {
    const a = analyzeFile(L.file);
    if (!a) { console.warn('找不到快取，略過：', L.file); continue; }
    samples.push({ ...L, a, img: a._img, f: E.sceneFeatures(a) });
  }
  if (!samples.length) { console.error('沒有可用的照片。請先執行 tools/testset_prep.py'); process.exit(1); }
  const types = Object.keys(E.SCENE_TYPES);

  if (cmd === 'fit') {
    const use = selectFeatures(samples);
    console.log('挑選的特徵：', use.join('、'));
    const m = fitModel(samples, use);
    const out = `/* 由 tools/testset.js fit 自動產生，請勿手動編輯。\n * 標註照片：${samples.length} 張（${Object.entries(m.counts).map(([k, v]) => E.SCENE_TYPES[k] + ' ' + v).join('、')}；人像另由人臉判斷）\n * 產生時間：${new Date().toISOString()}\n */\n(function (root) {\n  const model = ${JSON.stringify({ ...m, std: round(m.std), centroids: Object.fromEntries(Object.entries(m.centroids).map(([k, v]) => [k, round(v)])) }, null, 2).replace(/\n/g, '\n  ')};\n  if (typeof module !== 'undefined' && module.exports) module.exports = model;\n  else root.PhotoriumSceneModel = model;\n})(typeof window !== 'undefined' ? window : globalThis);\n`;
    fs.writeFileSync(path.join(ROOT, 'web/src/scene-model.js'), out);
    console.log('已更新 web/src/scene-model.js', m.counts);
    return;
  }

  if (cmd === 'eval' || cmd === 'report') {
    // 留一交叉驗證：每次拿掉一張，用其他照片產生模型，再判斷拿掉的那張
    const conf = {}; types.forEach((t) => { conf[t] = {}; types.forEach((u) => { conf[t][u] = 0; }); });
    let ok = 0;
    const rows = [];
    // 使用目前 scene-model.js 挑選的特徵（若有）
    let use;
    try { use = require(path.join(ROOT, 'web/src/scene-model.js')).use; } catch (e) { use = undefined; }
    const calib = [];
    for (let i = 0; i < samples.length; i++) {
      const rest = samples.filter((_, j) => j !== i);
      const m = fitModel(rest, use);
      const s = samples[i];
      const r = E.classifyScene(s.a, m);
      conf[s.type][r.type]++;
      if (r.type === s.type) ok++;
      calib.push({ conf: r.conf, ok: r.type === s.type });
      rows.push({ file: s.file, want: s.type, got: r.type, conf: r.conf, note: s.note, comps: E.suggest(s.type === 'portrait' || E.PROFILES[s.type].faces ? s.a : E.analyze(s.img, { faces: [] }), { type: s.type }).slice(0, 3).map((c) => c.name + c.score).join(' ') });
    }
    if (cmd === 'report') {
      for (const r of rows) console.log(`${r.file}\t標註 ${E.SCENE_TYPES[r.want]}\t判斷 ${E.SCENE_TYPES[r.got]} ${(r.conf * 100).toFixed(0)}%\t${r.want === r.got ? '✓' : '✗'}\t${r.comps}\t${r.note}`);
      console.log('');
    }
    console.log(`使用的特徵：${(use || E.SCENE_FEATURES).join('、')}`);
    console.log(`類型判斷準確率（留一交叉驗證）：${ok}/${samples.length} = ${(ok / samples.length * 100).toFixed(0)}%\n`);
    // 信心度門檻：信心度 ≥ t 的判斷有多少比例正確，用來決定自動模式何時才套用判斷結果
    console.log('信心度門檻    判斷張數    正確率');
    for (const t of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
      const sel = calib.filter((c) => c.conf >= t);
      if (sel.length) console.log(`  ≥ ${t.toFixed(1)}       ${String(sel.length).padStart(3)}        ${(sel.filter((c) => c.ok).length / sel.length * 100).toFixed(0)}%`);
    }
    console.log('');
    console.log('混淆矩陣（列 = 標註，欄 = 判斷）');
    console.log('        ' + types.map((t) => E.SCENE_TYPES[t]).join('  '));
    for (const t of types) {
      const n = types.reduce((a, u) => a + conf[t][u], 0);
      if (!n) continue;
      console.log(`${E.SCENE_TYPES[t]}(${n})`.padEnd(8) + types.map((u) => String(conf[t][u]).padStart(4)).join('  ') + `   正確 ${(conf[t][t] / n * 100).toFixed(0)}%`);
    }
    return;
  }
  console.error('未知的指令：' + cmd);
}
main();
