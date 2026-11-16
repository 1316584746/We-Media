/* 公共工具：DOM、接口、图标、提示、确认框、格式化、全局状态 */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const state = { meta: null, settings: null };

export async function api(url, { method = 'GET', body, timeout } = {}) {
  const ctl = timeout ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl?.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`等了 ${Math.round(timeout / 1000)} 秒还没有结果，已停止等待，请重试一次`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `请求失败（HTTP ${res.status}）`);
  return json;
}

export async function loadMeta() {
  state.meta = await api('/api/meta');
}
export async function loadSettings() {
  state.settings = await api('/api/settings');
  return state.settings;
}

/* ---------------- 图标（Feather 风格线性图标） ---------------- */
const PATHS = {
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  star: '<polygon points="12 2 15.1 8.6 22 9.3 16.8 14 18.2 21 12 17.5 5.8 21 7.2 14 2 9.3 8.9 8.6"/>',
  send: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  agent: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><circle cx="9" cy="14" r="1.2"/><circle cx="15" cy="14" r="1.2"/><path d="M2 14h2M20 14h2"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="6" y1="9" x2="6.01" y2="9"/><line x1="10" y1="9" x2="10.01" y2="9"/><line x1="14" y1="9" x2="14.01" y2="9"/><line x1="18" y1="9" x2="18.01" y2="9"/><line x1="8" y1="15" x2="16" y2="15"/>',
  trimLeft: '<line x1="4" y1="4" x2="4" y2="20"/><rect x="9" y="7" width="11" height="10" rx="1.5"/>',
  trimRight: '<line x1="20" y1="4" x2="20" y2="20"/><rect x="4" y="7" width="11" height="10" rx="1.5"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
  undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  redo: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  skipBack: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
  skipFwd: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ''}</svg>`;
export function paintIcons(root = document) {
  $$('[data-ic]', root).forEach((el) => {
    if (!el.firstChild) el.innerHTML = icon(el.dataset.ic);
  });
}

/* ---------------- 音色试听 ---------------- */
let previewAudio = null;
let previewBtn = null;
const previewCache = new Map(); // 参数 → blob URL，同样的参数不重复请求（避免重复计费）

const setPreviewBtn = (btn, mode) => {
  if (!btn) return;
  btn.classList.toggle('loading', mode === 'loading');
  btn.classList.toggle('playing', mode === 'playing');
  btn.title = mode === 'playing' ? '停止' : '试听';
  btn.innerHTML = mode === 'loading' ? '<i class="spin"></i>' : icon(mode === 'playing' ? 'stop' : 'play');
};

export function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.onended = previewAudio.onerror = null;
    previewAudio = null;
  }
  setPreviewBtn(previewBtn, 'idle');
  previewBtn = null;
}

/** 试听一个音色。btn 为触发按钮（再点一次停止）；tts 为尚未保存的配音配置。 */
export async function previewVoice(btn, { voice = '', tts, text } = {}) {
  if (previewBtn === btn) return stopPreview();
  stopPreview();
  previewBtn = btn;
  setPreviewBtn(btn, 'loading');
  try {
    const key = JSON.stringify([voice, tts, text, state.settings?.tts]);
    let url = previewCache.get(key);
    if (!url) {
      const res = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice, tts, text }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `试听失败（HTTP ${res.status}）`);
      const mock = res.headers.get('X-TTS-Mode') === 'mock';
      url = URL.createObjectURL(await res.blob());
      if (mock) toast('当前是 mock 模式，只有提示音；切到 Edge 或百炼才是真人声', '');
      else previewCache.set(key, url);
    }
    if (previewBtn !== btn) return; // 加载期间用户点了别的
    const audio = new Audio(url);
    previewAudio = audio;
    audio.onended = audio.onerror = () => previewBtn === btn && stopPreview();
    await audio.play();
    setPreviewBtn(btn, 'playing');
  } catch (e) {
    if (previewBtn === btn) stopPreview();
    toast(e.message, 'err');
  }
}

/** 音色下拉框 + 试听按钮（data-preview 由各页面统一监听） */
export const previewBtnHtml = (extra = '') =>
  `<button type="button" class="icon-btn preview-btn" data-preview ${extra} title="试听">${icon('play')}</button>`;

/* ---------------- 提示 / 确认 ---------------- */
export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 5500 : 2400);
}

export function confirmDlg({ title, body = '', okText = '确认', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg';
    dlg.innerHTML = `<form method="dialog">
      <div class="dlg-body"><h3>${esc(title)}</h3><p>${esc(body)}</p></div>
      <div class="dlg-foot">
        <button value="no" class="btn ghost">${esc(cancelText)}</button>
        <button value="yes" class="btn ${danger ? 'danger' : 'primary'}" autofocus>${esc(okText)}</button>
      </div></form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'yes');
      dlg.remove();
    });
    dlg.showModal();
  });
}

/* ---------------- 格式化 / 常量 ---------------- */
export const debounce = (fn, ms) => {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a) => {
    clearTimeout(t);
    return fn(...a);
  };
  d.cancel = () => clearTimeout(t);
  return d;
};

export function fmtDur(sec) {
  if (!sec && sec !== 0) return '--:--';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function relTime(ts) {
  const d = Date.now() - ts;
  if (d < 60e3) return '刚刚';
  if (d < 3600e3) return `${Math.floor(d / 60e3)} 分钟前`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)} 小时前`;
  if (d < 7 * 86400e3) return `${Math.floor(d / 86400e3)} 天前`;
  return new Date(ts).toLocaleDateString();
}

export const STATUS = {
  draft: '草稿',
  queued: '排队中',
  running: '生成中',
  done: '已完成',
  error: '失败',
};
export const STAGE = { pending: '待生成', tts: '生成中', compose: '素材就绪', done: '已完成', error: '失败' };
export const VISUAL = {
  image: { name: '插画推拉', desc: '静态插画 + 镜头推拉，费用最低' },
  i2v: { name: '图生视频', desc: '插画再生成动态视频，效果最好，按秒计费' },
  video: { name: '文生视频', desc: '直接文生视频，角色一致性较差，按秒计费' },
};
export const KIND = { title: '片头', shot: '镜头', ending: '片尾' };
export const isBusy = (p) => p.status === 'running' || p.status === 'queued';

export const tplOf = (id) => state.meta.templates.find((t) => t.id === id) || state.meta.templates.at(-1);
export const tplColor = (t) => `linear-gradient(135deg, hsl(${t.hue} 74% 62%), hsl(${(t.hue + 34) % 360} 66% 48%))`;

/** 当前配音服务可选的音色列表；不支持项目内选音色的服务返回 null */
export function voiceChoices() {
  const { ttsMode, voices } = state.meta;
  return ttsMode === 'edge' ? voices.edge : ttsMode === 'dashscope' ? voices.dashscope : null;
}

/** 侧边栏左下角：数据看板入口（模型配置状态已挪到「设置 → 模型」） */
export function paintRailStatus() {
  const host = $('#railFoot');
  if (!host) return;
  host.innerHTML = '<nav class="rail-nav"><a href="#/dashboard" data-nav="dashboard" title="所有平台的数据看板"><span class="ic" data-ic="chart"></span><span>数据看板</span></a></nav>';
  paintIcons(host);
  host.querySelector('[data-nav]').classList.toggle('active', location.hash === '#/dashboard');
}

/** 模型配置状态：哪些能力还没配置（没配的会生成占位内容） */
export function modelStatus() {
  const s = state.settings;
  const aiOk = !!(s && s.llm.enabled && s.llm.apiKey);
  const missing = [];
  if (s) {
    if (!aiOk) missing.push('AI 文案');
    missing.push(...mockParts(s, s.render.visual));
  }
  return { aiOk, missing };
}

/** 当前配置里还是 mock 的能力（按画面方式判断哪些会用到） */
export function mockParts(settings, visual) {
  const out = [];
  if (!settings) return out;
  if (settings.image.mode === 'mock' && visual !== 'video') out.push('文生图');
  if (visual !== 'image' && settings.video.mode === 'mock') out.push('视频生成');
  if (settings.tts.mode === 'mock') out.push('配音');
  return out;
}
