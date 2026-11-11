const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const settingsStore = require('./settings');
const providers = require('./providers');
const ff = require('./ffmpeg');
const { pLimit, retry } = require('./util');

const OUTPUT_DIR = path.join(settingsStore.ROOT, 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const jobs = new Map();

/** 把诗拆成"句"，再按 linesPerScene 合并成分镜 */
function splitPoem(poem, linesPerScene = 1) {
  const lines = poem
    .replace(/\r/g, '')
    .split(/[\n，。！？；,.!?;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const n = Math.max(1, Number(linesPerScene) || 1);
  const verses = [];
  for (let i = 0; i < lines.length; i += n) {
    verses.push({ text: lines.slice(i, i + n).join('，') + '。' });
  }
  return { lines, verses };
}

/**
 * 生成分镜：[片头标题卡] + 每句诗一个镜头 + [片尾全诗]
 * 片头/片尾复用诗句镜头的画面（imageRef），不额外生成图片。
 */
async function storyboard({ title, author, poem, style }) {
  const settings = settingsStore.load();
  const useStyle = style || settings.render.style;
  const { lines, verses } = splitPoem(poem, settings.render.linesPerScene);
  if (!verses.length) throw new Error('没有识别到诗句');

  const { shots, character, setting, usedLlm, warning } = await providers.buildShots({
    llm: settings.llm,
    title,
    author,
    poem,
    verses,
    style: useStyle,
  });

  const scenes = [];
  const t = title || '无题';
  const a = author || '';
  if (settings.render.titleCard) {
    scenes.push({
      kind: 'title',
      text: a ? `${t}，${a}` : t,
      display: a ? `${t}\n（${a}）` : t,
      prompt: '',
      imageRef: null, // 由下方统一回填
    });
  }
  verses.forEach((v, i) => {
    scenes.push({
      kind: 'verse',
      text: v.text,
      display: '',
      prompt: shots[i].prompt,
      motion: shots[i].motion,
      shot: shots[i].shot,
      imageRef: null,
    });
  });
  if (settings.render.endCard) {
    scenes.push({
      kind: 'ending',
      text: '',
      display: [`《${t}》`, a, ...lines].filter(Boolean).join('\n'),
      prompt: '',
      imageRef: null,
      silent: 5,
    });
  }
  fixRefs(scenes);
  return { usedLlm, warning, character, setting, scenes };
}

/** 片头复用第一个诗句镜头的画面，片尾复用最后一个 */
function fixRefs(scenes) {
  const verseIdx = scenes.map((s, i) => (s.kind === 'verse' ? i : -1)).filter((i) => i >= 0);
  scenes.forEach((s) => {
    if (s.kind === 'title') s.imageRef = verseIdx.length ? verseIdx[0] : null;
    if (s.kind === 'ending') s.imageRef = verseIdx.length ? verseIdx[verseIdx.length - 1] : null;
  });
}

function jobDir(id) {
  return path.join(OUTPUT_DIR, id);
}

function persist(job) {
  fs.writeFileSync(path.join(jobDir(job.id), 'job.json'), JSON.stringify(job, null, 2), 'utf8');
}

function log(job, msg) {
  job.logs.push(`${new Date().toLocaleTimeString()} ${msg}`);
  if (job.logs.length > 300) job.logs.shift();
}

function createJob({ title, author, scenes }) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error('scenes 不能为空');
  const id = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
  const job = {
    id,
    title: title || '未命名',
    author: author || '',
    status: 'queued', // queued | running | done | error
    stage: '排队中',
    progress: 0,
    createdAt: Date.now(),
    error: null,
    result: null,
    logs: [],
    scenes: scenes.map((s, i) => ({
      index: i,
      kind: s.kind || 'verse',
      text: String(s.text || '').trim(),
      display: String(s.display || '').trim(),
      prompt: String(s.prompt || '').trim(),
      motion: String(s.motion || '').trim(),
      imageRef: Number.isInteger(s.imageRef) ? s.imageRef : null,
      silent: Number(s.silent) || 4,
      stage: 'pending', // pending | tts | compose | done | error
      detail: '',
      audio: null,
      image: null,
      clip: null,
      segment: null,
      error: null,
    })),
  };
  fs.mkdirSync(jobDir(id), { recursive: true });
  jobs.set(id, job);
  persist(job);
  return job;
}

function getJob(id) {
  if (jobs.has(id)) return jobs.get(id);
  try {
    const job = JSON.parse(fs.readFileSync(path.join(jobDir(id), 'job.json'), 'utf8'));
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'error';
      job.error = '服务重启导致任务中断，可点击"重试"继续（已完成的步骤会跳过）';
    }
    jobs.set(id, job);
    return job;
  } catch {
    return null;
  }
}

function listJobs() {
  const out = [];
  for (const name of fs.readdirSync(OUTPUT_DIR)) {
    const j = getJob(name);
    if (j) out.push({ id: j.id, title: j.title, author: j.author, status: j.status, createdAt: j.createdAt, result: j.result });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
}

const exists = (file) => fs.existsSync(file) && fs.statSync(file).size > 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const I2V_DEFAULT_MOTION = '画面中的人物与景物自然缓慢地运动，水面泛起涟漪，花草随风轻摆，薄雾缓缓流动，镜头缓慢推进';

/**
 * 三种画面方式：
 *  image  插画 + 镜头推拉（最便宜）
 *  i2v    插画 → 图生视频（画面里的人和景物真的会动；片头片尾用静态插画推拉）
 *  video  纯文生视频
 */
async function runJob(job) {
  const settings = settingsStore.load();
  const dir = jobDir(job.id);
  const render = settings.render;
  const visualMode = ['image', 'i2v', 'video'].includes(render.visual) ? render.visual : 'image';
  const needImage = visualMode === 'image' || visualMode === 'i2v';
  const portrait = render.orientation === 'portrait';
  const width = portrait ? 1080 : 1920;
  const height = portrait ? 1920 : 1080;
  const tail = Number(render.tail) || 0.6;
  const total = job.scenes.length;
  const weightGen = 0.75; // 生成阶段占总进度
  let genDone = 0;
  let composeDone = 0;
  const refresh = () => {
    job.progress = Math.round(((genDone / total) * weightGen + (composeDone / total) * (1 - weightGen) * 0.9) * 100);
    persist(job);
  };
  const sdirOf = (i) => path.join(dir, `s${i}`);
  /** 该镜头最终用哪种画面合成：i2v 模式下复用画面的片头/片尾用静态插画 */
  const visualTypeOf = (scene) => {
    if (visualMode === 'image') return 'image';
    if (visualMode === 'video') return 'clip';
    return scene.imageRef != null ? 'image' : 'clip';
  };

  job.status = 'running';
  job.error = null;
  job.result = null;
  const label = { image: '插画 + 镜头推拉', i2v: '插画 → 图生视频', video: '文生视频' }[visualMode];
  job.stage = '生成配音与画面';
  log(
    job,
    `开始：共 ${total} 个镜头，画面=${label}（图:${settings.image.mode} 视频:${settings.video.mode}），TTS=${settings.tts.mode}`,
  );
  persist(job);

  if (visualMode === 'i2v' && !['dashscope_i2v', 'custom', 'mock'].includes(settings.video.mode)) {
    job.status = 'error';
    job.stage = '失败';
    job.error = '画面方式选了「图生视频」，但「文生视频」配置的模式不是 dashscope_i2v / custom / mock，请到模型配置里修改';
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
  const retryLog = (i, what) => (e, n) => log(job, `镜头${i + 1} ${what}失败，第${n}次重试：${e.message.slice(0, 120)}`);
  const refOf = (scene, i, depth) =>
    scene.imageRef != null && scene.imageRef !== i && depth < 3 && job.scenes[scene.imageRef] ? scene.imageRef : null;

  /** 配音（无旁白的镜头生成静音），返回音频时长（秒） */
  const getAudio = (i) =>
    memo(audioMemo, i, async () => {
      const scene = job.scenes[i];
      const sdir = sdirOf(i);
      fs.mkdirSync(sdir, { recursive: true });
      const file = path.join(sdir, 'audio.mp3');
      if (!exists(file)) {
        await ttsLimit(async () => {
          if (!scene.text) return providers.makeSilence(scene.silent || 4, file); // 片尾无旁白
          scene.detail = '配音中';
          return retry(() => providers.synthesizeSpeech({ cfg: settings.tts, text: scene.text, outFile: file }), 2, 3000, retryLog(i, '配音'));
        });
      }
      scene.audio = `/output/${job.id}/s${i}/audio.mp3`;
      return ff.getDuration(file);
    });

  /** 插画：自己生成，或复用别的镜头（片头/片尾） */
  const getImage = (i, depth = 0) =>
    memo(imageMemo, i, async () => {
      const scene = job.scenes[i];
      const sdir = sdirOf(i);
      fs.mkdirSync(sdir, { recursive: true });
      const file = path.join(sdir, 'image.png');
      if (!exists(file)) {
        const ref = refOf(scene, i, depth);
        if (ref != null) {
          await getImage(ref, depth + 1);
          fs.copyFileSync(path.join(sdirOf(ref), 'image.png'), file);
        } else {
          scene.detail = '插画生成中';
          await imageLimit(() =>
            retry(() => providers.generateImage({ cfg: settings.image, render, prompt: scene.prompt, outFile: file }), 2, 4000, retryLog(i, '插画')),
          );
        }
      }
      scene.image = `/output/${job.id}/s${i}/image.png`;
    });

  /** 视频片段：文生视频，或以插画为首帧的图生视频 */
  const getClip = (i, depth = 0) =>
    memo(clipMemo, i, async () => {
      const scene = job.scenes[i];
      const sdir = sdirOf(i);
      fs.mkdirSync(sdir, { recursive: true });
      const file = path.join(sdir, 'clip.mp4');
      if (!exists(file)) {
        const ref = visualMode === 'video' ? refOf(scene, i, depth) : null;
        if (ref != null) {
          await getClip(ref, depth + 1);
          fs.copyFileSync(path.join(sdirOf(ref), 'clip.mp4'), file);
        } else {
          let prompt = scene.prompt;
          let duration;
          let imageFile;
          if (visualMode === 'i2v') {
            await getImage(i);
            const audioDur = await getAudio(i);
            duration = clamp(Math.ceil(audioDur + tail), 2, 15); // 视频长度≈旁白长度，不浪费
            imageFile = path.join(sdir, 'image.png');
            prompt = `${scene.motion || I2V_DEFAULT_MOTION}。保持原画的国风手绘水彩风格与人物外观，画面中不出现任何文字。`;
          }
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
              retryLog(i, '视频'),
            ),
          );
        }
      }
      scene.clip = `/output/${job.id}/s${i}/clip.mp4`;
    });

  try {
    await Promise.all(
      job.scenes.map(async (scene) => {
        fs.mkdirSync(sdirOf(scene.index), { recursive: true });
        scene.error = null;
        try {
          scene.stage = 'tts';
          const tasks = [getAudio(scene.index)];
          if (needImage) tasks.push(getImage(scene.index));
          if (visualTypeOf(scene) === 'clip') tasks.push(getClip(scene.index));
          await Promise.all(tasks);
          scene.stage = 'compose';
          scene.detail = '素材就绪';
          genDone++;
          refresh();
        } catch (e) {
          scene.stage = 'error';
          scene.error = e.message;
          log(job, `镜头${scene.index + 1} 失败：${e.message.slice(0, 300)}`);
          throw e;
        }
      }),
    );

    job.stage = '合成镜头（对齐配音、烧录字幕）';
    persist(job);
    const segFiles = [];
    for (const scene of job.scenes) {
      const sdir = sdirOf(scene.index);
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
        index: scene.index,
      });
      if (render.subtitles && !r.subtitles) log(job, `镜头${scene.index + 1} 字幕烧录不可用，已跳过字幕`);
      scene.segment = `/output/${job.id}/s${scene.index}/seg.mp4`;
      scene.stage = 'done';
      scene.detail = `${r.duration.toFixed(1)}s`;
      segFiles.push(`s${scene.index}/seg.mp4`);
      composeDone++;
      refresh();
    }

    job.stage = '拼接成片';
    persist(job);
    await ff.concatSegments({ dir, segments: segFiles, out: 'final.mp4' });
    job.result = `/output/${job.id}/final.mp4`;
    job.status = 'done';
    job.stage = '完成';
    job.progress = 100;
    log(job, '成片完成');
  } catch (e) {
    job.status = 'error';
    job.stage = '失败';
    job.error = e.message;
    log(job, `任务失败：${e.message.slice(0, 300)}`);
  }
  persist(job);
}

function start(job) {
  // 不 await，后台执行
  runJob(job).catch((e) => {
    job.status = 'error';
    job.error = e.message;
    persist(job);
  });
}

module.exports = { storyboard, createJob, getJob, listJobs, start, splitPoem, OUTPUT_DIR };
