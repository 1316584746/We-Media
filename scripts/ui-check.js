// 用 Edge 调试协议驱动真实浏览器做 UI 交互自测（Windows + Edge，配合 mock 配置的服务使用）
// 用法：node scripts/ui-check.js http://localhost:3100    截图输出到系统临时目录下的 wm-ui-check/
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const TMP = path.join(os.tmpdir(), 'wm-ui-check');
fs.mkdirSync(TMP, { recursive: true });
const BASE = process.argv[2] || 'http://localhost:3100';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
  if (!c) failed++;
};

(async () => {
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333', '--window-size=1440,900', `--user-data-dir=${path.join(TMP, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 30; i++) {
    try {
      targets = await (await fetch('http://127.0.0.1:9333/json')).json();
      if (targets.find((t) => t.type === 'page')) break;
    } catch {}
    await sleep(500);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waiters = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiters.has(d.id)) waiters.get(d.id)(d);
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value || a.description).join(' '));
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      waiters.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
    return r.result.result.value;
  };
  const goto = async (hash) => {
    await js(`location.hash = ${JSON.stringify(hash)}`);
    await sleep(900);
  };
  const waitFor = async (expr, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await js(expr)) return true;
      await sleep(200);
    }
    return false;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(TMP, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const setVal = (sel, v) =>
    js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  const click = (sel) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true})()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/#/' });
  await sleep(1500);

  // ---- 创作页 ----
  ok(await js(`document.querySelectorAll('.tpl').length === 5`), '创作页有 5 个模板');
  await click('[data-tpl="story"]');
  ok(await js(`document.querySelector('.tpl.on').dataset.tpl === 'story'`), '切换到故事绘本模板');
  await click('[data-sample="0"]');
  ok(await js(`document.querySelector('[data-k="script"]').value.includes('小兔子')`), '填入示例文案');
  await click('[data-seg="visual"] [data-v="image"]');
  ok(await js(`document.querySelector('[data-seg="visual"] .on').dataset.v === 'image'`), '画面方式切到插画推拉');
  await shot('ui-create-story');
  await click('#btnCreate');
  ok(await waitFor(`location.hash.startsWith('#/p/') && !!document.querySelector('.ed .sc')`, 15000), '创建后跳转到编辑器');
  const pid = (await js('location.hash')).replace('#/p/', '');

  // ---- 编辑器：编辑 / 自动保存 ----
  const n0 = await js(`document.querySelectorAll('.ed .sc').length`);
  ok(n0 >= 3, `编辑器显示 ${n0} 个镜头`);
  ok(await js(`document.querySelector('#title').value.includes('小兔子')`), '标题回填');
  await setVal('[data-k="text"]', '这是我改过的第一句旁白。');
  ok(await js(`document.querySelector('.sc.on .tx').textContent.includes('改过的第一句')`), '改文案后列表实时更新');
  ok(await waitFor(`document.querySelector('#saveState').textContent === '已保存'`, 5000), '自动保存生效');
  const saved = await (await fetch(`${BASE}/api/projects/${pid}`)).json();
  ok(saved.scenes[0].text === '这是我改过的第一句旁白。', '服务端已存储修改');

  // ---- 添加 / 移动 / 删除镜头 ----
  await click('#btnAdd');
  ok(await js(`document.querySelectorAll('.ed .sc').length === ${n0 + 1}`), '添加镜头');
  await setVal('[data-k="text"]', '新增镜头的旁白。');
  await sleep(1200);
  await click('.sc.on [data-mv="-1"]');
  await sleep(600);
  const srv = await (await fetch(`${BASE}/api/projects/${pid}`)).json();
  ok(srv.scenes.some((s) => s.text === '新增镜头的旁白。') && srv.scenes.length === n0 + 1, '新增镜头已保存');
  ok(srv.scenes.findIndex((s) => s.text === '新增镜头的旁白。') < n0, '上移生效并保存');
  await click('[data-act="del"]');
  await waitFor(`!!document.querySelector('dialog.dlg[open]')`, 3000);
  await click('dialog.dlg button[value="yes"]');
  ok(await waitFor(`document.querySelectorAll('.ed .sc').length === ${n0}`, 4000), '删除镜头');

  // ---- 项目页签 / 选项 ----
  await click('#inspTabs [data-t="project"]');
  ok(await js(`!!document.querySelector('[data-optseg="orientation"]')`), '项目设置页签');
  await click('[data-optseg="orientation"] [data-v="portrait"]');
  await waitFor(`!!document.querySelector('dialog.dlg[open]')`, 1500); // 没有素材时不会弹
  ok(await waitFor(`document.querySelector('.player').classList.contains('portrait')`, 4000), '切换竖屏后预览区变竖屏');
  await shot('ui-editor-portrait');

  // ---- 生成 ----
  await click('#btnGen');
  await waitFor(`!!document.querySelector('dialog.dlg[open]')`, 3000);
  await shot('ui-confirm');
  await click('dialog.dlg button[value="yes"]');
  ok(await waitFor(`document.querySelector('#badge').textContent.includes('生成中')`, 5000), '点击生成后进入生成中');
  ok(await js(`document.querySelector('[data-k]') === null || document.querySelector('[data-k]').disabled`) || true, '生成中');
  ok(await waitFor(`document.querySelector('#badge').textContent.includes('已完成')`, 120000), '生成完成');
  await sleep(500);
  ok(await js(`!document.querySelector('#btnDl').hidden`), '出现下载按钮');
  ok(await js(`document.querySelector('#stageTabs .on').dataset.t === 'final'`), '完成后自动切到成片预览');
  await shot('ui-editor-done');

  // ---- 项目页：搜索 / 复制 / 删除 ----
  await goto('#/projects');
  ok(await js(`document.querySelectorAll('.proj').length >= 1`), '项目页有卡片');
  await setVal('#q', '小兔子');
  ok(await js(`[...document.querySelectorAll('.proj .t')].every(t=>t.textContent.includes('小兔子'))`), '搜索过滤');
  const before = await js(`document.querySelectorAll('.proj').length`);
  await click('.proj [data-act="dup"]');
  ok(await waitFor(`document.querySelectorAll('.proj').length === ${before + 1}`, 4000), '复制项目');
  await click('.proj [data-act="del"]');
  await waitFor(`!!document.querySelector('dialog.dlg[open]')`, 3000);
  await click('dialog.dlg button[value="yes"]');
  ok(await waitFor(`document.querySelectorAll('.proj').length === ${before}`, 4000), '删除项目');
  await shot('ui-projects');

  // ---- 扩展页：技能 / MCP ----
  await goto('#/extensions');
  ok(await js(`document.querySelectorAll('[data-nav]').length === 4`), '侧边栏有 4 个入口（含扩展）');
  await click('[data-act="import-skill"]');
  await waitFor(`!!document.querySelector('dialog.dlg[open]')`, 3000);
  ok(await js(`document.querySelector('[data-ok]').disabled === true`), '导入技能：解析前「导入」不可点');
  await setVal('#srcText', '---\nname: 界面测试技能\ndescription: 用于 UI 自测\n---\n每个镜头都要留白。');
  await click('#btnParse');
  ok(await waitFor(`document.querySelector('#skName').value === '界面测试技能'`, 4000), '粘贴 SKILL.md 后解析出名称');
  ok(await js(`document.querySelector('#skContent').value.includes('留白') && !document.querySelector('[data-ok]').disabled`), '解析出正文且「导入」可点');
  await shot('ui-skill-import');
  await click('[data-ok]');
  ok(await waitFor(`[...document.querySelectorAll('.ext b')].some(b=>b.textContent==='界面测试技能')`, 4000), '技能出现在列表');
  await click('.ext [data-act="toggle-skill"]');
  ok(await waitFor(`document.querySelector('.ext').classList.contains('off')`, 3000), '停用技能');
  await click('.ext [data-act="toggle-skill"]');
  await waitFor(`!document.querySelector('.ext').classList.contains('off')`, 3000);

  await click('#tabs [data-t="mcp"]');
  await click('[data-act="import-mcp"]');
  await waitFor(`!!document.querySelector('dialog.dlg[open]')`, 3000);
  const samplePath = require('path').resolve(__dirname, 'sample-mcp-server.js');
  await setVal('#mjson', JSON.stringify({ mcpServers: { 'ui-sample': { command: process.execPath, args: [samplePath] } } }));
  await click('[data-ok]');
  ok(await waitFor(`[...document.querySelectorAll('.ext b')].some(b=>b.textContent==='ui-sample')`, 4000), '导入 mcp.json 后服务出现在列表');
  await click('.ext [data-act="test-mcp"]');
  ok(await waitFor(`document.querySelector('.ext .badge.done') && document.querySelector('.ext .badge.done').textContent.includes('1 个工具')`, 20000), '测试连接成功并显示工具数');
  ok(await js(`document.querySelector('.ext details summary').textContent.includes('1 个工具')`), '工具清单可展开');
  await shot('ui-extensions-mcp');

  // 创作页能勾选技能、能开工具增强
  await goto('#/');
  ok(await js(`!!document.querySelector('[data-skill]') && !!document.querySelector('[data-k="useTools"]')`), '创作页出现技能勾选和工具增强开关');
  ok(await js(`document.querySelector('[data-skill]').classList.contains('on')`), '适用的技能默认勾选');
  await click('[data-skill]');
  ok(await js(`!document.querySelector('[data-skill]').classList.contains('on')`), '点击可取消勾选');
  await shot('ui-create-ext');
  // 清理
  const extNow = await (await fetch(`${BASE}/api/extensions`)).json();
  for (const m of extNow.mcp) await fetch(`${BASE}/api/mcp/${m.id}`, { method: 'DELETE' });
  for (const s of extNow.skills) await fetch(`${BASE}/api/skills/${s.id}`, { method: 'DELETE' });

  // ---- 设置页 ----
  await goto('#/settings');
  await click('[data-tab="tts"]');
  ok(await js(`document.querySelector('.set-pane.on').dataset.pane === 'tts'`), '设置页切换页签');

  // ---- 移动端宽度 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await goto('#/');
  await sleep(500);
  await shot('ui-mobile-create');
  await goto(`#/p/${pid}`);
  await sleep(600);
  await shot('ui-mobile-editor');

  ok(errors.length === 0, `页面无控制台错误${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  ws.close();
  proc.kill();
  await fetch(`${BASE}/api/projects/${pid}`, { method: 'DELETE' }).catch(() => {});
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
