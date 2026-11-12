/**
 * 剪辑时间线的纯逻辑（不碰 DOM）：切割 / 裁剪 / 移动 / 变速 / 吸附 / 撤销。
 * 所有函数都不修改入参，返回新数组；.mjs 后缀让 Node 也能直接导入做单元测试。
 *
 * clip: { id, track:'v'|'t'|'a', start, dur, mediaId?, in?, speed?, volume?, ... }
 *   视频轨 v 是「磁吸主轨」：片段首尾相接、没有空档，任何改动后会重新排紧。
 *   文字轨 t / 音频轨 a 自由定位，同一轨内不能重叠。
 */
export const MIN_DUR = 0.1;
export const TRACK_ORDER = ['t', 'v', 'a']; // 时间线从上到下
export const TRACK_NAME = { t: '文字', v: '视频', a: '音频' };

export const r3 = (n) => Math.round(n * 1000) / 1000;
export const uid = (p = 'c') => p + Math.random().toString(36).slice(2, 9);
export const clipEnd = (c) => r3(c.start + c.dur);
export const totalDuration = (clips) => r3(clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0));
export const trackClips = (clips, track) => clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start);
export const clipAt = (clips, track, t) => trackClips(clips, track).find((c) => t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6) || null;
export const speedOf = (c) => c.speed || 1;
/** 时间线时刻 t 对应的素材内时刻 */
export const sourceTime = (c, t) => r3((c.in || 0) + (t - c.start) * speedOf(c));
/** 是否可以在这个时刻切开（两边都至少 MIN_DUR） */
export const canSplit = (c, t) => t - c.start >= MIN_DUR && clipEnd(c) - t >= MIN_DUR;

const mediaMax = (c, media) => {
  const m = media?.get?.(c.mediaId) ?? media?.[c.mediaId];
  return !m || m.kind === 'image' || c.track === 't' ? Infinity : m.duration;
};

/** 视频主轨排紧：按当前顺序首尾相接 */
export function packVideo(clips) {
  let cursor = 0;
  const ordered = trackClips(clips, 'v').map((c) => {
    const n = { ...c, start: r3(cursor) };
    cursor += c.dur;
    return n;
  });
  const map = new Map(ordered.map((c) => [c.id, c]));
  return clips.map((c) => map.get(c.id) || c);
}

const finish = (clips, track) => (track === 'v' ? packVideo(clips) : clips);

/** 在 track 的空位里，找离 want 最近、能放下 dur 的起点（排除 exceptId 自己） */
export function findSlot(clips, track, want, dur, exceptId = null) {
  const others = trackClips(clips, track).filter((c) => c.id !== exceptId);
  const gaps = [];
  let from = 0;
  for (const o of others) {
    if (o.start - from >= dur - 1e-6) gaps.push([from, o.start]);
    from = Math.max(from, clipEnd(o));
  }
  gaps.push([from, Infinity]);
  let best = null;
  for (const [g0, g1] of gaps) {
    const s = Math.min(Math.max(want, g0), g1 - dur);
    if (s < g0 - 1e-6) continue;
    const d = Math.abs(s - want);
    if (!best || d < best.d) best = { s, d };
  }
  return r3(best ? Math.max(0, best.s) : want);
}

export function addClip(clips, clip, want = null) {
  if (clip.track === 'v') return packVideo([...clips, { ...clip, start: totalOfTrack(clips, 'v') }]);
  const start = findSlot(clips, clip.track, want ?? 0, clip.dur);
  return [...clips, { ...clip, start }];
}
const totalOfTrack = (clips, track) => trackClips(clips, track).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
/** 同一轨道末尾的时间（新片段默认放在这里） */
export const trackEnd = (clips, track) => r3(totalOfTrack(clips, track));

export function deleteClip(clips, id) {
  const c = clips.find((x) => x.id === id);
  if (!c) return clips;
  return finish(
    clips.filter((x) => x.id !== id),
    c.track,
  );
}

/** 在 t 切开片段，返回 { clips, ids:[左, 右] }；不能切返回 null */
export function splitClip(clips, id, t) {
  const c = clips.find((x) => x.id === id);
  if (!c || !canSplit(c, t)) return null;
  const sp = speedOf(c);
  const left = { ...c, dur: r3(t - c.start) };
  const right = { ...c, id: uid(), start: r3(t), dur: r3(clipEnd(c) - t) };
  if (c.track !== 't') right.in = r3((c.in || 0) + (t - c.start) * sp);
  if (c.track === 'a') {
    left.fadeOut = 0;
    right.fadeIn = 0;
  }
  const next = clips.flatMap((x) => (x.id === id ? [left, right] : [x]));
  return { clips: finish(next, c.track), ids: [left.id, right.id] };
}

/** 裁剪左 / 右边缘到时间线时刻 t */
export function trimClip(clips, id, edge, t, media) {
  const c = clips.find((x) => x.id === id);
  if (!c) return clips;
  const sp = speedOf(c);
  const sorted = trackClips(clips, c.track);
  const idx = sorted.findIndex((x) => x.id === id);
  const prev = sorted[idx - 1];
  const next = sorted[idx + 1];
  const max = mediaMax(c, media);
  let out;
  if (edge === 'r') {
    let end = Math.max(c.start + MIN_DUR, t);
    if (max !== Infinity) end = Math.min(end, c.start + (max - (c.in || 0)) / sp);
    if (c.track !== 'v' && next) end = Math.min(end, next.start);
    out = { ...c, dur: r3(end - c.start) };
  } else {
    const end = clipEnd(c);
    let s = Math.min(t, end - MIN_DUR);
    // 不能向左超出素材开头；自由轨道还不能压到前一个片段、不能小于 0
    if (c.track !== 't') s = Math.max(s, c.start - (c.in || 0) / sp);
    if (c.track !== 'v') s = Math.max(s, prev ? clipEnd(prev) : 0);
    const delta = s - c.start;
    out = { ...c, dur: r3(end - s) };
    if (c.track !== 't') out.in = r3(Math.max(0, (c.in || 0) + delta * sp));
    // 视频主轨：左边缘裁剪不改变 start（排紧后后面的片段自动补上）；其他轨移动起点
    out.start = c.track === 'v' ? c.start : r3(s);
  }
  return finish(
    clips.map((x) => (x.id === id ? out : x)),
    c.track,
  );
}

/** 按给定顺序把视频主轨片段首尾相接，返回 id → 新片段 */
function layoutVideo(order) {
  let cur = 0;
  const placed = new Map();
  for (const x of order) {
    placed.set(x.id, { ...x, start: r3(cur) });
    cur += x.dur;
  }
  return placed;
}

/** 把片段移到 newStart；视频主轨按中心点重新排序，其他轨找最近的空位 */
export function moveClip(clips, id, newStart) {
  const c = clips.find((x) => x.id === id);
  if (!c) return clips;
  if (c.track === 'v') {
    const others = trackClips(clips, 'v').filter((x) => x.id !== id);
    const center = newStart + c.dur / 2;
    let idx = 0;
    let cursor = 0;
    for (const o of others) {
      if (cursor + o.dur / 2 < center) idx++;
      cursor += o.dur;
    }
    const placed = layoutVideo([...others.slice(0, idx), c, ...others.slice(idx)]);
    return clips.map((x) => placed.get(x.id) || x);
  }
  const start = findSlot(clips, c.track, Math.max(0, newStart), c.dur, id);
  return clips.map((x) => (x.id === id ? { ...x, start } : x));
}

export function duplicateClip(clips, id) {
  const c = clips.find((x) => x.id === id);
  if (!c) return { clips, id: null };
  const copy = { ...c, id: uid() };
  if (c.track === 'v') {
    const order = trackClips(clips, 'v').flatMap((x) => (x.id === id ? [x, copy] : [x]));
    const placed = layoutVideo(order);
    return { clips: [...clips.map((x) => placed.get(x.id) || x), placed.get(copy.id)], id: copy.id };
  }
  copy.start = findSlot(clips, c.track, clipEnd(c), c.dur);
  return { clips: [...clips, copy], id: copy.id };
}
/** 改变速度：保持素材取用范围不变，时长随之伸缩 */
export function setSpeed(clips, id, speed, media) {
  const c = clips.find((x) => x.id === id);
  if (!c || c.track === 't') return clips;
  const sp = Math.min(4, Math.max(0.25, speed));
  const srcLen = c.dur * speedOf(c);
  let dur = r3(Math.max(MIN_DUR, srcLen / sp));
  if (c.track !== 'v') {
    const next = trackClips(clips, c.track).find((x) => x.start >= clipEnd(c) - 1e-6 && x.id !== id);
    if (next) dur = Math.min(dur, r3(next.start - c.start));
  }
  void media;
  return finish(
    clips.map((x) => (x.id === id ? { ...x, speed: sp, dur } : x)),
    c.track,
  );
}

export function updateClip(clips, id, patch) {
  const c = clips.find((x) => x.id === id);
  if (!c) return clips;
  return clips.map((x) => (x.id === id ? { ...x, ...patch } : x));
}

/** 吸附：返回离 t 最近且在阈值内的目标，否则原值 */
export function snapTime(t, targets, threshold) {
  let best = t;
  let bd = threshold;
  for (const p of targets) {
    const d = Math.abs(p - t);
    if (d <= bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
export function snapPoints(clips, excludeId, extra = []) {
  const pts = new Set([0, ...extra]);
  for (const c of clips) {
    if (c.id === excludeId) continue;
    pts.add(c.start);
    pts.add(clipEnd(c));
  }
  return [...pts];
}

/* ---------------- 新片段的默认值 ---------------- */
export function newMediaClip(media, start = 0) {
  if (media.kind === 'audio') {
    return { id: uid(), track: 'a', mediaId: media.id, start, dur: r3(media.duration), in: 0, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 };
  }
  return {
    id: uid(),
    track: 'v',
    mediaId: media.id,
    start,
    dur: r3(media.kind === 'image' ? 5 : media.duration),
    in: 0,
    speed: 1,
    volume: 1,
    muted: false,
    scale: 1,
    x: 0,
    y: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
  };
}
export function newTextClip(start = 0, text = '双击编辑文字') {
  return { id: uid(), track: 't', start, dur: 3, text, size: 6, color: '#ffffff', bg: '', bold: true, x: 50, y: 85, fade: false };
}

/* ---------------- 撤销 / 重做 ---------------- */
export class History {
  constructor(limit = 100) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }
  /** 在修改前调用，记录当前状态 */
  push(snapshot) {
    const s = JSON.stringify(snapshot);
    if (this.past.at(-1) === s) return;
    this.past.push(s);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(this.past.pop());
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(this.future.pop());
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
}
