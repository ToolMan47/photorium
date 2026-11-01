const { chromium } = require('playwright');
const out = '/tmp/claude-0/-home-claude/ca02b018-7025-50b5-9494-f4d221197e97/scratchpad/shots/';
(async () => {
  const url = 'file://' + __dirname + '/../web/dist/index.html';
  // 1) 無相機
  let b = await chromium.launch();
  let p = await b.newPage({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  await p.goto(url); await p.waitForTimeout(1500);
  await p.screenshot({ path: out + 'm1.png' });
  for (let i = 2; i <= 3; i++) { await p.click('#sceneBtn'); await p.waitForTimeout(500); await p.screenshot({ path: out + `m${i}.png` }); }
  console.log(await p.$$eval('.chip', cs => cs.map(c => c.textContent)));
  await p.click('#modeCrop'); await p.waitForTimeout(300); await p.screenshot({ path: out + 'm3crop.png' });
  await p.click('#shutter'); await p.waitForTimeout(400); await p.screenshot({ path: out + 'm3shot.png' });
  await p.setViewportSize({ width: 1280, height: 800 }); await p.click('#closeResult'); await p.click('#sceneBtn'); await p.click('#modeAim'); await p.waitForTimeout(500);
  await p.screenshot({ path: out + 'desk.png' });
  console.log('errors no-cam:', errs);
  await b.close();
  // 2) 假相機
  b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const c = await b.newContext({ viewport: { width: 400, height: 820 }, permissions: ['camera'] });
  p = await c.newPage(); const e2=[]; p.on('pageerror', e => e2.push(e.message));
  await p.goto(url); await p.waitForTimeout(3000);
  console.log('src tag:', await p.textContent('#srcTag'), 'hint:', await p.textContent('#hint'), 'readout:', await p.textContent('#readout'));
  await p.screenshot({ path: out + 'live.png' });
  console.log('errors live:', e2);
  await b.close();
})();
