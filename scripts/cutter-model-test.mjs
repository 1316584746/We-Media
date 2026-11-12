// 剪辑时间线纯逻辑的单元测试：node scripts/cutter-model-test.mjs
import * as M from '../public/js/cutter/model.mjs';

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};
const near = (a, b) => Math.abs(a - b) < 1e-3;
const media = new Map([
  ['mv', { id: 'mv', kind: 'video', duration: 10 }],
  ['mi', { id: 'mi', kind: 'image', duration: 5 }],
  ['ma', { id: 'ma', kind: 'audio', duration: 20 }],
]);
const V = (id, start, dur, extra = {}) => ({ id, track: 'v', mediaId: 'mv', start, dur, in: 0, speed: 1, volume: 1, ...extra });
const A = (id, start, dur, extra = {}) => ({ id, track: 'a', mediaId: 'ma', start, dur, in: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, ...extra });
const T = (id, start, dur) => ({ id, track: 't', start, dur, text: id });
const get = (clips, id) => clips.find((c) => c.id === id);

/* 切割 */
let clips = [V('a', 0, 4), V('b', 4, 6)];
let r = M.splitClip(clips, 'a', 1.5);
ok(r && r.clips.length === 3, '切割后多一个片段');
const [l, rt] = r.ids.map((id) => get(r.clips, id));
ok(near(l.dur, 1.5) && near(rt.start, 1.5) && near(rt.dur, 2.5) && near(rt.in, 1.5), `左 1.5s，右从 1.5 起 2.5s，素材入点 ${rt.in}`);
ok(near(get(r.clips, 'b').start, 4), '切割后视频主轨总长不变、后续片段位置不变');
r = M.splitClip([V('s', 0, 4, { speed: 2, in: 1 })], 's', 1);
ok(near(get(r.clips, r.ids[1]).in, 3), `2 倍速切割：素材入点 = 1 + 1*2 = ${get(r.clips, r.ids[1]).in}`);
ok(M.splitClip(clips, 'a', 0.05) === null && M.splitClip(clips, 'a', 3.95) === null, '太靠边不能切');
r = M.splitClip([A('x', 2, 6, { fadeIn: 1, fadeOut: 2 })], 'x', 5);
ok(get(r.clips, r.ids[0]).fadeOut === 0 && get(r.clips, r.ids[1]).fadeIn === 0 && get(r.clips, r.ids[0]).fadeIn === 1 && get(r.clips, r.ids[1]).fadeOut === 2, '音频切割：只在两端保留淡入淡出');
r = M.splitClip([T('t', 1, 4)], 't', 3);
ok(r.clips.length === 2 && get(r.clips, r.ids[1]).in === undefined, '文字也能切割');

/* 删除（磁吸） */
clips = M.deleteClip([V('a', 0, 2), V('b', 2, 3), V('c', 5, 1)], 'b');
ok(near(get(clips, 'c').start, 2), '删除视频片段后后面的自动补上');
clips = M.deleteClip([A('a1', 0, 2), A('a2', 5, 2)], 'a1');
ok(near(get(clips, 'a2').start, 5), '删除音频不影响其他片段位置');

/* 移动 */
clips = [V('a', 0, 2), V('b', 2, 2), V('c', 4, 2)];
clips = M.moveClip(clips, 'a', 3.9);
ok(M.trackClips(clips, 'v').map((c) => c.id).join('') === 'bca' && near(get(clips, 'a').start, 4), `拖到末尾后顺序 bca，a 起点 ${get(clips, 'a').start}`);
clips = M.moveClip(clips, 'a', 0);
ok(M.trackClips(clips, 'v').map((c) => c.id).join('') === 'abc', '拖回开头恢复顺序');
clips = M.moveClip([A('x', 0, 2), A('y', 3, 2)], 'y', 1);
ok(near(get(clips, 'y').start, 2), `音频不能重叠：被推到 ${get(clips, 'y').start}`);
clips = M.moveClip([A('x', 0, 2), A('y', 10, 2)], 'y', 1.2);
ok(near(get(clips, 'y').start, 2), '靠近前一个片段时贴到它后面');
clips = M.moveClip([A('x', 0, 5)], 'x', -3);
ok(get(clips, 'x').start === 0, '不能拖到负时间');

/* 裁剪 */
clips = M.trimClip([V('a', 0, 4, { in: 2 }), V('b', 4, 3)], 'a', 'r', 20, media);
ok(near(get(clips, 'a').dur, 8) && near(get(clips, 'b').start, 8), `右边缘最多拉到素材末尾（10-2=8s），后面片段跟随 -> ${get(clips, 'a').dur}`);
clips = M.trimClip([V('a', 0, 4, { in: 2 })], 'a', 'r', 0.01, media);
ok(near(get(clips, 'a').dur, M.MIN_DUR), '最短 0.1s');
clips = M.trimClip([V('a', 0, 4, { in: 2 })], 'a', 'l', 1.5, media);
ok(near(get(clips, 'a').in, 3.5) && near(get(clips, 'a').dur, 2.5) && get(clips, 'a').start === 0, `左边缘裁剪：入点 ${get(clips, 'a').in}、时长 ${get(clips, 'a').dur}、起点不变`);
clips = M.trimClip([V('a', 0, 4, { in: 2 })], 'a', 'l', -5, media);
ok(near(get(clips, 'a').in, 0) && near(get(clips, 'a').dur, 6), '左边缘不能超出素材开头');
clips = M.trimClip([A('a1', 0, 2), A('a2', 3, 4, { in: 5 })], 'a2', 'l', 1, media);
ok(near(get(clips, 'a2').start, 2) && near(get(clips, 'a2').in, 4), `音频左裁剪不压到前一个片段：起点 ${get(clips, 'a2').start}，入点 ${get(clips, 'a2').in}`);
clips = M.trimClip([A('a1', 0, 2), A('a2', 3, 2)], 'a1', 'r', 9, media);
ok(near(get(clips, 'a1').dur, 3), '音频右裁剪不压到后一个片段');
clips = M.trimClip([{ id: 'i', track: 'v', mediaId: 'mi', start: 0, dur: 5, in: 0, speed: 1 }], 'i', 'r', 30, media);
ok(near(get(clips, 'i').dur, 30), '图片可以拉任意长');
clips = M.trimClip([V('a', 0, 4, { speed: 2, in: 0 })], 'a', 'r', 99, media);
ok(near(get(clips, 'a').dur, 5), `2 倍速下最长 5s（素材 10s / 2）-> ${get(clips, 'a').dur}`);

/* 变速 */
clips = M.setSpeed([V('a', 0, 4), V('b', 4, 2)], 'a', 2, media);
ok(near(get(clips, 'a').dur, 2) && near(get(clips, 'b').start, 2), '2 倍速：时长减半，后面补上');
clips = M.setSpeed([V('a', 0, 2, { speed: 2 })], 'a', 0.5, media);
ok(near(get(clips, 'a').dur, 8), `从 2x 改 0.5x：素材 4s → 8s -> ${get(clips, 'a').dur}`);
clips = M.setSpeed([V('a', 0, 2)], 'a', 100, media);
ok(get(clips, 'a').speed === 4, '倍速上限 4');
clips = M.setSpeed([A('a1', 0, 4), A('a2', 5, 1)], 'a1', 0.25, media);
ok(near(get(clips, 'a1').dur, 5), '慢放时不压到后一个音频片段');

/* 复制 */
r = M.duplicateClip([V('a', 0, 2), V('b', 2, 2)], 'a');
ok(r.clips.length === 3 && M.trackClips(r.clips, 'v').map((c) => c.id)[1] === r.id && near(M.totalDuration(r.clips), 6), '视频复制插在原片段后面');
r = M.duplicateClip([A('a1', 0, 2), A('a2', 2, 2)], 'a1');
ok(near(get(r.clips, r.id).start, 4), `音频复制放到后面第一个空位 ${get(r.clips, r.id).start}`);

/* 添加 */
clips = M.addClip([V('a', 0, 3)], M.newMediaClip({ id: 'mv', kind: 'video', duration: 2 }));
ok(near(M.trackClips(clips, 'v')[1].start, 3), '新视频追加在主轨末尾');
clips = M.addClip([A('a1', 0, 3)], M.newMediaClip({ id: 'ma', kind: 'audio', duration: 4 }), 1);
ok(near(M.trackClips(clips, 'a')[1].start, 3), '新音频放到最近的空位');
ok(M.newMediaClip({ id: 'mi', kind: 'image', duration: 5 }).dur === 5 && M.newMediaClip({ id: 'ma', kind: 'audio', duration: 4 }).track === 'a', '图片默认 5s；音频进音频轨');

/* 查询 / 吸附 */
clips = [V('a', 0, 2), V('b', 2, 3)];
ok(M.clipAt(clips, 'v', 2).id === 'b' && M.clipAt(clips, 'v', 1.99).id === 'a' && M.clipAt(clips, 'v', 5) === null, '按时间找当前片段（右开区间）');
ok(near(M.sourceTime(V('s', 10, 4, { in: 3, speed: 2 }), 11), 5), '时间线 → 素材时间换算');
ok(M.totalDuration([V('a', 0, 2), T('t', 1, 5)]) === 6, '总时长取所有轨道最大值');
ok(M.snapTime(2.04, [0, 2, 5], 0.1) === 2 && M.snapTime(2.3, [0, 2, 5], 0.1) === 2.3, '吸附阈值内吸附，阈值外不动');
ok(M.snapPoints([V('a', 0, 2), V('b', 2, 3)], 'a', [7]).sort().join() === '0,2,5,7', '吸附点排除自己、含额外点');

/* 撤销 / 重做 */
const h = new M.History();
let state = { clips: [V('a', 0, 2)] };
h.push(state);
state = { clips: [V('a', 0, 5)] };
h.push(state);
state = { clips: [V('a', 0, 9)] };
ok(h.canUndo && !h.canRedo, '有历史可撤销');
let prev = h.undo(state);
ok(prev.clips[0].dur === 5, '撤销到上一步');
prev = h.undo(prev);
ok(prev.clips[0].dur === 2 && !h.canUndo, '再撤销到最初');
let again = h.redo(prev);
ok(again.clips[0].dur === 5 && h.canRedo, '重做');
h.push(again);
ok(!h.canRedo, '做了新修改后重做栈清空');
const h2 = new M.History(3);
for (let i = 0; i < 10; i++) h2.push({ i });
ok(h2.past.length === 3, '历史有上限');

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exitCode = failed ? 1 : 0;
