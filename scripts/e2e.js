// 端到端（真实配置）：创建项目 → 打印分镜 → 生成 → 轮询 → 输出成片地址。
// 注意：按 settings 里的真实模型调用，会产生费用。
// 用法：node scripts/e2e.js [模板id，默认 poem]      例：node scripts/e2e.js explainer
const base = process.env.WM_BASE || 'http://localhost:3000';
const j = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
  return json;
};

const SAMPLES = {
  poem: { title: '池上', author: '白居易', script: '小娃撑小艇，偷采白莲回。\n不解藏踪迹，浮萍一道开。' },
  story: { title: '小兔子找月亮', script: '夜深了，小兔子睡不着。它抬头一看，月亮不见了。\n小兔子决定出门去找月亮。' },
  explainer: { title: '为什么天空是蓝色的', script: '阳光看起来是白色的，其实它由七种颜色的光组成。\n蓝光更容易被空气分子散射到四面八方，所以天空是蓝色的。' },
  talk: { title: '三个习惯，让你更自律', script: '想变得自律，别靠意志力。\n第一，把目标拆到小到不可能失败。\n第二，固定时间固定地点。' },
};

(async () => {
  const template = process.argv[2] || 'poem';
  const sample = SAMPLES[template] || SAMPLES.story;
  const p = await j('POST', '/api/projects', { template, ...sample });
  console.log('项目', p.id, '| LLM:', p.usedLlm, p.warning || '');
  console.log('角色:', p.character, '| 场景:', p.setting);
  p.scenes.forEach((s, i) => console.log(i + 1, s.kind, s.shot || '', '|', s.text, '|', (s.prompt || '').slice(0, 90)));
  await j('POST', `/api/projects/${p.id}/generate`);
  let last = '';
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const cur = await j('GET', `/api/projects/${p.id}`);
    const line = `${cur.status} ${cur.progress}% ${cur.stage}`;
    if (line !== last) console.log(line);
    last = line;
    if (cur.status === 'done' || cur.status === 'error') {
      console.log(cur.error || '', '\n' + cur.logs.join('\n'));
      console.log('成片:', cur.result && base + cur.result, '| 时长:', cur.duration);
      console.log('在浏览器里打开：', `${base}/#/p/${p.id}`);
      return;
    }
  }
})().catch((e) => console.error('FAIL', e.message));
