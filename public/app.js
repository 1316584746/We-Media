const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let scenes = [];
let pollTimer = null;
let currentJob = null;

async function api(url, opts) {
  const res = await fetch(url, opts && opts.body ? { ...opts, headers: { 'Content-Type': 'application/json' } } : opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- 提示 / 确认 ---------------- */
let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isErr ? 5000 : 2200);
}
function ask(title, msg) {
  return new Promise((resolve) => {
    $('#cfmTitle').textContent = title;
    $('#cfmMsg').textContent = msg;
    const d = $('#cfm');
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true });
    d.showModal();
  });
}

/* ---------------- 步骤条 ---------------- */
function setStep(n, allDone = false) {
  $$('#stepper .step').forEach((el) => {
    const i = Number(el.dataset.step);
    el.classList.toggle('active', i === n && !allDone);
    el.classList.toggle('done', i < n || allDone);
  });
}
$('#stepper').addEventListener('click', (e) => {
  const b = e.target.closest('.step');
  if (!b) return;
  const target = { 1: '#sec1', 2: '#sbCard', 3: '#jobCard' }[b.dataset.step];
  const el = $(target);
  if (el && !el.hidden) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------------- 配置概览 ---------------- */
const VISUAL_LABEL = { i2v: '图生视频', image: '插画推拉', video: '文生视频' };
const TTS_LABEL = { dashscope: '百炼配音', edge: 'Edge 配音', openai: 'OpenAI 配音', custom: '自定义配音', mock: '配音 mock' };
function renderChips(s) {
  const chips = [];
  const mock = [];
  if (s.render.visual !== 'image' && s.video.mode === 'mock') mock.push('视频');
  if (s.image.mode === 'mock') mock.push('文生图');
  if (s.tts.mode === 'mock') mock.push('配音');
  chips.push(`<span class="chip ok">${VISUAL_LABEL[s.render.visual] || s.render.visual}</span>`);
  chips.push(`<span class="chip">${s.render.orientation === 'portrait' ? '竖屏' : '横屏'}</span>`);
  chips.push(`<span class="chip">${TTS_LABEL[s.tts.mode] || s.tts.mode}</span>`);
  if (mock.length) chips.push(`<span class="chip warn" title="未配置真实模型，会生成占位内容">mock：${mock.join('、')}</span>`);
  $('#cfgChips').innerHTML = chips.join('');
}

/* ---------------- 设置 ---------------- */
function getByPath(obj, p) { return p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setByPath(obj, p, v) {
  const ks = p.split('.');
  let o = obj;
  ks.slice(0, -1).forEach((k) => (o = o[k] = o[k] || {}));
  o[ks.at(-1)] = v;
}
function setField(name, value) {
  const el = document.querySelector(`#settingsForm [name="${name}"]`);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!value;
  else el.value = value;
}

async function openSettings() {
  const s = await api('/api/settings');
  $$('#settingsForm [name]').forEach((el) => {
    const v = getByPath(s, el.name);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.name.endsWith('.custom')) el.value = v ? JSON.stringify(v, null, 2) : '';
    else el.value = v ?? '';
  });
  $('#saveHint').textContent = '';
  $('#dashKey').value = '';
  $('#dlg').showModal();
}

async function saveSettings(ev) {
  ev.preventDefault();
  const body = {};
  try {
    $$('#settingsForm [name]').forEach((el) => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number') v = el.value === '' ? null : Number(el.value);
      else if (el.name.endsWith('.custom')) v = el.value.trim() ? JSON.parse(el.value) : null;
      else v = el.value;
      setByPath(body, el.name, v);
    });
  } catch (e) {
    $('#saveHint').textContent = '自定义模板 JSON 格式有误：' + e.message;
    return;
  }
  try {
    const saved = await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
    renderChips(saved);
    toast('配置已保存 ✓');
    $('#dlg').close();
  } catch (e) {
    $('#saveHint').textContent = '保存失败：' + e.message;
  }
}

// 阿里百炼一键套用：同一个 Key 填到 LLM / 文生图 / 配音 / 视频，并选好推荐模型
function applyDashscope() {
  const key = $('#dashKey').value.trim();
  if (!key) return toast('请先填入百炼 API Key', true);
  const base = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const vals = {
    'llm.enabled': true, 'llm.baseUrl': base, 'llm.apiKey': key, 'llm.model': 'qwen-plus',
    'image.mode': 'dashscope', 'image.baseUrl': '', 'image.apiKey': key, 'image.model': 'qwen-image-2.0',
    'tts.mode': 'dashscope', 'tts.baseUrl': '', 'tts.apiKey': key, 'tts.model': 'qwen3-tts-flash', 'tts.voice': 'Ethan',
    'video.mode': 'dashscope_i2v', 'video.baseUrl': '', 'video.apiKey': key, 'video.model': 'wan2.7-i2v', 'video.resolution': '720P',
    'render.visual': 'i2v',
  };
  Object.entries(vals).forEach(([k, v]) => setField(k, v));
  $('#dashKey').value = '';
  $('#saveHint').textContent = '已套用百炼推荐配置，点「保存」生效';
}

$('#tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  $$('#tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
  $$('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
});

async function loadDefaults() {
  const s = await api('/api/settings');
  if (!$('#style').value) $('#style').value = s.render.style;
  renderChips(s);
}

/* ---------------- 示例诗词 ---------------- */
const SAMPLES = {
  chishang: { title: '池上', author: '白居易', poem: '小娃撑小艇，偷采白莲回。\n不解藏踪迹，浮萍一道开。' },
  jingyesi: { title: '静夜思', author: '李白', poem: '床前明月光，疑是地上霜。\n举头望明月，低头思故乡。' },
  dengguanquelou: { title: '登鹳雀楼', author: '王之涣', poem: '白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。' },
  chunxiao: { title: '春晓', author: '孟浩然', poem: '春眠不觉晓，处处闻啼鸟。\n夜来风雨声，花落知多少。' },
};
$('.samples').addEventListener('click', (e) => {
  const s = SAMPLES[e.target.dataset.sample];
  if (!s) return;
  $('#title').value = s.title;
  $('#author').value = s.author;
  $('#poem').value = s.poem;
});

/* ---------------- 分镜 ---------------- */
async function makeStoryboard() {
  const poem = $('#poem').value.trim();
  if (!poem) return toast('请先输入诗词正文', true);
  const btn = $('#btnStoryboard');
  btn.disabled = true;
  btn.textContent = '正在生成分镜…';
  $('#sbHint').textContent = '';
  try {
    const r = await api('/api/storyboard', {
      method: 'POST',
      body: JSON.stringify({ title: $('#title').value, author: $('#author').value, poem, style: $('#style').value }),
    });
    scenes = r.scenes;
    renderScenes();
    $('#sbCard').hidden = false;
    const meta = $('#sbMeta');
    if (r.character || r.setting) {
      meta.hidden = false;
      meta.innerHTML = `<b>统一设定</b>　角色：${esc(r.character || '无')}　｜　场景：${esc(r.setting || '无')}`;
    } else {
      meta.hidden = true;
    }
    $('#sbHint').textContent = r.usedLlm
      ? '已由 LLM 生成镜头与画面提示词'
      : '使用规则模板' + (r.warning ? `（LLM 失败：${r.warning.slice(0, 60)}）` : '（未启用 LLM，角色一致性会变差）');
    setStep(2);
    $('#sbCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    toast('生成分镜失败：' + e.message, true);
  }
  btn.disabled = false;
  btn.textContent = '生成分镜 →';
}

const KIND = { title: '片头标题卡', verse: '诗句镜头', ending: '片尾全诗' };

// 片头复用第一个诗句镜头、片尾复用最后一个（增删镜头后重新计算）
function fixRefs() {
  const verses = scenes.map((s, i) => (s.kind === 'verse' ? i : -1)).filter((i) => i >= 0);
  scenes.forEach((s) => {
    if (s.kind === 'title') s.imageRef = verses.length ? verses[0] : null;
    if (s.kind === 'ending') s.imageRef = verses.length ? verses[verses.length - 1] : null;
  });
}

function renderScenes() {
  $('#scenes').innerHTML = scenes
    .map((s, i) => {
      const head = `<div class="scene-head"><span class="no">${i + 1}</span><span class="tag ${s.kind}">${KIND[s.kind] || s.kind}</span>${
        s.shot ? `<span class="tag shot">${esc(s.shot)}</span>` : ''
      }<button class="del" data-del="${i}" title="删除此镜头">删除</button></div>`;
      let body;
      if (s.kind === 'verse') {
        body = `<label>旁白 / 字幕<input data-i="${i}" data-k="text" value="${esc(s.text)}" /></label>
          <label>插画提示词（先画出这一帧）<textarea data-i="${i}" data-k="prompt" rows="4">${esc(s.prompt)}</textarea></label>
          <label>动作描述（让画面动起来）<textarea data-i="${i}" data-k="motion" rows="2">${esc(s.motion || '')}</textarea></label>`;
      } else {
        const refNote = s.imageRef != null ? `画面复用「镜头 ${s.imageRef + 1}」的插画，不额外生图` : '无可复用画面';
        body = `<label>旁白（留空 = 无旁白）<input data-i="${i}" data-k="text" value="${esc(s.text)}" /></label>
          <label>屏幕文字（每行一段，首行为大标题）<textarea data-i="${i}" data-k="display" rows="${s.kind === 'ending' ? 5 : 2}">${esc(s.display)}</textarea></label>
          <div class="hint">${refNote}</div>`;
      }
      return `<div class="scene ${s.kind === 'ending' ? 'span2' : ''}">${head}${body}</div>`;
    })
    .join('');
  const own = scenes.filter((s) => s.imageRef == null).length;
  $('#genHint').textContent = `共 ${scenes.length} 个镜头，需生成 ${own} 个画面`;
}

$('#scenes').addEventListener('input', (e) => {
  const { i, k } = e.target.dataset;
  if (i !== undefined) scenes[i][k] = e.target.value;
});
$('#scenes').addEventListener('click', (e) => {
  const d = e.target.dataset.del;
  if (d !== undefined) {
    scenes.splice(Number(d), 1);
    fixRefs();
    renderScenes();
  }
});

/* ---------------- 任务 ---------------- */
async function generate() {
  if (!scenes.length) return;
  const own = scenes.filter((s) => s.imageRef == null).length;
  const ok = await ask(
    '开始生成？',
    `将生成 ${own} 个画面（共 ${scenes.length} 个镜头）。图生视频按秒计费，真实模型会产生费用。`,
  );
  if (!ok) return;
  try {
    const r = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ title: $('#title').value, author: $('#author').value, scenes }),
    });
    watchJob(r.id);
  } catch (e) {
    toast('创建任务失败：' + e.message, true);
  }
}

function watchJob(id) {
  currentJob = id;
  jobView = { id: null, result: null };
  $('#jobCard').hidden = false;
  setStep(3);
  $('#jobCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  clearInterval(pollTimer);
  const tick = async () => {
    let job;
    try {
      job = await api(`/api/jobs/${id}`);
    } catch (e) {
      clearInterval(pollTimer);
      return toast('读取任务失败：' + e.message, true);
    }
    if (currentJob !== id) return;
    renderJob(job);
    if (job.status === 'done' || job.status === 'error') {
      clearInterval(pollTimer);
      loadHistory();
    }
  };
  tick();
  pollTimer = setInterval(tick, 2000);
}

const STAGE = { pending: '等待', tts: '生成中', compose: '素材就绪', done: '完成', error: '失败' };
const STATUS = { queued: '排队中', running: '生成中', done: '已完成', error: '失败' };
let jobView = { id: null, result: null };

// 增量更新：只改变化的节点，避免轮询重绘导致预览视频闪烁重播
function ensureJobScenes(job) {
  const box = $('#jobScenes');
  if (jobView.id !== job.id || box.children.length !== job.scenes.length) {
    box.innerHTML = job.scenes
      .map(
        (s) => `<div class="js" data-i="${s.index}">
        <div class="thumb"><span class="st"></span><div class="media"></div></div>
        <div class="body"><div class="t"></div><div class="d"></div><div class="err"></div></div>
      </div>`,
      )
      .join('');
    jobView.id = job.id;
  }
}

function renderJob(job) {
  ensureJobScenes(job);
  $('#jobTitle').textContent = `《${job.title}》${job.author ? ' · ' + job.author : ''}`;
  const badge = $('#jobBadge');
  badge.textContent = STATUS[job.status] || job.status;
  badge.className = 'badge ' + job.status;
  $('#bar').style.width = job.progress + '%';
  $('#stage').textContent = `${job.stage} · ${job.progress}%` + (job.error ? ` · ${job.error.slice(0, 200)}` : '');

  job.scenes.forEach((s) => {
    const el = $(`#jobScenes .js[data-i="${s.index}"]`);
    if (!el) return;
    const st = el.querySelector('.st');
    st.textContent = STAGE[s.stage] || s.stage;
    st.className = 'st ' + (s.stage === 'done' ? 'done' : s.stage === 'error' ? 'error' : s.stage === 'tts' ? 'run' : '');
    el.classList.toggle('error', s.stage === 'error');
    el.querySelector('.t').textContent = `${s.index + 1}. ${(s.text || s.display || KIND[s.kind] || '').replace(/\n/g, ' ')}`;
    el.querySelector('.d').textContent = s.detail || '';
    el.querySelector('.err').textContent = s.error ? s.error.slice(0, 160) : '';

    const media = el.querySelector('.media');
    const want = s.clip ? `v:${s.clip}` : s.image ? `i:${s.image}` : s.stage === 'tts' ? 'spin' : 'none';
    if (media.dataset.k !== want) {
      media.dataset.k = want;
      media.style.display = 'contents';
      media.innerHTML = s.clip
        ? `<video src="${s.clip}" controls muted loop playsinline preload="metadata"></video>`
        : s.image
          ? `<img src="${s.image}" loading="lazy" />`
          : s.stage === 'tts'
            ? '<div class="spin"></div>'
            : '';
    }
  });

  if (job.result !== jobView.result) {
    jobView.result = job.result;
    $('#resultWrap').hidden = !job.result;
    $('#result').innerHTML = job.result
      ? `<video src="${job.result}" controls></video><a class="dl" href="${job.result}" download="${esc(job.title)}.mp4">⬇ 下载成片</a>`
      : '';
    if (job.result) setStep(3, true);
  }
  $('#logs').textContent = job.logs.join('\n');
  $('#btnRetry').hidden = job.status !== 'error';
}

async function retry() {
  try {
    await api(`/api/jobs/${currentJob}/retry`, { method: 'POST' });
    watchJob(currentJob);
  } catch (e) {
    toast('重试失败：' + e.message, true);
  }
}

async function loadHistory() {
  const list = await api('/api/jobs');
  $('#history').innerHTML = list.length
    ? list
        .map(
          (j) => `<div class="hitem" data-id="${j.id}">
        <div class="ht">${esc(j.title)}</div>
        <div class="hm"><span>${esc(j.author || '佚名')} · ${new Date(j.createdAt).toLocaleString()}</span><span class="badge ${j.status}">${STATUS[j.status] || j.status}</span></div>
      </div>`,
        )
        .join('')
    : '<div class="empty">还没有作品，写一首诗试试吧</div>';
}
$('#history').addEventListener('click', (e) => {
  const a = e.target.closest('.hitem');
  if (a) watchJob(a.dataset.id);
});

// 切换模式时，如果模型/音色框是空的或还是别家的默认值，就自动换成该模式的默认值
const PRESETS = {
  'video.mode': { field: 'video.model', map: { dashscope_i2v: 'wan2.7-i2v', openai: 'sora-2', ark: 'doubao-seedance-1-0-lite-t2v-250428', dashscope: 'wan2.2-t2v-plus' } },
  'image.mode': { field: 'image.model', map: { dashscope: 'qwen-image-2.0' } },
  'tts.mode': { field: 'tts.model', map: { dashscope: 'qwen3-tts-flash', openai: 'tts-1' } },
};
const KNOWN_BASES = [
  'https://api.openai.com/v1',
  'https://dashscope.aliyuncs.com',
  'https://ark.cn-beijing.volces.com',
];
const VOICE_PRESETS = { dashscope: 'Ethan', openai: 'alloy' };
Object.entries(PRESETS).forEach(([sel, { field, map }]) => {
  document.querySelector(`[name="${sel}"]`).addEventListener('change', (e) => {
    const input = document.querySelector(`[name="${field}"]`);
    if (map[e.target.value] && (!input.value || Object.values(map).includes(input.value))) input.value = map[e.target.value];
    // Base URL 留空 = 使用该服务的官方默认地址；切换模式时清掉上一个服务遗留的默认地址
    const base = document.querySelector(`[name="${sel.split('.')[0]}.baseUrl"]`);
    if (base && (!base.value || KNOWN_BASES.includes(base.value))) base.value = '';
    if (sel === 'tts.mode' && VOICE_PRESETS[e.target.value]) {
      const v = document.querySelector('[name="tts.voice"]');
      if (!v.value || Object.values(VOICE_PRESETS).includes(v.value)) v.value = VOICE_PRESETS[e.target.value];
    }
  });
});

$('#btnSettings').onclick = openSettings;
$('#settingsForm').addEventListener('submit', saveSettings);
$('#btnClose').onclick = () => $('#dlg').close();
$('#btnCancel').onclick = () => $('#dlg').close();
$('#btnApplyDash').onclick = applyDashscope;
$('#btnStoryboard').onclick = makeStoryboard;
$('#btnGenerate').onclick = generate;
$('#btnRetry').onclick = retry;

loadDefaults().catch((e) => toast('读取配置失败：' + e.message, true));
loadHistory();
