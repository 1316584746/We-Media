const $ = (s) => document.querySelector(s);
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

/* ---------------- 设置 ---------------- */
function getByPath(obj, p) { return p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setByPath(obj, p, v) {
  const ks = p.split('.');
  let o = obj;
  ks.slice(0, -1).forEach((k) => (o = o[k] = o[k] || {}));
  o[ks.at(-1)] = v;
}

async function openSettings() {
  const s = await api('/api/settings');
  document.querySelectorAll('#settingsForm [name]').forEach((el) => {
    let v = getByPath(s, el.name);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.name.endsWith('.custom')) el.value = v ? JSON.stringify(v, null, 2) : '';
    else el.value = v ?? '';
  });
  $('#saveHint').textContent = '';
  $('#dlg').showModal();
}

async function saveSettings(ev) {
  ev.preventDefault();
  const body = {};
  try {
    document.querySelectorAll('#settingsForm [name]').forEach((el) => {
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
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
  $('#saveHint').textContent = '已保存 ✓';
  loadDefaults();
}

async function loadDefaults() {
  const s = await api('/api/settings');
  if (!$('#style').value) $('#style').value = s.render.style;
}

/* ---------------- 分镜 ---------------- */
async function makeStoryboard() {
  const poem = $('#poem').value.trim();
  if (!poem) return alert('请先输入诗词');
  $('#btnStoryboard').disabled = true;
  $('#sbHint').textContent = '正在生成分镜…';
  try {
    const r = await api('/api/storyboard', {
      method: 'POST',
      body: JSON.stringify({ title: $('#title').value, author: $('#author').value, poem, style: $('#style').value }),
    });
    scenes = r.scenes;
    renderScenes();
    $('#sbCard').hidden = false;
    $('#sbMeta').textContent = r.character || r.setting ? `统一设定 —— 角色：${r.character || '无'}；场景：${r.setting || '无'}` : '';
    $('#sbHint').textContent = r.usedLlm ? '已由 LLM 生成镜头与画面提示词' : '使用规则模板生成提示词' + (r.warning ? `（LLM 失败：${r.warning.slice(0, 80)}）` : '（未启用 LLM）');
  } catch (e) {
    $('#sbHint').textContent = '失败：' + e.message;
  }
  $('#btnStoryboard').disabled = false;
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
      const head = `<div><span class="no">镜头 ${i + 1}</span> <span class="hint">${KIND[s.kind] || s.kind}${s.shot ? ' · ' + esc(s.shot) : ''}</span></div>`;
      let body;
      if (s.kind === 'verse') {
        body = `<label>旁白 / 字幕<input data-i="${i}" data-k="text" value="${esc(s.text)}" /></label>
          <label>插画提示词（先画出这一帧）<textarea data-i="${i}" data-k="prompt" rows="3">${esc(s.prompt)}</textarea></label>
          <label>动作描述（让画面动起来，图生视频用）<textarea data-i="${i}" data-k="motion" rows="2">${esc(s.motion || '')}</textarea></label>`;
      } else {
        const refNote = s.imageRef != null ? `画面复用「镜头 ${s.imageRef + 1}」` : '无可复用画面';
        body = `<label>旁白（可留空 = 无旁白）<input data-i="${i}" data-k="text" value="${esc(s.text)}" /></label>
          <label>屏幕文字（每行一段，首行为大标题）<textarea data-i="${i}" data-k="display" rows="${s.kind === 'ending' ? 6 : 2}">${esc(s.display)}</textarea></label>
          <div class="hint">${refNote}，不额外生图</div>`;
      }
      return `<div class="scene">${head}${body}<button class="ghost" data-del="${i}">删除此镜头</button></div>`;
    })
    .join('');
}

$('#scenes').addEventListener('input', (e) => {
  const { i, k } = e.target.dataset;
  if (i !== undefined) scenes[i][k] = e.target.value;
});
$('#scenes').addEventListener('click', (e) => {
  const d = e.target.dataset.del;
  if (d !== undefined) { scenes.splice(Number(d), 1); fixRefs(); renderScenes(); }
});

/* ---------------- 任务 ---------------- */
async function generate() {
  if (!scenes.length) return;
  const own = scenes.filter((s) => s.imageRef == null).length;
  if (!confirm(`将生成 ${own} 个画面（共 ${scenes.length} 个镜头）。图生视频按秒计费，真实模型会产生费用，确认开始？`)) return;
  const r = await api('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ title: $('#title').value, author: $('#author').value, scenes }),
  });
  watchJob(r.id);
}

function watchJob(id) {
  currentJob = id;
  $('#jobCard').hidden = false;
  $('#jobCard').scrollIntoView({ behavior: 'smooth' });
  clearInterval(pollTimer);
  const tick = async () => {
    const job = await api(`/api/jobs/${id}`);
    if (currentJob !== id) return;
    renderJob(job);
    if (job.status === 'done' || job.status === 'error') { clearInterval(pollTimer); loadHistory(); }
  };
  tick();
  pollTimer = setInterval(tick, 2000);
}

const STAGE = { pending: '等待', tts: '生成中', compose: '素材就绪', done: '✓ 完成', error: '✗ 失败' };
function renderJob(job) {
  $('#bar').style.width = job.progress + '%';
  $('#stage').textContent = `${job.title} · ${job.stage} · ${job.progress}%` + (job.error ? ` · ${job.error.slice(0, 200)}` : '');
  $('#jobScenes').innerHTML = job.scenes
    .map(
      (s) => `<div class="js ${s.stage === 'error' ? 'error' : ''}">
      <b>镜头 ${s.index + 1}</b> ${STAGE[s.stage] || s.stage}<br>
      <span class="hint">${esc(KIND[s.kind] || '')} ${esc((s.text || s.display || '').replace(/\n/g, ' ').slice(0, 30))}</span><br>
      <span class="hint">${esc(s.detail || '')}</span>
      ${s.error ? `<div class="err">${esc(s.error.slice(0, 200))}</div>` : ''}
      ${s.clip ? `<video src="${s.clip}" controls muted loop preload="metadata"></video>` : s.image ? `<img src="${s.image}" loading="lazy" />` : ''}
    </div>`,
    )
    .join('');
  $('#result').innerHTML = job.result
    ? `<video src="${job.result}" controls></video><p><a href="${job.result}" download="${esc(job.title)}.mp4">⬇ 下载成片</a></p>`
    : '';
  $('#logs').textContent = job.logs.join('\n');
  $('#btnRetry').hidden = job.status !== 'error';
}

async function retry() {
  await api(`/api/jobs/${currentJob}/retry`, { method: 'POST' });
  watchJob(currentJob);
}

async function loadHistory() {
  const list = await api('/api/jobs');
  $('#history').innerHTML = list.length
    ? list.map((j) => `<a data-id="${j.id}"><span>${esc(j.title)} ${esc(j.author)}</span><span class="hint">${new Date(j.createdAt).toLocaleString()} · ${j.status}</span></a>`).join('')
    : '<span class="hint">暂无</span>';
}
$('#history').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-id]');
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
$('#settingsForm button[value=cancel]').onclick = () => $('#dlg').close();
$('#btnStoryboard').onclick = makeStoryboard;
$('#btnGenerate').onclick = generate;
$('#btnRetry').onclick = retry;

loadDefaults();
loadHistory();
