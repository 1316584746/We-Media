/* 公共工具：DOM、接口、图标、提示、确认框、格式化、全局状态 */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const state = { meta: null, settings: null };

export async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ''}</svg>`;
export function paintIcons(root = document) {
  $$('[data-ic]', root).forEach((el) => {
    if (!el.firstChild) el.innerHTML = icon(el.dataset.ic);
  });
}

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
export const tplColor = (t) => `linear-gradient(135deg, hsl(${t.hue} 62% 46%), hsl(${(t.hue + 36) % 360} 58% 30%))`;

/** 当前配音服务可选的音色列表；不支持项目内选音色的服务返回 null */
export function voiceChoices() {
  const { ttsMode, voices } = state.meta;
  return ttsMode === 'edge' ? voices.edge : ttsMode === 'dashscope' ? voices.dashscope : null;
}

/** 侧边栏底部的模型配置状态 */
export function paintRailStatus() {
  const mocks = state.settings ? mockParts(state.settings, state.settings.render.visual) : [];
  $('#railFoot').innerHTML = mocks.length
    ? `<a href="#/settings" class="dot-note" title="未配置真实模型：${mocks.join('、')}，会生成占位内容"><i class="dot warn"></i>未配置<br>模型</a>`
    : `<div class="dot-note"><i class="dot"></i>模型已<br>配置</div>`;
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
