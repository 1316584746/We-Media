// 剪辑功能后端自测：上传素材 → 编辑时间线 → 导出 → 校验成片。
//   $env:WM_DATA_DIR="E:\tmp\wm-data"; $env:WM_OUTPUT_DIR="E:\tmp\wm-out"; $env:WM_EDIT_DIR="E:\tmp\wm-edits"; $env:WM_PORT=3100; node server/index.js
//   node scripts/edit-test.js http://localhost:3100
const fs = require('fs');
const os = require('os');
const path = require('path');
const ff = require('../server/ffmpeg');

const BASE = process.argv[2] || 'http://localhost:3100';
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};
const api = async (method, url, body) => {
  const res = await fetch(BASE + url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};
const upload = async (id, file, name) => {
  const res = await fetch(`${BASE}/api/edits/${id}/media?name=${encodeURIComponent(name || path.basename(file))}`, { method: 'POST', body: fs.readFileSync(file) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function info(file) {
  let stderr = '';
  try {
    ({ stderr } = await ff.run(['-i', file]));
  } catch (e) {
    stderr = e.stderr || '';
  }
  const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const sz = stderr.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})/);
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, w: sz ? +sz[1] : 0, h: sz ? +sz[2] : 0, hasAudio: /Audio:/.test(stderr), hasVideo: /Video:/.test(stderr) };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-edit-'));
  const f = (n) => path.join(tmp, n);
  // 测试素材（全部 ffmpeg 合成）
  await ff.run(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f('a.mp4')]);
  await ff.run(['-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('b-silent.mp4')]);
  await ff.run(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', f('music.wav')]);
  await ff.run(['-f', 'lavfi', '-i', 'color=c=red:s=800x600:d=1', '-frames:v', '1', f('pic.png')]);
  await ff.run(['-i', f('a.mp4'), '-c', 'copy', f('a.mkv')]); // 浏览器不直接支持 → 预览代理

  let r = await api('POST', '/api/edits', { name: '自测剪辑', ratio: '16:9' });
  ok(r.status === 200 && r.json.id && r.json.ratio === '16:9' && r.json.clips.length === 0, `创建剪辑工程 ${r.json.id}`);
  const id = r.json.id;

  /* ---- 素材 ---- */
  r = await upload(id, f('a.mp4'));
  const A = r.json;
  ok(r.status === 200 && A.kind === 'video' && Math.abs(A.duration - 4) < 0.3 && A.width === 640 && A.hasAudio && A.thumb && A.strip && A.wave && !A.proxy, `上传视频：${A.duration}s ${A.width}x${A.height} 有声音 有缩略图/胶片条/波形，无需代理`);
  r = await upload(id, f('b-silent.mp4'));
  const B = r.json;
  ok(r.status === 200 && B.kind === 'video' && B.width === 360 && B.height === 640 && !B.hasAudio && !B.wave, `上传竖屏无声视频 ${B.width}x${B.height} hasAudio=${B.hasAudio}`);
  r = await upload(id, f('music.wav'));
  const M = r.json;
  ok(r.status === 200 && M.kind === 'audio' && Math.abs(M.duration - 6) < 0.3 && M.wave, `上传音频 ${M.duration}s`);
  r = await upload(id, f('pic.png'));
  const P = r.json;
  ok(r.status === 200 && P.kind === 'image' && P.width === 800 && P.thumb, `上传图片 ${P.width}x${P.height}`);
  r = await upload(id, f('a.mkv'));
  const K = r.json;
  ok(r.status === 200 && K.kind === 'video' && K.proxy, `mkv 生成了预览代理 ${K.proxy}`);
  ok((await fetch(`${BASE}/edit-files/${id}/${K.proxy}`)).status === 200 && (await fetch(`${BASE}/edit-files/${id}/${A.wave}`)).status === 200 && (await fetch(`${BASE}/edit-files/${id}/${A.strip.file}`)).status === 200, '预览代理、波形、胶片条文件都可访问');
  const rangeRes = await fetch(`${BASE}/edit-files/${id}/${A.file}`, { headers: { Range: 'bytes=0-99' } });
  ok(rangeRes.status === 206, `素材支持 Range（拖动进度条要用）-> ${rangeRes.status}`);

  r = await upload(id, f('pic.png'), 'evil.exe');
  ok(r.status === 400, `拒绝不支持的类型 -> ${r.status}`);
  const bad = await fetch(`${BASE}/api/edits/${id}/media?name=fake.mp4`, { method: 'POST', body: Buffer.from('not a video') });
  ok(bad.status === 400, `拒绝损坏的视频文件 -> ${bad.status}`);
  ok((await api('GET', `/api/edits/${id}`)).json.media.length === 5, '失败的上传不会留下素材');

  /* ---- 时间线保存与校验 ---- */
  const clips = [
    { id: 'c1', track: 'v', mediaId: A.id, start: 0, dur: 3, in: 0, speed: 1, volume: 1 },
    { id: 'c2', track: 'v', mediaId: B.id, start: 3, dur: 2, in: 0, speed: 1, volume: 1, scale: 1.2, x: 10, y: -5, brightness: 0.1, contrast: 1.1, saturation: 1.2 },
    { id: 'c3', track: 'v', mediaId: P.id, start: 5, dur: 2 },
    { id: 'c4', track: 'a', mediaId: M.id, start: 0.5, dur: 5, in: 0, speed: 1, volume: 0.5, fadeIn: 1, fadeOut: 1 },
    { id: 'c5', track: 't', start: 0.5, dur: 3, text: '你好，剪辑\n第二行', size: 8, color: '#ffeb3b', bold: true, x: 50, y: 80, fade: true },
    { id: 'bad1', track: 'v', mediaId: 'm_nope', start: 0, dur: 1 },
    { id: 'bad2', track: 'a', mediaId: A.id, start: 0, dur: 1 }, // 视频素材不能放音频轨
    { id: 'bad3', track: 'x', start: 0, dur: 1 },
  ];
  r = await api('PUT', `/api/edits/${id}`, { clips, name: '自测剪辑 2', ratio: '9:16' });
  ok(r.status === 200 && r.json.clips.length === 5 && r.json.name === '自测剪辑 2' && r.json.ratio === '9:16', `保存时间线：丢弃 3 个非法片段，剩 ${r.json.clips?.length}`);
  r = await api('PUT', `/api/edits/${id}`, { ratio: '16:9', clips: [{ id: 'long', track: 'v', mediaId: A.id, start: 0, dur: 50, in: 1, speed: 1 }, { id: 'sp', track: 'v', mediaId: A.id, start: 60, dur: 2, speed: 99 }] });
  const long = r.json.clips.find((c) => c.id === 'long');
  const sp = r.json.clips.find((c) => c.id === 'sp');
  ok(long.dur <= A.duration - 1 + 0.1 && sp.speed === 4, `时长不会超出素材（50s→${long.dur}s），倍速限制在 4x（99→${sp.speed}）`);
  r = await api('PUT', `/api/edits/${id}`, { clips });
  ok(r.status === 200 && r.json.clips.length === 5, '恢复正式时间线');

  /* ---- 导出 ---- */
  const empty = (await api('POST', '/api/edits', { name: '空' })).json;
  r = await api('POST', `/api/edits/${empty.id}/export`);
  await sleep(800);
  const emptyState = (await api('GET', `/api/edits/${empty.id}`)).json.export;
  ok(emptyState?.status === 'error' && /空/.test(emptyState.error), `空时间线导出给出提示：${emptyState?.error}`);

  r = await api('POST', `/api/edits/${id}/export`);
  ok(r.status === 200 && r.json.export?.status === 'running', '开始导出');
  const dup = await api('POST', `/api/edits/${id}/export`);
  ok(dup.status === 409, `导出中再次导出被拒绝 -> ${dup.status}`);
  let st;
  for (let i = 0; i < 120; i++) {
    st = (await api('GET', `/api/edits/${id}`)).json.export;
    if (st.status !== 'running') break;
    await sleep(1000);
  }
  ok(st.status === 'done' && st.file, `导出完成：${st.file || st.error}`);
  ok(!st.warning, `文字烧录成功（无降级警告）${st.warning || ''}`);
  const dl = await fetch(`${BASE}/api/edits/${id}/download`);
  const outFile = f('out.mp4');
  fs.writeFileSync(outFile, Buffer.from(await dl.arrayBuffer()));
  const out = await info(outFile);
  ok(dl.status === 200 && out.hasVideo && out.hasAudio, `成片有画面和声音 ${out.w}x${out.h} ${out.duration.toFixed(2)}s`);
  ok(out.w === 1920 && out.h === 1080, `成片分辨率符合 16:9 -> ${out.w}x${out.h}`);
  ok(Math.abs(out.duration - 7) < 0.25, `成片时长等于时间线总长 7s -> ${out.duration.toFixed(2)}s`);

  // 变速 + 空档 + 竖屏
  await api('PUT', `/api/edits/${id}`, {
    ratio: '9:16',
    clips: [
      { id: 'd1', track: 'v', mediaId: A.id, start: 0, dur: 2, in: 1, speed: 2, volume: 1 }, // 取 4s 素材，2x → 2s
      { id: 'd2', track: 'v', mediaId: B.id, start: 3, dur: 1.5, in: 0, speed: 0.5 }, // 空档 1s，慢放
    ],
  });
  await api('POST', `/api/edits/${id}/export`);
  for (let i = 0; i < 120; i++) {
    st = (await api('GET', `/api/edits/${id}`)).json.export;
    if (st.status !== 'running') break;
    await sleep(1000);
  }
  const dl2 = await fetch(`${BASE}/api/edits/${id}/download`);
  fs.writeFileSync(f('out2.mp4'), Buffer.from(await dl2.arrayBuffer()));
  const out2 = await info(f('out2.mp4'));
  ok(st.status === 'done' && out2.w === 1080 && out2.h === 1920 && Math.abs(out2.duration - 4.5) < 0.25 && out2.hasAudio, `变速 + 空档补黑 + 竖屏：${out2.w}x${out2.h} ${out2.duration.toFixed(2)}s`);

  /* ---- 联动：AI 项目成片导入 ---- */
  const nf = await api('POST', `/api/edits/${id}/media/from-project`, { projectId: 'nope-not-exist' });
  ok(nf.status === 404, `导入不存在的项目成片 -> ${nf.status}`);
  const trav = await api('POST', `/api/edits/${id}/media/from-project`, { projectId: '../x' });
  ok(trav.status === 400, `项目 id 含路径符号被拒绝 -> ${trav.status}`);

  /* ---- 列表 / 删除素材 / 删除工程 ---- */
  const list = (await api('GET', '/api/edits')).json;
  const me = list.find((e) => e.id === id);
  ok(me && me.clips === 2 && me.cover && me.duration > 4 && me.export?.status === 'done', `列表摘要：${me?.clips} 个片段，封面 ${me?.cover}`);
  r = await api('DELETE', `/api/edits/${id}/media/${B.id}`);
  ok(r.status === 200 && !r.json.media.some((m) => m.id === B.id) && !r.json.clips.some((c) => c.mediaId === B.id), '删除素材时一并删除用到它的片段');
  ok((await fetch(`${BASE}/edit-files/${id}/${B.file}`)).status === 404, '素材文件已删除');
  ok((await api('DELETE', `/api/edits/${id}`)).status === 200 && (await api('GET', `/api/edits/${id}`)).status === 404, '删除剪辑工程');
  await api('DELETE', `/api/edits/${empty.id}`);
  ok((await api('GET', '/api/edits/..%2F..%2Fx')).status === 404, '非法工程 id 返回 404');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
