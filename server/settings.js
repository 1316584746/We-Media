const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'settings.json');
const MASK = '********';
const KEY_SECTIONS = ['llm', 'tts', 'image', 'video'];

const DEFAULTS = {
  llm: {
    enabled: false,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    model: 'qwen-plus',
  },
  tts: {
    // dashscope(百炼 qwen3-tts) | edge(免费) | openai | custom | mock
    mode: 'edge',
    baseUrl: '',
    apiKey: '',
    model: 'qwen3-tts-flash',
    voice: 'Ethan',
    edgeVoice: 'zh-CN-YunxiNeural',
    speed: 0.9,
    custom: null,
  },
  image: {
    // dashscope(百炼 qwen-image) | custom | mock
    mode: 'mock',
    baseUrl: '',
    apiKey: '',
    model: 'qwen-image-2.0',
    concurrency: 3,
    custom: null,
  },
  video: {
    // render.visual = i2v 用 dashscope_i2v；= video 用 dashscope(文生视频) | ark | openai；也可 custom | mock
    mode: 'mock',
    apiKey: '',
    model: 'wan2.7-i2v',
    baseUrl: '',
    resolution: '720P',
    duration: 5,
    concurrency: 2,
    custom: null,
  },
  render: {
    visual: 'i2v', // i2v 插画→图生视频(推荐) | image 插画+镜头推拉(最便宜) | video 文生视频
    orientation: 'landscape', // landscape 横屏 1920x1080 | portrait 竖屏 1080x1920
    fps: 30,
    subtitles: true,
    linesPerScene: 1,
    titleCard: true,
    endCard: true,
    tail: 0.6,
    style: '国风手绘水彩插画，清新柔和的色调，薄雾与自然光，细腻的东方意境，画面中不出现任何文字和水印',
  },
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return deepMerge(DEFAULTS, saved);
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function save(incoming) {
  const current = load();
  const next = deepMerge(current, incoming || {});
  // 前端回传的是脱敏后的 key，视为"未修改"
  for (const section of KEY_SECTIONS) {
    const k = incoming?.[section]?.apiKey;
    if (typeof k === 'string' && k.startsWith(MASK)) next[section].apiKey = current[section].apiKey;
  }
  // custom 允许被清空为 null
  for (const section of ['tts', 'image', 'video']) {
    if (incoming?.[section] && 'custom' in incoming[section]) next[section].custom = incoming[section].custom;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function masked(settings) {
  const s = JSON.parse(JSON.stringify(settings));
  for (const section of KEY_SECTIONS) {
    const k = s[section].apiKey;
    if (k) s[section].apiKey = MASK + k.slice(-4);
  }
  return s;
}

module.exports = { load, save, masked, ROOT, DATA_DIR, DEFAULTS };
