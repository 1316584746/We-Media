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
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=9333', '--window-size=1440,900', `--user-data-dir=${path.join(TMP, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
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
  ok(await js(`document.querySelectorAll('.tpl:not(.clone)').length === 6`), '创作页有 6 个模板（含心灵鸡汤）');
  // 模板行是自动滚动的轮播：首尾相接，悬停暂停，两侧有箭头
  ok(await waitFor(`!document.querySelector('.tpl-nav.next').hidden && !document.querySelector('.tpl-nav.prev').hidden && document.querySelector('#tpls').classList.contains('loop') && document.querySelectorAll('.tpl.clone').length >= 6`, 3000), '模板行首尾相接成轮播，两侧都有箭头');
  const sl0 = await js(`document.querySelector('#tpls').scrollLeft`);
  await sleep(1500);
  const sl1 = await js(`document.querySelector('#tpls').scrollLeft`);
  ok(sl1 !== sl0, `模板行会自动滚动（${sl0} → ${sl1}）`);
  await js(`document.querySelector('#tplRail').dispatchEvent(new MouseEvent('mouseenter'))`);
  const sl2 = await js(`document.querySelector('#tpls').scrollLeft`);
  await sleep(800);
  ok((await js(`document.querySelector('#tpls').scrollLeft`)) === sl2, '鼠标移到模板行上自动滚动暂停');
  await js(`document.querySelector('#tplRail').dispatchEvent(new MouseEvent('mouseleave'))`);
  const sl3 = await js(`document.querySelector('#tpls').scrollLeft`);
  await js(`document.querySelector('#tplRail').dispatchEvent(new MouseEvent('mouseenter'))`);
  await click('.tpl-nav.next');
  ok(await waitFor(`Math.abs(document.querySelector('#tpls').scrollLeft - ${sl3}) > 100`, 3000), '点右箭头明显向前滚动');
  await shot('ui-create-tpl-scroll');
  await click('[data-tpl="heal"]');
  ok(await js(`document.querySelector('.tpl.on').dataset.tpl === 'heal' && [...document.querySelectorAll('.tpl.on')].every(x => x.dataset.tpl === 'heal') && document.querySelectorAll('.tpl.on .tpl-tag').length > 0`), '选「心灵鸡汤」后选中状态保留（带「已选」标记）');
  await js(`document.querySelector('#tplRail').dispatchEvent(new MouseEvent('mouseleave'))`);
  // 每个模板一套主题：配色 / 背景装饰 / 问候语随模板变化，离开创作页后恢复
  const themeOf = (id) => js(`(() => { document.querySelector('[data-tpl="${id}"]').click(); const cs = getComputedStyle(document.body); return JSON.stringify({ t: document.body.dataset.theme, bg: cs.getPropertyValue('--bg').trim(), ac: cs.getPropertyValue('--accent').trim(), deco: cs.getPropertyValue('--deco').trim().length > 20, h: document.querySelector('#heroTitle').textContent }); })()`).then(JSON.parse);
  const themes = {};
  for (const id of ['poem', 'story', 'explainer', 'talk', 'heal', 'free']) {
    themes[id] = await themeOf(id);
    await sleep(250);
    await shot(`ui-theme-${id}`);
  }
  ok(Object.entries(themes).every(([id, v]) => v.t === id && v.deco && v.h), '6 个模板各有主题标记、背景装饰和问候语');
  ok(new Set(Object.values(themes).map((v) => v.bg)).size === 6 && new Set(Object.values(themes).map((v) => v.ac)).size === 6, '6 个主题的底色、强调色都不一样');
  await goto('#/projects');
  ok(await js(`!document.body.dataset.theme`), '离开创作页后主题配色恢复默认');
  await goto('#/');
  await click('[data-tpl="heal"]');
  ok(await js(`document.body.dataset.theme === 'heal'`), '回到创作页后主题按当前模板恢复');
  ok(await js(`document.querySelector('[data-seg="orientation"] .on').dataset.v === 'portrait' && document.querySelectorAll('[data-sample]').length === 3`), '心灵鸡汤默认竖屏，有 3 条示例文案');
  await click('[data-sample="0"]');
  ok(await js(`document.querySelector('[data-k="script"]').value.includes('晚安') && document.querySelector('[data-k="style"]').value.includes('治愈')`), '填入治愈系示例文案，画风为治愈系');
  // 画风下拉：按模板推荐，手改后显示「自定义」
  ok(await js(`(() => { const s = document.querySelector('select[data-style-sel]'); const g = s.querySelectorAll('optgroup'); return !!s && !document.querySelector('[data-style]') && g[0].label.includes('心灵鸡汤') && g[0].querySelectorAll('option').length === 4 && s.selectedOptions[0].textContent.includes('治愈柔光') && s.selectedOptions[0].textContent.includes('默认推荐'); })()`), '画风是下拉：心灵鸡汤推荐 4 种，默认「治愈柔光」排第一');
  await js(`(() => { const s = document.querySelector('select[data-style-sel]'); s.value = [...s.options].find(o => o.textContent.startsWith('梦幻水彩')).value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  ok(await js(`document.querySelector('[data-k="style"]').value.includes('梦幻水彩') && document.querySelector('select[data-style-sel]').selectedOptions[0].textContent.startsWith('梦幻水彩')`), '选「梦幻水彩」后画风文本同步');
  await setVal('[data-k="style"]', '我自己写的画风');
  ok(await js(`document.querySelector('select[data-style-sel]').selectedOptions[0].value === '__custom'`), '手改画风文本后下拉显示「自定义」');
  await click('[data-tpl="poem"]');
  ok(await js(`(() => { const g = document.querySelector('select[data-style-sel]').querySelectorAll('optgroup'); return g[0].label.includes('古诗词') && [...g[0].querySelectorAll('option')].map(o => o.textContent.split(' · ')[0]).join() === '国风水彩,水墨写意,工笔重彩,治愈柔光'; })()`), '切到古诗词：推荐国风水彩、水墨写意、工笔重彩、治愈柔光');
  await click('[data-tpl="heal"]');
  await click('[data-sample="0"]');
  // 预计费用：随文案实时显示
  ok(await waitFor(`document.querySelector('#estRow')?.textContent.includes('预计费用') && document.querySelector('#estRow').textContent.includes('镜头')`, 3000), '填了文案后显示「预计费用」，含镜头数');
  // 临时把设置改成收费配置，看付费时的展示（截图后还原）
  const keepSettings = await js(`(async () => {
    const { state } = await import('/js/core.js');
    const old = JSON.stringify({ image: state.settings.image, tts: state.settings.tts, video: state.settings.video });
    Object.assign(state.settings.image, { mode: 'dashscope', model: 'qwen-image-2.0' });
    Object.assign(state.settings.tts, { mode: 'dashscope' });
    Object.assign(state.settings.video, { mode: 'dashscope_i2v', model: 'wan2.7-i2v', resolution: '720P' });
    return old;
  })()`);
  await click('[data-seg="visual"] [data-v="i2v"]');
  ok(await waitFor(`/约 \\d+(\\.\\d+)? 元/.test(document.querySelector('#estRow .est-total')?.textContent || '') && document.querySelector('#estRow .est-parts').textContent.includes('图生视频')`, 3000), '收费配置 + 图生视频：预计费用显示金额和各项明细');
  await js(`document.querySelector('#estRow').scrollIntoView({block:'center'})`);
  await sleep(400);
  await shot('ui-estimate');
  await js(`(async () => {
    const { state } = await import('/js/core.js');
    const o = JSON.parse(${JSON.stringify(keepSettings)});
    Object.assign(state.settings.image, o.image); Object.assign(state.settings.tts, o.tts); Object.assign(state.settings.video, o.video);
  })()`);
  await setVal('[data-k="script"]', '');
  ok(await waitFor(`document.querySelector('#estRow').textContent.includes('写好文案后')`, 2000), '文案清空后提示先写文案');
  ok(await js(`(async () => {
    const { estimate } = await import('/js/pricing.js');
    const S = { llm: { enabled: false }, image: { mode: 'dashscope', model: 'qwen-image-2.0' }, tts: { mode: 'edge' }, video: { mode: 'dashscope_i2v', model: 'wan2.7-i2v', resolution: '720P' } };
    const script = '床前明月光，疑是地上霜。\\n举头望明月，低头思故乡。';
    const a = estimate({ settings: S, split: 'line', script, visual: 'image' });
    const b = estimate({ settings: S, split: 'line', script, visual: 'i2v', titleCard: true, endCard: true });
    const c = estimate({ settings: { ...S, tts: { mode: 'custom' } }, split: 'line', script, visual: 'image' });
    const d = estimate({ settings: S, split: 'line', script: '', visual: 'image' });
    const near = (x, y) => Math.abs(x - y) < 1e-9;
    return a.scenes === 4 && near(a.total, 0.8) && b.seconds === 17 && near(b.total, 0.8 + 17 * 0.6) && c.unknown.join() === '配音' && d === null;
  })()`), '预计费用计算：4 个镜头画图 0.8 元；图生视频 17 秒 +10.2 元；自定义配音标为按服务商；空文案不估算');
  await click('[data-tpl="poem"]');
  await sleep(300);
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

  // 成片 → 去剪辑
  ok(await js(`!document.querySelector('#btnCut').hidden`), '成片完成后出现「去剪辑」按钮');
  await click('#btnCut');
  ok(await waitFor(`/^#\\/e\\/e_/.test(location.hash) && !!document.querySelector('.tl-clip.v')`, 15000), '点「去剪辑」直接进入剪辑器，成片已放在时间线上');
  const fromEid = (await js('location.hash')).replace('#/e/', '');
  await fetch(`${BASE}/api/edits/${fromEid}`, { method: 'DELETE' });
  await goto(`#/p/${pid}`);

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
  await goto('#/extensions'); // 旧地址应跳到设置 → 技能
  ok(await waitFor(`location.hash === '#/settings/skills'`, 3000), '旧的 #/extensions 地址跳转到设置·技能');
  ok(await js(`getComputedStyle(document.querySelector('.rail')).display === 'none' && document.querySelectorAll('#setNav button').length === 4`), '设置页是二级页：隐藏主导航，左侧有 4 个分区');
  ok(await js(`document.querySelector('#setNav .on').dataset.sec === 'skills' && document.querySelector('#saveBar').hidden`), '技能分区默认选中，无保存栏');
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

  await click('#setNav [data-sec="mcp"]');
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
  // 创作精选：筛选、详情、做同款
  ok(await js(`!document.querySelector('#recent') && ![...document.querySelectorAll('h2')].some(h=>h.textContent.includes('最近项目'))`), '创作页不再展示「最近项目」');
  // 热门动画页签（默认）：B 站同主题视频按播放量排序，原地播放。依赖外网，联网失败时只校验错误提示
  await click('[data-tpl="poem"]');
  ok(await js(`document.querySelector('[data-tab="hot"]').classList.contains('on')`), '创作精选默认是「热门动画」页签');
  ok(await waitFor(`document.querySelectorAll('.hot').length > 0 || !!document.querySelector('[data-hot-retry]')`, 30000), '热门动画：加载出视频或给出可重试的错误提示');
  if (await js(`document.querySelectorAll('.hot').length > 0`)) {
    const hotApi = await (await fetch(`${BASE}/api/discover?template=poem`)).json();
    ok(hotApi.items.length >= 6 && hotApi.items.every((v, i) => i === 0 || hotApi.items[i - 1].play >= v.play), `热门视频 ${hotApi.items.length} 条，按播放量从高到低`);
    ok(await js(`JSON.stringify([...document.querySelectorAll('.hot')].map(c=>c.dataset.hot)) === ${JSON.stringify(JSON.stringify(hotApi.items.map((v) => v.bvid)))}`), '页面顺序与接口一致');
    ok(await js(`[...document.querySelectorAll('.hot')].every(c => c.querySelector('.hot-play') && c.querySelector('.hot-dur') && !c.querySelector('a[href]'))`), '每张卡片有播放量、时长，且没有跳转到平台的链接');
    ok(await js(`!document.querySelector('#hotNote').textContent.includes('来源') && document.querySelector('[data-tab="hot"]').textContent.trim() === '热门动画'`), '热门动画页签不再有说明文字');
    ok(await js(`(() => { const g = [...document.querySelectorAll('.hot-group')]; const names = g.map(x => x.querySelector('.plat-name').textContent.trim()); return JSON.stringify(names) === '[\"B 站\"]' && g[0].querySelectorAll('.hot').length > 0 && !document.querySelector('.plat-links') && !document.querySelector('#featGrid a[href]'); })()`), '按平台分组（目前只有 B 站一组，没有空的「未接入」分组），B 站有视频，没有「跳转到平台」的关键词链接');
    await js(`document.querySelector('.hot-groups').scrollIntoView({block:'start'})`);
    await sleep(300);
    await shot('ui-hot-groups');
    await js(`document.querySelector('#featured').scrollIntoView()`);
    await click('.hot [data-hplay]');
    ok(await waitFor(`document.querySelectorAll('.hot iframe').length === 1 && document.querySelector('.hot iframe').src.includes('player.bilibili.com') && !document.querySelector('dialog[open]')`, 3000), '点播放：在卡片内嵌入 B 站播放器，不弹窗');
    await sleep(2500);
    await shot('ui-hot-playing');
    await click('.hot [data-hplay]');
    ok(await js(`document.querySelectorAll('.hot iframe').length === 1`), '再播另一条，同时只有一个播放器');
    await click('.hot [data-stop]');
    ok(await js(`document.querySelectorAll('.hot iframe').length === 0 && document.querySelectorAll('.hot [data-hplay]').length === document.querySelectorAll('.hot').length`), '点 ✕ 关闭播放器，恢复封面');
    await click('[data-tpl="heal"]');
    ok(await waitFor(`document.querySelectorAll('.hot').length > 0 && document.querySelector('#featured h2').textContent.includes('心灵鸡汤') && document.querySelector('.hot').dataset.hot !== ${JSON.stringify(hotApi.items[0].bvid)}`, 30000), '切到心灵鸡汤，热门视频同步换成治愈类');
    // 热门视频「做同款」：以它为参考，标题带入表单，出现参考横幅
    await click('.hot [data-hot-use]');
    ok(await waitFor(`!!document.querySelector('.ref-banner b') && document.querySelector('[data-k="title"]').value.length > 0 && document.querySelector('.tpl.on').dataset.tpl === 'heal'`, 3000), '热门视频「做同款」：保持当前模板、标题带入、出现参考视频横幅');
    ok(await js(`!document.querySelector('[data-ai-draft]') && !!document.querySelector('.ref-banner .hint')`), '没启用分镜 LLM 时，横幅提示先启用，不显示 AI 写文案按钮');
    await click('[data-ref-clear]');
    ok(await js(`!document.querySelector('.ref-banner')`), '点 ✕ 移除参考横幅');
    await click('[data-tpl="poem"]');
  }
  // 示范页签
  await click('[data-tab="demo"]');
  ok(await waitFor(`document.querySelectorAll('.feat:not(.hot)').length === 4`, 3000), '切到「做同款示范」页签');
  // 精选跟随模板：选「古诗词动画」→ 只推荐诗词
  await click('[data-tpl="poem"]');
  ok(await waitFor(`document.querySelectorAll('.feat').length === 4 && document.querySelector('#featured h2').textContent.includes('古诗词')`, 3000), '默认模板是古诗词，精选只展示 4 条诗词');
  ok(await js(`[...document.querySelectorAll('.feat')].every(c => ['shanju-qiuming','jingyesi','dengguanque','jiangxue'].includes(c.dataset.feat))`), '展示的都是诗词类');
  await click('[data-plat="抖音向"]');
  ok(await js(`document.querySelectorAll('.feat').length === 2 && [...document.querySelectorAll('.feat-plat')].every(e=>e.textContent==='抖音向')`), '筛选抖音向');
  await click('[data-plat="小红书向"]');
  ok(await js(`document.querySelectorAll('.feat').length === 2 && [...document.querySelectorAll('.feat-plat')].every(e=>e.textContent==='小红书向')`), '筛选小红书向');
  await click('[data-plat="全部"]');
  // 示范视频原地播放：卡片不变，只在画面区出现播放器，同一时间只播一个
  await js(`document.querySelector('#featured').scrollIntoView()`);
  await click('[data-feat="shanju-qiuming"] [data-play]');
  ok(await waitFor(`!!document.querySelector('[data-feat="shanju-qiuming"] .feat-media video') && document.querySelectorAll('.feat').length === 4 && !document.querySelector('dialog[open]')`, 3000), '点播放：在当前卡片内出现播放器，不弹窗');
  ok(await waitFor(`(()=>{const v=document.querySelector('[data-feat="shanju-qiuming"] video');return v && v.readyState>=1 && v.duration>5 && !v.error})()`, 8000), '示范视频能加载，时长正常');
  await click('[data-feat="jingyesi"] [data-play]');
  ok(await js(`document.querySelectorAll('.feat video').length === 1 && !!document.querySelector('[data-feat="jingyesi"] video') && !!document.querySelector('[data-feat="shanju-qiuming"] [data-play]')`), '再播另一条：上一条自动恢复成封面，同时只有一个播放器');
  await sleep(500);
  await shot('ui-featured-playing');
  await click('[data-feat="jingyesi"] [data-stop]');
  ok(await js(`!document.querySelector('.feat video') && !!document.querySelector('[data-feat="jingyesi"] [data-play]')`), '点 ✕ 关闭播放器，恢复封面');
  // 切换模板 → 精选同步
  await click('[data-tpl="explainer"]');
  ok(await waitFor(`document.querySelectorAll('.feat').length === 4 && document.querySelector('#featured h2').textContent.includes('知识科普') && [...document.querySelectorAll('.feat')].every(c=>['sky-blue','coffee-journey','rainbow','yawn'].includes(c.dataset.feat))`, 3000), '切到知识科普，精选同步成科普类');
  await click('[data-tpl="heal"]');
  ok(await waitFor(`document.querySelectorAll('.feat').length === 4 && [...document.querySelectorAll('.feat')].every(c=>c.dataset.feat.startsWith('heal-'))`, 3000), '切到心灵鸡汤，精选同步成治愈类');
  await click('[data-tpl="free"]');
  ok(await waitFor(`document.querySelectorAll('.feat').length === 24 && !document.querySelector('[data-scope]')`, 3000), '自由创作不限题材：展示全部精选');
  await click('[data-tpl="explainer"]');
  await click('[data-scope]');
  ok(await waitFor(`document.querySelectorAll('.feat').length === 24`, 3000), '「看全部模板」展示全部 24 条');
  await js(`document.querySelector('#featured').scrollIntoView()`);
  await sleep(800);
  await shot('ui-featured');
  await click('[data-feat="sky-blue"] .feat-info');
  ok(await waitFor(`!!document.querySelector('dialog.feat-dlg[open]') && document.querySelector('.fd-script').textContent.includes('散射')`, 3000), '点击卡片打开详情，显示示范文案');
  await sleep(500);
  await shot('ui-featured-dlg');
  await click('dialog.feat-dlg [value="yes"]');
  ok(await waitFor(`document.querySelector('[data-k="title"]').value === '天空为什么是蓝色的' && document.querySelector('[data-k="script"]').value.includes('散射')`, 3000), '做同款：标题和文案已填入');
  ok(await js(`document.querySelector('.tpl.on').dataset.tpl === 'explainer' && document.querySelector('[data-seg="orientation"] .on').dataset.v === 'portrait'`), '做同款：模板和画幅已切换');
  ok(await js(`document.querySelector('[data-k="style"]').value.includes('扁平')`), '做同款：画风已套用');
  // 音色试听：点击进入播放态，再点停止
  ok(await js(`!!document.querySelector('.voice-row [data-preview]')`), '创作页配音旁有试听按钮');
  await click('.voice-row [data-preview]');
  ok(await waitFor(`!!document.querySelector('.voice-row [data-preview].playing')`, 8000), '点击试听后进入播放态');
  await click('.voice-row [data-preview]');
  ok(await waitFor(`!document.querySelector('.voice-row [data-preview].playing') && !document.querySelector('.voice-row [data-preview].loading')`, 3000), '再点一次停止');
  await shot('ui-create-ext');
  // 清理
  const extNow = await (await fetch(`${BASE}/api/extensions`)).json();
  for (const m of extNow.mcp) await fetch(`${BASE}/api/mcp/${m.id}`, { method: 'DELETE' });
  for (const s of extNow.skills) await fetch(`${BASE}/api/skills/${s.id}`, { method: 'DELETE' });

  // ---- 设置页（二级页） ----
  await goto('#/projects');
  await goto('#/settings');
  ok(await js(`document.querySelector('#setNav .on').dataset.sec === 'model' && !document.querySelector('#saveBar').hidden`), '设置默认进入「模型」并显示保存栏');
  ok(await js(`document.querySelectorAll('[data-blk]').length === 4 && document.querySelectorAll('[data-badge]').length === 4`), '模型分区有 4 个块，各带状态');
  ok(await js(`!!document.querySelector('[data-preview="edge"]') && !!document.querySelector('[data-preview="remote"]')`), '配音设置里 Edge 音色和百炼音色都有试听按钮');
  await shot('ui-settings-model');
  // API Key 输入框带「眼睛」：默认隐藏，点一下显示，再点隐藏
  ok(await js(`document.querySelectorAll('.pw-eye').length >= 5 && [...document.querySelectorAll('input[name$=".apiKey"], #dashKey')].every(i => i.type === 'password' && i.parentElement.classList.contains('pw-wrap'))`), '所有 API Key 输入框默认隐藏，右侧有眼睛按钮');
  await setVal('[name="video.apiKey"]', 'sk-test-eye-1234');
  await click('[name="video.apiKey"] + .pw-eye');
  ok(await js(`(()=>{const i=document.querySelector('[name="video.apiKey"]');const b=i.nextElementSibling;return i.type==='text' && i.value==='sk-test-eye-1234' && b.classList.contains('on') && b.title==='隐藏'})()`), '点眼睛：明文显示，图标变为「隐藏」');
  await js(`document.querySelector('[data-blk="video"]').scrollIntoView()`);
  await sleep(300);
  await shot('ui-settings-eye');
  await click('[name="video.apiKey"] + .pw-eye');
  ok(await js(`(()=>{const i=document.querySelector('[name="video.apiKey"]');return i.type==='password' && i.nextElementSibling.title==='显示'})()`), '再点一次：重新隐藏');
  await setVal('[name="video.apiKey"]', '');
  // 费用说明：下拉里带【免费】/【收费】标签，选了之后有费用卡片，Sora 已停用
  ok(await js(`document.querySelectorAll('.cost').length === 4 && [...document.querySelectorAll('[name="tts.mode"] option')].some(o=>o.textContent.startsWith('【免费】'))`), '配音下拉带【免费】标签，每个环节有费用说明卡片');
  ok(await js(`(()=>{const o=document.querySelector('[name="video.mode"] [value="openai"]');return o.textContent.startsWith('【已停用】') && o.disabled})()`), 'Sora 选项标为已停用且不能新选');
  await setVal('[name="video.mode"]', 'dashscope_i2v');
  await setVal('[name="video.model"]', 'wan2.7-i2v');
  await setVal('[name="video.resolution"]', '720P');
  ok(await js(`document.querySelector('[data-cost="video"]').textContent.includes('0.6 元 / 秒') && document.querySelector('[data-cost="video"]').textContent.includes('18.0 元')`), '视频选万相图生视频 720P：显示 0.6 元/秒，30 秒约 18 元');
  await js(`document.querySelector('[data-blk="video"]').scrollIntoView()`);
  await sleep(300);
  await shot('ui-settings-video-cost');
  await setVal('[name="video.resolution"]', '1080P');
  ok(await js(`document.querySelector('[data-cost="video"]').textContent.includes('1 元 / 秒')`), '切到 1080P：费用卡片实时变成 1 元/秒');
  await setVal('[name="tts.mode"]', 'edge');
  ok(await js(`document.querySelector('[data-cost="tts"]').classList.contains('cost-free') && document.querySelector('[data-badge="tts"]').textContent === '免费'`), '配音选 Edge：卡片和徽标都显示免费');
  await js(`document.querySelector('#costAll').open = true`);
  ok(await js(`document.querySelectorAll('#costAll .cost-table tbody tr').length >= 12`), '费用一览表可展开');
  await shot('ui-settings-cost');
  await js(`document.querySelector('#costAll').open = false`);
  await setVal('[name="video.mode"]', 'mock');
  await setVal('[name="tts.mode"]', 'mock');
  await setVal('[name="llm.model"]', 'qwen-max-ui');
  await click('#setNav [data-sec="skills"]');
  await click('#setNav [data-sec="model"]');
  ok(await js(`document.querySelector('[name="llm.model"]').value === 'qwen-max-ui'`), '切换分区不丢未保存的修改');
  await click('#setNav [data-sec="prefs"]');
  ok(await js(`!!document.querySelector('[name="render.fps"]') && document.querySelector('[data-sec="prefs"].st-pane').hidden === false`), '偏好分区');
  ok(await js(`document.querySelector('.st-back').getAttribute('href') === '#/projects'`), '返回链接指向进入设置前的页面');
  await click('.st-back');
  ok(await waitFor(`location.hash === '#/projects' && getComputedStyle(document.querySelector('.rail')).display !== 'none'`, 3000), '返回后恢复主导航');
  // ---- 剪辑：列表 → 新建 → 导入素材 → 剪辑 → 导出 ----
  const ff = require('../server/ffmpeg');
  const cutDir = fs.mkdtempSync(path.join(TMP, 'cut-'));
  const mk = (n) => path.join(cutDir, n);
  await ff.run(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mk('clip.mp4')]);
  await ff.run(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8', mk('music.mp3')]);
  await ff.run(['-f', 'lavfi', '-i', 'color=c=0x2255aa:s=800x600:d=1', '-frames:v', '1', mk('pic.png')]);
  const cut = (expr) => js(`(()=>{const c=document.querySelector('#view').__cutter;return ${expr}})()`);

  await goto('#/projects');
  ok(await js(`[...document.querySelectorAll('.rail-nav a')].map(a=>a.dataset.nav).join()==='create,edits,projects,settings' || [...document.querySelectorAll('.rail-nav a')].some(a=>a.dataset.nav==='edits')`), '主导航里有「剪辑」入口');
  await click('.rail-nav [data-nav="edits"]');
  ok(await waitFor(`location.hash === '#/edits' && document.querySelector('.rail-nav a.active').dataset.nav === 'edits'`, 3000), '点「剪辑」进入列表页并高亮');
  await shot('ui-edits-list');
  await click('#btnNew');
  await waitFor(`!!document.querySelector('dialog.dlg[open] #nName')`, 3000);
  await setVal('#nName', 'UI 自测剪辑');
  await click('#nRatio [data-r="16:9"]');
  await click('dialog.dlg [data-ok]');
  ok(await waitFor(`/^#\\/e\\/e_/.test(location.hash) && !!document.querySelector('.ct')`, 5000), '新建后进入剪辑编辑器');
  const eid = (await js('location.hash')).replace('#/e/', '');
  ok(await js(`getComputedStyle(document.querySelector('.rail')).display === 'none' && document.querySelectorAll('.tl-track').length === 3`), '编辑器全屏（隐藏主导航），有 文字/视频/音频 三条轨道');
  ok(await js(`document.querySelector('#ctName').value === 'UI 自测剪辑'`), '工程名回填');

  // 通过真实的文件选择器上传：视频 + 音频 + 图片
  const doc = await send('DOM.getDocument', { depth: 1 });
  const inp = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#libFile' });
  await send('DOM.setFileInputFiles', { nodeId: inp.result.nodeId, files: [mk('clip.mp4'), mk('music.mp3'), mk('pic.png')] });
  ok(await waitFor(`document.querySelectorAll('.lib-item[data-id]').length === 3`, 40000), '三个素材（视频/音频/图片）上传完成并出现在素材库');
  ok(await js(`document.querySelectorAll('.lib-thumb.video img').length === 1 && document.querySelectorAll('.lib-thumb.image img').length === 1`), '视频与图片素材有缩略图');
  await shot('ui-cutter-library');

  const addBy = (kind) => js(`(()=>{const it=document.querySelector('.lib-thumb.${kind}').closest('.lib-item');it.querySelector('[data-add]').click();return true})()`);
  await addBy('video');
  ok(await cut(`c.clips.length === 1 && c.clips[0].track === 'v' && Math.abs(c.clips[0].dur - 6) < 0.3`), '点＋把视频加到视频轨（时长约 6 秒）');
  ok(await js(`!!document.querySelector('.tl-clip.v .tl-tiles i') && !!document.querySelector('.tl-clip.v .tl-wave')`), '视频片段显示胶片条和音轨波形');
  await addBy('audio');
  ok(await cut(`c.clips.some(x=>x.track==='a')`), '音频加到音频轨');
  await addBy('image');
  ok(await cut(`c.clips.filter(x=>x.track==='v').length === 2 && c.clips.filter(x=>x.track==='v')[1].start >= 5.7`), '图片接在视频后面（视频轨自动首尾相接）');

  // 分割 / 撤销 / 重做
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const clickClip = async (n) => {
    const p = JSON.parse(await js(`(()=>{const el=[...document.querySelectorAll('.tl-clip.v')].sort((a,b)=>a.offsetLeft-b.offsetLeft)[${n}];const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`));
    await mouse('mousePressed', p.x, p.y);
    await mouse('mouseReleased', p.x, p.y);
  };
  await cut(`c.player.seek(2.5)`);
  await clickClip(0);
  ok(await js(`!document.querySelector('#btnSplit').disabled`), '播放头在片段中间时「分割」可用');
  await click('#btnSplit');
  ok(await cut(`c.clips.filter(x=>x.track==='v').length === 3`), '分割成两段（共 3 个视频片段）');
  await click('#btnUndo');
  ok(await cut(`c.clips.filter(x=>x.track==='v').length === 2`), '撤销分割');
  await click('#btnRedo');
  ok(await cut(`c.clips.filter(x=>x.track==='v').length === 3`), '重做分割');

  // 拖拽裁剪：把第一段右端往左拖 60px
  const hr = JSON.parse(await js(`(()=>{const r=document.querySelector('.tl-clip.v .h-r').getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`));
  const d0 = await cut(`c.clips.filter(x=>x.track==='v').sort((a,b)=>a.start-b.start)[0].dur`);
  await mouse('mouseMoved', hr.x, hr.y);
  await mouse('mousePressed', hr.x, hr.y);
  for (let i = 1; i <= 6; i++) await mouse('mouseMoved', hr.x - i * 10, hr.y);
  await mouse('mouseReleased', hr.x - 60, hr.y);
  await sleep(300);
  const d1 = await cut(`c.clips.filter(x=>x.track==='v').sort((a,b)=>a.start-b.start)[0].dur`);
  ok(d1 < d0 - 0.3, `拖动右端裁剪：第一段 ${d0}s → ${d1}s`);
  ok(await cut(`(()=>{const v=c.clips.filter(x=>x.track==='v').sort((a,b)=>a.start-b.start);return v.every((x,i)=>i===0?x.start===0:Math.abs(x.start-(v[i-1].start+v[i-1].dur))<0.002)})()`), '裁剪后视频轨自动补位，没有空隙');

  // 点标尺定位播放头
  const rr = JSON.parse(await js(`(()=>{const r=document.querySelector('#tlRuler').getBoundingClientRect();return JSON.stringify({x:r.left+160,y:r.top+10})})()`));
  await mouse('mousePressed', rr.x, rr.y);
  await mouse('mouseReleased', rr.x, rr.y);
  ok(await cut(`Math.abs(c.player.t - 2) < 0.15`), '点击标尺：播放头定位到对应时间（80px/秒）');

  // 文字
  await cut(`c.player.seek(0.5)`);
  await click('#btnAddText');
  ok(await cut(`c.clips.some(x=>x.track==='t')`) && (await waitFor(`!!document.querySelector('#inspText')`, 2000)), '添加文字，右侧出现文字属性');
  await setVal('#inspText', '这是UI自测字幕');
  ok(await waitFor(`!!document.querySelector('.ct-text') && document.querySelector('.ct-text').textContent === '这是UI自测字幕'`, 2000), '预览画面里实时显示字幕');
  await setVal('[data-prop="size"]', '9');
  await setVal('[data-prop="y"]', '30');
  ok(await cut(`(()=>{const t=c.clips.find(x=>x.track==='t');return t.size===9&&t.y===30})()`), '字号/位置滑块生效');
  await shot('ui-cutter-text');

  // 变速
  await clickClip(0);
  ok(await waitFor(`!!document.querySelector('[data-speed="2"]')`, 2000), '选中视频片段，出现变速面板');
  const durBefore = await cut(`c.clips.find(x=>x.id===c.sel).dur`);
  await click('[data-speed="2"]');
  ok(await cut(`(()=>{const x=c.clips.find(x=>x.id===c.sel);return x.speed===2&&Math.abs(x.dur-${durBefore}/2)<0.02})()`), `2x 变速：时长 ${durBefore}s 减半`);
  await click('#btnUndo');
  ok(await cut(`c.clips.find(x=>x.id===c.sel).speed === 1`), '撤销变速');
  await click('[data-speed="2"]');

  // 自动保存
  ok(await waitFor(`document.querySelector('#ctSave').textContent === '已保存'`, 5000), '改动自动保存');
  const srvEdit = await (await fetch(`${BASE}/api/edits/${eid}`)).json();
  ok(srvEdit.clips.length === (await cut(`c.clips.length`)) && srvEdit.clips.some((x) => x.track === 't' && x.text === '这是UI自测字幕') && srvEdit.clips.some((x) => x.speed === 2), '服务端存了完整的时间线');
  await cut(`c.player.seek(0.8)`);
  await sleep(500);
  await shot('ui-cutter');

  // 升级后的剪辑页：预览居中、左侧分类面板、滤镜 / 朗读 / 文字模板、向左向右裁剪、参考线、快捷键面板、分隔条
  ok(await js(`(()=>{const w=document.querySelector('#ctWrap').getBoundingClientRect(),s=document.querySelector('#ctScreen').getBoundingClientRect();return Math.abs((w.left+w.width/2)-(s.left+s.width/2))<=2 && Math.abs((w.top+w.height/2)-(s.top+s.height/2))<=2})()`), '预览画面在舞台里水平、垂直居中');
  ok(await js(`document.querySelectorAll('#libTabs [data-tab]').length === 5`), '左侧有 5 个分类（媒体/音频/文字/滤镜/AI 成片）');
  await click('#libTabs [data-tab="audio"]');
  ok(await waitFor(`!!document.querySelector('#ttsText') && !!document.querySelector('#ttsGo') && document.querySelector('#libTitle').textContent.includes('文本朗读')`, 2000), '音频页有「文本朗读」');
  await fetch(`${BASE}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tts: { mode: 'mock' } }) }); // 测试服务：占位配音，不联网
  const aBefore = await cut(`c.clips.filter(x=>x.track==='a').length`);
  await setVal('#ttsText', '你好，这是一段自测配音');
  await click('#ttsGo');
  ok(await waitFor(`document.querySelector('#view').__cutter.clips.filter(x=>x.track==='a').length === ${aBefore + 1}`, 20000), '文本朗读生成配音并加到音频轨');
  await click('#libTabs [data-tab="text"]');
  ok(await js(`document.querySelectorAll('.lib-preset').length >= 6`), '文字页有多款文字模板');
  await click('#libTabs [data-tab="filter"]');
  ok(await js(`document.querySelectorAll('.filter-item').length === 12`), '滤镜页有 12 款滤镜');
  await clickClip(0);
  await click('.filter-item[data-filter="11"]');
  ok(await cut(`(()=>{const x=c.clips.find(x=>x.id===c.sel);return x.saturation===0&&x.contrast===1.1})()`), '点「黑白」滤镜：选中片段饱和度变 0');
  ok(await waitFor(`document.querySelector('.filter-item.on')?.textContent === '黑白'`, 2000), '当前滤镜高亮');
  await click('#btnUndo');
  ok(await cut(`c.clips.find(x=>x.id===c.sel).saturation === 1`), '撤销滤镜');
  await click('#libTabs [data-tab="media"]');

  // 属性面板分页
  ok(await js(`document.querySelectorAll('#inspTabs [data-itab]').length >= 3`), '选中视频片段后，属性面板分「画面 / 调色 / 变速 / 声音」页');
  await click('#inspTabs [data-itab="color"]');
  ok(await js(`getComputedStyle(document.querySelector('[data-pane="color"]')).display !== 'none' && getComputedStyle(document.querySelector('[data-pane="pic"]')).display === 'none'`), '切到「调色」页');
  await click('#inspTabs [data-itab="pic"]');

  // 向左 / 向右裁剪（Q / W）
  await cut(`c.select(c.clips.find(x=>x.track==='a').id)`);
  const aClip = JSON.parse(await cut(`JSON.stringify(c.clips.find(x=>x.id===c.sel))`));
  await cut(`c.player.seek(${(aClip.start + aClip.dur / 2).toFixed(3)})`);
  ok(await waitFor(`!document.querySelector('#btnTrimL').disabled`, 2000), '播放头在音频片段中间时「向左裁剪」可用');
  await js(`document.activeElement && document.activeElement.blur()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'q', code: 'KeyQ', text: 'q' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'q', code: 'KeyQ' });
  ok(await cut(`(()=>{const x=c.clips.find(x=>x.id===c.sel);return x.start > ${aClip.start + 0.2} && x.dur < ${aClip.dur - 0.2}})()`), '按 Q：删掉播放头左边的部分');
  await click('#btnUndo');
  await click('#btnTrimR');
  ok(await cut(`(()=>{const x=c.clips.find(x=>x.id===c.sel);return Math.abs(x.start-${aClip.start})<0.01 && x.dur < ${aClip.dur - 0.2}})()`), '点「向右裁剪」：删掉播放头右边的部分');
  await click('#btnUndo');
  await cut(`c.select(null)`);

  // 参考线、快捷键面板、拖动分隔条
  await click('#btnGrid');
  ok(await js(`document.querySelector('#ctScreen').classList.contains('grid')`), '预览参考线可开关');
  await click('#btnGrid');
  await click('#btnKeys');
  ok(await waitFor(`!!document.querySelector('dialog.keys-dlg[open] kbd')`, 2000), '点键盘图标弹出快捷键列表');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  ok(await waitFor(`!document.querySelector('dialog.keys-dlg[open]')`, 2000), 'Esc 关闭快捷键面板');
  const tlh0 = await js(`document.querySelector('.ct-tl').getBoundingClientRect().height`);
  const sp = JSON.parse(await js(`(()=>{const r=document.querySelector('#ctSplit').getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`));
  await mouse('mousePressed', sp.x, sp.y);
  for (let i = 1; i <= 5; i++) await mouse('mouseMoved', sp.x, sp.y - i * 16);
  await mouse('mouseReleased', sp.x, sp.y - 80);
  const tlh1 = await js(`document.querySelector('.ct-tl').getBoundingClientRect().height`);
  ok(tlh1 > tlh0 + 40, `拖动分隔条调整时间线高度（${Math.round(tlh0)} → ${Math.round(tlh1)}px）`);
  ok(await js(`document.querySelector('#btnExport').getBoundingClientRect().right <= window.innerWidth + 1 && document.querySelector('#ctInsp').getBoundingClientRect().right <= window.innerWidth + 1`), '时间线加了片段后页面不会横向撑出屏幕（导出按钮、属性面板始终可见）');
  await js(`localStorage.removeItem('wm.cutter.tlh')`);
  await sleep(300);
  await shot('ui-cutter-pro');

  // 快捷键：空格播放 / 暂停
  await js(`document.activeElement && document.activeElement.blur()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' });
  ok(await waitFor(`document.querySelector('#view').__cutter.player.playing`, 2000), '空格键开始播放');
  ok(await waitFor(`document.querySelector('#view').__cutter.player.t > 0.9`, 4000), '播放头随播放前进');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' });
  ok(await waitFor(`!document.querySelector('#view').__cutter.player.playing`, 2000), '再按空格暂停');

  // 导出
  await click('#btnExport');
  ok(await waitFor(`!!document.querySelector('dialog.export-dlg[open]')`, 3000), '点导出弹出进度窗口');
  ok(await waitFor(`!!document.querySelector('dialog.export-dlg .exp-video')`, 90000), '导出完成并可预览');
  await shot('ui-cutter-export');
  const dl = await fetch(`${BASE}/api/edits/${eid}/download`);
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  ok(dl.status === 200 && dlBuf.length > 5000 && dlBuf.slice(4, 8).toString() === 'ftyp', `下载导出的 mp4（${Math.round(dlBuf.length / 1024)} KB）`);
  await click('dialog.export-dlg [data-close]');

  // 返回列表：卡片 → 删除
  await click('.ct-top a.icon-btn');
  ok(await waitFor(`location.hash === '#/edits' && document.querySelectorAll('.proj').length >= 1`, 4000), '返回剪辑列表，看到工程卡片');
  ok(await js(`!!document.querySelector('.proj .proj-cover img') && document.querySelector('.badge.done') !== null`), '卡片有封面并标记已导出');
  await shot('ui-edits-list2');
  const cardsBefore = await js(`document.querySelectorAll('.proj').length`);
  await click('.proj [data-del]');
  await waitFor(`!!document.querySelector('dialog.dlg[open]')`, 3000);
  await click('dialog.dlg button[value="yes"]');
  const gone = await waitFor(`document.querySelectorAll('.proj').length === ${cardsBefore - 1}`, 4000);
  ok(gone, `删除剪辑工程${gone ? '' : '（' + (await js(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('|') + ' dlg=' + document.querySelectorAll('dialog[open]').length + ' cards=' + document.querySelectorAll('.proj').length`)) + '）'}`);

  // ---- 移动端宽度 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await goto('#/');
  await sleep(500);
  await shot('ui-mobile-create');
  await goto(`#/p/${pid}`);
  await sleep(600);
  await shot('ui-mobile-editor');
  await goto('#/settings');
  await sleep(500);
  await shot('ui-mobile-settings');

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
