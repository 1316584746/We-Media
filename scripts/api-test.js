// 后端 API 端到端自测（建议用独立目录 + mock 配置，不产生费用）：
//   $env:WM_DATA_DIR="E:\tmp\wm-data"; $env:WM_OUTPUT_DIR="E:\tmp\wm-out"; $env:WM_PORT=3100; node server/index.js
//   node scripts/api-test.js http://localhost:3100
const BASE = process.argv[2] || 'http://localhost:3100';
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};
const api = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitDone(id, timeoutMs = 180000) {
  const t0 = Date.now();
  for (;;) {
    const { json } = await api('GET', `/api/projects/${id}`);
    if (json.status === 'done' || json.status === 'error') return json;
    if (Date.now() - t0 > timeoutMs) throw new Error('等待生成超时');
    await sleep(1500);
  }
}

(async () => {
  const meta = (await api('GET', '/api/meta')).json;
  ok(meta.templates.length >= 5 && meta.voices.edge.length, `meta：${meta.templates.map((t) => t.id).join(',')}`);

  // 1) 古诗词模板：片头 + 4 句 + 片尾
  let r = await api('POST', '/api/projects', {
    template: 'poem',
    title: '池上',
    author: '白居易',
    script: '小娃撑小艇，偷采白莲回。\n不解藏踪迹，浮萍一道开。',
    options: { visual: 'image' },
  });
  ok(r.status === 200 && r.json.status === 'draft', `创建诗词项目 status=${r.json.status}`);
  const poem = r.json;
  ok(poem.scenes.map((s) => s.kind).join() === 'title,shot,shot,shot,shot,ending', `诗词分镜结构 ${poem.scenes.map((s) => s.kind).join()}`);
  ok(poem.options.orientation === 'landscape' && poem.options.titleCard, '诗词默认横屏 + 片头片尾');

  // 2) 口播模板：竖屏、无片头片尾、按句合并
  r = await api('POST', '/api/projects', {
    template: 'talk',
    script: '想变得自律，别靠意志力。第一，把目标拆到小到不可能失败，比如每天只读一页书。第二，固定时间固定地点，让行动变成条件反射。第三，当天就奖励自己。',
    options: { visual: 'image' },
  });
  const talk = r.json;
  ok(talk.options.orientation === 'portrait' && talk.scenes.every((s) => s.kind === 'shot'), `口播项目 竖屏，${talk.scenes.length} 个镜头，标题=「${talk.title}」`);

  // 3) 空文案 / 过长文案
  r = await api('POST', '/api/projects', { template: 'free', script: '   ' });
  ok(r.status === 400, `空文案 -> ${r.status} ${r.json.error}`);
  r = await api('POST', '/api/projects', { template: 'free', script: Array.from({ length: 60 }, (_, i) => `第${i}个镜头的内容很长很长很长很长很长很长很长很长很长很长很长。`).join('') });
  ok(r.status === 400, `超长文案 -> ${r.status}`);

  // 4) 生成（mock 图 + Edge 配音）
  r = await api('POST', `/api/projects/${talk.id}/generate`);
  ok(r.status === 200, '开始生成');
  const r409 = await api('PUT', `/api/projects/${talk.id}`, { title: 'x' });
  ok(r409.status === 409, `生成中禁止编辑 -> ${r409.status}`);
  let done = await waitDone(talk.id);
  ok(done.status === 'done' && done.result && done.duration > 3, `生成完成 status=${done.status} duration=${done.duration} ${done.error || ''}`);
  if (done.result) {
    const head = await fetch(BASE + done.result, { method: 'HEAD' });
    ok(head.status === 200, `成片可访问 ${done.result}`);
  }
  ok(done.scenes.every((s) => s.stage === 'done' && s.audio && s.image && s.segment && s.duration), '每个镜头都有配音/画面/片段/时长');

  // 5) 编辑：改文案 -> 只失效该镜头配音；加镜头；删镜头；dirty
  const scenes = done.scenes.map((s) => ({ id: s.id, text: s.text, display: s.display, prompt: s.prompt, motion: s.motion }));
  const keep = scenes.map((s) => s.id);
  scenes[0].text = '改过的第一句话。';
  scenes.push({ id: 'newsc1', text: '新增的最后一句。', prompt: '', motion: '' });
  const removed = scenes.splice(1, 1)[0];
  r = await api('PUT', `/api/projects/${talk.id}`, { title: '改名后的口播', scenes });
  ok(r.status === 200 && r.json.title === '改名后的口播' && r.json.dirty, `编辑保存 dirty=${r.json.dirty}`);
  const edited = r.json;
  ok(edited.scenes.length === scenes.length && edited.scenes.at(-1).id === 'newsc1', '新增镜头保留客户端 id');
  ok(!edited.scenes.find((s) => s.id === removed.id), '删除镜头生效');
  ok(edited.scenes[0].audio === null && edited.scenes[0].stage === 'pending', '改文案的镜头缓存被清');
  ok(keep.length >= 3, `口播至少切出 3 个镜头（实际 ${keep.length}）`);
  const untouched = edited.scenes.find((s) => s.id === keep.at(-1));
  ok(untouched && untouched.audio && untouched.image, '未改动的镜头缓存保留');

  // 6) 重新生成（只补缺的）
  await api('POST', `/api/projects/${talk.id}/generate`);
  done = await waitDone(talk.id);
  ok(done.status === 'done' && !done.dirty && done.scenes.every((s) => s.segment), `重新生成完成 dirty=${done.dirty} ${done.error || ''}`);

  // 7) 改画幅 -> 画面全部失效
  r = await api('PUT', `/api/projects/${talk.id}`, { options: { orientation: 'landscape' } });
  ok(r.json.options.orientation === 'landscape' && r.json.scenes.every((s) => !s.image), '改画幅后画面缓存全部失效');

  // 8) 单镜头重置
  await api('POST', `/api/projects/${talk.id}/generate`);
  done = await waitDone(talk.id);
  r = await api('POST', `/api/projects/${talk.id}/scenes/${done.scenes[0].id}/reset`);
  ok(r.json.scenes[0].image === null && r.json.scenes[1].image, '单镜头重置只清该镜头');

  // 9) 列表 / 复制 / 删除
  const list = (await api('GET', '/api/projects')).json;
  ok(list.some((p) => p.id === talk.id) && list.some((p) => p.id === poem.id), `列表 ${list.length} 个项目`);
  r = await api('POST', `/api/projects/${poem.id}/duplicate`);
  ok(r.status === 200 && r.json.id !== poem.id && r.json.title.includes('副本'), `复制 -> ${r.json.id}`);
  const dup = r.json.id;
  ok((await api('DELETE', `/api/projects/${dup}`)).status === 200 && (await api('GET', `/api/projects/${dup}`)).status === 404, '删除');
  r = await api('POST', `/api/projects/${poem.id}/storyboard`);
  ok(r.status === 200 && r.json.status === 'draft', '重新生成分镜');
  await api('DELETE', `/api/projects/${poem.id}`);

  /* ---------- 扩展：技能 ---------- */
  const md = '---\nname: 国风分镜规范\ndescription: >-\n  古诗词分镜时的构图要求\n---\n# 规则\n1. 多用留白构图\n2. 色调偏青绿';
  r = await api('POST', '/api/skills/preview', { text: md });
  ok(r.status === 200 && r.json.name === '国风分镜规范' && r.json.description.includes('构图') && r.json.content.includes('留白'), `解析 SKILL.md frontmatter：${r.json.name}`);
  r = await api('POST', '/api/skills/preview', { text: '   ' });
  ok(r.status === 400, '空技能文本被拒绝');
  r = await api('POST', '/api/skills', { ...(await api('POST', '/api/skills/preview', { text: md })).json, templates: ['poem'] });
  ok(r.status === 200 && r.json.enabled && r.json.templates.join() === 'poem', '创建技能');
  const skill = r.json;
  r = await api('PUT', `/api/skills/${skill.id}`, { enabled: false });
  ok(r.json.enabled === false && r.json.name === skill.name, '停用技能（只改开关，其它字段保留）');
  r = await api('POST', '/api/skills', { name: 'x', content: '' });
  ok(r.status === 400, '技能内容为空被拒绝');
  r = await api('POST', '/api/skills', { name: 'x', content: 'a'.repeat(20001) });
  ok(r.status === 400, '技能内容过长被拒绝');

  /* ---------- 扩展：MCP ---------- */
  const samplePath = require('path').resolve(__dirname, 'sample-mcp-server.js');
  r = await api('POST', '/api/mcp/import', {
    json: JSON.stringify({
      mcpServers: {
        'sample-research': { command: process.execPath, args: [samplePath], env: { SECRET_TOKEN: 'abc123' } },
        'bogus-http': { url: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer xyz' } },
        broken: { foo: 1 },
      },
    }),
  });
  ok(r.status === 200 && r.json.added.length === 2 && r.json.skipped.length === 1, `导入 mcp.json：新增 ${r.json.added}，跳过 ${r.json.skipped}`);
  let ext = (await api('GET', '/api/extensions')).json;
  const sample = ext.mcp.find((m) => m.name === 'sample-research');
  const bogus = ext.mcp.find((m) => m.name === 'bogus-http');
  ok(sample.env.SECRET_TOKEN === '********' && bogus.headers.Authorization === '********', '环境变量 / 请求头在接口里脱敏');
  r = await api('POST', `/api/mcp/${sample.id}/test`);
  ok(r.status === 200 && r.json.status === 'ok' && r.json.tools.some((t) => t.name === 'lookup_background'), `测试本地 MCP：${r.json.statusMsg}`);
  r = await api('POST', `/api/mcp/${bogus.id}/test`);
  ok(r.json.status === 'error' && r.json.statusMsg, `测试不可达的远程 MCP 返回错误：${String(r.json.statusMsg).slice(0, 40)}`);
  r = await api('PUT', `/api/mcp/${sample.id}`, { name: 'sample-research', transport: 'stdio', command: process.execPath, args: [samplePath], env: { SECRET_TOKEN: '********' } });
  ok(r.status === 200 && r.json.status === 'ok', '编辑时回传脱敏值视为未修改，连接参数没变则保留测试结果');
  r = await api('POST', '/api/mcp', { name: 'bad', transport: 'stdio', command: '' });
  ok(r.status === 400, '缺少命令被拒绝');
  r = await api('POST', '/api/mcp', { name: 'bad', transport: 'http', url: 'ftp://x' });
  ok(r.status === 400, '非 http(s) 地址被拒绝');

  // 带技能 / 工具增强创建项目（未启用 LLM：不生效，但要给出明确提示且不影响创建）
  r = await api('POST', '/api/projects', { template: 'poem', title: '池上', author: '白居易', script: '小娃撑小艇，偷采白莲回。', skills: [skill.id], useTools: true, options: { visual: 'image' } });
  ok(r.status === 200 && r.json.researchWarning && r.json.researchWarning.includes('LLM') && r.json.ext.useTools, `未启用 LLM 时工具增强给出提示：${r.json.researchWarning}`);
  await api('DELETE', `/api/projects/${r.json.id}`);

  // 清理
  for (const m of ext.mcp) await api('DELETE', `/api/mcp/${m.id}`);
  await api('DELETE', `/api/skills/${skill.id}`);
  ext = (await api('GET', '/api/extensions')).json;
  ok(!ext.mcp.length && !ext.skills.length, '清理扩展配置');

  /* ---------- 创作精选 ---------- */
  ok(Array.isArray(meta.featured) && meta.featured.length >= 8, `meta 带创作精选 ${meta.featured?.length} 条`);
  ok(
    meta.templates.every((t) => t.styles.length >= 4 && t.styles.every((n) => meta.stylePresets.some((s) => s.name === n)) && t.defaults.style === meta.stylePresets.find((s) => s.name === t.styles[0]).value),
    '每个模板有 4+ 个推荐画风，且默认画风就是推荐的第一个',
  );
  const tplIds = meta.templates.map((t) => t.id);
  ok(meta.featured.every((f) => tplIds.includes(f.template) && f.script.trim() && f.style && !('coverPrompt' in f)), '精选条目模板有效、带文案和画风，且不下发封面提示词');
  for (const t of meta.templates.filter((x) => x.id !== 'free')) {
    ok(meta.featured.filter((f) => f.template === t.id).length >= 4, `模板「${t.name}」至少有 4 条精选`);
  }
  const covers = await Promise.all(meta.featured.map((f) => fetch(BASE + f.cover).then((r) => r.status)));
  const missing = meta.featured.filter((_, i) => covers[i] !== 200).map((f) => f.id);
  if (missing.length) console.log(`  提示：${missing.length} 条精选还没有封面图（运行 scripts/gen-featured-covers.js 补齐）：${missing.join(',')}`);
  ok(covers.filter((s) => s === 200).length >= 8, `已有封面的精选都能访问（${covers.filter((s) => s === 200).length}/${covers.length}）`);
  const withVideo = meta.featured.filter((f) => f.video);
  const vids = await Promise.all(withVideo.map((f) => fetch(BASE + f.video, { headers: { Range: 'bytes=0-99' } }).then((r) => r.status)));
  ok(vids.every((s) => s === 200 || s === 206), `有示范视频的精选（${withVideo.length} 条）视频地址都能访问`);
  const f0 = meta.featured[0];
  const fp = await api('POST', '/api/projects', { template: f0.template, title: f0.title, script: f0.script, options: { style: f0.style, orientation: f0.orientation, visual: 'image' } });
  ok(fp.status === 200 && fp.json.scenes.length >= 3, `用精选内容能直接创建项目（${fp.json.scenes?.length} 个镜头）`);
  await api('DELETE', `/api/projects/${fp.json.id}`);
  /* ---------- 热门相关视频（B 站，依赖外网，联网失败时只校验错误格式） ---------- */
  const bad = await api('GET', '/api/discover?template=__nope__');
  ok(bad.status === 400, '未知模板的热门视频请求返回 400');
  const hot = await api('GET', '/api/discover?template=poem');
  if (hot.status === 200) {
    const it = hot.json.items;
    ok(it.length >= 6 && it.every((v) => v.bvid && v.title && v.pic && v.url.includes(v.bvid) && v.play > 0), `热门视频 ${it.length} 条，字段完整`);
    ok(it.every((v, i) => i === 0 || it[i - 1].play >= v.play), '热门视频按播放量从高到低');
    ok(it.every((v) => !/<|&quot;/.test(v.title)), '标题已去掉搜索高亮标签');
  } else {
    ok(hot.status === 502 && /B 站/.test(hot.json.error), `联网失败时返回可读错误（${hot.status}）：${hot.json.error}`);
  }
  /* ---------- 做同款：按题材让 LLM 写文案（用本地假 LLM，不花钱） ---------- */
  const noTpl = await api('POST', '/api/script-draft', { template: '__nope__', topic: 'x' });
  ok(noTpl.status === 400, '做同款：未知模板返回 400');
  const noLlm = await api('POST', '/api/script-draft', { template: 'heal', topic: '晚安' });
  ok(noLlm.status === 400 && /分镜 LLM/.test(noLlm.json.error), `做同款：未启用 LLM 时给出明确提示（${noLlm.json.error}）`);
  const fake = require('http').createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const asked = JSON.parse(body).messages.map((m) => m.content).join('\n');
      const reply = asked.includes('开头钩子规则') ? '{"title":"开头钩子版","author":"","script":"你以为很累。\\n其实是方法不对。\\n换个做法。"}' : asked.includes('M Agent') ? '{"title":"秋夜小记","author":"","script":"风起了。\\n叶子落满小路。\\n你慢慢走。"}' : asked.includes('晚安小熊') ? '{"title":"给你的晚安","author":"","script":"今天辛苦了。\\n把烦恼放下吧。\\n晚安。"}' : 'not json';
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const keepLlm = (await api('GET', '/api/settings')).json.llm;
  if (keepLlm.apiKey) throw new Error('当前服务里已有真实 LLM Key，api-test 会改写它，请用隔离的测试服务（WM_DATA_DIR 指向临时目录）运行');
  await api('PUT', '/api/settings', { llm: { enabled: true, baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: 'sk-fake', model: 'fake' } });
  const draft = await api('POST', '/api/script-draft', { template: 'heal', topic: '晚安小熊' });
  ok(draft.status === 200 && draft.json.title === '给你的晚安' && draft.json.script.split('\n').length === 3, `做同款：返回原创文案 ${JSON.stringify(draft.json).slice(0, 60)}`);
  const badDraft = await api('POST', '/api/script-draft', { template: 'heal', topic: '随便' });
  ok(badDraft.status === 502 && /重试/.test(badDraft.json.error), '做同款：模型没按 JSON 返回时提示重试');
  // M Agent：精选 Skill 列表 → 添加成「技能」→ 灵感 + 技能 → 文案
  const ags = await api('GET', '/api/agent/skills');
  const sk = ags.json.skills;
  ok(ags.status === 200 && sk.length >= 12 && ags.json.categories[0] === '推荐' && sk.every((s) => s.content && s.intro && s.scene && s.how && s.output && s.glyph), `M Agent：${sk.length} 个精选 Skill，分类 ${ags.json.categories.join('/')}`);
  ok(sk.every((s) => s.templates.every((t) => meta.templates.some((x) => x.id === t))), 'M Agent：每个 Skill 适用的模板都存在');
  ok(sk.filter((s) => s.cats.includes('推荐')).length >= 6 && ags.json.categories.slice(1).every((c) => sk.some((s) => s.cats.includes(c))), 'M Agent：「推荐」里有多个，每个分类下都有 Skill');
  const hook = sk.find((s) => s.id === 'hook-3s');
  const added = await api('POST', '/api/skills', { name: hook.name, description: hook.desc, content: hook.content, templates: hook.templates, source: `market:${hook.id}` });
  ok(added.status === 200 && added.json.source === 'market:hook-3s', `M Agent：「添加 Skill」存成技能 ${added.json.id}`);
  const ag1 = await api('POST', '/api/agent/run', { template: 'free', idea: '租房改造', skills: [added.json.id], orientation: 'portrait' });
  ok(ag1.status === 200 && ag1.json.template === 'free' && ag1.json.orientation === 'portrait' && ag1.json.title === '开头钩子版' && ag1.json.script.split('\n').length === 3 && ag1.json.skillsUsed[0]?.id === added.json.id, `M Agent：Skill 指引随请求发给模型，返回 ${JSON.stringify(ag1.json).slice(0, 70)}`);
  const ag0 = await api('POST', '/api/agent/run', { template: 'free', idea: '租房改造' });
  ok(ag0.status === 200 && ag0.json.title === '秋夜小记' && ag0.json.skillsUsed.length === 0, 'M Agent：不选 Skill 也能写（没有带 Skill 指引）');
  const agT = await api('POST', '/api/agent/run', { template: 'poem', idea: '秋天', skills: [added.json.id] });
  ok(agT.status === 200 && agT.json.template === 'poem' && agT.json.orientation === 'landscape', 'M Agent：不指定画幅时用模板默认');
  const ag3 = await api('POST', '/api/agent/run', { template: '__nope__', idea: 'x' });
  ok(ag3.status === 400, 'M Agent：未知模板返回 400');
  const ag4 = await api('POST', '/api/agent/run', { idea: '   ' });
  ok(ag4.status === 400 && /灵感/.test(ag4.json.error), 'M Agent：空灵感返回 400');
  await api('DELETE', `/api/skills/${added.json.id}`);
  await api('PUT', '/api/settings', { llm: { enabled: false } });
  const ag5 = await api('POST', '/api/agent/run', { idea: '秋天' });
  ok(ag5.status === 400 && /分镜 LLM/.test(ag5.json.error), 'M Agent：未启用 LLM 时给出明确提示');
  await api('PUT', '/api/settings', { llm: { enabled: !!keepLlm.enabled, baseUrl: keepLlm.baseUrl, apiKey: '', model: keepLlm.model } });
  fake.close();

  // 剪辑：文本朗读 → 音频素材
  const ttsKeep = (await api('GET', '/api/settings')).json.tts.mode;
  await api('PUT', '/api/settings', { tts: { mode: 'mock' } });
  const ed = await api('POST', '/api/edits', { name: 'tts 自测' });
  const edId = ed.json.id;
  const noText = await api('POST', `/api/edits/${edId}/media/from-tts`, { text: '  ' });
  ok(noText.status === 400, `文本朗读：空文字返回 400（${noText.json.error}）`);
  const tm = await api('POST', `/api/edits/${edId}/media/from-tts`, { text: '你好，这是一段文本朗读测试。' });
  ok(tm.status === 200 && tm.json.kind === 'audio' && tm.json.duration > 2 && /^朗读-/.test(tm.json.name), `文本朗读：生成音频素材 ${tm.json.name} ${tm.json.duration}s`);
  const noEd = await api('POST', '/api/edits/e_nope/media/from-tts', { text: 'x' });
  ok(noEd.status === 404, '文本朗读：工程不存在返回 404');
  await api('DELETE', `/api/edits/${edId}`);
  await api('PUT', '/api/settings', { tts: { mode: ttsKeep } });
  /* ---------- 音色试听 ---------- */
  const pv = await fetch(BASE + '/api/tts/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tts: { mode: 'mock' }, text: '试听一下' }),
  });
  const pvBuf = Buffer.from(await pv.arrayBuffer());
  ok(pv.status === 200 && pv.headers.get('content-type') === 'audio/mpeg' && pvBuf.length > 1000, `试听返回音频 ${pvBuf.length} 字节`);
  const pvBad = await api('POST', '/api/tts/preview', { tts: { mode: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'x' } });
  ok(pvBad.status === 502 && String(pvBad.json.error).includes('试听失败'), `试听失败时返回可读错误：${String(pvBad.json.error).slice(0, 60)}`);

  /* ---------- 安全：Host 校验 ---------- */
  const status = await new Promise((resolve) => {
    const u = new URL(BASE);
    require('http')
      .request({ host: u.hostname, port: u.port, path: '/api/settings', headers: { Host: 'evil.example.com' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .end();
  });
  ok(status === 403, `非本机 Host 请求被拒绝 -> ${status}`);

  // 定时发布：公众号走（假的）官方接口，其余平台到点提醒
  {
    const http = require('http');
    const wxLog = [];
    const wx = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        wxLog.push(u.pathname + (u.searchParams.get('type') ? `?type=${u.searchParams.get('type')}` : ''));
        const send = (o) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));
        if (u.pathname === '/cgi-bin/token') return u.searchParams.get('secret') === 'good-secret' ? send({ access_token: 'TK', expires_in: 7200 }) : send({ errcode: 40125, errmsg: 'invalid appsecret' });
        if (u.searchParams.get('access_token') !== 'TK') return send({ errcode: 40001, errmsg: 'bad token' });
        if (u.pathname === '/cgi-bin/material/add_material') return send({ media_id: `M_${u.searchParams.get('type')}`, url: 'http://x/y' });
        if (u.pathname === '/cgi-bin/draft/add') {
          const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
          wxLog.push(`draft:${body.articles?.[0]?.title}|${body.articles?.[0]?.thumb_media_id}`);
          return send({ media_id: 'DRAFT1' });
        }
        send({ errcode: 404, errmsg: 'nope' });
      });
    });
    await new Promise((r) => wx.listen(0, '127.0.0.1', r));
    const wxUrl = `http://127.0.0.1:${wx.address().port}`;

    let pb = (await api('GET', '/api/publish')).json;
    ok(pb.platforms.length >= 5 && pb.platforms.some((p) => p.key === 'wechat' && p.mode === 'api') && pb.sources.some((s) => s.id === talk.id), `发布：平台 ${pb.platforms.map((p) => p.key).join('/')}，可选视频 ${pb.sources.length} 个`);

    let w = await api('PUT', '/api/publish/wechat', { appId: 'wx123', appSecret: 'bad-secret', baseUrl: wxUrl });
    ok(w.status === 200 && w.json.appId === 'wx123' && w.json.configured && w.json.appSecret.startsWith('********') && !JSON.stringify(w.json).includes('bad-secret'), '发布：公众号配置保存，密钥脱敏');
    ok((await api('PUT', '/api/publish/wechat', { baseUrl: 'ftp://x' })).status === 400, '发布：接口地址格式校验');
    let t1 = (await api('POST', '/api/publish/wechat/test')).json;
    ok(t1.ok === false && /AppSecret/.test(t1.message), `发布：密钥错误给出中文原因 ${t1.message}`);
    w = await api('PUT', '/api/publish/wechat', { appSecret: 'good-secret' });
    ok(w.json.appSecret === '********cret', '发布：只改密钥');
    w = await api('PUT', '/api/publish/wechat', { appId: 'wx123', appSecret: w.json.appSecret });
    t1 = (await api('POST', '/api/publish/wechat/test')).json;
    ok(t1.ok === true, '发布：保存时带回脱敏密钥不会覆盖真实密钥，测试连接通过');

    ok((await api('POST', '/api/publish/tasks', { sourceType: 'project', sourceId: talk.id, platforms: [], runAt: Date.now() })).status === 400, '发布：不选平台 -> 400');
    ok((await api('POST', '/api/publish/tasks', { sourceType: 'project', sourceId: 'nope', platforms: ['douyin'], runAt: Date.now() })).status === 404, '发布：视频不存在 -> 404');
    const draftP = (await api('POST', '/api/projects', { template: 'free', script: '一句话。', options: { visual: 'image' } })).json;
    ok((await api('POST', '/api/publish/tasks', { sourceType: 'project', sourceId: draftP.id, platforms: ['douyin'], runAt: Date.now() })).status === 400, '发布：没做好的视频不能排期');

    const future = (await api('POST', '/api/publish/tasks', { sourceType: 'project', sourceId: talk.id, title: '明天发', desc: '第一段\n第二段', tags: '自律, #成长', platforms: ['wechat', 'douyin'], runAt: Date.now() + 3600000 })).json;
    ok(future.status === 'pending' && future.tags.join() === '自律,成长' && future.videoUrl.includes(talk.id), `发布：创建计划 ${future.id}`);
    await api('POST', '/api/publish/tick');
    ok((await api('GET', '/api/publish')).json.tasks.find((t) => t.id === future.id).status === 'pending', '发布：没到点不会执行');

    const due = (await api('POST', '/api/publish/tasks', { sourceType: 'project', sourceId: talk.id, title: '到点了', desc: '文案', platforms: ['wechat', 'xhs'], runAt: Date.now() - 1000 })).json;
    const tk = await api('POST', '/api/publish/tick');
    ok(tk.json.ran === 1, `发布：tick 执行到点的计划 ran=${tk.json.ran}`);
    const dueV = (await api('GET', '/api/publish')).json.tasks.find((t) => t.id === due.id);
    const wxR = dueV.platforms.find((p) => p.key === 'wechat');
    const xhsR = dueV.platforms.find((p) => p.key === 'xhs');
    ok(wxR.status === 'done' && /草稿箱/.test(wxR.message), `发布：公众号存入草稿 ${wxR.message}`);
    ok(wxLog.includes('/cgi-bin/material/add_material?type=image') && wxLog.includes('/cgi-bin/material/add_material?type=video') && wxLog.includes('draft:到点了|M_image'), `发布：调用顺序 ${wxLog.join(' ')}`);
    ok(xhsR.status === 'remind' && dueV.status === 'waiting', '发布：小红书到点提醒，计划进入「待手动发布」');
    const al = (await api('GET', '/api/publish/alerts')).json;
    ok(al.some((a) => a.id === due.id && a.platforms.some((p) => p.key === 'xhs')), '发布：提醒列表里有小红书');
    const dn = await api('POST', `/api/publish/tasks/${due.id}/done`, { platform: 'xhs' });
    ok(dn.status === 200 && dn.json.status === 'done', '发布：标记已发布后计划完成');
    ok(!(await api('GET', '/api/publish/alerts')).json.some((a) => a.id === due.id), '发布：完成后不再提醒');
    ok((await api('POST', `/api/publish/tasks/${due.id}/done`, { platform: 'bili' })).status === 400, '发布：标记没选的平台 -> 400');

    await api('PUT', '/api/publish/wechat', { appSecret: 'bad-secret' });
    const bad = (await api('POST', '/api/publish/tasks', { sourceType: 'project', sourceId: talk.id, platforms: ['wechat'], runAt: Date.now() - 1000 })).json;
    await api('POST', '/api/publish/tick');
    const badV = (await api('GET', '/api/publish')).json.tasks.find((t) => t.id === bad.id);
    ok(badV.status === 'failed' && /AppSecret/.test(badV.platforms[0].message), `发布：公众号失败会记录原因 ${badV.platforms[0].message}`);
    await api('PUT', '/api/publish/wechat', { appSecret: 'good-secret' });
    const re = await api('POST', `/api/publish/tasks/${bad.id}/run`);
    ok(re.status === 200 && re.json.status === 'done', '发布：修好配置后可重试');

    for (const id of [future.id, due.id, bad.id]) await api('DELETE', `/api/publish/tasks/${id}`);
    ok((await api('DELETE', `/api/publish/tasks/${future.id}`)).status === 404, '发布：删除计划');
    await api('PUT', '/api/publish/wechat', { appId: '', appSecret: '', baseUrl: '' });
    wx.close();
    await api('DELETE', `/api/projects/${draftP.id}`);
    await api('DELETE', `/api/projects/${talk.id}`);
  }

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
