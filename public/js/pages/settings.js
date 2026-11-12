import { $, $$, api, state, toast, loadMeta, paintRailStatus } from '../core.js';

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

const TABS = [
  ['general', '通用'],
  ['llm', '分镜 LLM'],
  ['image', '文生图'],
  ['tts', '配音'],
  ['video', '视频生成'],
];

const PANES = `
<fieldset class="set-pane card on" data-pane="general">
  <h3>通用默认值</h3>
  <p class="hint">新建项目时的默认值；每个项目可以在编辑器里单独调整。</p>
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
</fieldset>

<fieldset class="set-pane card" data-pane="llm">
  <h3>分镜 LLM</h3>
  <p class="hint">用大模型把文案拆成镜头，并保证各镜头角色、画风一致。不启用则用规则模板生成画面描述。</p>
  <label class="switch"><input type="checkbox" name="llm.enabled" />启用 LLM 分镜</label>
  <div class="field"><label>Base URL（OpenAI 兼容）</label><input name="llm.baseUrl" /></div>
  <div class="row2">
    <div class="field"><label>API Key</label><input name="llm.apiKey" type="password" autocomplete="off" /></div>
    <div class="field"><label>模型</label><input name="llm.model" /></div>
  </div>
</fieldset>

<fieldset class="set-pane card" data-pane="image">
  <h3>文生图</h3>
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
</fieldset>

<fieldset class="set-pane card" data-pane="tts">
  <h3>配音</h3>
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
</fieldset>

<fieldset class="set-pane card" data-pane="video">
  <h3>视频生成</h3>
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
</fieldset>`;

function tabState(s, tab) {
  if (tab === 'general') return '';
  if (tab === 'llm') return s.llm.enabled && s.llm.apiKey ? ['已启用', ''] : ['未启用', 'mock'];
  const mode = s[tab].mode;
  return mode === 'mock' ? ['mock', 'mock'] : [mode === 'edge' ? '免费' : '已配置', ''];
}

export async function mount(root) {
  const s = await api('/api/settings');
  state.settings = s;

  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>设置</h1><span class="sub">模型与密钥只保存在本机 <code class="mono">data/settings.json</code>，不会上传</span></div>
    <div class="card quick">
      <div><b>阿里百炼一键配置</b><div class="hint">一个 Key 同时用于分镜、文生图、配音、图生视频。填入后点「套用」，再点保存。</div></div>
      <div class="quick-row"><input id="dashKey" type="password" placeholder="sk-xxxxxxxx" autocomplete="off" /><button type="button" class="btn" id="btnApplyDash">套用</button></div>
    </div>
    <form id="form" class="set-layout">
      <nav class="set-nav" id="setNav"></nav>
      <div id="panes">${PANES}</div>
    </form>
    <div class="save-bar"><button class="btn primary lg" id="btnSave" type="button">保存设置</button><span class="hint" id="saveHint"></span></div>
  </div>`;

  const form = $('#form', root);
  const field = (name) => form.querySelector(`[name="${name}"]`);

  $$('[name]', form).forEach((el) => {
    const v = getByPath(s, el.name);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.name.endsWith('.custom')) el.value = v ? JSON.stringify(v, null, 2) : '';
    else el.value = v ?? '';
  });

  const paintNav = (active) => {
    $('#setNav', root).innerHTML = TABS.map(([k, n]) => {
      const st = tabState(s, k);
      return `<button type="button" data-tab="${k}" class="${k === active ? 'on' : ''}"><span>${n}</span>${st ? `<span class="st ${st[1]}">${st[0]}</span>` : ''}</button>`;
    }).join('');
  };
  const showTab = (k) => {
    $$('.set-pane', root).forEach((p) => p.classList.toggle('on', p.dataset.pane === k));
    paintNav(k);
  };
  showTab('general');
  $('#setNav', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });

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
      paintNav($('#setNav .on', root)?.dataset.tab || 'general');
      $('#saveHint', root).textContent = '';
      toast('设置已保存', 'ok');
    } catch (e) {
      $('#saveHint', root).textContent = `保存失败：${e.message}`;
    }
  });

  return { unmount() {} };
}
