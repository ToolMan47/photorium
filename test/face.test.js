// 人臉偵測回歸測試：用 test-photos 轉出的 RGBA 檔（tools/heic2jpg.py → 縮到 640 → .rgba）
// 用法：node test/face.test.js <rgba 資料夾>
const F = require('./face-load.js');
const fs = require('fs');
const dir = process.argv[2];
// 人工標註（2026-11-01，40 張抽樣）：有清楚正面人臉的照片
const expected = { IMG_5482: 1, IMG_6109: 1, IMG_6904: 1, IMG_6557: 1 };
let tp = 0, fn = 0, fp = 0;
for (const f of fs.readdirSync(dir).sort()) {
  const b = fs.readFileSync(dir + '/' + f); const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
  const faces = F.detect({ width: w, height: h, data: new Uint8ClampedArray(b.buffer, b.byteOffset + 8, w * h * 4) });
  const name = f.replace(/\..*/, ''), want = expected[name] || 0;
  tp += Math.min(want, faces.length); fn += Math.max(0, want - faces.length); fp += Math.max(0, faces.length - want);
  if (faces.length || want) console.log(name, 'want', want, 'got', faces.map(x => `(${x.cx.toFixed(2)},${x.cy.toFixed(2)} s${x.size.toFixed(2)} q${x.score.toFixed(0)})`).join(' '));
}
console.log(`命中 ${tp}，漏掉 ${fn}，誤判 ${fp}`);
