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
  await api('DELETE', `/api/projects/${talk.id}`);

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
  const tplIds = meta.templates.map((t) => t.id);
  ok(meta.featured.every((f) => tplIds.includes(f.template) && f.script.trim() && f.style && !('coverPrompt' in f)), '精选条目模板有效、带文案和画风，且不下发封面提示词');
  const covers = await Promise.all(meta.featured.map((f) => fetch(BASE + f.cover).then((r) => r.status)));
  ok(covers.every((s) => s === 200), `所有精选封面都能访问 ${covers.join(',')}`);
  const f0 = meta.featured[0];
  const fp = await api('POST', '/api/projects', { template: f0.template, title: f0.title, script: f0.script, options: { style: f0.style, orientation: f0.orientation, visual: 'image' } });
  ok(fp.status === 200 && fp.json.scenes.length >= 3, `用精选内容能直接创建项目（${fp.json.scenes?.length} 个镜头）`);
  await api('DELETE', `/api/projects/${fp.json.id}`);
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

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
