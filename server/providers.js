/**
 * 四类 AI 能力的适配层：LLM(分镜) / TTS(配音) / 文生图(插画) / 文生视频(可选)。
 * 采用"请求模板"设计：任何第三方只要是 HTTP + API Key，都可以用 custom 模式配置，不用改代码。
 */
const fs = require('fs');
const path = require('path');
const ff = require('./ffmpeg');
const cursor = require('./cursor-llm');
const { sleep, getPath, httpRequest, readJsonOrThrow, downloadTo } = require('./util');

const DASHSCOPE = 'https://dashscope.aliyuncs.com';
const trimSlash = (s) => String(s || '').replace(/\/$/, '');

/* ----------------------------- 预设模板 ----------------------------- */

function ttsSpec(cfg) {
  if (cfg.mode === 'custom') {
    if (!cfg.custom) throw new Error('TTS 选择了 custom 模式，但没有配置自定义 JSON');
    return cfg.custom;
  }
  if (cfg.mode === 'dashscope') {
    // 百炼 qwen3-tts：返回 output.audio.url（24h 有效，需立即下载）
    return {
      request: {
        method: 'POST',
        url: `${trimSlash(cfg.baseUrl) || DASHSCOPE}/api/v1/services/aigc/multimodal-generation/generation`,
        headers: { Authorization: 'Bearer {{apiKey}}' },
        body: { model: '{{model}}', input: { text: '{{text}}', voice: '{{voice}}', language_type: 'Chinese' } },
      },
      responseType: 'url',
      path: 'output.audio.url',
    };
  }
  // openai 兼容：POST {baseUrl}/audio/speech，直接返回音频二进制
  return {
    request: {
      method: 'POST',
      url: `${trimSlash(cfg.baseUrl) || 'https://api.openai.com/v1'}/audio/speech`,
      headers: { Authorization: 'Bearer {{apiKey}}' },
      body: { model: '{{model}}', input: '{{text}}', voice: '{{voice}}', speed: '{{speed}}', response_format: 'mp3' },
    },
    responseType: 'binary',
  };
}

function imageSpec(cfg) {
  if (cfg.mode === 'custom') {
    if (!cfg.custom) throw new Error('文生图选择了 custom 模式，但没有配置自定义 JSON');
    return cfg.custom;
  }
  // 百炼 qwen-image：同步返回 output.choices[0].message.content[0].image
  return {
    request: {
      method: 'POST',
      url: `${trimSlash(cfg.baseUrl) || DASHSCOPE}/api/v1/services/aigc/multimodal-generation/generation`,
      headers: { Authorization: 'Bearer {{apiKey}}' },
      body: {
        model: '{{model}}',
        input: { messages: [{ role: 'user', content: [{ text: '{{prompt}}' }] }] },
        parameters: { size: '{{size}}', watermark: false },
      },
    },
    responseType: 'url',
    path: 'output.choices[0].message.content[0].image',
  };
}

function videoSpec(cfg) {
  if (cfg.mode === 'custom') {
    if (!cfg.custom) throw new Error('视频选择了 custom 模式，但没有配置自定义 JSON');
    return cfg.custom;
  }
  if (cfg.mode === 'openai') {
    // OpenAI Sora：POST /videos → GET /videos/{id} 轮询 → GET /videos/{id}/content 下载 mp4（需带 Key）
    const base = trimSlash(cfg.baseUrl) || 'https://api.openai.com/v1';
    return {
      submit: {
        method: 'POST',
        url: `${base}/videos`,
        headers: { Authorization: 'Bearer {{apiKey}}' },
        body: { model: '{{model}}', prompt: '{{prompt}}', size: '{{openaiSize}}', seconds: '{{seconds}}' },
      },
      taskIdPath: 'id',
      poll: { method: 'GET', url: `${base}/videos/{{taskId}}`, headers: { Authorization: 'Bearer {{apiKey}}' } },
      statusPath: 'status',
      successValues: ['completed'],
      failValues: ['failed', 'cancelled', 'canceled', 'expired'],
      download: { method: 'GET', url: `${base}/videos/{{taskId}}/content`, headers: { Authorization: 'Bearer {{apiKey}}' } },
      intervalMs: 8000,
      timeoutMs: 20 * 60 * 1000,
    };
  }
  if (cfg.mode === 'dashscope' || cfg.mode === 'dashscope_i2v') {
    const base = trimSlash(cfg.baseUrl) || DASHSCOPE;
    // dashscope_i2v：万相 2.7 图生视频，以插画为首帧让画面动起来；dashscope：文生视频
    const body =
      cfg.mode === 'dashscope_i2v'
        ? {
            model: '{{model}}',
            input: { prompt: '{{prompt}}', media: [{ type: 'first_frame', url: '{{imageData}}' }] },
            parameters: { resolution: '{{resolution}}', duration: '{{duration}}', prompt_extend: true, watermark: false },
          }
        : { model: '{{model}}', input: { prompt: '{{prompt}}' }, parameters: { size: '{{size}}' } };
    return {
      submit: {
        method: 'POST',
        url: `${base}/api/v1/services/aigc/video-generation/video-synthesis`,
        headers: { Authorization: 'Bearer {{apiKey}}', 'X-DashScope-Async': 'enable' },
        body,
      },
      taskIdPath: 'output.task_id',
      poll: { method: 'GET', url: `${base}/api/v1/tasks/{{taskId}}`, headers: { Authorization: 'Bearer {{apiKey}}' } },
      statusPath: 'output.task_status',
      successValues: ['SUCCEEDED'],
      failValues: ['FAILED', 'CANCELED', 'UNKNOWN'],
      videoUrlPath: 'output.video_url',
      intervalMs: 8000,
      timeoutMs: 15 * 60 * 1000,
    };
  }
  // ark / ark_i2v：火山方舟 Seedance（ark_i2v = 以插画为首帧的图生视频，Seedance 1.0 Pro Fast 约 0.09 元/秒）
  const base = trimSlash(cfg.baseUrl) || 'https://ark.cn-beijing.volces.com';
  const submit =
    cfg.mode === 'ark_i2v'
      ? {
          method: 'POST',
          url: `${base}/api/v3/contents/generations/tasks`,
          headers: { Authorization: 'Bearer {{apiKey}}' },
          body: {
            model: '{{model}}',
            content: [
              { type: 'text', text: '{{prompt}}' },
              { type: 'image_url', role: 'first_frame', image_url: { url: '{{imageData}}' } },
            ],
            resolution: '{{resolutionLower}}',
            ratio: 'adaptive',
            duration: '{{duration}}',
            watermark: false,
          },
        }
      : {
          method: 'POST',
          url: `${base}/api/v3/contents/generations/tasks`,
          headers: { Authorization: 'Bearer {{apiKey}}' },
          body: { model: '{{model}}', content: [{ type: 'text', text: '{{prompt}} --ratio {{ratio}} --dur {{duration}}' }] },
        };
  return {
    submit,
    taskIdPath: 'id',
    poll: { method: 'GET', url: `${base}/api/v3/contents/generations/tasks/{{taskId}}`, headers: { Authorization: 'Bearer {{apiKey}}' } },
    statusPath: 'status',
    successValues: ['succeeded'],
    failValues: ['failed', 'cancelled', 'canceled', 'expired'],
    videoUrlPath: 'content.video_url',
    intervalMs: 6000,
    timeoutMs: 15 * 60 * 1000,
  };
}

/* ----------------------------- LLM：分镜 ----------------------------- */

async function llmChat(cfg, messages) {
  if (cursor.isCursor(cfg)) return cursor.complete(cfg, messages);
  const res = await httpRequest(
    {
      method: 'POST',
      url: `${trimSlash(cfg.baseUrl)}/chat/completions`,
      headers: { Authorization: 'Bearer {{apiKey}}' },
      body: { model: '{{model}}', messages, temperature: 0.7 },
    },
    { apiKey: cfg.apiKey, model: cfg.model },
    120000,
  );
  const json = await readJsonOrThrow(res, 'LLM');
  const content = getPath(json, 'choices[0].message.content');
  if (!content) throw new Error('LLM 返回内容为空');
  return content;
}

/**
 * 通用对话补全（OpenAI 兼容），支持 tools；返回 message 对象（含 content / tool_calls）。
 * 直接 fetch，不走请求模板（消息里可能含 {{ }}，不能被当成模板变量替换）。
 */
async function llmComplete(cfg, { messages, tools, temperature = 0.4 }) {
  // Cursor 的 Key：走官方 SDK，没有函数调用，tools 被忽略
  if (cursor.isCursor(cfg)) return { role: 'assistant', content: await cursor.complete(cfg, messages) };
  const body = { model: cfg.model, messages, temperature };
  if (tools?.length) body.tools = tools;
  const res = await fetch(`${trimSlash(cfg.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const json = await readJsonOrThrow(res, 'LLM');
  const msg = getPath(json, 'choices[0].message');
  if (!msg) throw new Error('LLM 返回内容为空');
  return msg;
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('LLM 没有返回 JSON');
  return JSON.parse(m[0]);
}

const SHOT_CYCLE = ['远景', '中景', '特写', '背影', '全景', '近景'];

/**
 * 为每个分句生成镜头：景别 + 画面提示词 + 动作描述，并给出贯穿全片的角色/场景设定（保证画面一致）。
 * template 决定分镜师角色、回退文案与默认动作；失败/未配置 LLM 时回退到规则模板。
 */
async function buildShots({ llm, template, title, author, script, verses, style, skillText = '', research = '' }) {
  const DEFAULT_MOTION = template.defaultMotion;
  const compose = (shot, body, character, setting) =>
    [
      style,
      character ? `角色：${character}` : '',
      setting ? `场景：${setting}` : '',
      `${shot}镜头：${body}`,
    ]
      .filter(Boolean)
      .join('。');
  const fallback = () => ({
    character: '',
    setting: '',
    usedLlm: false,
    shots: verses.map((v, i) => {
      const shot = i === 0 ? '远景' : SHOT_CYCLE[i % SHOT_CYCLE.length];
      return {
        shot,
        prompt: compose(shot, `${template.fallbackPrefix}${v.text.replace(/[。，！？；,.!?;]+$/, '')}，画面唯美`),
        motion: DEFAULT_MOTION,
      };
    }),
  });

  if (!llm.enabled || !llm.apiKey) return fallback();
  try {
    const content = await llmChat(llm, [
      {
        role: 'system',
        content:
          `你是${template.role}。根据文本，为每一个${template.unit}设计一个镜头，输出严格的 JSON：` +
          '{"character":"贯穿全片的主角/主体外观固定描述（年龄、发型、衣着、造型；没有固定主角则为空字符串）",' +
          '"setting":"统一的季节、时间、光线与环境基调",' +
          '"shots":[{"shot":"远景|全景|中景|近景|特写|背影 之一","prompt":"该镜头的画面描述，50-90字，写清主体、动作、构图、光影","motion":"该镜头里画面如何动起来，30-60字，写清人物动作、景物动态（水波、风、云雾、花叶摇曳）和运镜，动作要自然舒缓"}]}。' +
          `shots 的数量必须与${template.unit}数完全一致；第一个镜头建立整体环境；镜头类型要交替变化；` +
          '各镜头的角色、画风、色调必须保持一致；画面里不要出现任何文字。只输出 JSON。' +
          skillText,
      },
      {
        role: 'user',
        content: `标题：${title || '无题'}\n${author ? `作者：${author}\n` : ''}全文：${script}\n${research ? `背景资料（来自工具检索，仅供设计画面时参考）：\n${research}\n` : ''}统一画风：${style}\n分句（共${verses.length}个镜头）：\n${verses
          .map((v, i) => `${i + 1}. ${v.text}`)
          .join('\n')}`,
      },
    ]);
    const j = extractJson(content);
    const arr = j.shots || [];
    const fb = fallback();
    return {
      character: j.character || '',
      setting: j.setting || '',
      usedLlm: true,
      shots: verses.map((v, i) => {
        const s = arr[i];
        if (!s?.prompt) return fb.shots[i];
        const shot = s.shot || SHOT_CYCLE[i % SHOT_CYCLE.length];
        return { shot, prompt: compose(shot, s.prompt, j.character, j.setting), motion: s.motion || DEFAULT_MOTION };
      }),
    };
  } catch (e) {
    console.warn('[llm] 分镜生成失败，使用规则模板：', e.message);
    return { ...fallback(), warning: e.message };
  }
}

/* ----------------------------- TTS ----------------------------- */

/** 项目级音色覆盖：edge 用 *Neural 音色 ID，其他服务用各自的音色名；类型不匹配时忽略 */
function ttsWithVoice(cfg, voice) {
  if (!voice) return cfg;
  const isEdgeVoice = /Neural$/.test(voice);
  if (cfg.mode === 'edge') return isEdgeVoice ? { ...cfg, edgeVoice: voice } : cfg;
  return isEdgeVoice ? cfg : { ...cfg, voice };
}

async function synthesizeSpeech({ cfg, text, outFile }) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (cfg.mode === 'mock') {
    const dur = Math.max(2.5, text.replace(/[，。！？；、\s]/g, '').length * 0.32);
    await ff.run(['-f', 'lavfi', '-i', `sine=frequency=330:duration=${dur.toFixed(2)}`, '-af', 'volume=0.08', '-c:a', 'libmp3lame', outFile]);
    return;
  }
  if (cfg.mode === 'edge') {
    // 免费、无需 Key：微软 Edge 在线朗读。speed 0.9 → rate -10%
    const { EdgeTTS } = require('node-edge-tts');
    const pct = Math.round(((Number(cfg.speed) || 1) - 1) * 100);
    const tts = new EdgeTTS({
      voice: cfg.edgeVoice || 'zh-CN-YunxiNeural',
      lang: 'zh-CN',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      rate: `${pct >= 0 ? '+' : ''}${pct}%`,
      timeout: 30000,
    });
    await tts.ttsPromise(text, outFile);
    return;
  }
  const spec = ttsSpec(cfg);
  const vars = { apiKey: cfg.apiKey, model: cfg.model, voice: cfg.voice, speed: cfg.speed, text };
  const res = await httpRequest(spec.request, vars, 120000);
  const type = spec.responseType || 'binary';
  if (type === 'binary') {
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
    return;
  }
  const json = await readJsonOrThrow(res, 'TTS');
  const val = getPath(json, spec.path);
  if (!val) throw new Error(`TTS 响应里找不到 ${spec.path}: ${JSON.stringify(json).slice(0, 300)}`);
  if (type === 'url') await downloadTo(val, outFile);
  else if (type === 'base64') fs.writeFileSync(outFile, Buffer.from(String(val).replace(/^data:.*?;base64,/, ''), 'base64'));
  else throw new Error(`未知 responseType: ${type}`);
}

/** 生成一段静音（用于片尾全诗等无旁白镜头） */
async function makeSilence(seconds, outFile) {
  await ff.run(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(seconds), '-c:a', 'libmp3lame', outFile]);
}

/* ----------------------------- 文生图 ----------------------------- */

function visualVars(render, extra) {
  const portrait = render.orientation === 'portrait';
  return {
    ratio: portrait ? '9:16' : '16:9',
    size: portrait ? '928*1664' : '1664*928',
    width: portrait ? 928 : 1664,
    height: portrait ? 1664 : 928,
    ...extra,
  };
}

async function generateImage({ cfg, render, prompt, outFile }) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const v = visualVars(render, {});
  if (cfg.mode === 'mock') {
    // 水墨感渐变底图，用于无 Key 时演示整条流水线
    await ff.run([
      '-f', 'lavfi', '-i', `gradients=s=${v.width}x${v.height}:c0=0x2c3e50:c1=0xd9cfb4:x0=0:y0=0:x1=${v.width}:y1=${v.height}:d=1:speed=0.01`,
      '-frames:v', '1', outFile,
    ]);
    return;
  }
  const spec = imageSpec(cfg);
  const full = `${prompt}。画面中没有任何文字、字幕和水印。`;
  const res = await httpRequest(spec.request, { apiKey: cfg.apiKey, model: cfg.model, prompt: full, ...v }, 180000);
  const json = await readJsonOrThrow(res, '文生图');
  const val = getPath(json, spec.path);
  if (!val) throw new Error(`文生图响应里找不到 ${spec.path}: ${JSON.stringify(json).slice(0, 300)}`);
  if ((spec.responseType || 'url') === 'base64') {
    fs.writeFileSync(outFile, Buffer.from(String(val).replace(/^data:.*?;base64,/, ''), 'base64'));
  } else {
    await downloadTo(val, outFile);
  }
}

/* ----------------------------- 文生视频（可选） ----------------------------- */

function videoVars(cfg, render, prompt, { duration, imageFile } = {}) {
  const portrait = render.orientation === 'portrait';
  const want = Math.round(Number(duration) || Number(cfg.duration) || 5);
  const imageData = imageFile ? `data:image/png;base64,${fs.readFileSync(imageFile).toString('base64')}` : '';
  return {
    apiKey: cfg.apiKey,
    model: cfg.model,
    prompt,
    imageData,
    resolution: cfg.resolution || '720P',
    resolutionLower: String(cfg.resolution || '720P').toLowerCase(),
    duration: want,
    ratio: portrait ? '9:16' : '16:9',
    size: portrait ? '1080*1920' : '1920*1080',
    openaiSize: portrait ? '720x1280' : '1280x720',
    // Sora 只支持 4/8/12 秒，取最接近的（字符串）
    seconds: String([4, 8, 12].reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a))),
    width: portrait ? 1080 : 1920,
    height: portrait ? 1920 : 1080,
  };
}

/**
 * 生成视频片段。imageFile 存在时为图生视频（以该图为首帧）；duration 为期望秒数（整数）。
 */
async function generateClip({ cfg, render, prompt, outFile, imageFile, duration, onStatus = () => {} }) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (cfg.mode === 'mock') {
    const dur = Math.round(Number(duration) || Number(cfg.duration) || 5);
    if (imageFile) {
      // 无 Key 演示：把插画做成轻微缩放的片段
      await ff.run([
        '-loop', '1', '-framerate', '25', '-i', imageFile, '-t', String(dur),
        '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p',
        '-c:v', 'libx264', outFile,
      ]);
      return;
    }
    const portrait = render.orientation === 'portrait';
    const size = portrait ? '540x960' : '960x540';
    await ff.run(['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24:duration=${dur}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outFile]);
    return;
  }

  const spec = videoSpec(cfg);
  const vars = videoVars(cfg, render, prompt, { duration, imageFile });

  const submitRes = await httpRequest(spec.submit, vars, 60000);
  const submitJson = await readJsonOrThrow(submitRes, '提交视频任务');
  const taskId = getPath(submitJson, spec.taskIdPath);
  if (!taskId) throw new Error(`提交成功但找不到任务ID(${spec.taskIdPath}): ${JSON.stringify(submitJson).slice(0, 300)}`);
  onStatus(`任务已提交 ${taskId}`);

  const interval = spec.intervalMs || 6000;
  const deadline = Date.now() + (spec.timeoutMs || 15 * 60 * 1000);
  const ok = (spec.successValues || []).map((s) => String(s).toLowerCase());
  const bad = (spec.failValues || []).map((s) => String(s).toLowerCase());
  while (Date.now() < deadline) {
    await sleep(interval);
    const res = await httpRequest(spec.poll, { ...vars, taskId }, 60000);
    const json = await readJsonOrThrow(res, '查询视频任务');
    const status = String(getPath(json, spec.statusPath) ?? '').toLowerCase();
    onStatus(`生成中：${status || '未知'}`);
    if (ok.includes(status)) {
      if (spec.download) {
        const dl = await httpRequest(spec.download, { ...vars, taskId }, 10 * 60 * 1000);
        if (!dl.ok) throw new Error(`下载视频 HTTP ${dl.status}: ${(await dl.text()).slice(0, 300)}`);
        fs.writeFileSync(outFile, Buffer.from(await dl.arrayBuffer()));
        return;
      }
      const url = getPath(json, spec.videoUrlPath);
      if (!url) throw new Error(`任务成功但找不到视频地址(${spec.videoUrlPath}): ${JSON.stringify(json).slice(0, 300)}`);
      await downloadTo(url, outFile);
      return;
    }
    if (bad.includes(status)) throw new Error(`视频任务失败(${status}): ${JSON.stringify(json).slice(0, 500)}`);
  }
  throw new Error('视频生成超时');
}

module.exports = {
  isCursor: cursor.isCursor,
  buildShots,
  llmComplete,
  extractJson,
  synthesizeSpeech,
  ttsWithVoice,
  makeSilence,
  generateImage,
  generateClip,
  ttsSpec,
  imageSpec,
  videoSpec,
};
