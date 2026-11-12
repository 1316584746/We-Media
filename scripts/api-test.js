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

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
