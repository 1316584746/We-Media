import { $, $$, api, esc, icon, paintIcons, state, toast, loadMeta, paintRailStatus } from '../core.js';
import { mountPanel } from './extensions.js';

const getByPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
function setByPath(obj, p, v) {
  const ks = p.split('.');
  let o = obj;
  ks.slice(0, -1).forEach((k) => (o = o[k] = o[k] || {}));
  o[ks.at(-1)] = v;
}

// 切换模式时，如果模型/音色框是空的或还是别家的默认值，就自动换成该模式的默认值
const PRESETS = {
  'video.mode': { field: 'video.model', map: { dashscope_i2v: 'wan2.7-i2v', openai: 'sora-2', ark: 'doubao-seedance-1-0-lite-t2v-250428', dashscope: 'wan2.2-t2v-plus' } },
  'image.mode': { field: 'image.model', map: { dashscope: 'qwen-image-2.0' } },
  'tts.mode': { field: 'tts.model', map: { dashscope: 'qwen3-tts-flash', openai: 'tts-1' } },
};
const KNOWN_BASES = ['https://api.openai.com/v1', 'https://dashscope.aliyuncs.com', 'https://ark.cn-beijing.volces.com'];
const VOICE_PRESETS = { dashscope: 'Ethan', openai: 'alloy' };

const SECTIONS = [
  ['model', '模型'],
  ['skills', '技能'],
  ['mcp', 'MCP 服务'],
  ['prefs', '偏好'],
];
const SECTION_DESC = {
  skills: '技能是写给分镜 AI 的额外指引（SKILL.md 格式）。在「创作」页创建项目时勾选后，会附加到分镜提示词里；需要先在「模型」里启用分镜 LLM。',
  mcp: 'MCP 服务给分镜 AI 提供「工具」（搜索、读网页、查资料……）。创建项目时打开「工具增强」，AI 会在分镜前按需调用它们检索背景资料；需要启用分镜 LLM，且模型支持函数调用。',
};

const PANES = `
<div class="st-pane" data-sec="prefs"><h2 class="st-h">偏好</h2><p class="st-desc">新建项目时的默认值；每个项目可以在编辑器里单独调整。</p><div class="st-inner">
  <div class="field"><label>默认画面方式</label>
    <select name="render.visual">
      <option value="i2v">图生视频：先画插画定角色，再让画面动起来（推荐，真动画）</option>
      <option value="image">插画 + 镜头推拉（最便宜，画面本身不动）</option>
      <option value="video">纯文生视频（角色一致性较差）</option>
    </select>
  </div>
  <div class="row2">
    <div class="field"><label>帧率</label><input name="render.fps" type="number" min="15" max="60" /></div>
    <div class="field"><label>诗词每镜头句数</label><input name="render.linesPerScene" type="number" min="1" max="4" /></div>
  </div>
  <label class="switch"><input type="checkbox" name="render.subtitles" />默认烧录字幕</label>
</div></div>

<div class="st-pane" data-sec="model"><h2 class="st-h">模型</h2><p class="st-desc">分镜、文生图、配音、视频生成用到的模型与密钥，只保存在本机 <code class="mono">data/settings.json</code>，不会上传。</p>
<section class="st-blk"><div class="st-sub"><span>阿里百炼一键配置</span></div><div class="st-inner">
  <label class="lbl-sm">API Key <span class="hint">一个 Key 同时用于分镜、文生图、配音、图生视频。填入后点「套用」，再保存。</span></label>
  <div class="quick-row"><input id="dashKey" type="password" placeholder="sk-xxxxxxxx" autocomplete="off" /><button type="button" class="btn" id="btnApplyDash">套用</button></div>
</div></section>
<section class="st-blk" data-blk="llm"><div class="st-sub"><span>分镜 LLM</span><span class="badge" data-badge="llm"></span></div><div class="st-inner">
  <p class="hint">用大模型把文案拆成镜头，并保证各镜头角色、画风一致。不启用则用规则模板生成画面描述。</p>
  <label class="switch"><input type="checkbox" name="llm.enabled" />启用 LLM 分镜</label>
  <div class="field"><label>Base URL（OpenAI 兼容）</label><input name="llm.baseUrl" /></div>
  <div class="row2">
    <div class="field"><label>API Key</label><input name="llm.apiKey" type="password" autocomplete="off" /></div>
    <div class="field"><label>模型</label><input name="llm.model" /></div>
  </div>
</div></section>

<section class="st-blk" data-blk="image"><div class="st-sub"><span>文生图</span><span class="badge" data-badge="image"></span></div><div class="st-inner">
  <div class="field"><label>模式</label>
    <select name="image.mode">
      <option value="mock">mock（测试，渐变底图）</option>
      <option value="dashscope">阿里百炼 qwen-image / 万相</option>
      <option value="custom">自定义请求模板</option>
    </select>
  </div>
  <div class="field"><label>Base URL（留空用官方默认）</label><input name="image.baseUrl" /></div>
  <div class="row3">
    <div class="field"><label>API Key</label><input name="image.apiKey" type="password" autocomplete="off" /></div>
    <div class="field"><label>模型</label><input name="image.model" list="imageModels" /></div>
    <div class="field"><label>并发数</label><input name="image.concurrency" type="number" min="1" /></div>
  </div>
  <datalist id="imageModels"><option value="qwen-image-2.0"></option><option value="qwen-image-2.0-pro"></option><option value="qwen-image-3.0"></option><option value="z-image-turbo"></option></datalist>
  <div class="field"><label>自定义模板 JSON（仅 custom 模式）</label><textarea name="image.custom" rows="6" class="mono" placeholder='{"request":{"method":"POST","url":"https://...","headers":{"Authorization":"Bearer {{apiKey}}"},"body":{"model":"{{model}}","prompt":"{{prompt}}","size":"{{size}}"}},"responseType":"url","path":"data[0].url"}'></textarea></div>
</div></section>

<section class="st-blk" data-blk="tts"><div class="st-sub"><span>配音</span><span class="badge" data-badge="tts"></span></div><div class="st-inner">
  <div class="field"><label>模式</label>
    <select name="tts.mode">
      <option value="mock">mock（测试，提示音）</option>
      <option value="edge">Edge 在线朗读（免费，无需 Key）</option>
      <option value="dashscope">阿里百炼 qwen3-tts</option>
      <option value="openai">OpenAI 兼容 /audio/speech</option>
      <option value="custom">自定义请求模板</option>
    </select>
  </div>
  <div class="row2">
    <div class="field"><label>默认 Edge 音色（edge 模式）</label>
      <select name="tts.edgeVoice">
        <option value="zh-CN-YunxiNeural">云希（男，沉稳）</option>
        <option value="zh-CN-YunjianNeural">云健（男，浑厚）</option>
        <option value="zh-CN-YunyangNeural">云扬（男，新闻播报）</option>
        <option value="zh-CN-XiaoxiaoNeural">晓晓（女，温柔）</option>
        <option value="zh-CN-XiaoyiNeural">晓伊（女，清亮）</option>
      </select>
    </div>
    <div class="field"><label>语速（edge / openai，1 为正常）</label><input name="tts.speed" type="number" step="0.1" /></div>
  </div>
  <div class="field"><label>Base URL（留空用官方默认）</label><input name="tts.baseUrl" /></div>
  <div class="row3">
    <div class="field"><label>API Key</label><input name="tts.apiKey" type="password" autocomplete="off" /></div>
    <div class="field"><label>模型</label><input name="tts.model" /></div>
    <div class="field"><label>音色（百炼如 Ethan / Cherry）</label><input name="tts.voice" /></div>
  </div>
  <div class="field"><label>自定义模板 JSON（仅 custom 模式）</label><textarea name="tts.custom" rows="6" class="mono" placeholder='{"request":{"method":"POST","url":"https://...","headers":{"Authorization":"Bearer {{apiKey}}"},"body":{"text":"{{text}}","voice":"{{voice}}"}},"responseType":"binary"}'></textarea></div>
</div></section>

<section class="st-blk" data-blk="video"><div class="st-sub"><span>视频生成</span><span class="badge" data-badge="video"></span></div><div class="st-inner">
  <div class="field"><label>模式</label>
    <select name="video.mode">
      <option value="mock">mock（测试）</option>
      <option value="dashscope_i2v">阿里百炼 万相2.7 图生视频（配合「图生视频」）</option>
      <option value="dashscope">阿里百炼 万相 文生视频</option>
      <option value="openai">OpenAI Sora（sora-2 / sora-2-pro）</option>
      <option value="ark">火山方舟 Seedance</option>
      <option value="custom">自定义请求模板</option>
    </select>
  </div>
  <div class="field"><label>Base URL（留空用官方默认）</label><input name="video.baseUrl" /></div>
  <div class="row3">
    <div class="field"><label>API Key</label><input name="video.apiKey" type="password" autocomplete="off" /></div>
    <div class="field"><label>模型 / 接入点 ID</label><input name="video.model" /></div>
    <div class="field"><label>清晰度（影响费用）</label>
      <select name="video.resolution"><option value="720P">720P（推荐，便宜）</option><option value="1080P">1080P</option></select>
    </div>
  </div>
  <div class="row2">
    <div class="field"><label>并发数</label><input name="video.concurrency" type="number" min="1" /></div>
    <div class="field"><label>单段时长（秒，仅文生视频）</label><input name="video.duration" type="number" /></div>
  </div>
  <div class="field"><label>自定义模板 JSON（仅 custom 模式）</label><textarea name="video.custom" rows="8" class="mono"></textarea></div>
</div></section></div>`;

/** 每个模型块右上角的状态：[文字, badge 样式] */
function badgeOf(s, key) {
  if (key === 'llm') return s.llm.enabled && s.llm.apiKey ? ['已启用', 'done'] : ['未启用', 'warn'];
  const mode = s[key].mode;
  return mode === 'mock' ? ['mock 占位', 'warn'] : [mode === 'edge' ? '免费' : '已配置', 'done'];
}

export async function mount(root, params = []) {
  const s = await api('/api/settings');
  state.settings = s;
  let ext = await api('/api/extensions').catch(() => ({ skills: [], mcp: [] }));
  let section = SECTIONS.some(([k]) => k === params[0]) ? params[0] : 'model';

  const extPane = (key, title) => `<div class="st-pane" data-sec="${key}" hidden>
      <h2 class="st-h">${title}</h2><p class="st-desc">${SECTION_DESC[key]}</p><div class="st-host" id="host-${key}"></div></div>`;
  root.innerHTML = `<div class="st-shell">
    <aside class="st-side"><div class="st-cap">设置</div><nav id="setNav"></nav></aside>
    <section class="st-main">
      <a class="st-back" href="${esc(state.lastApp || '#/')}">${icon('back')}返回</a>
      <div class="st-title"><h1>设置</h1><span class="sub">本地应用 · 数据只保存在这台电脑</span></div>
      <div class="st-card">
        <form id="form" autocomplete="off" onsubmit="return false">${PANES}</form>
        ${extPane('skills', '技能')}
        ${extPane('mcp', 'MCP 服务')}
      </div>
      <div class="save-bar" id="saveBar"><button class="btn primary lg" id="btnSave" type="button">保存设置</button><span class="hint" id="saveHint"></span></div>
    </section>
  </div>`;
  paintIcons(root);

  const form = $('#form', root);
  const field = (name) => form.querySelector(`[name="${name}"]`);

  $$('[name]', form).forEach((el) => {
    const v = getByPath(s, el.name);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.name.endsWith('.custom')) el.value = v ? JSON.stringify(v, null, 2) : '';
    else el.value = v ?? '';
  });

  const count = (k) => (k === 'skills' ? ext.skills.length : k === 'mcp' ? ext.mcp.length : null);
  const paintNav = () => {
    $('#setNav', root).innerHTML = SECTIONS.map(([k, n]) => {
      const c = count(k);
      return `<button type="button" data-sec="${k}" class="${k === section ? 'on' : ''}"><span>${n}</span>${c ? `<span class="n">${c}</span>` : ''}</button>`;
    }).join('');
  };
  const paintBadges = () => {
    ['llm', 'image', 'tts', 'video'].forEach((k) => {
      const [txt, cls] = badgeOf(s, k);
      const el = $(`[data-badge="${k}"]`, root);
      el.textContent = txt;
      el.className = `badge ${cls}`;
    });
  };
  const showSection = (k) => {
    section = k;
    $$('.st-pane', root).forEach((p) => (p.hidden = p.dataset.sec !== k));
    $('#saveBar', root).hidden = k !== 'model' && k !== 'prefs';
    paintNav();
    history.replaceState(null, '', `#/settings/${k}`); // 不触发路由重绘，未保存的修改不会丢
  };
  paintBadges();
  showSection(section);
  $('#setNav', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-sec]');
    if (b) showSection(b.dataset.sec);
  });

  const onExtChange = (d) => {
    ext = d;
    paintNav();
  };
  const panels = await Promise.all([
    mountPanel($('#host-skills', root), 'skills', onExtChange),
    mountPanel($('#host-mcp', root), 'mcp', onExtChange),
  ]);
  Object.entries(PRESETS).forEach(([sel, { field: target, map }]) => {
    field(sel).addEventListener('change', (e) => {
      const input = field(target);
      if (map[e.target.value] && (!input.value || Object.values(map).includes(input.value))) input.value = map[e.target.value];
      const base = field(`${sel.split('.')[0]}.baseUrl`);
      if (base && (!base.value || KNOWN_BASES.includes(base.value))) base.value = '';
      if (sel === 'tts.mode' && VOICE_PRESETS[e.target.value]) {
        const v = field('tts.voice');
        if (!v.value || Object.values(VOICE_PRESETS).includes(v.value)) v.value = VOICE_PRESETS[e.target.value];
      }
    });
  });

  $('#btnApplyDash', root).addEventListener('click', () => {
    const key = $('#dashKey', root).value.trim();
    if (!key) return toast('请先填入百炼 API Key', 'err');
    const base = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const vals = {
      'llm.enabled': true, 'llm.baseUrl': base, 'llm.apiKey': key, 'llm.model': 'qwen-plus',
      'image.mode': 'dashscope', 'image.baseUrl': '', 'image.apiKey': key, 'image.model': 'qwen-image-2.0',
      'tts.mode': 'dashscope', 'tts.baseUrl': '', 'tts.apiKey': key, 'tts.model': 'qwen3-tts-flash', 'tts.voice': 'Ethan',
      'video.mode': 'dashscope_i2v', 'video.baseUrl': '', 'video.apiKey': key, 'video.model': 'wan2.7-i2v', 'video.resolution': '720P',
      'render.visual': 'i2v',
    };
    Object.entries(vals).forEach(([k, v]) => {
      const el = field(k);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    $('#dashKey', root).value = '';
    $('#saveHint', root).textContent = '已套用百炼推荐配置，点「保存设置」生效';
  });

  $('#btnSave', root).addEventListener('click', async () => {
    const body = {};
    try {
      $$('[name]', form).forEach((el) => {
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number') v = el.value === '' ? null : Number(el.value);
        else if (el.name.endsWith('.custom')) v = el.value.trim() ? JSON.parse(el.value) : null;
        else v = el.value;
        setByPath(body, el.name, v);
      });
    } catch (e) {
      $('#saveHint', root).textContent = `自定义模板 JSON 格式有误：${e.message}`;
      return;
    }
    try {
      const saved = await api('/api/settings', { method: 'PUT', body });
      Object.assign(s, saved);
      state.settings = saved;
      await loadMeta();
      paintRailStatus();
      paintBadges();
      $('#saveHint', root).textContent = '';
      toast('设置已保存', 'ok');
    } catch (e) {
      $('#saveHint', root).textContent = `保存失败：${e.message}`;
    }
  });

  return { unmount() { panels.forEach((p) => p?.unmount?.()); } };
}
