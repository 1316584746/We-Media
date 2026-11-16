import { $, $$, api, esc, icon, paintIcons, state, toast, loadMeta, paintRailStatus, modelStatus, previewVoice, stopPreview } from '../core.js';
import { mountPanel } from './extensions.js';
import { mountPublishPanel } from './publish-panel.js';
import { MODE_LABEL, costHtml, describe, kindOf } from '../pricing.js';

const modeOpts = (name) => Object.entries(MODE_LABEL[name]).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');

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
  ['skills', 'SKILLS'],
  ['mcp', 'MCP 服务'],
  ['publish', '发布'],
  ['prefs', '偏好'],
];
const SECTION_DESC = {
  publish: '把做好的视频排进发布计划，到点处理：微信公众号走官方接口存草稿；抖音、小红书、视频号、B 站到点提醒你手动发布（这些平台没有个人可用的公开接口）。',
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
<div class="model-status" id="modelStatus"></div>
<section class="st-blk" data-blk="llm"><div class="st-sub"><span>AI Agent</span><span class="badge" data-badge="llm"></span></div><div class="st-inner">
  <p class="hint">分镜、M Agent 写文案、做同款、工具增强等所有 AI 对话功能，都用这里的 API Key 和默认模型：百炼 Key 和 Cursor Key 都可以，填好 Key 会自动获取模型，从下拉里选。文生图、配音、视频生成是另外的服务，在下面单独配置。</p>
  <div class="field"><label>服务商</label>
    <select name="llm.provider"><option value="openai">阿里百炼 / 其他 OpenAI 兼容服务</option><option value="cursor">Cursor</option></select>
  </div>
  <div class="field"><label>API Key <span class="hint" id="llmKeyHint"></span></label><input name="llm.apiKey" type="password" autocomplete="off" placeholder="sk-xxxxxxxx" /></div>
  <div class="field"><label>默认模型</label>
    <div class="mdl-row"><select name="llm.model" id="llmModelSel"></select><button type="button" class="btn ghost" id="btnLlmModels"><span class="ic" data-ic="refresh"></span>获取列表</button></div>
  </div>
  <div class="hint" id="llmModelsHint"></div>
  <details class="mdl-adv" id="llmAdv"><summary>接口地址（默认阿里百炼，也可以换成其他 OpenAI 兼容服务）</summary>
    <div class="field"><label>Base URL</label><input name="llm.baseUrl" /></div>
  </details>
  <div class="cost" data-cost="llm"></div>
</div></section>
<section class="st-blk" data-blk="image"><div class="st-sub"><span>文生图</span><span class="badge" data-badge="image"></span></div><div class="st-inner">
  <div class="field"><label>模式</label>
    <select name="image.mode">${modeOpts('image.mode')}</select>
  </div>
  <div class="cost" data-cost="image"></div>
  <div class="field"><label>Base URL（留空用官方默认）</label><input name="image.baseUrl" /></div>
  <div class="row3">
    <div class="field"><label>API Key</label><input name="image.apiKey" type="password" autocomplete="off" /></div>
    <div class="field"><label>模型</label><input name="image.model" list="imageModels" /></div>
    <div class="field"><label>并发数</label><input name="image.concurrency" type="number" min="1" /></div>
  </div>
  <datalist id="imageModels"><option value="qwen-image-2.0" label="0.2 元/张"></option><option value="qwen-image-2.0-pro" label="0.5 元/张"></option><option value="qwen-image-3.0" label="0.18 元/张，新用户 10 张免费"></option><option value="qwen-image-3.0-pro" label="0.25 元/张，新用户 10 张免费"></option><option value="z-image-turbo" label="价格见百炼官网"></option></datalist>
  <div class="field"><label>自定义模板 JSON（仅 custom 模式）</label><textarea name="image.custom" rows="6" class="mono" placeholder='{"request":{"method":"POST","url":"https://...","headers":{"Authorization":"Bearer {{apiKey}}"},"body":{"model":"{{model}}","prompt":"{{prompt}}","size":"{{size}}"}},"responseType":"url","path":"data[0].url"}'></textarea></div>
</div></section>

<section class="st-blk" data-blk="tts"><div class="st-sub"><span>配音</span><span class="badge" data-badge="tts"></span></div><div class="st-inner">
  <div class="field"><label>模式</label>
    <select name="tts.mode">${modeOpts('tts.mode')}</select>
  </div>
  <div class="cost" data-cost="tts"></div>
  <div class="row2">
    <div class="field"><label>默认 Edge 音色（edge 模式）</label>
      <div class="voice-row"><select name="tts.edgeVoice">
        <option value="zh-CN-YunxiNeural">云希（男，沉稳）</option>
        <option value="zh-CN-YunjianNeural">云健（男，浑厚）</option>
        <option value="zh-CN-YunyangNeural">云扬（男，新闻播报）</option>
        <option value="zh-CN-XiaoxiaoNeural">晓晓（女，温柔）</option>
        <option value="zh-CN-XiaoyiNeural">晓伊（女，清亮）</option>
      </select><button type="button" class="icon-btn preview-btn" data-preview="edge" title="试听">${icon('play')}</button></div>
    </div>
    <div class="field"><label>语速（edge / openai，1 为正常）</label><input name="tts.speed" type="number" step="0.1" /></div>
  </div>
  <div class="field"><label>Base URL（留空用官方默认）</label><input name="tts.baseUrl" /></div>
  <div class="row3">
    <div class="field"><label>API Key</label><input name="tts.apiKey" type="password" autocomplete="off" /></div>
    <div class="field"><label>模型</label><input name="tts.model" /></div>
    <div class="field"><label>音色（百炼如 Ethan / Cherry）</label><div class="voice-row"><input name="tts.voice" /><button type="button" class="icon-btn preview-btn" data-preview="remote" title="试听">${icon('play')}</button></div></div>
  </div>
  <div class="field"><label>自定义模板 JSON（仅 custom 模式）</label><textarea name="tts.custom" rows="6" class="mono" placeholder='{"request":{"method":"POST","url":"https://...","headers":{"Authorization":"Bearer {{apiKey}}"},"body":{"text":"{{text}}","voice":"{{voice}}"}},"responseType":"binary"}'></textarea></div>
</div></section>

<section class="st-blk" data-blk="video"><div class="st-sub"><span>视频生成</span><span class="badge" data-badge="video"></span></div><div class="st-inner">
  <div class="field"><label>模式</label>
    <select name="video.mode">${modeOpts('video.mode')}</select>
  </div>
  <div class="cost" data-cost="video"></div>
  <div class="field"><label>Base URL（留空用官方默认）</label><input name="video.baseUrl" /></div>
  <div class="row3">
    <div class="field"><label>API Key</label><input name="video.apiKey" type="password" autocomplete="off" /></div>
    <div class="field"><label>模型 / 接入点 ID</label><input name="video.model" list="videoModels" /></div>
    <div class="field"><label>清晰度（影响费用）</label>
      <select name="video.resolution"><option value="720P">720P（推荐，便宜）</option><option value="1080P">1080P</option></select>
    </div>
  </div>
  <div class="row2">
    <div class="field"><label>并发数</label><input name="video.concurrency" type="number" min="1" /></div>
    <div class="field"><label>单段时长（秒，仅文生视频）</label><input name="video.duration" type="number" /></div>
  </div>
  <datalist id="videoModels"><option value="doubao-seedance-1-0-pro-fast-251015" label="火山方舟·最便宜 480P 约 0.04 / 720P 约 0.09 元每秒（按 token 估算，仅火山方舟模式）"></option><option value="doubao-seedance-2-0-mini-260615" label="火山方舟·2.0 mini 480P 0.23 / 720P 0.5 元每秒（仅火山方舟模式）"></option><option value="wan2.7-i2v" label="图生视频 720P 0.6 / 1080P 1 元每秒"></option><option value="wan2.6-i2v" label="图生视频 720P 0.6 / 1080P 1 元每秒"></option><option value="wan2.7-t2v" label="文生视频 720P 0.6 / 1080P 1 元每秒"></option><option value="wan2.2-t2v-plus" label="文生视频 480P 0.14 / 1080P 0.7 元每秒"></option><option value="doubao-seedance-1-0-lite-t2v-250428" label="约 0.2 元每秒（按 token 计费）"></option></datalist>
  <div class="field"><label>自定义模板 JSON（仅 custom 模式）</label><textarea name="video.custom" rows="8" class="mono"></textarea></div>
</div></section></div>`;

/** 每个模型块右上角的状态：[文字, badge 样式] */
function badgeOf(cfg, key) {
  if (key === 'llm') return cfg.enabled && cfg.apiKey ? [cfg.provider === 'cursor' ? 'Cursor · 已启用' : '收费 · 已启用', 'paid'] : ['未启用', 'warn'];
  const kind = kindOf(key, cfg);
  if (kind === 'free') return ['免费', 'done'];
  if (kind === 'test') return ['mock 占位', 'warn'];
  if (kind === 'dead') return ['已停用', 'error'];
  if (kind === 'vary') return ['按服务商计费', 'paid'];
  return [cfg.apiKey ? '收费 · 已配置' : '收费 · 未填 Key', cfg.apiKey ? 'paid' : 'warn'];
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
      <div class="st-title"><h1>设置</h1><span class="sub">本地应用 · 数据只保存在这台电脑</span>
        <div class="save-bar" id="saveBar"><span class="hint" id="saveHint"></span><button class="btn primary" id="btnSave" type="button">保存设置</button></div>
      </div>
      <div class="st-card">
        <form id="form" autocomplete="off" onsubmit="return false">${PANES}</form>
        ${extPane('skills', 'SKILLS')}
        ${extPane('mcp', 'MCP 服务')}
        ${extPane('publish', '发布')}
      </div>
    </section>
  </div>`;
  paintIcons(root);

  // 密钥输入框右侧加「眼睛」：点一下在显示 / 隐藏之间切换
  $$('input[type="password"]', root).forEach((inp) => {
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    inp.replaceWith(wrap);
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'pw-eye';
    const paint = () => {
      const shown = inp.type === 'text';
      eye.innerHTML = icon(shown ? 'eye' : 'eyeoff');
      eye.title = shown ? '隐藏' : '显示';
      eye.setAttribute('aria-label', eye.title);
      eye.classList.toggle('on', shown);
    };
    eye.addEventListener('click', () => {
      inp.type = inp.type === 'text' ? 'password' : 'text';
      paint();
    });
    wrap.append(inp, eye);
    paint();
  });

  const form = $('#form', root);
  const field = (name) => form.querySelector(`[name="${name}"]`);

  // 默认模型下拉：先只放已保存的那个，「获取列表」后换成这个 Key 拥有的全部对话模型
  const MODEL_HINT = { 'qwen-plus': '0.8 / 2 元每百万 token', 'qwen-max': '2.4 / 9.6 元每百万 token', 'qwen3.5-plus': '0.8 / 4.8 元每百万 token', 'qwen3.7-plus': '2 / 8 元每百万 token' };
  const modelSel = $('#llmModelSel', form);
  const fillModelSelect = (ids, selected, names = {}) => {
    const ph = ids.length ? '请选择模型' : '填好 API Key 后，点「获取列表」';
    modelSel.innerHTML = `<option value="">${ph}</option>` + ids.map((m) => `<option value="${esc(m)}">${esc(names[m] || m)}${MODEL_HINT[m] ? `　· ${MODEL_HINT[m]}` : ''}</option>`).join('');
    modelSel.value = ids.includes(selected) ? selected : '';
  };
  fillModelSelect(s.llm.model ? [s.llm.model] : [], s.llm.model);
  $$('[name]', form).forEach((el) => {
    const v = getByPath(s, el.name);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.name.endsWith('.custom')) el.value = v ? JSON.stringify(v, null, 2) : '';
    else el.value = v ?? '';
  });

  // 试听：用表单里还没保存的配音配置，改完音色 / Key 就能直接听
  const ttsFromForm = () => {
    const out = {};
    $$('[name^="tts."]', form).forEach((el) => {
      const k = el.name.slice(4);
      if (k === 'custom') {
        try { out.custom = el.value.trim() ? JSON.parse(el.value) : null; } catch { /* 模板写到一半，忽略 */ }
      } else out[k] = el.type === 'number' ? (el.value === '' ? undefined : Number(el.value)) : el.value;
    });
    return out;
  };
  form.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preview]');
    if (!btn) return;
    const tts = ttsFromForm();
    // edge 按钮：不管当前选的什么模式，都用 Edge 试这个音色；另一个按钮试远程服务（模式还是 edge/mock 时按百炼）
    if (btn.dataset.preview === 'edge') tts.mode = 'edge';
    else if (tts.mode === 'edge' || tts.mode === 'mock') tts.mode = 'dashscope';
    previewVoice(btn, { tts });
  });

  const count = (k) => (k === 'skills' ? ext.skills.length : k === 'mcp' ? ext.mcp.length : null);
  const paintNav = () => {
    $('#setNav', root).innerHTML = SECTIONS.map(([k, n]) => {
      const c = count(k);
      return `<button type="button" data-sec="${k}" class="${k === section ? 'on' : ''}"><span>${n}</span>${c ? `<span class="n">${c}</span>` : ''}</button>`;
    }).join('');
  };
  // 费用说明、状态徽标都读表单里的当前值，改了就实时更新（不用先保存）
  const cfgOf = (k) => {
    const out = {};
    $$(`[name^="${k}."]`, form).forEach((el) => {
      const key = el.name.slice(k.length + 1);
      out[key] = el.type === 'checkbox' ? el.checked : el.value;
    });
    if (k === 'llm') out.enabled = !!(out.apiKey && out.model);
    return out;
  };
  const paintBadges = () => {
    ['llm', 'image', 'tts', 'video'].forEach((k) => {
      const [txt, cls] = badgeOf(cfgOf(k), k);
      const el = $(`[data-badge="${k}"]`, root);
      el.textContent = txt;
      el.className = `badge ${cls}`;
    });
    const ms = modelStatus();
    const box = $('#modelStatus', root);
    box.className = `model-status ${ms.missing.length ? 'warn' : 'ok'}`;
    box.innerHTML = ms.missing.length
      ? `<i class="dot warn"></i><span>还没配置：<b>${esc(ms.missing.join('、'))}</b>${ms.aiOk ? '（AI 文案已配置）' : ''}。没配置的功能会生成占位内容。</span>`
      : '<i class="dot"></i><span>文案、文生图、配音、视频生成都已配置。</span>';
  };
  const paintCosts = () => {
    ['llm', 'image', 'tts', 'video'].forEach((k) => {
      const box = $(`[data-cost="${k}"]`, root);
      const cfg = cfgOf(k);
      box.className = `cost cost-${describe(k, cfg).kind}`;
      box.innerHTML = costHtml(k, cfg, esc);
    });
    paintBadges();
  };
  const soraOpt = field('video.mode').querySelector('[value="openai"]');
  if (soraOpt) soraOpt.disabled = s.video.mode !== 'openai'; // 已停用：除非原来就选着，否则不让新选
  form.addEventListener('input', paintCosts);
  form.addEventListener('change', paintCosts);
  const showSection = (k) => {
    section = k;
    $$('.st-pane', root).forEach((p) => (p.hidden = p.dataset.sec !== k));
    $('#saveBar', root).hidden = k !== 'model' && k !== 'prefs';
    paintNav();
    history.replaceState(null, '', `#/settings/${k}`); // 不触发路由重绘，未保存的修改不会丢
  };
  paintCosts();
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
    mountPublishPanel($('#host-publish', root)).catch(() => null),
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

  // 获取 Key 拥有的模型 → 填进「默认模型」下拉；填好 Key（失去焦点）、打开设置页、套用百炼配置时会自动获取
  const mdlBtn = $('#btnLlmModels', root);
  const mdlHint = $('#llmModelsHint', root);
  let mdlSeq = 0;
  // 服务商：阿里百炼 / OpenAI 兼容 或 Cursor（Key 以 crsr_ / cursor_ 开头会自动切到 Cursor）
  const provSel = field('llm.provider');
  const KEY_TIPS = {
    openai: '默认是阿里百炼，到 <a href="https://bailian.console.aliyun.com/" target="_blank" rel="noopener">bailian.console.aliyun.com</a> 创建；其他 OpenAI 兼容服务在下面改「接口地址」',
    cursor: '到 <a href="https://cursor.com/dashboard/integrations" target="_blank" rel="noopener">cursor.com/dashboard/integrations</a> 创建（crsr_ 开头）。用量计入你的 Cursor 账号，每次要几秒到几十秒，不支持工具增强',
  };
  const syncProvider = () => {
    const cur = provSel.value === 'cursor';
    $('#llmKeyHint', root).innerHTML = KEY_TIPS[cur ? 'cursor' : 'openai'];
    field('llm.apiKey').placeholder = cur ? 'crsr_xxxxxxxx' : 'sk-xxxxxxxx';
    $('#llmAdv', root).hidden = cur;
    paintCosts();
  };
  provSel.addEventListener('change', () => {
    syncProvider();
    fillModelSelect([], '');
    mdlHint.textContent = field('llm.apiKey').value.trim() ? '换了服务商，点「获取列表」重新读取模型。' : '填好 API Key 后点「获取列表」。';
    if (field('llm.apiKey').value.trim()) fetchModels({ quiet: true });
  });
  // 输入 / 粘贴 Key：识别服务商，停下 0.6 秒后自动获取模型（不用再点按钮或离开输入框）
  let autoTimer = 0;
  let lastKey = '';
  field('llm.apiKey').addEventListener('input', () => {
    const k = field('llm.apiKey').value.trim();
    const want = /^(crsr_|cursor_)/i.test(k) ? 'cursor' : /^sk-/i.test(k) ? 'openai' : provSel.value;
    if (want !== provSel.value) {
      provSel.value = want;
      syncProvider();
      fillModelSelect([], '');
    }
    clearTimeout(autoTimer);
    if (k.length >= 12 && !k.startsWith('********')) autoTimer = setTimeout(() => fetchModels({ quiet: true }), 600);
  });
  const fetchModels = async ({ quiet = false } = {}) => {
    const apiKey = field('llm.apiKey').value.trim();
    if (!apiKey) {
      if (!quiet) mdlHint.textContent = '请先填写 API Key。';
      return;
    }
    const seq = ++mdlSeq;
    lastKey = apiKey;
    mdlBtn.disabled = true;
    mdlHint.textContent = provSel.value === 'cursor' ? '正在获取这个 Cursor 账号的模型，大约要几秒…' : '获取中…';
    modelSel.disabled = true;
    try {
      const r = await api('/api/llm/models', { method: 'POST', body: { baseUrl: field('llm.baseUrl').value.trim(), apiKey, provider: provSel.value } });
      if (seq !== mdlSeq) return;
      if (r.provider && r.provider !== provSel.value) {
        provSel.value = r.provider;
        syncProvider();
      }
      if (r.error) {
        mdlHint.textContent = r.error;
        return;
      }
      if (!r.models.length) {
        mdlHint.textContent = '这个 Key 没有返回任何对话模型。';
        return;
      }
      const cur = field('llm.model').value.trim();
      const list = !cur || r.models.includes(cur) ? r.models : [cur, ...r.models];
      fillModelSelect(list, cur, r.names || {});
      paintCosts();
      mdlHint.textContent = `这个 Key 共有 ${r.models.length} 个对话模型${cur && !r.models.includes(cur) ? `；当前的「${cur}」不在列表里，可能用不了` : ''}。${cur ? '' : '请选一个，'}选好后点「保存设置」。`;
    } catch (e) {
      if (seq === mdlSeq) mdlHint.textContent = e.message;
    } finally {
      if (seq === mdlSeq) {
        mdlBtn.disabled = false;
        modelSel.disabled = false;
      }
    }
  };
  mdlBtn.addEventListener('click', () => fetchModels());
  field('llm.apiKey').addEventListener('change', () => {
    clearTimeout(autoTimer);
    if (field('llm.apiKey').value.trim() !== lastKey) fetchModels({ quiet: true });
  });
  field('llm.baseUrl').addEventListener('change', () => fetchModels({ quiet: true }));
  syncProvider();
  if (s.llm.apiKey) fetchModels({ quiet: true });
  else mdlHint.textContent = '填好 API Key 后点「获取列表」。';

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
      // AI Agent 没有单独的开关：填了 Key 并选了模型就启用，清掉 Key 或没选模型就是不启用
      setByPath(body, 'llm.enabled', !!(body.llm.apiKey && body.llm.model));
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

  return { unmount() { stopPreview(); panels.forEach((p) => p?.unmount?.()); } };
}
