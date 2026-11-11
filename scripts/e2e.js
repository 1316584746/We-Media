// 端到端自测：分镜 → 创建任务 → 轮询 → 输出成片路径。
// 用法：node scripts/e2e.js          （默认《池上》）
const base = process.env.WM_BASE || 'http://localhost:3000';
const j = async (url, body) => {
  const r = await fetch(base + url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  return r.json();
};
(async () => {
  const poem = { title: '池上', author: '白居易', poem: '小娃撑小艇，偷采白莲回。\n不解藏踪迹，浮萍一道开。' };
  const sb = await j('/api/storyboard', poem);
  if (sb.error) throw new Error(sb.error);
  console.log('LLM:', sb.usedLlm, sb.warning || '');
  console.log('角色:', sb.character, '| 场景:', sb.setting);
  sb.scenes.forEach((s, i) => console.log(i + 1, s.kind, s.shot || '', '|', s.text, '|', (s.prompt || '').slice(0, 90)));
  const { id } = await j('/api/jobs', { ...poem, scenes: sb.scenes });
  console.log('job', id);
  let last = '';
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const job = await j('/api/jobs/' + id);
    const line = `${job.status} ${job.progress}% ${job.stage}`;
    if (line !== last) console.log(line);
    last = line;
    if (job.status === 'done' || job.status === 'error') {
      console.log(job.error || '', '\n' + job.logs.join('\n'));
      console.log('result:', job.result && base + job.result);
      return;
    }
  }
})().catch((e) => console.error('FAIL', e.message));
