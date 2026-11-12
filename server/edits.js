/**
 * 视频剪辑工程：时间线数据、素材库、预览代理。
 * 目录：EDIT_DIR/<id>/{edit.json, media/, thumbs/, exports/}
 * 导出渲染见 edit-render.js。
 */
const fs = require('fs');
const path = require('path');
const settingsStore = require('./settings');
const ff = require('./ffmpeg');

const EDIT_DIR = process.env.WM_EDIT_DIR || path.join(settingsStore.ROOT, 'edits');
const RATIOS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440] };
const VIDEO_EXT = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'flv', 'wmv', 'ts', 'mpg', 'mpeg', '3gp']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'amr']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif']);
const MAX_CLIPS = 600;
const MAX_MEDIA = 200;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const num = (v, d, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
};
const round3 = (n) => Math.round(n * 1000) / 1000;

const dirOf = (id) => {
  if (!/^e_[a-z0-9]+$/.test(String(id))) throw httpError(404, '剪辑工程不存在');
  return path.join(EDIT_DIR, id);
};
const fileOf = (id) => path.join(dirOf(id), 'edit.json');
const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ---------------- 读写 ---------------- */
const exporting = new Set(); // 正在导出的工程 id（进程内）

function read(id) {
  let e;
  try {
    e = JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
  } catch {
    throw httpError(404, '剪辑工程不存在');
  }
  // 服务重启时遗留的「导出中」状态
  if (e.export?.status === 'running' && !exporting.has(id)) e.export = { ...e.export, status: 'error', error: '导出被中断，请重新导出' };
  return e;
}

function write(e) {
  e.updatedAt = Date.now();
  const f = fileOf(e.id);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(e, null, 2), 'utf8');
  fs.renameSync(tmp, f);
  return e;
}

/** 修改前后保证串行，避免上传素材和自动保存互相覆盖 */
const locks = new Map();
function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(id, next);
  next.finally(() => locks.get(id) === next && locks.delete(id)).catch(() => {});
  return next;
}

const totalOf = (clips) => clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);

function summary(e) {
  const firstV = e.clips.filter((c) => c.track === 'v').sort((a, b) => a.start - b.start)[0];
  const m = firstV && e.media.find((x) => x.id === firstV.mediaId);
  return {
    id: e.id,
    name: e.name,
    ratio: e.ratio,
    duration: round3(totalOf(e.clips)),
    clips: e.clips.length,
    media: e.media.length,
    cover: m?.thumb ? `/edit-files/${e.id}/${m.thumb}` : null,
    export: e.export ? { status: e.export.status, file: e.export.file } : null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function list() {
  if (!fs.existsSync(EDIT_DIR)) return [];
  const out = [];
  for (const id of fs.readdirSync(EDIT_DIR)) {
    try {
      out.push(summary(read(id)));
    } catch {
      /* 不是工程目录，忽略 */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function view(e) {
  return { ...e, files: `/edit-files/${e.id}/`, duration: round3(totalOf(e.clips)) };
}

/* ---------------- 工程 ---------------- */
async function create({ name, ratio, fromProject } = {}) {
  const id = newId('e_');
  const e = {
    id,
    name: String(name || '').trim().slice(0, 60) || '未命名剪辑',
    ratio: RATIOS[ratio] ? ratio : '16:9',
    fps: 30,
    media: [],
    clips: [],
    export: null,
    createdAt: Date.now(),
  };
  fs.mkdirSync(path.join(dirOf(id), 'media'), { recursive: true });
  write(e);
  if (fromProject) {
    try {
      await importProject(id, fromProject, { place: true });
    } catch (err) {
      fs.rmSync(dirOf(id), { recursive: true, force: true });
      throw err;
    }
  }
  return view(read(id));
}

function remove(id) {
  read(id);
  fs.rmSync(dirOf(id), { recursive: true, force: true });
}

/** 校验并规整前端提交的时间线：只保留已知字段、夹紧数值、丢弃引用不存在素材的片段 */
function sanitizeClips(clips, media) {
  if (!Array.isArray(clips)) throw httpError(400, 'clips 必须是数组');
  if (clips.length > MAX_CLIPS) throw httpError(400, `片段太多（最多 ${MAX_CLIPS} 个）`);
  const byId = new Map(media.map((m) => [m.id, m]));
  const seen = new Set();
  const out = [];
  for (const c of clips) {
    if (!c || typeof c !== 'object') continue;
    const track = c.track;
    if (!['v', 't', 'a'].includes(track)) continue;
    const id = /^[\w-]{1,24}$/.test(String(c.id)) && !seen.has(c.id) ? String(c.id) : newId('c');
    seen.add(id);
    const base = { id, track, start: round3(num(c.start, 0, 0, 36000)), dur: round3(num(c.dur, 3, 0.1, 7200)) };
    if (track === 't') {
      const text = String(c.text ?? '').replace(/[{}]/g, '').slice(0, 500);
      out.push({
        ...base,
        text: text || '文字',
        size: num(c.size, 6, 1, 40),
        color: /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : '#ffffff',
        bg: /^#[0-9a-fA-F]{6}$/.test(c.bg) ? c.bg : '',
        bold: c.bold !== false,
        x: num(c.x, 50, 0, 100),
        y: num(c.y, 85, 0, 100),
        fade: !!c.fade,
      });
      continue;
    }
    const m = byId.get(c.mediaId);
    if (!m) continue;
    if (track === 'v' && m.kind === 'audio') continue;
    if (track === 'a' && m.kind !== 'audio') continue;
    const speed = m.kind === 'image' ? 1 : num(c.speed, 1, 0.25, 4);
    let dur = base.dur;
    let inn = m.kind === 'image' ? 0 : num(c.in, 0, 0, Math.max(0, m.duration - 0.1));
    if (m.kind !== 'image') {
      // 不能超出素材本身的长度
      const room = m.duration - inn;
      if (dur * speed > room + 0.05) dur = Math.max(0.1, round3(room / speed));
    }
    const clip = { ...base, dur, mediaId: m.id, in: round3(inn), speed, volume: num(c.volume, 1, 0, 2), muted: !!c.muted };
    if (track === 'v') {
      Object.assign(clip, {
        scale: num(c.scale, 1, 0.1, 5),
        x: num(c.x, 0, -100, 100),
        y: num(c.y, 0, -100, 100),
        brightness: num(c.brightness, 0, -1, 1),
        contrast: num(c.contrast, 1, 0, 2),
        saturation: num(c.saturation, 1, 0, 3),
      });
    } else {
      Object.assign(clip, { fadeIn: num(c.fadeIn, 0, 0, dur / 2), fadeOut: num(c.fadeOut, 0, 0, dur / 2) });
    }
    out.push(clip);
  }
  return out;
}

function update(id, body = {}) {
  return withLock(id, async () => {
    const e = read(id);
    if (body.name !== undefined) e.name = String(body.name).trim().slice(0, 60) || e.name;
    if (body.ratio !== undefined && RATIOS[body.ratio]) e.ratio = body.ratio;
    if (body.clips !== undefined) e.clips = sanitizeClips(body.clips, e.media);
    write(e);
    return view(e);
  });
}

/* ---------------- 素材探测 ---------------- */
async function probe(file) {
  let stderr = '';
  try {
    ({ stderr } = await ff.run(['-i', file]));
  } catch (err) {
    stderr = err.stderr || '';
  }
  const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0;
  const vline = stderr.split('\n').find((l) => /Stream #\d+:\d+.*Video:/.test(l) && !/attached pic/.test(l));
  const aline = stderr.split('\n').find((l) => /Stream #\d+:\d+.*Audio:/.test(l));
  let width = 0;
  let height = 0;
  let vcodec = '';
  if (vline) {
    const sz = vline.match(/,\s*(\d{2,5})x(\d{2,5})/);
    if (sz) [width, height] = [Number(sz[1]), Number(sz[2])];
    vcodec = (vline.match(/Video:\s*([\w]+)/) || [])[1] || '';
    const rot = stderr.match(/rotation of (-?\d+(?:\.\d+)?) degrees/);
    if (rot && Math.abs(Math.round(Number(rot[1]) / 90)) % 2 === 1) [width, height] = [height, width];
  }
  return { duration, width, height, vcodec, hasVideo: !!vline, hasAudio: !!aline, acodec: aline ? (aline.match(/Audio:\s*([\w]+)/) || [])[1] || '' : '' };
}

const extOf = (name) => path.extname(String(name)).slice(1).toLowerCase();
const kindOfExt = (ext) => (VIDEO_EXT.has(ext) ? 'video' : AUDIO_EXT.has(ext) ? 'audio' : IMAGE_EXT.has(ext) ? 'image' : null);

/** 浏览器能直接播放、不需要预览代理的组合 */
function browserFriendly(kind, ext, p) {
  if (kind === 'image') return true;
  if (kind === 'audio') return ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'].includes(ext);
  return ['mp4', 'm4v', 'mov', 'webm'].includes(ext) && ['h264', 'vp8', 'vp9', 'av1'].includes(p.vcodec) && (!p.hasAudio || ['aac', 'mp3', 'opus', 'vorbis'].includes(p.acodec));
}

/**
 * 把上传好的临时文件登记为素材：探测 → 缩略图 / 胶片条 / 波形 → 必要时生成预览代理。
 * 文件会被移动到工程目录。
 */
function addMedia(id, tmpFile, originalName) {
  return withLock(id, async () => {
    const e = read(id);
    if (e.media.length >= MAX_MEDIA) throw httpError(400, `素材太多（最多 ${MAX_MEDIA} 个）`);
    const ext = extOf(originalName);
    const kind = kindOfExt(ext);
    if (!kind) throw httpError(400, `不支持的文件类型 .${ext || '?'}（支持视频、音频、图片）`);
    const mid = newId('m_');
    const dir = dirOf(id);
    const rel = `media/${mid}.${ext}`;
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.renameSync(tmpFile, abs);
    try {
      const p = await probe(abs);
      if (kind !== 'image' && !(p.duration > 0)) throw httpError(400, '无法读取这个文件，可能已损坏');
      if (kind === 'video' && !p.hasVideo) throw httpError(400, '这个文件里没有视频画面');
      if (kind === 'image' && !(p.width > 0)) throw httpError(400, '无法读取这张图片');
      const m = {
        id: mid,
        name: String(originalName).slice(0, 120),
        kind,
        file: rel,
        duration: kind === 'image' ? 5 : round3(p.duration),
        width: p.width,
        height: p.height,
        hasAudio: kind === 'audio' ? true : kind === 'video' ? p.hasAudio : false,
        size: fs.statSync(abs).size,
        addedAt: Date.now(),
      };
      fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
      await makeAssets(dir, m, abs, p);
      if (!browserFriendly(kind, ext, p)) await makeProxy(dir, m, abs);
      e.media.push(m);
      write(e);
      return m;
    } catch (err) {
      fs.rmSync(abs, { force: true });
      throw err;
    }
  });
}

async function makeAssets(dir, m, abs, p) {
  const thumbs = (n) => path.join(dir, 'thumbs', n);
  const rel = (n) => `thumbs/${n}`;
  try {
    if (m.kind === 'image') {
      await ff.run(['-i', abs, '-vf', 'scale=-2:240', '-frames:v', '1', '-q:v', '4', thumbs(`${m.id}.jpg`)]);
      m.thumb = rel(`${m.id}.jpg`);
    } else if (m.kind === 'video') {
      const at = Math.min(1, Math.max(0, m.duration / 2));
      await ff.run(['-ss', String(at), '-i', abs, '-vf', 'scale=-2:240', '-frames:v', '1', '-q:v', '4', thumbs(`${m.id}.jpg`)]);
      m.thumb = rel(`${m.id}.jpg`);
      // 时间线上的胶片条：每 step 秒一帧，横向拼成一张图
      const th = 64;
      const tw = Math.max(16, Math.round((th * (p.width / p.height || 16 / 9)) / 2) * 2);
      const step = Math.max(1, Math.ceil(m.duration / 40));
      const n = Math.max(1, Math.ceil(m.duration / step));
      const out = thumbs(`${m.id}-strip.jpg`);
      const vf = `fps=1/${step},scale=${tw}:${th},tile=${n}x1`;
      // 短视频逐帧解码最稳；长视频只解关键帧（快得多，但关键帧稀疏时可能一帧都出不来 → 失败再退回逐帧）
      const attempts = m.duration > 300 ? [['-skip_frame', 'nokey'], []] : [[]];
      for (const pre of attempts) {
        try {
          await ff.run([...pre, '-i', abs, '-an', '-vf', vf, '-frames:v', '1', '-update', '1', '-q:v', '5', '-y', out]);
          if (fs.existsSync(out) && fs.statSync(out).size > 0) {
            m.strip = { file: rel(`${m.id}-strip.jpg`), n, step, tw, th };
            break;
          }
        } catch {
          /* 换下一种方式 */
        }
      }
      // 胶片条失败不影响使用，退回单张缩略图
    }
    if (m.kind === 'audio' || (m.kind === 'video' && m.hasAudio)) {
      const w = Math.min(4000, Math.max(600, Math.round(m.duration * 12)));
      try {
        await ff.run(['-i', abs, '-vn', '-filter_complex', `aformat=channel_layouts=mono,showwavespic=s=${w}x64:colors=0xbfc8ff`, '-frames:v', '1', thumbs(`${m.id}-wave.png`)]);
        m.wave = rel(`${m.id}-wave.png`);
      } catch {
        /* 没有波形也能用 */
      }
    }
  } catch (err) {
    if (m.kind !== 'audio') throw httpError(400, `无法处理这个文件：${String(err.message).split('\n').slice(-3).join(' ')}`);
  }
}

/** 预览代理：浏览器播不了的格式（mkv / hevc / wma …）转成 540p h264 或 mp3 只用于预览，导出仍用原文件 */
async function makeProxy(dir, m, abs) {
  const rel = m.kind === 'audio' ? `media/${m.id}-proxy.mp3` : `media/${m.id}-proxy.mp4`;
  const out = path.join(dir, rel);
  if (m.kind === 'audio') {
    await ff.run(['-i', abs, '-vn', '-c:a', 'libmp3lame', '-b:a', '160k', out]);
  } else {
    await ff.run(['-i', abs, '-vf', 'scale=-2:540', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
  }
  m.proxy = rel;
}

function removeMedia(id, mid) {
  return withLock(id, async () => {
    const e = read(id);
    const m = e.media.find((x) => x.id === mid);
    if (!m) throw httpError(404, '素材不存在');
    const dir = dirOf(id);
    for (const f of [m.file, m.proxy, m.thumb, m.strip?.file, m.wave]) if (f) fs.rmSync(path.join(dir, f), { force: true });
    e.media = e.media.filter((x) => x.id !== mid);
    e.clips = e.clips.filter((c) => c.mediaId !== mid);
    write(e);
    return view(e);
  });
}

/** 把 AI 项目的成片登记为素材；place=true 时顺便铺到时间线上 */
async function importProject(id, projectId, { place = false } = {}) {
  const { OUTPUT_DIR } = require('./pipeline');
  if (!/^[\w-]+$/.test(String(projectId))) throw httpError(400, '项目 id 不合法');
  const src = path.join(OUTPUT_DIR, projectId, 'final.mp4');
  if (!fs.existsSync(src)) throw httpError(404, '这个项目还没有生成成片');
  let title = projectId;
  try {
    title = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, projectId, 'job.json'), 'utf8')).title || projectId;
  } catch {
    /* 用 id 兜底 */
  }
  const tmp = path.join(dirOf(id), `import-${Date.now()}.mp4`);
  fs.copyFileSync(src, tmp);
  const m = await addMedia(id, tmp, `${title}.mp4`);
  if (place) {
    await update(id, {
      name: read(id).name === '未命名剪辑' ? String(title).slice(0, 60) : undefined,
      ratio: m.width && m.height ? (m.width < m.height ? '9:16' : m.width === m.height ? '1:1' : '16:9') : undefined,
      clips: [{ id: newId('c'), track: 'v', mediaId: m.id, start: 0, dur: m.duration, in: 0, speed: 1, volume: 1 }],
    });
  }
  return m;
}

function setExport(id, patch) {
  return withLock(id, async () => {
    const e = read(id);
    e.export = { ...(e.export || {}), ...patch };
    write(e);
    return e.export;
  });
}

module.exports = {
  EDIT_DIR,
  RATIOS,
  exporting,
  list,
  create,
  remove,
  update,
  read,
  view,
  addMedia,
  removeMedia,
  importProject,
  setExport,
  dirOf,
  totalOf,
  kindOfExt,
  httpError,
  newId,
};
