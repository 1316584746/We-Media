import {
  $, $$, api, esc, state, toast, icon, paintIcons, tplOf, VISUAL, STATUS, STAGE, KIND, isBusy, fmtDur, debounce, confirmDlg, mockParts, voiceChoices,
} from '../core.js';

const ASSET_KEYS = ['audio', 'image', 'clip', 'segment', 'stage', 'detail', 'duration', 'error'];
const newId = () => Math.random().toString(36).slice(2, 8);

export async function mount(root, [id]) {
  let p;
  try {
    p = await api(`/api/projects/${id}`);
  } catch (e) {
    root.innerHTML = `<div class="page"><div class="empty"><b>找不到这个项目</b>${esc(e.message)}<br><a class="btn" href="#/projects">返回项目列表</a></div></div>`;
    return null;
  }
  const tpl = tplOf(p.template);
  let selId = p.scenes[0]?.id;
  let inspTab = 'scene';
  let stageTab = p.result ? 'final' : 'scene';
  let pollTimer = null;
  let alive = true;
  let lastBusy = isBusy(p);
  let dragId = null;

  const scene = () => p.scenes.find((s) => s.id === selId) || p.scenes[0];
  const idxOf = (sid) => p.scenes.findIndex((s) => s.id === sid);
  const busy = () => isBusy(p);
  const portrait = () => p.options.orientation === 'portrait';
  const estDur = (s) => s.duration || (s.text ? Math.max(2, s.text.replace(/\s/g, '').length * 0.3 + 0.6) : s.silent || 3);

  root.innerHTML = `<div class="ed">
    <header class="ed-top">
      <a class="icon-btn" href="#/projects" title="返回项目列表" style="font-size:18px">${icon('back')}</a>
      <input class="ed-title" id="title" maxlength="80" aria-label="项目名称" />
      <span class="badge" id="badge"></span>
      <span class="save-state" id="saveState"></span>
      <span class="spacer"></span>
      <div class="top-progress" id="topProg" hidden><div class="bar"><i></i></div><span></span></div>
      <a class="btn" id="btnDl" hidden>${icon('download')}<span class="t">下载成片</span></a>
      <button class="btn primary" id="btnGen"></button>
    </header>
    <aside class="ed-list">
      <div class="pane-head"><h3 id="listTitle">分镜</h3><button class="btn sm" id="btnAdd">${icon('plus')}添加镜头</button></div>
      <div class="scene-list" id="list"></div>
    </aside>
    <section class="ed-stage">
      <div class="stage-tabs"><div class="seg" id="stageTabs"><button data-t="final">成片</button><button data-t="scene">当前镜头</button></div></div>
      <div class="stage-wrap"><div class="player" id="player"></div><div class="stage-banner" id="banner"></div></div>
      <div class="stage-info" id="stageInfo"></div>
    </section>
    <section class="ed-tl">
      <div class="tl-head"><span>时间线</span><span id="tlTotal"></span></div>
      <div class="tl-track" id="track"></div>
    </section>
    <aside class="ed-insp">
      <div class="insp-tabs" id="inspTabs"><button data-t="scene">镜头</button><button data-t="project">项目</button></div>
      <div class="insp-body" id="insp"></div>
    </aside>
  </div>`;

  const el = {
    title: $('#title', root), badge: $('#badge', root), saveState: $('#saveState', root), topProg: $('#topProg', root),
    dl: $('#btnDl', root), gen: $('#btnGen', root), list: $('#list', root), listTitle: $('#listTitle', root),
    stageTabs: $('#stageTabs', root), player: $('#player', root), banner: $('#banner', root), info: $('#stageInfo', root),
    track: $('#track', root), tlTotal: $('#tlTotal', root), inspTabs: $('#inspTabs', root), insp: $('#insp', root), add: $('#btnAdd', root),
  };

  /* ---------------- 保存 ---------------- */
  let pending = false;
  let chain = Promise.resolve();
  const setSave = (t) => (el.saveState.textContent = t);

  function mergeAssets(sp) {
    p.dirty = sp.dirty;
    p.updatedAt = sp.updatedAt;
    p.title = p.title || sp.title;
    for (const s of p.scenes) {
      const n = sp.scenes.find((x) => x.id === s.id);
      if (n) ASSET_KEYS.forEach((k) => (s[k] = n[k]));
    }
  }

  const doSave = () => {
    chain = chain.then(async () => {
      if (!pending || !alive) return;
      pending = false;
      setSave('保存中…');
      try {
        const sp = await api(`/api/projects/${id}`, {
          method: 'PUT',
          body: {
            title: p.title,
            scenes: p.scenes.map((s) => ({ id: s.id, text: s.text, display: s.display, prompt: s.prompt, motion: s.motion, shot: s.shot })),
          },
        });
        mergeAssets(sp);
        setSave('已保存');
        if (alive) {
          paintTop();
          paintList();
          paintTrack();
          paintStage();
          paintInspLive();
        }
      } catch (e) {
        setSave('保存失败');
        toast(`保存失败：${e.message}`, 'err');
      }
    });
    return chain;
  };
  const queueSave = debounce(doSave, 700);
  const markDirty = () => {
    pending = true;
    setSave('未保存…');
    queueSave();
  };
  const flush = () => {
    queueSave.cancel();
    return doSave();
  };

  /* ---------------- 绘制 ---------------- */
  function paintTop() {
    if (document.activeElement !== el.title) el.title.value = p.title;
    el.title.disabled = busy();
    el.badge.className = `badge ${p.dirty && p.status === 'done' ? 'warn' : p.status}`;
    el.badge.textContent = STATUS[p.status] + (p.status === 'done' && p.dirty ? ' · 有改动' : '');
    el.topProg.hidden = !busy();
    if (busy()) {
      $('i', el.topProg).style.width = `${p.progress}%`;
      $('span', el.topProg).textContent = `${p.stage} · ${p.progress}%`;
    }
    el.dl.hidden = !p.result;
    if (p.result) {
      el.dl.href = p.result;
      el.dl.setAttribute('download', `${p.title}.mp4`);
    }
    if (busy()) {
      el.gen.disabled = true;
      el.gen.className = 'btn primary';
      el.gen.innerHTML = '<i class="spin"></i><span class="t">生成中</span>';
    } else {
      el.gen.disabled = false;
      const first = p.status === 'draft';
      const label = first ? '生成视频' : p.status === 'error' ? '重试生成' : '重新生成';
      el.gen.className = `btn ${first || p.dirty || p.status === 'error' ? 'primary' : ''}`;
      el.gen.innerHTML = `${icon(first ? 'sparkle' : 'refresh')}<span class="t">${label}</span>`;
    }
  }

  function paintList() {
    el.listTitle.textContent = `分镜 · ${p.scenes.length}`;
    el.add.disabled = busy();
    el.list.innerHTML = p.scenes
      .map((s, i) => {
        const txt = s.text || s.display.replace(/\n/g, ' ');
        return `<div class="sc ${s.id === selId ? 'on' : ''}" data-id="${s.id}" draggable="${!busy()}">
          <div class="sc-thumb ${portrait() ? 'portrait' : ''}">
            ${s.image ? `<img src="${s.image}" loading="lazy" alt="" />` : `<span class="ph">${icon('image')}</span>`}
            <span class="no">${i + 1}</span>
          </div>
          <div class="sc-body">
            <div class="tx ${txt ? '' : 'empty-tx'}">${esc(txt || '（空镜头，点击编辑）')}</div>
            <div class="sc-meta"><i class="st-dot ${s.stage}" title="${STAGE[s.stage] || ''}"></i>${s.kind !== 'shot' ? `<span class="tag ${s.kind}">${KIND[s.kind]}</span>` : ''}<span>${estDur(s).toFixed(1)}s</span></div>
          </div>
          <div class="sc-acts">
            <button class="icon-btn" data-mv="-1" title="上移" ${busy() || i === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button class="icon-btn" data-mv="1" title="下移" ${busy() || i === p.scenes.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function stageSource() {
    if (stageTab === 'final') return p.result ? { type: 'video', src: p.result } : null;
    const s = scene();
    if (!s) return null;
    if (s.segment) return { type: 'video', src: s.segment };
    if (s.clip) return { type: 'video', src: s.clip };
    if (s.image) return { type: 'img', src: s.image };
    return null;
  }

  function paintStage() {
    $$('button', el.stageTabs).forEach((b) => b.classList.toggle('on', b.dataset.t === stageTab));
    el.player.classList.toggle('portrait', portrait());
    const src = stageSource();
    const key = src ? `${src.type}:${src.src}` : `none:${stageTab}:${stageTab === 'scene' ? selId : ''}`;
    if (el.player.dataset.key !== key) {
      el.player.dataset.key = key;
      if (src?.type === 'video') el.player.innerHTML = `<video src="${src.src}" controls playsinline preload="metadata"></video>`;
      else if (src?.type === 'img') el.player.innerHTML = `<img src="${src.src}" alt="" />`;
      else if (stageTab === 'final') {
        el.player.innerHTML = `<div class="ph"><b>还没有成片</b>确认分镜内容后，点右上角「生成视频」。<br>生成过程中可以在这里看到每个镜头的进展。</div>`;
      } else {
        const s = scene();
        el.player.innerHTML = `<div class="ph"><b>这个镜头还没有画面</b>${esc(s?.text || s?.display || '')}</div>`;
      }
    }
    let banner = '';
    if (p.status === 'error' && p.error) banner = `<div class="notice err"><span>生成失败：${esc(p.error.slice(0, 240))}</span></div>`;
    else if (stageTab === 'final' && p.result && p.dirty && !busy()) banner = `<div class="notice info"><span>分镜有改动，当前成片是旧版本。点「重新生成」更新（只重做改动过的镜头）。</span></div>`;
    el.banner.innerHTML = banner;
  }

  function paintInfo() {
    const dur = p.duration ? fmtDur(p.duration) : `约 ${fmtDur(p.scenes.reduce((a, s) => a + estDur(s), 0))}`;
    el.info.innerHTML = `<span>${portrait() ? '竖屏 9:16' : '横屏 16:9'}</span><span>${VISUAL[p.options.visual].name}</span><span>${p.scenes.length} 个镜头</span><span>时长 ${dur}</span>`;
  }

  function paintTrack() {
    const total = p.scenes.reduce((a, s) => a + estDur(s), 0);
    el.tlTotal.textContent = `共 ${p.scenes.length} 段 · ${fmtDur(total)}`;
    el.track.innerHTML = p.scenes
      .map((s, i) => {
        const d = estDur(s);
        const bg = s.image ? `background-image:url(${s.image});` : '';
        return `<div class="tl-clip ${s.id === selId ? 'on' : ''}" data-id="${s.id}" style="flex-grow:${d.toFixed(2)};${bg}" title="${esc(s.text || s.display)}">
          <span class="no">${i + 1}</span><i class="st-dot ${s.stage}"></i>
          <span class="lbl">${esc((s.text || s.display || KIND[s.kind]).replace(/\n/g, ' '))}</span>
        </div>`;
      })
      .join('');
  }

  function sceneStateHtml(s) {
    const b = busy();
    return `<div class="scene-state">
      <div>状态：<b>${STAGE[s.stage] || s.stage}</b>${s.stage !== 'done' && s.detail ? ` · ${esc(s.detail)}` : ''}${s.duration ? ` · ${s.duration}s` : ''}</div>
      ${s.error ? `<div class="e">${esc(s.error.slice(0, 220))}</div>` : ''}
      ${s.audio ? `<audio src="${s.audio}" controls preload="none"></audio>` : ''}
    </div>${b ? '<div class="lock-note">生成中，暂时不能编辑</div>' : ''}`;
  }

  function sceneInspHtml() {
    const s = scene();
    if (!s) return '<div class="hint">没有镜头</div>';
    const dis = busy() ? 'disabled' : '';
    const n = idxOf(s.id) + 1;
    const isShot = s.kind === 'shot';
    const vis = p.options.visual;
    const ref = !isShot ? (s.kind === 'title' ? p.scenes.find((x) => x.kind === 'shot') : [...p.scenes].reverse().find((x) => x.kind === 'shot')) : null;
    return `
    <div class="insp-sec">
      <div style="display:flex;align-items:center;gap:8px"><b>镜头 ${n}</b><span class="tag ${s.kind}">${KIND[s.kind]}</span>${s.shot ? `<span class="tag">${esc(s.shot)}</span>` : ''}</div>
      <div class="field"><label>旁白文案（配音内容）${s.kind === 'ending' ? ' · 留空则无旁白' : ''}</label>
        <textarea data-k="text" rows="3" ${dis} placeholder="这一镜头要说的话">${esc(s.text)}</textarea></div>
      <div class="field"><label>${isShot ? '字幕文字（留空 = 同旁白）' : '屏幕文字（每行一段，首行为大标题）'}</label>
        <textarea data-k="display" rows="${isShot ? 2 : 4}" ${dis}>${esc(s.display)}</textarea></div>
      ${
        isShot
          ? `<div class="field"><label>画面描述（先画出这一帧）</label>
              <textarea data-k="prompt" rows="6" ${dis} placeholder="留空则自动用「画风 + 旁白」生成">${esc(s.prompt)}</textarea></div>
            <div class="field"><label>动作描述（让画面动起来）</label>
              <textarea data-k="motion" rows="3" ${dis}>${esc(s.motion)}</textarea>
              ${vis === 'image' ? '<span class="hint">当前画面方式是「插画推拉」，动作描述不生效。到「项目」页切换画面方式。</span>' : ''}</div>`
          : `<div class="hint">${ref ? `画面复用镜头 ${idxOf(ref.id) + 1} 的插画，不额外生图。` : '没有可复用的镜头画面。'}</div>`
      }
    </div>
    <div class="insp-sec"><h4>状态</h4><div id="sceneState">${sceneStateHtml(s)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${isShot ? `<button class="btn sm" data-act="reset" ${dis} title="清除该镜头已生成的画面，下次生成时重画">${icon('refresh')}重画此镜头</button>` : ''}
        <button class="btn sm danger" data-act="del" ${dis}>${icon('trash')}删除镜头</button>
      </div>
    </div>`;
  }

  /** 创建分镜时用到的技能与工具检索结果 */
  function extSection() {
    const skills = p.skillsUsed || [];
    const useTools = p.ext?.useTools;
    if (!skills.length && !useTools && !p.researchWarning) return '';
    const calls = p.research?.calls || [];
    return `<div class="insp-sec"><h4>扩展（分镜时使用）</h4>
      <dl class="kv">
        ${skills.length ? `<dt>技能</dt><dd>${skills.map((s) => esc(s.name)).join('、')}</dd>` : ''}
        ${useTools ? `<dt>工具增强</dt><dd>${p.research ? `调用了 ${calls.length} 次工具${calls.some((c) => !c.ok) ? '（有失败）' : ''}` : '没有获得资料'}</dd>` : ''}
      </dl>
      ${p.researchWarning ? `<div class="notice"><span>${esc(p.researchWarning)}</span></div>` : ''}
      ${
        p.research?.text || calls.length
          ? `<details class="logs"><summary>查看检索详情</summary><pre>${esc(
              [...calls.map((c) => `${c.ok ? '✓' : '✗'} ${c.server} / ${c.tool}  ${JSON.stringify(c.args)}`), p.research?.text ? `\n${p.research.text}` : ''].join('\n').trim(),
            )}</pre></details>`
          : ''
      }
    </div>`;
  }

  function projectInspHtml() {
    const dis = busy() ? 'disabled' : '';
    const o = p.options;
    const voices = voiceChoices();
    const voiceSel = voices
      ? `<select data-opt="voice" ${dis}><option value="">默认音色（设置里的音色）</option>${voices
          .map((v) => `<option value="${esc(v.id)}" ${v.id === o.voice ? 'selected' : ''}>${esc(v.name)}</option>`)
          .join('')}</select>`
      : `<select disabled><option>当前配音服务使用设置里的音色</option></select>`;
    const mocks = mockParts(state.settings, o.visual);
    return `
    <div class="insp-sec"><h4>基本信息</h4>
      <dl class="kv">
        <dt>模板</dt><dd>${esc(tpl.name)}</dd>
        <dt>镜头</dt><dd>${p.scenes.length} 个</dd>
        <dt>创建</dt><dd>${new Date(p.createdAt).toLocaleString()}</dd>
        <dt>分镜</dt><dd>${p.usedLlm ? '由 LLM 生成' : '规则模板（未启用 LLM，角色一致性较差）'}</dd>
      </dl>
      ${mocks.length ? `<div class="notice"><span>${mocks.join('、')} 还是 mock 占位。<a href="#/settings">去设置</a></span></div>` : ''}
    </div>
    <div class="insp-sec"><h4>视频设置</h4>
      <div class="field"><span class="lbl">画幅</span>
        <div class="seg full" data-optseg="orientation">
          <button data-v="landscape" class="${o.orientation === 'landscape' ? 'on' : ''}" ${dis}>横屏 16:9</button>
          <button data-v="portrait" class="${o.orientation === 'portrait' ? 'on' : ''}" ${dis}>竖屏 9:16</button>
        </div></div>
      <div class="field"><span class="lbl">画面方式</span>
        <div class="seg full" data-optseg="visual">
          ${Object.entries(VISUAL).map(([k, v]) => `<button data-v="${k}" class="${o.visual === k ? 'on' : ''}" ${dis}>${v.name}</button>`).join('')}
        </div><span class="hint">${VISUAL[o.visual].desc}</span></div>
      <div class="field"><span class="lbl">配音</span>${voiceSel}</div>
      <label class="switch"><input type="checkbox" data-opt="subtitles" ${o.subtitles ? 'checked' : ''} ${dis} />烧录字幕</label>
    </div>
    <div class="insp-sec"><h4>脚本原文</h4>
      <textarea readonly rows="6" style="min-height:90px">${esc(p.script)}</textarea>
      <button class="btn sm danger" data-act="rebuild" ${dis}>${icon('refresh')}按脚本重新生成分镜</button>
      <span class="hint">会丢弃当前所有镜头的修改和已生成的素材。</span>
    </div>
    ${extSection()}
    ${p.character || p.setting ? `<div class="insp-sec"><h4>统一设定（LLM 生成）</h4><dl class="kv">${p.character ? `<dt>角色</dt><dd>${esc(p.character)}</dd>` : ''}${p.setting ? `<dt>场景</dt><dd>${esc(p.setting)}</dd>` : ''}</dl></div>` : ''}
    <div class="insp-sec"><details class="logs"><summary>运行日志（${p.logs.length}）</summary><pre id="logs">${esc(p.logs.join('\n') || '暂无')}</pre></details></div>`;
  }

  function paintInsp() {
    $$('button', el.inspTabs).forEach((b) => b.classList.toggle('on', b.dataset.t === inspTab));
    el.insp.innerHTML = inspTab === 'scene' ? sceneInspHtml() : projectInspHtml();
    paintIcons(el.insp);
  }
  function paintInspLive() {
    const box = $('#sceneState', el.insp);
    const s = scene();
    if (box && s && inspTab === 'scene') {
      const audio = $('audio', box);
      const cur = audio?.getAttribute('src');
      // 音频控件正在播放时不要重建
      if (audio && !audio.paused && cur === s.audio) return;
      box.innerHTML = sceneStateHtml(s);
    }
    if (inspTab === 'project') {
      const logs = $('#logs', el.insp);
      if (logs) logs.textContent = p.logs.join('\n') || '暂无';
    }
  }
  function paintAll() {
    paintTop();
    paintList();
    paintStage();
    paintInfo();
    paintTrack();
    if (lastBusy !== busy()) {
      lastBusy = busy();
      paintInsp();
    } else paintInspLive();
  }

  /* ---------------- 生成 / 轮询 ---------------- */
  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(async () => {
      try {
        const sp = await api(`/api/projects/${id}`);
        if (!alive) return;
        const was = busy();
        p = sp;
        if (!scene()) selId = p.scenes[0]?.id;
        if (was && !busy()) {
          stopPoll();
          if (p.status === 'done') {
            toast('成片已生成', 'ok');
            stageTab = 'final';
          } else toast('生成失败，查看顶部提示或日志', 'err');
        }
        paintAll();
      } catch {
        /* 偶发网络错误，下一轮再试 */
      }
    }, 1500);
  }

  function needGen() {
    const vis = p.options.visual;
    return p.scenes.filter((s) => s.kind === 'shot' && ((vis !== 'video' && !s.image) || (vis !== 'image' && !s.clip))).length;
  }

  async function generate() {
    await flush();
    const n = needGen();
    const vis = p.options.visual;
    const mocks = mockParts(state.settings, vis);
    let body;
    if (!n) body = '素材都已就绪，这次只会重新合成成片，不产生模型费用。';
    else if (vis === 'image') body = `将为 ${n} 个镜头生成插画（文生图按张计费）。已完成的镜头会直接复用。`;
    else body = `将为 ${n} 个镜头生成画面${vis === 'i2v' ? '并转成动态视频' : ''}，按量计费。已完成的镜头会直接复用。`;
    if (mocks.length) body += `\n\n注意：${mocks.join('、')} 还是 mock 占位，只能生成测试内容。`;
    const ok = await confirmDlg({ title: p.status === 'draft' ? '开始生成视频？' : '重新生成视频？', body, okText: '开始生成' });
    if (!ok) return;
    try {
      p = await api(`/api/projects/${id}/generate`, { method: 'POST' });
      lastBusy = false;
      paintAll();
      startPoll();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  /* ---------------- 编辑动作 ---------------- */
  function select(sid, { keepStage = false } = {}) {
    selId = sid;
    if (!keepStage) stageTab = 'scene';
    paintList();
    paintTrack();
    paintStage();
    if (inspTab === 'scene') paintInsp();
  }

  async function reorder(fromId, toId) {
    const from = idxOf(fromId);
    const [m] = p.scenes.splice(from, 1);
    const to = idxOf(toId);
    p.scenes.splice(to < 0 ? p.scenes.length : to, 0, m);
    markDirty();
    paintList();
    paintTrack();
    flush();
  }

  async function moveScene(sid, d) {
    const i = idxOf(sid);
    const j = i + d;
    if (j < 0 || j >= p.scenes.length) return;
    [p.scenes[i], p.scenes[j]] = [p.scenes[j], p.scenes[i]];
    markDirty();
    paintList();
    paintTrack();
    flush();
  }

  async function addScene() {
    const ns = { id: newId(), kind: 'shot', text: '', display: '', prompt: '', motion: '', shot: '', silent: 4, stage: 'pending', detail: '', duration: null, audio: null, image: null, clip: null, segment: null, error: null };
    let at = p.scenes.length;
    const cur = scene();
    if (cur) at = cur.kind === 'ending' ? idxOf(cur.id) : idxOf(cur.id) + 1;
    if (p.scenes.length >= 40) return toast('最多 40 个镜头', 'err');
    p.scenes.splice(at, 0, ns);
    inspTab = 'scene';
    select(ns.id);
    markDirty();
    paintInfo();
    flush();
    $('[data-k="text"]', el.insp)?.focus();
  }

  async function deleteScene() {
    const s = scene();
    if (!s) return;
    if (p.scenes.length <= 1) return toast('至少保留一个镜头', 'err');
    const ok = await confirmDlg({ title: '删除这个镜头？', body: s.text || s.display || '空镜头', okText: '删除', danger: true });
    if (!ok) return;
    const i = idxOf(s.id);
    p.scenes.splice(i, 1);
    selId = p.scenes[Math.min(i, p.scenes.length - 1)].id;
    markDirty();
    paintAll();
    paintInsp();
    flush();
  }

  async function resetScene() {
    const s = scene();
    await flush();
    try {
      p = await api(`/api/projects/${id}/scenes/${s.id}/reset`, { method: 'POST' });
      paintAll();
      paintInsp();
      toast('已清除该镜头的画面，重新生成时会重画', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function rebuild() {
    const ok = await confirmDlg({
      title: '重新生成分镜？',
      body: '会按脚本原文重新拆分镜头，当前所有镜头的修改和已生成的素材都会丢弃。',
      okText: '重新生成分镜',
      danger: true,
    });
    if (!ok) return;
    queueSave.cancel();
    pending = false;
    try {
      toast('正在重新拆分镜头…');
      p = await api(`/api/projects/${id}/storyboard`, { method: 'POST' });
      selId = p.scenes[0]?.id;
      stageTab = 'scene';
      paintAll();
      paintInsp();
      toast('分镜已重新生成', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  const OPT_WARN = {
    orientation: ['修改画幅？', '画幅变了，已生成的所有画面都要按新比例重画，会产生费用。'],
    visual: ['更换画面方式？', '已生成的视频片段会失效并重新生成，可能产生费用。'],
    voice: ['更换音色？', '已生成的所有配音都会重新合成。'],
  };
  async function setOption(k, v) {
    if (p.options[k] === v) return;
    const warn = OPT_WARN[k];
    const hasAssets = p.scenes.some((s) => s.image || s.clip || s.audio);
    if (warn && hasAssets) {
      const ok = await confirmDlg({ title: warn[0], body: warn[1], okText: '继续修改' });
      if (!ok) return paintInsp();
    }
    await flush();
    try {
      p = await api(`/api/projects/${id}`, { method: 'PUT', body: { options: { [k]: v } } });
      paintAll();
      paintInsp();
    } catch (e) {
      toast(e.message, 'err');
      paintInsp();
    }
  }

  /* ---------------- 事件 ---------------- */
  el.title.addEventListener('input', () => {
    p.title = el.title.value;
    markDirty();
  });
  el.gen.addEventListener('click', generate);
  el.add.addEventListener('click', addScene);
  el.stageTabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    stageTab = b.dataset.t;
    paintStage();
  });
  el.inspTabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    inspTab = b.dataset.t;
    paintInsp();
  });
  el.track.addEventListener('click', (e) => {
    const c = e.target.closest('[data-id]');
    if (c) select(c.dataset.id);
  });
  el.list.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-mv]');
    const row = e.target.closest('.sc');
    if (mv && row) return moveScene(row.dataset.id, Number(mv.dataset.mv));
    if (row) select(row.dataset.id);
  });
  el.list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.sc');
    if (!row || busy()) return e.preventDefault();
    dragId = row.dataset.id;
    row.classList.add('drag');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  el.list.addEventListener('dragover', (e) => {
    const row = e.target.closest('.sc');
    if (!dragId || !row) return;
    e.preventDefault();
    $$('.sc.over', el.list).forEach((x) => x.classList.remove('over'));
    if (row.dataset.id !== dragId) row.classList.add('over');
  });
  el.list.addEventListener('drop', (e) => {
    const row = e.target.closest('.sc');
    e.preventDefault();
    if (dragId && row && row.dataset.id !== dragId) reorder(dragId, row.dataset.id);
    dragId = null;
  });
  el.list.addEventListener('dragend', () => {
    dragId = null;
    $$('.sc.drag, .sc.over', el.list).forEach((x) => x.classList.remove('drag', 'over'));
  });

  el.insp.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    const s = scene();
    if (!k || !s || busy()) return;
    s[k] = e.target.value;
    markDirty();
    paintList();
    paintTrack();
    paintInfo();
  });
  el.insp.addEventListener('change', (e) => {
    const o = e.target.dataset.opt;
    if (!o) return;
    setOption(o, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  });
  el.insp.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-optseg] button');
    if (seg) return setOption(seg.parentElement.dataset.optseg, seg.dataset.v);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'del') deleteScene();
    else if (act === 'reset') resetScene();
    else if (act === 'rebuild') rebuild();
  });

  paintAll();
  paintInsp();
  if (busy()) startPoll();

  return {
    async unmount() {
      alive = false;
      stopPoll();
      queueSave.cancel();
      if (pending) {
        pending = false;
        // 离开页面前把还没保存的改动写出去
        try {
          await api(`/api/projects/${id}`, {
            method: 'PUT',
            body: {
              title: p.title,
              scenes: p.scenes.map((s) => ({ id: s.id, text: s.text, display: s.display, prompt: s.prompt, motion: s.motion, shot: s.shot })),
            },
          });
        } catch {
          /* 忽略 */
        }
      }
    },
  };
}
