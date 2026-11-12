const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const settingsStore = require('./settings');
const providers = require('./providers');
const ff = require('./ffmpeg');
const { getTemplate } = require('./templates');
const { pLimit, retry } = require('./util');

const OUTPUT_DIR = process.env.WM_OUTPUT_DIR || path.join(settingsStore.ROOT, 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/** 内存里的项目缓存（磁盘上是 output/<id>/job.json） */
const projects = new Map();

const MAX_SCENES = 40;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ----------------------------- 文本切分 ----------------------------- */

/** 诗：按标点拆成"句"，再按 linesPerScene 合并成分镜 */
function splitPoem(text, linesPerScene = 1) {
  const lines = text
    .replace(/\r/g, '')
    .split(/[\n，。！？；,.!?;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const n = Math.max(1, Number(linesPerScene) || 1);
  const units = [];
  for (let i = 0; i < lines.length; i += n) units.push({ text: lines.slice(i, i + n).join('，') + '。' });
  return { lines, units };
}

/** 通用文案：按句拆，再贪心合并到每镜头不超过 maxChars 个字 */
function splitSentences(text, maxChars = 26) {
  const sentences = text
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?…])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // 过长的句子在逗号处再拆
  const pieces = [];
  for (const s of sentences) {
    if (s.length <= maxChars * 1.5) {
      pieces.push(s);
      continue;
    }
    let cur = '';
    for (const part of s.split(/(?<=[，,；;：:、])/)) {
      if (cur && (cur + part).length > maxChars) {
        pieces.push(cur);
        cur = part;
      } else cur += part;
    }
    if (cur) pieces.push(cur);
  }
  const units = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && (cur + p).length > maxChars) {
      units.push({ text: cur });
      cur = p;
    } else cur += p;
  }
  if (cur) units.push({ text: cur });
  return { lines: pieces, units };
}

/* ----------------------------- 项目选项 ----------------------------- */

function sanitizeOptions(o = {}) {
  const out = {};
  if (['landscape', 'portrait'].includes(o.orientation)) out.orientation = o.orientation;
  if (['image', 'i2v', 'video'].includes(o.visual)) out.visual = o.visual;
  for (const k of ['subtitles', 'titleCard', 'endCard']) if (typeof o[k] === 'boolean') out[k] = o[k];
  if (typeof o.style === 'string') out.style = o.style.trim().slice(0, 500);
  if (typeof o.voice === 'string') out.voice = o.voice.trim().slice(0, 80);
  if (Number.isFinite(Number(o.fps)) && o.fps !== '' && o.fps !== null) out.fps = Math.min(60, Math.max(15, Math.round(Number(o.fps))));
  if (Number.isFinite(Number(o.linesPerScene)) && o.linesPerScene) out.linesPerScene = Math.min(4, Math.max(1, Math.round(Number(o.linesPerScene))));
  return out;
}

function resolveOptions(tpl, render, overrides) {
  return {
    orientation: render.orientation,
    visual: render.visual,
    fps: render.fps,
    subtitles: render.subtitles,
    linesPerScene: render.linesPerScene,
    titleCard: false,
    endCard: false,
    style: '',
    voice: '',
    ...sanitizeOptions(tpl.defaults),
    ...sanitizeOptions(overrides),
  };
}

/* ----------------------------- 分镜 ----------------------------- */

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const newSceneId = () => crypto.randomBytes(3).toString('hex');
const validId = (id) => (typeof id === 'string' && /^[a-z0-9]{1,12}$/i.test(id) ? id : null);

function makeScene(s = {}) {
  return {
    id: validId(s.id) || newSceneId(),
    kind: ['title', 'shot', 'ending'].includes(s.kind) ? s.kind : 'shot',
    text: str(s.text),
    display: str(s.display),
    prompt: str(s.prompt),
    motion: str(s.motion),
    shot: str(s.shot),
    silent: Number(s.silent) || 4,
    stage: 'pending', // pending | tts | compose | done | error
    detail: '',
    duration: null,
    audio: null,
    image: null,
    clip: null,
    segment: null,
    error: null,
  };
}

/**
 * 生成分镜：[片头标题卡] + 每个分句一个镜头 + [片尾]
 * 片头/片尾复用首/尾镜头的画面，不额外生成图片。
 */
async function buildStoryboard({ tpl, title, author, script, options }) {
  const settings = settingsStore.load();
  const style = options.style || tpl.defaults.style;
  const { lines, units } = tpl.split === 'line' ? splitPoem(script, options.linesPerScene) : splitSentences(script);
  if (!units.length) throw httpError(400, '没有识别到可用的文案');
  if (units.length > MAX_SCENES) throw httpError(400, `文案太长：切出了 ${units.length} 个镜头，最多支持 ${MAX_SCENES} 个，请精简或分成多个视频`);

  const { shots, character, setting, usedLlm, warning } = await providers.buildShots({
    llm: settings.llm,
    template: tpl,
    title,
    author,
    script,
    verses: units,
    style,
  });

  const scenes = [];
  if (options.titleCard && title) {
    scenes.push(
      makeScene({
        kind: 'title',
        text: author ? `${title}，${author}` : title,
        display: author ? `${title}\n（${author}）` : title,
      }),
    );
  }
  units.forEach((u, i) =>
    scenes.push(makeScene({ kind: 'shot', text: u.text, prompt: shots[i].prompt, motion: shots[i].motion, shot: shots[i].shot })),
  );
  if (options.endCard) {
    const display =
      tpl.endMode === 'script' ? [`《${title || '无题'}》`, author, ...lines].filter(Boolean).join('\n') : tpl.endText || title || '';
    if (display) scenes.push(makeScene({ kind: 'ending', text: '', display, silent: 5 }));
  }
  return { usedLlm, warning, character, setting, scenes };
}

/* ----------------------------- 存取 ----------------------------- */

const projectDir = (id) => path.join(OUTPUT_DIR, id);
const sceneDir = (job, scene) => path.join(projectDir(job.id), `s${scene.id}`);
// ?v= 用于破浏览器缓存（同名文件重新生成后，预览才会刷新）
const assetUrl = (job, scene, file) => `/output/${job.id}/s${scene.id}/${file}?v=${Date.now()}`;

function persist(job) {
  fs.writeFileSync(path.join(projectDir(job.id), 'job.json'), JSON.stringify(job, null, 2), 'utf8');
}

function log(job, msg) {
  job.logs.push(`${new Date().toLocaleTimeString()} ${msg}`);
  if (job.logs.length > 300) job.logs.shift();
}

/** 兼容旧版数据（诗词任务：scene 没有 id、kind=verse） */
function normalize(job) {
  const settings = settingsStore.load();
  job.template = job.template || 'poem';
  job.script = job.script || job.scenes.filter((s) => s.kind === 'verse' || s.kind === 'shot').map((s) => s.text).join('\n');
  job.options = job.options || resolveOptions(getTemplate(job.template), settings.render, {});
  job.updatedAt = job.updatedAt || job.createdAt;
  job.dirty = !!job.dirty;
  job.duration = job.duration || null;
  job.scenes.forEach((s, i) => {
    if (!s.id) s.id = String(i);
    if (s.kind === 'verse') s.kind = 'shot';
    delete s.imageRef;
    delete s.index;
  });
  return job;
}

function getJob(id) {
  if (!/^[\w-]+$/.test(String(id))) return null;
  if (projects.has(id)) return projects.get(id);
  try {
    const job = normalize(JSON.parse(fs.readFileSync(path.join(projectDir(id), 'job.json'), 'utf8')));
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'error';
      job.error = '服务重启导致生成中断，点击「重新生成」继续（已完成的步骤会跳过）';
    }
    projects.set(id, job);
    return job;
  } catch {
    return null;
  }
}

const isBusy = (job) => job.status === 'running' || job.status === 'queued';

function summary(j) {
  const cover = j.scenes.find((s) => s.image);
  const est = j.scenes.reduce((a, s) => a + (s.duration || 0), 0);
  return {
    id: j.id,
    title: j.title,
    template: j.template,
    status: j.status,
    stage: j.stage,
    progress: j.progress,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    dirty: j.dirty,
    result: j.result,
    duration: j.duration || (est ? Math.round(est * 10) / 10 : null),
    sceneCount: j.scenes.length,
    orientation: j.options.orientation,
    cover: cover ? cover.image : null,
  };
}

function listProjects() {
  const out = [];
  for (const name of fs.readdirSync(OUTPUT_DIR)) {
    const j = getJob(name);
    if (j) out.push(summary(j));
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ----------------------------- 项目 CRUD ----------------------------- */

async function createProject({ template, title, author, script, options }) {
  const tpl = getTemplate(template);
  script = String(script || '').trim();
  if (!script) throw httpError(400, '请先输入文案');
  title = String(title || '').trim();
  author = String(author || '').trim();
  const opts = resolveOptions(tpl, settingsStore.load().render, options);
  // 没填标题时取文案的第一个分句
  const autoTitle = title || script.split(/[，。！？；,.!?;\n]/).map((s) => s.trim()).find(Boolean)?.slice(0, 16) || '未命名视频';
  const sb = await buildStoryboard({ tpl, title: title || '', author, script, options: opts });

  const id = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
  const now = Date.now();
  const job = {
    id,
    title: autoTitle,
    author,
    template: tpl.id,
    script,
    options: opts,
    status: 'draft', // draft | queued | running | done | error
    stage: '草稿',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    dirty: false,
    error: null,
    result: null,
    duration: null,
    character: sb.character,
    setting: sb.setting,
    usedLlm: sb.usedLlm,
    warning: sb.warning || null,
    logs: [],
    scenes: sb.scenes,
  };
  fs.mkdirSync(projectDir(id), { recursive: true });
  projects.set(id, job);
  persist(job);
  return job;
}

const SCENE_FILES = { audio: ['audio.mp3'], image: ['image.png'], clip: ['clip.mp4'], seg: ['seg.mp4', 'sub.ass'] };

/** 清掉某镜头的缓存产物，下次生成时重新做 */
function resetScene(job, scene, { audio = false, image = false, clip = false } = {}) {
  const dir = sceneDir(job, scene);
  const drop = (files) => files.forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
  if (audio) {
    drop(SCENE_FILES.audio);
    scene.audio = null;
  }
  if (image) {
    drop(SCENE_FILES.image);
    scene.image = null;
  }
  if (clip) {
    drop(SCENE_FILES.clip);
    scene.clip = null;
  }
  drop(SCENE_FILES.seg);
  scene.segment = null;
  scene.stage = 'pending';
  scene.detail = '';
  scene.duration = null;
  scene.error = null;
}

function updateProject(id, patch = {}) {
  const job = getJob(id);
  if (!job) throw httpError(404, '项目不存在');
  if (isBusy(job)) throw httpError(409, '正在生成，暂时不能编辑');
  let changed = false;

  if (typeof patch.title === 'string' && patch.title.trim()) job.title = patch.title.trim().slice(0, 80);

  if (patch.options) {
    const prev = job.options;
    const next = { ...prev, ...sanitizeOptions(patch.options) };
    const orient = next.orientation !== prev.orientation;
    const visual = next.visual !== prev.visual;
    const voice = next.voice !== prev.voice;
    const seg = next.subtitles !== prev.subtitles || next.fps !== prev.fps;
    job.options = next;
    if (orient || visual || voice || seg) {
      changed = true;
      job.scenes.forEach((s) => resetScene(job, s, { audio: voice, image: orient, clip: orient || visual }));
    }
  }

  if (Array.isArray(patch.scenes)) {
    if (!patch.scenes.length) throw httpError(400, '至少保留一个镜头');
    if (patch.scenes.length > MAX_SCENES) throw httpError(400, `最多 ${MAX_SCENES} 个镜头`);
    const old = new Map(job.scenes.map((s) => [s.id, s]));
    const next = [];
    for (const inc of patch.scenes) {
      const prev = validId(inc.id) && old.get(inc.id);
      if (prev) {
        const f = { text: str(inc.text), display: str(inc.display), prompt: str(inc.prompt), motion: str(inc.motion) };
        const textCh = f.text !== prev.text;
        const promptCh = f.prompt !== prev.prompt;
        const motionCh = f.motion !== prev.motion;
        const dispCh = f.display !== prev.display;
        Object.assign(prev, f);
        if (typeof inc.shot === 'string') prev.shot = str(inc.shot);
        if (textCh || promptCh || motionCh || dispCh) {
          changed = true;
          resetScene(job, prev, { audio: textCh, image: promptCh, clip: promptCh || motionCh });
        }
        next.push(prev);
        old.delete(prev.id);
      } else {
        next.push(makeScene({ ...inc, kind: 'shot' }));
        changed = true;
      }
    }
    for (const gone of old.values()) {
      fs.rmSync(sceneDir(job, gone), { recursive: true, force: true });
      changed = true;
    }
    if (next.map((s) => s.id).join() !== job.scenes.map((s) => s.id).join()) changed = true;
    job.scenes = next;
  }

  if (changed) job.dirty = true;
  job.updatedAt = Date.now();
  persist(job);
  return job;
}

function resetSceneById(id, sid) {
  const job = getJob(id);
  if (!job) throw httpError(404, '项目不存在');
  if (isBusy(job)) throw httpError(409, '正在生成，暂时不能编辑');
  const scene = job.scenes.find((s) => s.id === sid);
  if (!scene) throw httpError(404, '镜头不存在');
  resetScene(job, scene, { image: true, clip: true });
  job.dirty = true;
  job.updatedAt = Date.now();
  persist(job);
  return job;
}

async function rebuildStoryboard(id) {
  const job = getJob(id);
  if (!job) throw httpError(404, '项目不存在');
  if (isBusy(job)) throw httpError(409, '正在生成，暂时不能编辑');
  const tpl = getTemplate(job.template);
  const sb = await buildStoryboard({ tpl, title: job.title, author: job.author, script: job.script, options: job.options });
  job.scenes.forEach((s) => fs.rmSync(sceneDir(job, s), { recursive: true, force: true }));
  job.scenes = sb.scenes;
  job.character = sb.character;
  job.setting = sb.setting;
  job.usedLlm = sb.usedLlm;
  job.warning = sb.warning || null;
  job.status = 'draft';
  job.stage = '草稿';
  job.progress = 0;
  job.result = null;
  job.duration = null;
  job.dirty = false;
  job.error = null;
  job.updatedAt = Date.now();
  persist(job);
  return job;
}

function duplicateProject(id) {
  const src = getJob(id);
  if (!src) throw httpError(404, '项目不存在');
  if (isBusy(src)) throw httpError(409, '正在生成，暂时不能复制');
  const newId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
  fs.cpSync(projectDir(id), projectDir(newId), { recursive: true });
  const json = JSON.parse(JSON.stringify(src).split(`/output/${id}/`).join(`/output/${newId}/`));
  const now = Date.now();
  Object.assign(json, { id: newId, title: `${src.title}（副本）`, createdAt: now, updatedAt: now });
  projects.set(newId, json);
  persist(json);
  return json;
}

function deleteProject(id) {
  const job = getJob(id);
  if (!job) throw httpError(404, '项目不存在');
  if (isBusy(job)) throw httpError(409, '正在生成，暂时不能删除');
  projects.delete(id);
  fs.rmSync(projectDir(id), { recursive: true, force: true });
}

/* ----------------------------- 生成 ----------------------------- */

const exists = (file) => fs.existsSync(file) && fs.statSync(file).size > 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 三种画面方式：
 *  image  插画 + 镜头推拉（最便宜）
 *  i2v    插画 → 图生视频（画面里的人和景物真的会动；片头片尾用静态插画推拉）
 *  video  纯文生视频
 */
async function runJob(job) {
  const settings = settingsStore.load();
  const tpl = getTemplate(job.template);
  const dir = projectDir(job.id);
  const render = { ...settings.render, ...job.options };
  const ttsCfg = providers.ttsWithVoice(settings.tts, job.options.voice);
  const visualMode = ['image', 'i2v', 'video'].includes(render.visual) ? render.visual : 'image';
  const needImage = visualMode === 'image' || visualMode === 'i2v';
  const portrait = render.orientation === 'portrait';
  const width = portrait ? 1080 : 1920;
  const height = portrait ? 1920 : 1080;
  const tail = Number(render.tail) || 0.6;
  const scenes = job.scenes;
  const total = scenes.length;
  const weightGen = 0.75; // 生成阶段占总进度
  let genDone = 0;
  let composeDone = 0;
  const refresh = () => {
    job.progress = Math.round(((genDone / total) * weightGen + (composeDone / total) * (1 - weightGen) * 0.9) * 100);
    persist(job);
  };

  /** 片头复用第一个镜头的画面，片尾复用最后一个 */
  const shots = scenes.filter((s) => s.kind === 'shot');
  const refSceneOf = (scene) => (scene.kind === 'title' ? shots[0] : scene.kind === 'ending' ? shots[shots.length - 1] : null) || null;
  /** 该镜头最终用哪种画面合成：i2v 模式下复用画面的片头/片尾用静态插画 */
  const visualTypeOf = (scene) => {
    if (visualMode === 'image') return 'image';
    if (visualMode === 'video') return 'clip';
    return refSceneOf(scene) ? 'image' : 'clip';
  };
  const no = (scene) => scenes.indexOf(scene) + 1;
  /** 没写画面描述的镜头（如用户新增的）用"画风 + 旁白"兜底 */
  const promptOf = (scene) =>
    scene.prompt || (scene.text ? `${job.options.style || tpl.defaults.style}。${tpl.fallbackPrefix}${scene.text}` : '');

  job.status = 'running';
  job.error = null;
  job.result = null;
  job.stage = '生成配音与画面';
  job.progress = 0;
  const label = { image: '插画 + 镜头推拉', i2v: '插画 → 图生视频', video: '文生视频' }[visualMode];
  log(job, `开始：共 ${total} 个镜头，画面=${label}（图:${settings.image.mode} 视频:${settings.video.mode}），TTS=${settings.tts.mode}`);
  scenes.forEach((s) => {
    s.error = null;
    if (s.stage === 'error') s.stage = 'pending';
  });
  persist(job);

  if (visualMode === 'i2v' && !['dashscope_i2v', 'custom', 'mock'].includes(settings.video.mode)) {
    job.status = 'error';
    job.stage = '失败';
    job.error = '画面方式选了「图生视频」，但设置里「视频生成」的模式不是百炼图生视频 / 自定义 / mock，请到「设置」里修改';
    persist(job);
    return;
  }

  const ttsLimit = pLimit(3);
  const imageLimit = pLimit(Math.max(1, Number(settings.image.concurrency) || 3));
  const videoLimit = pLimit(Math.max(1, Number(settings.video.concurrency) || 2));
  const memo = (map, key, fn) => {
    if (!map.has(key)) map.set(key, fn());
    return map.get(key);
  };
  const audioMemo = new Map();
  const imageMemo = new Map();
  const clipMemo = new Map();
  const retryLog = (scene, what) => (e, n) => log(job, `镜头${no(scene)} ${what}失败，第${n}次重试：${e.message.slice(0, 120)}`);

  /** 配音（无旁白的镜头生成静音），返回音频时长（秒） */
  const getAudio = (scene) =>
    memo(audioMemo, scene.id, async () => {
      const sdir = sceneDir(job, scene);
      fs.mkdirSync(sdir, { recursive: true });
      const file = path.join(sdir, 'audio.mp3');
      if (!exists(file)) {
        await ttsLimit(async () => {
          if (!scene.text) return providers.makeSilence(scene.silent || 4, file); // 无旁白（如片尾）
          scene.detail = '配音中';
          return retry(() => providers.synthesizeSpeech({ cfg: ttsCfg, text: scene.text, outFile: file }), 2, 3000, retryLog(scene, '配音'));
        });
      }
      scene.audio = assetUrl(job, scene, 'audio.mp3');
      return ff.getDuration(file);
    });

  /** 插画：自己生成，或复用别的镜头（片头/片尾，每次都重新拷贝以跟随源镜头的修改） */
  const getImage = (scene) =>
    memo(imageMemo, scene.id, async () => {
      const sdir = sceneDir(job, scene);
      fs.mkdirSync(sdir, { recursive: true });
      const file = path.join(sdir, 'image.png');
      const ref = refSceneOf(scene);
      if (ref) {
        await getImage(ref);
        fs.copyFileSync(path.join(sceneDir(job, ref), 'image.png'), file);
      } else if (!exists(file)) {
        const prompt = promptOf(scene);
        if (!prompt) throw new Error('该镜头没有画面描述，也没有旁白可参考');
        scene.detail = '插画生成中';
        await imageLimit(() =>
          retry(() => providers.generateImage({ cfg: settings.image, render, prompt, outFile: file }), 2, 4000, retryLog(scene, '插画')),
        );
      }
      scene.image = assetUrl(job, scene, 'image.png');
    });

  /** 视频片段：文生视频，或以插画为首帧的图生视频 */
  const getClip = (scene) =>
    memo(clipMemo, scene.id, async () => {
      const sdir = sceneDir(job, scene);
      fs.mkdirSync(sdir, { recursive: true });
      const file = path.join(sdir, 'clip.mp4');
      const ref = visualMode === 'video' ? refSceneOf(scene) : null;
      if (ref) {
        await getClip(ref);
        fs.copyFileSync(path.join(sceneDir(job, ref), 'clip.mp4'), file);
      } else if (!exists(file)) {
        let prompt = promptOf(scene);
        let duration;
        let imageFile;
        if (visualMode === 'i2v') {
          await getImage(scene);
          const audioDur = await getAudio(scene);
          duration = clamp(Math.ceil(audioDur + tail), 2, 15); // 视频长度≈旁白长度，不浪费
          imageFile = path.join(sdir, 'image.png');
          prompt = `${scene.motion || tpl.defaultMotion}。${tpl.keepStyle}`;
        }
        if (!prompt) throw new Error('该镜头没有画面描述，也没有旁白可参考');
        scene.detail = `视频生成中${duration ? `（${duration}s）` : ''}`;
        await videoLimit(() =>
          retry(
            () =>
              providers.generateClip({
                cfg: settings.video,
                render,
                prompt,
                imageFile,
                duration,
                outFile: file,
                onStatus: (s) => {
                  scene.detail = s;
                },
              }),
            1,
            5000,
            retryLog(scene, '视频'),
          ),
        );
      }
      scene.clip = assetUrl(job, scene, 'clip.mp4');
    });

  try {
    await Promise.all(
      scenes.map(async (scene) => {
        fs.mkdirSync(sceneDir(job, scene), { recursive: true });
        try {
          scene.stage = 'tts';
          const tasks = [getAudio(scene)];
          if (needImage) tasks.push(getImage(scene));
          if (visualTypeOf(scene) === 'clip') tasks.push(getClip(scene));
          await Promise.all(tasks);
          scene.stage = 'compose';
          scene.detail = '素材就绪';
          genDone++;
          refresh();
        } catch (e) {
          scene.stage = 'error';
          scene.error = e.message;
          log(job, `镜头${no(scene)} 失败：${e.message.slice(0, 300)}`);
          throw e;
        }
      }),
    );

    job.stage = '合成镜头（对齐配音、烧录字幕）';
    persist(job);
    const segFiles = [];
    for (const scene of scenes) {
      const sdir = sceneDir(job, scene);
      scene.detail = '合成中';
      const type = visualTypeOf(scene);
      const r = await ff.makeSegment({
        dir: sdir,
        visual: { type, file: type === 'image' ? 'image.png' : 'clip.mp4' },
        audio: 'audio.mp3',
        kind: scene.kind,
        display: scene.display || scene.text,
        out: 'seg.mp4',
        width,
        height,
        fps: Number(render.fps) || 30,
        subtitles: !!render.subtitles,
        tail: scene.kind === 'ending' ? 0.2 : tail,
        index: scenes.indexOf(scene),
      });
      if (render.subtitles && !r.subtitles) log(job, `镜头${no(scene)} 字幕烧录不可用，已跳过字幕`);
      scene.segment = assetUrl(job, scene, 'seg.mp4');
      scene.stage = 'done';
      scene.duration = Math.round(r.duration * 10) / 10;
      scene.detail = `${r.duration.toFixed(1)}s`;
      segFiles.push(`s${scene.id}/seg.mp4`);
      composeDone++;
      refresh();
    }

    job.stage = '拼接成片';
    persist(job);
    await ff.concatSegments({ dir, segments: segFiles, out: 'final.mp4' });
    job.result = `/output/${job.id}/final.mp4?v=${Date.now()}`;
    job.duration = Math.round((await ff.getDuration(path.join(dir, 'final.mp4'))) * 10) / 10;
    job.status = 'done';
    job.stage = '完成';
    job.progress = 100;
    job.dirty = false;
    log(job, '成片完成');
  } catch (e) {
    job.status = 'error';
    job.stage = '失败';
    job.error = e.message;
    log(job, `生成失败：${e.message.slice(0, 300)}`);
  }
  job.updatedAt = Date.now();
  persist(job);
}

/** 后台开始生成（不 await）；已完成的素材会跳过 */
function startGenerate(id) {
  const job = getJob(id);
  if (!job) throw httpError(404, '项目不存在');
  if (isBusy(job)) throw httpError(409, '正在生成');
  job.status = 'queued';
  job.stage = '排队中';
  job.error = null;
  persist(job);
  runJob(job).catch((e) => {
    job.status = 'error';
    job.error = e.message;
    persist(job);
  });
  return job;
}

module.exports = {
  OUTPUT_DIR,
  listProjects,
  getJob,
  createProject,
  updateProject,
  resetSceneById,
  rebuildStoryboard,
  duplicateProject,
  deleteProject,
  startGenerate,
  splitPoem,
  splitSentences,
};
