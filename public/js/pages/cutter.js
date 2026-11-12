/* 视频剪辑编辑器：素材库 | 预览 | 属性 + 多轨时间线。逻辑见 cutter/model.mjs，预览见 cutter/player.js。 */
import { $, $$, api, esc, toast, icon, paintIcons, confirmDlg, relTime, debounce, fmtDur } from '../core.js';
import * as M from '../cutter/model.mjs';
import { Player } from '../cutter/player.js';

const RATIOS = [
  ['16:9', 1920, 1080],
  ['9:16', 1080, 1920],
  ['1:1', 1080, 1080],
  ['4:3', 1440, 1080],
  ['3:4', 1080, 1440],
];
const RULER_H = 28;
const TRACK_H = { t: 40, v: 62, a: 46 };
const TRACK_GAP = 4;
const TRACK_ICON = { t: 'type', v: 'film', a: 'music' };
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const FRAME = 1 / 30;

const TEXT_PRESETS = [
  { name: '默认字幕', hint: '底部白字描边', patch: { text: '在这里输入字幕', size: 5.5, y: 86, color: '#ffffff', bold: true, bg: '', fade: false } },
  { name: '大标题', hint: '居中黄色淡入淡出', patch: { text: '标题文字', size: 12, y: 45, color: '#ffe14d', bold: true, bg: '', fade: true } },
  { name: '底框字幕', hint: '黑色底框', patch: { text: '底框字幕', size: 5, y: 88, color: '#ffffff', bold: true, bg: '#000000', fade: false } },
  { name: '角标', hint: '右上角小字', patch: { text: '@作者名', size: 4, x: 88, y: 6, color: '#ffffff', bold: false, bg: '', fade: false } },
];

const fmtT = (t) => {
  const v = Math.max(0, t);
  const m = Math.floor(v / 60);
  return `${String(m).padStart(2, '0')}:${(v - m * 60).toFixed(1).padStart(4, '0')}`;
};
const kindIcon = { video: 'film', image: 'image', audio: 'music' };

export async function mount(root, [id]) {
  let e;
  try {
    e = await api(`/api/edits/${id}`);
  } catch (err) {
    toast(err.message, 'err');
    location.hash = '#/edits';
    return null;
  }

  /* ---------------- 状态 ---------------- */
  let clips = e.clips;
  let ratio = e.ratio;
  let name = e.name;
  const media = new Map(e.media.map((m) => [m.id, m]));
  const mediaLookup = { get: (k) => media.get(k) };
  let sel = null;
  let px = 80; // 每秒像素
  let alive = true;
  let dirtyExport = !(e.export?.status === 'done');
  let tab = 'media';
  const hist = new M.History();
  let editOpen = false;
  let editTimer = 0;
  let exportPoll = 0;
  let uploads = 0;

  const filesBase = e.files;
  const getMedia = (mid) => media.get(mid);
  const snapshot = () => ({ clips, ratio });
  const selClip = () => clips.find((c) => c.id === sel) || null;

  /* ---------------- 骨架 ---------------- */
  root.innerHTML = `<div class="ct">
    <header class="ct-top">
      <a class="icon-btn" href="#/edits" title="返回剪辑列表">${icon('back')}</a>
      <input class="ct-name" id="ctName" maxlength="60" value="${esc(name)}" aria-label="工程名称" />
      <span class="ct-save" id="ctSave">已保存</span>
      <span class="spacer"></span>
      <div class="ct-ratio" id="ctRatio" title="画布比例">${RATIOS.map(([r]) => `<button data-r="${r}" class="${r === ratio ? 'on' : ''}">${r}</button>`).join('')}</div>
      <button class="icon-btn" id="btnUndo" title="撤销 (Ctrl+Z)">${icon('undo')}</button>
      <button class="icon-btn" id="btnRedo" title="重做 (Ctrl+Shift+Z)">${icon('redo')}</button>
      <button class="btn primary" id="btnExport">${icon('download')}<span>导出</span></button>
    </header>
    <div class="ct-main">
      <aside class="ct-lib" id="ctLib">
        <div class="seg full" id="libTabs"><button data-tab="media" class="on">媒体</button><button data-tab="text">文本</button><button data-tab="ai">AI 成片</button></div>
        <div class="lib-body" id="libBody"></div>
      </aside>
      <section class="ct-stage">
        <div class="ct-wrap" id="ctWrap"><div class="ct-screen" id="ctScreen"></div></div>
        <div class="ct-transport">
          <span class="ct-time" id="ctTime">00:00.0</span>
          <div class="ct-play">
            <button class="icon-btn" id="btnStart" title="回到开头 (Home)">${icon('skipBack')}</button>
            <button class="icon-btn play" id="btnPlay" title="播放 / 暂停 (空格)">${icon('play')}</button>
            <button class="icon-btn" id="btnEnd" title="跳到结尾 (End)">${icon('skipFwd')}</button>
          </div>
          <span class="ct-time dim" id="ctTotal">00:00.0</span>
        </div>
      </section>
      <aside class="ct-insp" id="ctInsp"></aside>
    </div>
    <section class="ct-tl">
      <div class="tl-bar">
        <button class="btn sm" id="btnSplit" title="在播放头处分割 (S)">${icon('scissors')}分割</button>
        <button class="btn sm" id="btnDup" title="复制 (Ctrl+D)">${icon('copy')}复制</button>
        <button class="btn sm danger" id="btnDel" title="删除 (Delete)">${icon('trash')}删除</button>
        <span class="tl-sep"></span>
        <button class="btn sm" id="btnAddText" title="在播放头处添加文字">${icon('type')}文字</button>
        <span class="spacer"></span>
        <span class="hint tl-help">空格 播放 · S 分割 · Delete 删除 · ←→ 逐帧 · Ctrl+滚轮 缩放</span>
        <button class="icon-btn" id="zoomOut" title="缩小">${icon('zoomOut')}</button>
        <input type="range" id="tlZoom" min="10" max="320" step="1" value="${px}" aria-label="时间线缩放" />
        <button class="icon-btn" id="zoomIn" title="放大">${icon('zoomIn')}</button>
        <button class="btn sm ghost" id="zoomFit" title="适应窗口">适应</button>
      </div>
      <div class="tl-body">
        <div class="tl-labels">
          <div class="tl-ruler-label" style="height:${RULER_H}px"></div>
          ${M.TRACK_ORDER.map((t) => `<div class="tl-label" style="height:${TRACK_H[t]}px;margin-bottom:${TRACK_GAP}px">${icon(TRACK_ICON[t])}<span>${M.TRACK_NAME[t]}</span></div>`).join('')}
        </div>
        <div class="tl-scroll" id="tlScroll">
          <div class="tl-content" id="tlContent">
            <div class="tl-ruler" id="tlRuler" style="height:${RULER_H}px"></div>
            ${M.TRACK_ORDER.map((t) => `<div class="tl-track" data-track="${t}" style="height:${TRACK_H[t]}px;margin-bottom:${TRACK_GAP}px"></div>`).join('')}
            <div class="tl-head" id="tlHead"><i></i></div>
            <div class="tl-snap" id="tlSnap" hidden></div>
          </div>
        </div>
      </div>
    </section>
  </div>`;
  paintIcons(root);

  const el = {
    name: $('#ctName', root),
    save: $('#ctSave', root),
    wrap: $('#ctWrap', root),
    screen: $('#ctScreen', root),
    time: $('#ctTime', root),
    total: $('#ctTotal', root),
    play: $('#btnPlay', root),
    insp: $('#ctInsp', root),
    libBody: $('#libBody', root),
    scroll: $('#tlScroll', root),
    content: $('#tlContent', root),
    ruler: $('#tlRuler', root),
    head: $('#tlHead', root),
    snap: $('#tlSnap', root),
    undo: $('#btnUndo', root),
    redo: $('#btnRedo', root),
    exp: $('#btnExport', root),
    zoom: $('#tlZoom', root),
  };
  const trackEl = (t) => $(`.tl-track[data-track="${t}"]`, el.content);

  /* ---------------- 保存 / 历史 ---------------- */
  let unsaved = false;
  const doSave = async () => {
    if (!alive) return;
    unsaved = false;
    el.save.textContent = '保存中…';
    el.save.classList.remove('err');
    try {
      await api(`/api/edits/${id}`, { method: 'PUT', body: { name, ratio, clips } });
      el.save.textContent = '已保存';
    } catch (err) {
      unsaved = true;
      el.save.textContent = '保存失败';
      el.save.classList.add('err');
      toast(`保存失败：${err.message}`, 'err');
    }
  };
  const saveDeb = debounce(doSave, 700);
  const save = () => {
    unsaved = true;
    el.save.textContent = '未保存';
    saveDeb();
  };
  save.flush = async () => {
    saveDeb.cancel();
    if (unsaved) await doSave();
  };
  save.cancel = () => saveDeb.cancel();

  const beginEdit = () => {
    if (!editOpen) {
      hist.push(snapshot());
      editOpen = true;
      paintHistory();
    }
    clearTimeout(editTimer);
    editTimer = setTimeout(() => (editOpen = false), 800);
  };
  const endEdit = () => {
    clearTimeout(editTimer);
    editOpen = false;
  };
  const paintHistory = () => {
    el.undo.disabled = !hist.canUndo;
    el.redo.disabled = !hist.canRedo;
  };

  /** 一次完整的时间线修改：先记历史，再应用 */
  const commit = (next, { keepInsp = false } = {}) => {
    endEdit();
    hist.push(snapshot());
    clips = next;
    changed({ keepInsp });
  };

  function changed({ keepInsp = false } = {}) {
    dirtyExport = true;
    if (sel && !selClip()) sel = null;
    const total = M.totalDuration(clips);
    if (player.t > total) player.seek(total);
    renderTimeline();
    player.render();
    paintHistory();
    paintToolbar();
    el.total.textContent = fmtT(total);
    if (!keepInsp) paintInsp();
    save();
  }

  /* ---------------- 预览 ---------------- */
  const player = new Player({
    screen: el.screen,
    getClips: () => clips,
    getMedia,
    base: filesBase,
    onTime: (t) => paintHead(t),
    onState: () => {
      el.play.innerHTML = icon(player.playing ? 'pause' : 'play');
      el.play.classList.toggle('on', player.playing);
    },
    onError: (m) => toast(m, ''),
    onTextMove: (cid, pos) => {
      select(cid);
      if (!pos) return;
      commit(M.updateClip(clips, cid, pos));
    },
  });

  const fitScreen = () => {
    const [, w, h] = RATIOS.find(([r]) => r === ratio) || RATIOS[0];
    const W = el.wrap.clientWidth - 24;
    const H = el.wrap.clientHeight - 24;
    if (W <= 0 || H <= 0) return;
    const s = Math.min(W / w, H / h);
    el.screen.style.width = `${Math.floor(w * s)}px`;
    el.screen.style.height = `${Math.floor(h * s)}px`;
  };
  const ro = new ResizeObserver(fitScreen);
  ro.observe(el.wrap);
  fitScreen();

  /* ---------------- 时间线渲染 ---------------- */
  const tToX = (t) => t * px;
  const xToT = (clientX) => Math.max(0, (clientX - el.content.getBoundingClientRect().left) / px);

  function paintHead(t) {
    el.head.style.transform = `translateX(${tToX(t)}px)`;
    el.time.textContent = fmtT(t);
    if (!player.playing) paintToolbar();
    if (player.playing) {
      const x = tToX(t);
      const { scrollLeft, clientWidth } = el.scroll;
      if (x > scrollLeft + clientWidth - 60) el.scroll.scrollLeft = x - 60;
      else if (x < scrollLeft) el.scroll.scrollLeft = Math.max(0, x - 60);
    }
  }

  function renderRuler(width) {
    const major = STEPS.find((s) => s * px >= 80) || 600;
    el.content.style.setProperty('--minor', `${(major / 5) * px}px`);
    el.content.style.setProperty('--major', `${major * px}px`);
    let html = '';
    for (let s = 0; s * px <= width; s += major) {
      html += `<span class="tick" style="left:${s * px}px">${fmtDur(s) === '--:--' ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`}</span>`;
    }
    el.ruler.innerHTML = html;
  }

  function clipHtml(c) {
    const m = media.get(c.mediaId);
    const h = TRACK_H[c.track] - 6;
    const w = Math.max(4, c.dur * px);
    const cls = `tl-clip ${c.track} ${c.id === sel ? 'sel' : ''} ${c.muted ? 'muted' : ''}`;
    let body = '';
    let label = '';
    if (c.track === 't') {
      label = esc(c.text.replace(/\n/g, ' '));
    } else if (m) {
      label = esc(m.name);
      if (m.kind === 'video' && m.strip) {
        const s = m.strip;
        const dw = Math.max(8, s.tw * (h / s.th));
        const n = Math.ceil(w / dw);
        let tiles = '';
        for (let k = 0; k < n; k++) {
          const srcT = (c.in || 0) + ((k * dw) / px) * (c.speed || 1);
          const idx = Math.min(s.n - 1, Math.floor(srcT / s.step));
          tiles += `<i style="width:${dw}px;background-image:url(${filesBase}${s.file});background-size:${s.n * dw}px ${h}px;background-position:-${idx * dw}px 0"></i>`;
        }
        body = `<div class="tl-tiles">${tiles}</div>`;
      } else if (m.thumb && m.kind !== 'audio') {
        body = `<div class="tl-tiles thumb" style="background-image:url(${filesBase}${m.thumb});background-size:auto 100%"></div>`;
      }
      if (m.wave && (c.track === 'a' || m.kind === 'video')) {
        const full = (m.duration / (c.speed || 1)) * px;
        body += `<div class="tl-wave ${c.track === 'v' ? 'low' : ''}" style="background-image:url(${filesBase}${m.wave});background-size:${full}px 100%;background-position:-${((c.in || 0) / (c.speed || 1)) * px}px 0"></div>`;
      }
    }
    const badges = [];
    if ((c.speed || 1) !== 1) badges.push(`${c.speed}x`);
    if (c.muted) badges.push('静音');
    return `<div class="${cls}" data-id="${c.id}" style="left:${c.start * px}px;width:${w}px">
      ${body}
      <span class="tl-label-txt">${label}${badges.length ? ` <em>${badges.join(' · ')}</em>` : ''}</span>
      <b class="h h-l" data-h="l"></b><b class="h h-r" data-h="r"></b>
    </div>`;
  }

  function renderTimeline() {
    const total = M.totalDuration(clips);
    const width = Math.max(el.scroll.clientWidth, (total + 6) * px);
    el.content.style.width = `${width}px`;
    renderRuler(width);
    for (const t of M.TRACK_ORDER) trackEl(t).innerHTML = M.trackClips(clips, t).map(clipHtml).join('');
    paintHead(player.t);
  }

  /* ---------------- 选择 / 工具栏 ---------------- */
  function select(cid) {
    if (sel === cid) return;
    sel = cid;
    $$('.tl-clip', el.content).forEach((n) => n.classList.toggle('sel', n.dataset.id === cid));
    paintToolbar();
    paintInsp();
  }

  function paintToolbar() {
    const c = selClip();
    $('#btnDel', root).disabled = !c;
    $('#btnDup', root).disabled = !c;
    $('#btnSplit', root).disabled = !splitTarget();
  }

  function splitTarget() {
    const t = player.t;
    const c = selClip();
    if (c && M.canSplit(c, t) && t > c.start && t < M.clipEnd(c)) return c;
    if (c) return null;
    for (const tr of ['v', 'a', 't']) {
      const x = M.clipAt(clips, tr, t);
      if (x && M.canSplit(x, t)) return x;
    }
    return null;
  }

  /* ---------------- 编辑动作 ---------------- */
  function doSplit() {
    const c = splitTarget();
    if (!c) return toast('把播放头放到片段中间再分割（离两端至少 0.1 秒）', '');
    const r = M.splitClip(clips, c.id, player.t);
    if (!r) return;
    commit(r.clips);
    select(r.ids[1]);
  }
  function doDelete() {
    const c = selClip();
    if (!c) return;
    sel = null;
    commit(M.deleteClip(clips, c.id));
  }
  function doDup() {
    const c = selClip();
    if (!c) return;
    const r = M.duplicateClip(clips, c.id);
    commit(r.clips);
    select(r.id);
  }
  function addMediaToTimeline(m, at = null) {
    if (!m) return;
    const clip = M.newMediaClip(m, 0);
    let next = M.addClip(clips, clip, at ?? player.t);
    // 视频轨：拖到指定时间则插入到对应位置
    if (clip.track === 'v' && at !== null) next = M.moveClip(next, clip.id, at);
    commit(next);
    select(clip.id);
  }
  function addText(patch = {}) {
    const base = { ...M.newTextClip(0), ...patch };
    const next = M.addClip(clips, base, player.t);
    commit(next);
    select(base.id);
  }
  function undo() {
    const prev = hist.undo(snapshot());
    if (prev) applySnapshot(prev);
  }
  function redo() {
    const nxt = hist.redo(snapshot());
    if (nxt) applySnapshot(nxt);
  }
  function applySnapshot(s) {
    endEdit();
    clips = s.clips;
    if (s.ratio !== ratio) setRatio(s.ratio, false);
    changed();
  }
  function setRatio(r, record = true) {
    if (r === ratio) return;
    if (record) {
      endEdit();
      hist.push(snapshot());
    }
    ratio = r;
    $$('#ctRatio button', root).forEach((b) => b.classList.toggle('on', b.dataset.r === r));
    fitScreen();
    player.layoutText();
    dirtyExport = true;
    paintHistory();
    paintInsp();
    save();
  }

  /* ---------------- 时间线交互 ---------------- */
  const trackAt = (target) => target.closest('.tl-track')?.dataset.track;

  let drag = null;
  const onWindowMove = (ev) => drag?.move(ev);
  const onWindowUp = (ev) => {
    const d = drag;
    drag = null;
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    d?.up(ev);
  };
  const startDrag = (d) => {
    drag = d;
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
  };
  const showSnap = (t) => {
    if (t == null) return (el.snap.hidden = true);
    el.snap.hidden = false;
    el.snap.style.transform = `translateX(${tToX(t)}px)`;
  };
  const SNAP_PX = 8;

  el.content.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const handle = ev.target.closest('.h');
    const clipEl = ev.target.closest('.tl-clip');
    // 标尺 / 空白处：定位播放头并可拖动
    if (!clipEl) {
      if (!ev.target.closest('.tl-ruler')) select(null);
      const scrub = (e2) => player.seek(xToT(e2.clientX));
      player.pause();
      scrub(ev);
      startDrag({ move: scrub, up: () => {} });
      return;
    }
    const cid = clipEl.dataset.id;
    const c = clips.find((x) => x.id === cid);
    if (!c) return;
    select(cid);
    player.pause();
    const base = clips;
    const startX = ev.clientX;
    let moved = false;
    if (handle) {
      const edge = handle.dataset.h;
      startDrag({
        move(e2) {
          if (!moved && Math.abs(e2.clientX - startX) < 2) return;
          if (!moved) {
            moved = true;
            endEdit();
            hist.push({ clips: base, ratio });
          }
          const pts = M.snapPoints(base, cid, [player.t]);
          const raw = xToT(e2.clientX);
          const t = M.snapTime(raw, pts, SNAP_PX / px);
          showSnap(t !== raw ? t : null);
          clips = M.trimClip(base, cid, edge, t, mediaLookup);
          changedLight();
        },
        up() {
          showSnap(null);
          if (moved) changed();
        },
      });
      return;
    }
    // 拖动整个片段
    const node = clipEl;
    const orig = c.start;
    startDrag({
      move(e2) {
        if (!moved && Math.abs(e2.clientX - startX) < 4) return;
        moved = true;
        node.classList.add('dragging');
        let s = Math.max(0, orig + (e2.clientX - startX) / px);
        if (c.track !== 'v') {
          const pts = M.snapPoints(base, cid, [player.t]);
          const a = M.snapTime(s, pts, SNAP_PX / px);
          const b = M.snapTime(s + c.dur, pts, SNAP_PX / px) - c.dur;
          const snapped = Math.abs(a - s) <= Math.abs(b - s) ? a : b;
          showSnap(snapped !== s ? (snapped === a ? a : snapped + c.dur) : null);
          s = Math.max(0, snapped);
        }
        node.style.left = `${tToX(s)}px`;
        node.dataset.drop = String(s);
      },
      up() {
        showSnap(null);
        node.classList.remove('dragging');
        if (!moved) return;
        const s = Number(node.dataset.drop);
        commit(M.moveClip(base, cid, s));
      },
    });
  });

  /** 裁剪过程中的轻量刷新：重画时间线和预览，不碰属性面板、不存盘 */
  function changedLight() {
    renderTimeline();
    player.render();
    el.total.textContent = fmtT(M.totalDuration(clips));
    dirtyExport = true;
    save();
  }

  el.content.addEventListener('dblclick', (ev) => {
    const c = ev.target.closest('.tl-clip');
    if (c && c.classList.contains('t')) $('#inspText', root)?.focus();
  });

  // 缩放
  const setZoom = (v, anchorClientX = null) => {
    const old = px;
    px = Math.min(320, Math.max(10, v));
    const rect = el.scroll.getBoundingClientRect();
    const ax = anchorClientX ?? rect.left + rect.width / 2;
    const tAt = (el.scroll.scrollLeft + ax - rect.left) / old;
    el.zoom.value = String(px);
    renderTimeline();
    el.scroll.scrollLeft = Math.max(0, tAt * px - (ax - rect.left));
  };
  el.zoom.addEventListener('input', () => setZoom(Number(el.zoom.value)));
  $('#zoomIn', root).addEventListener('click', () => setZoom(px * 1.3));
  $('#zoomOut', root).addEventListener('click', () => setZoom(px / 1.3));
  const fit = () => setZoom(Math.max(10, Math.min(320, (el.scroll.clientWidth - 40) / Math.max(M.totalDuration(clips), 4))));
  $('#zoomFit', root).addEventListener('click', () => {
    fit();
    el.scroll.scrollLeft = 0;
  });
  el.scroll.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      setZoom(px * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), ev.clientX);
    },
    { passive: false },
  );

  // 从素材库拖到时间线
  el.scroll.addEventListener('dragover', (ev) => {
    if (ev.dataTransfer.types.includes('text/wm-media')) ev.preventDefault();
  });
  el.scroll.addEventListener('drop', (ev) => {
    const mid = ev.dataTransfer.getData('text/wm-media');
    if (!mid) return;
    ev.preventDefault();
    addMediaToTimeline(media.get(mid), xToT(ev.clientX));
  });

  /* ---------------- 传输条 / 工具栏事件 ---------------- */
  el.play.addEventListener('click', () => player.toggle());
  $('#btnStart', root).addEventListener('click', () => player.seek(0));
  $('#btnEnd', root).addEventListener('click', () => player.seek(M.totalDuration(clips)));
  $('#btnSplit', root).addEventListener('click', doSplit);
  $('#btnDel', root).addEventListener('click', doDelete);
  $('#btnDup', root).addEventListener('click', doDup);
  $('#btnAddText', root).addEventListener('click', () => addText(TEXT_PRESETS[0].patch));
  el.undo.addEventListener('click', undo);
  el.redo.addEventListener('click', redo);
  $('#ctRatio', root).addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-r]');
    if (b) setRatio(b.dataset.r);
  });
  el.name.addEventListener('input', () => {
    name = el.name.value.trim() || '未命名剪辑';
    save();
  });

  const onKey = (ev) => {
    if (!alive || ev.target.closest('input, textarea, select, [contenteditable], dialog')) return;
    const k = ev.key;
    const mod = ev.ctrlKey || ev.metaKey;
    if (k === ' ') {
      ev.preventDefault();
      player.toggle();
    } else if (mod && k.toLowerCase() === 'z') {
      ev.preventDefault();
      ev.shiftKey ? redo() : undo();
    } else if (mod && k.toLowerCase() === 'y') {
      ev.preventDefault();
      redo();
    } else if (mod && k.toLowerCase() === 'd') {
      ev.preventDefault();
      doDup();
    } else if (!mod && k.toLowerCase() === 's') {
      ev.preventDefault();
      doSplit();
    } else if (k === 'Delete' || k === 'Backspace') {
      ev.preventDefault();
      doDelete();
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      ev.preventDefault();
      player.pause();
      player.seek(player.t + (k === 'ArrowLeft' ? -1 : 1) * (ev.shiftKey ? 1 : FRAME));
    } else if (k === 'Home') {
      player.seek(0);
    } else if (k === 'End') {
      player.seek(M.totalDuration(clips));
    } else if (k === 'Escape') {
      select(null);
    }
  };
  document.addEventListener('keydown', onKey);

  /* ---------------- 属性面板 ---------------- */
  const slider = (label, prop, val, min, max, step, fmt, extra = '') =>
    `<div class="ins-row"><label>${label}</label><input type="range" data-prop="${prop}" min="${min}" max="${max}" step="${step}" value="${val}" ${extra} /><output data-out="${prop}">${fmt(val)}</output></div>`;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const sec = (v) => `${(+v).toFixed(2)}s`;

  function inspHtml() {
    const c = selClip();
    if (!c) {
      return `<div class="ins-sec"><h4>画布</h4>
        <div class="seg full" id="inspRatio">${RATIOS.map(([r]) => `<button data-r="${r}" class="${r === ratio ? 'on' : ''}">${r}</button>`).join('')}</div>
        <p class="hint">${RATIOS.find(([r]) => r === ratio).slice(1).join(' × ')} · ${fmtT(M.totalDuration(clips))} · ${clips.length} 个片段</p></div>
        <div class="ins-sec"><h4>使用提示</h4><ul class="ins-tips">
          <li>把素材拖到时间线，或点素材上的 <b>＋</b></li>
          <li>点选片段后在这里调整属性</li>
          <li>拖动片段两端裁剪，拖动片段本身移动</li>
          <li>视频轨自动首尾相接；文字、音频可自由摆放</li>
          <li>文字可以直接在预览画面里拖动位置</li>
        </ul></div>`;
    }
    const m = media.get(c.mediaId);
    const title = c.track === 't' ? '文字' : esc(m?.name || '片段');
    const head = `<div class="ins-head"><span class="ins-kind ${c.track}">${icon(TRACK_ICON[c.track])}</span><b title="${title}">${title}</b></div>`;
    const timing = `<div class="ins-sec"><h4>时间</h4>
      <div class="ins-grid"><label>起点<input type="number" step="0.1" min="0" data-num="start" value="${c.start}" ${c.track === 'v' ? 'disabled' : ''} /></label>
      <label>时长<input type="number" step="0.1" min="0.1" data-num="dur" value="${c.dur}" /></label></div></div>`;
    if (c.track === 't') {
      return `${head}
      <div class="ins-sec"><h4>内容</h4><textarea id="inspText" data-prop="text" rows="3" maxlength="500">${esc(c.text)}</textarea></div>
      <div class="ins-sec"><h4>样式</h4>
        ${slider('字号', 'size', c.size, 2, 24, 0.5, (v) => `${v}`)}
        <div class="ins-row"><label>颜色</label><input type="color" data-prop="color" value="${c.color}" /><div class="swatches">${['#ffffff', '#ffe14d', '#ff5c5c', '#5cd6ff', '#7cff9b', '#000000'].map((s) => `<button data-swatch="${s}" style="background:${s}" title="${s}"></button>`).join('')}</div></div>
        <div class="ins-row"><label>底框</label><label class="switch"><input type="checkbox" data-check="bgOn" ${c.bg ? 'checked' : ''} /></label>${c.bg ? `<input type="color" data-prop="bg" value="${c.bg}" />` : ''}</div>
        <div class="ins-row"><label>加粗</label><label class="switch"><input type="checkbox" data-check="bold" ${c.bold ? 'checked' : ''} /></label><label class="sub">淡入淡出</label><label class="switch"><input type="checkbox" data-check="fade" ${c.fade ? 'checked' : ''} /></label></div>
      </div>
      <div class="ins-sec"><h4>位置</h4>
        ${slider('水平', 'x', c.x, 0, 100, 0.5, (v) => `${v}%`)}
        ${slider('垂直', 'y', c.y, 0, 100, 0.5, (v) => `${v}%`)}
        <div class="seg full" id="posQuick"><button data-y="12">靠上</button><button data-y="50">居中</button><button data-y="86">靠下</button></div>
      </div>${timing}`;
    }
    const isImg = m?.kind === 'image';
    const speed = !isImg
      ? `<div class="ins-sec"><h4>变速</h4>${slider('速度', 'speed', c.speed, 0.25, 4, 0.05, (v) => `${(+v).toFixed(2)}x`)}
         <div class="chips">${[0.5, 1, 1.5, 2, 3].map((s) => `<button class="chip ${c.speed === s ? 'on' : ''}" data-speed="${s}">${s}x</button>`).join('')}</div></div>`
      : '';
    const audio = m?.hasAudio
      ? `<div class="ins-sec"><h4>声音</h4>
          ${slider('音量', 'volume', c.volume, 0, 2, 0.05, pct)}
          <div class="ins-row"><label>静音</label><label class="switch"><input type="checkbox" data-check="muted" ${c.muted ? 'checked' : ''} /></label>${c.volume > 1 ? '<span class="hint">预览最大 100%，导出会放大</span>' : ''}</div>
          ${c.track === 'a' ? `${slider('淡入', 'fadeIn', c.fadeIn || 0, 0, Math.max(0.1, c.dur / 2), 0.1, sec)}${slider('淡出', 'fadeOut', c.fadeOut || 0, 0, Math.max(0.1, c.dur / 2), 0.1, sec)}` : ''}</div>`
      : '';
    const visual =
      c.track === 'v'
        ? `<div class="ins-sec"><h4>画面</h4>
          ${slider('缩放', 'scale', c.scale, 0.1, 3, 0.01, pct)}
          ${slider('水平位移', 'x', c.x, -100, 100, 1, (v) => `${v}%`)}
          ${slider('垂直位移', 'y', c.y, -100, 100, 1, (v) => `${v}%`)}</div>
          <div class="ins-sec"><h4>调色 <button class="link" data-reset-color>重置</button></h4>
          ${slider('亮度', 'brightness', c.brightness, -0.5, 0.5, 0.01, (v) => `${Math.round(v * 100)}`)}
          ${slider('对比度', 'contrast', c.contrast, 0.5, 1.8, 0.01, pct)}
          ${slider('饱和度', 'saturation', c.saturation, 0, 2.5, 0.01, pct)}</div>`
        : '';
    return `${head}${visual}${speed}${audio}${timing}`;
  }

  function paintInsp() {
    el.insp.innerHTML = inspHtml();
  }

  /** 把属性改动应用到选中片段 */
  function applyProp(prop, raw) {
    const c = selClip();
    if (!c) return;
    beginEdit();
    const numeric = ['size', 'x', 'y', 'speed', 'volume', 'fadeIn', 'fadeOut', 'scale', 'brightness', 'contrast', 'saturation'];
    const v = numeric.includes(prop) ? Number(raw) : raw;
    if (prop === 'speed') clips = M.setSpeed(clips, c.id, v, mediaLookup);
    else clips = M.updateClip(clips, c.id, { [prop]: v });
    changed({ keepInsp: true });
    syncInsp(prop);
  }

  /** 拖滑块时只刷新读数，不重建面板（否则会打断拖动） */
  function syncInsp(changedProp) {
    const c = selClip();
    if (!c) return;
    const set = (p, text) => {
      const o = $(`[data-out="${p}"]`, el.insp);
      if (o) o.textContent = text;
    };
    const fmts = {
      size: (v) => `${v}`,
      x: (v) => (c.track === 't' ? `${v}%` : `${v}%`),
      y: (v) => `${v}%`,
      speed: (v) => `${(+v).toFixed(2)}x`,
      volume: pct,
      fadeIn: sec,
      fadeOut: sec,
      scale: pct,
      brightness: (v) => `${Math.round(v * 100)}`,
      contrast: pct,
      saturation: pct,
    };
    for (const [p, f] of Object.entries(fmts)) if (p in c) set(p, f(c[p]));
    const durIn = $('[data-num="dur"]', el.insp);
    if (durIn && document.activeElement !== durIn) durIn.value = c.dur;
    const stIn = $('[data-num="start"]', el.insp);
    if (stIn && document.activeElement !== stIn) stIn.value = c.start;
    if (changedProp === 'speed') $$('[data-speed]', el.insp).forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === c.speed));
  }

  el.insp.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.prop) applyProp(t.dataset.prop, t.value);
  });
  el.insp.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.type === 'range') endEdit();
    if (['range', 'color', 'checkbox'].includes(t.type)) setTimeout(() => t.blur(), 0); // 别让它吞掉空格 / 方向键等快捷键
    if (t.dataset.check) {
      const c = selClip();
      if (!c) return;
      if (t.dataset.check === 'bgOn') {
        commit(M.updateClip(clips, c.id, { bg: t.checked ? '#000000' : '' }));
      } else {
        commit(M.updateClip(clips, c.id, { [t.dataset.check]: t.checked }), { keepInsp: true });
      }
    } else if (t.dataset.num) {
      const c = selClip();
      if (!c) return;
      const v = Math.max(t.dataset.num === 'dur' ? 0.1 : 0, Number(t.value) || 0);
      if (t.dataset.num === 'dur') commit(M.trimClip(clips, c.id, 'r', c.start + v, mediaLookup), { keepInsp: true });
      else commit(M.moveClip(clips, c.id, v), { keepInsp: true });
      syncInsp();
    }
  });
  el.insp.addEventListener('click', (ev) => {
    const c = selClip();
    const r = ev.target.closest('#inspRatio [data-r]');
    if (r) return setRatio(r.dataset.r);
    if (!c) return;
    const sw = ev.target.closest('[data-swatch]');
    if (sw) {
      commit(M.updateClip(clips, c.id, { color: sw.dataset.swatch }));
      return;
    }
    const sp = ev.target.closest('[data-speed]');
    if (sp) {
      commit(M.setSpeed(clips, c.id, Number(sp.dataset.speed), mediaLookup), { keepInsp: true });
      const s = $('[data-prop="speed"]', el.insp);
      if (s) s.value = String(sp.dataset.speed);
      syncInsp('speed');
      return;
    }
    const pq = ev.target.closest('#posQuick [data-y]');
    if (pq) {
      commit(M.updateClip(clips, c.id, { y: Number(pq.dataset.y), x: 50 }));
      return;
    }
    if (ev.target.closest('[data-reset-color]')) commit(M.updateClip(clips, c.id, { brightness: 0, contrast: 1, saturation: 1 }));
  });

  /* ---------------- 素材库 ---------------- */
  let aiProjects = null;
  const mediaItem = (m) => {
    const thumb = m.thumb ? `<img src="${filesBase}${m.thumb}" alt="" loading="lazy" />` : m.wave ? `<div class="lib-wave" style="background-image:url(${filesBase}${m.wave})"></div>` : `<span class="lib-ic">${icon(kindIcon[m.kind])}</span>`;
    return `<div class="lib-item" draggable="true" data-id="${m.id}" title="${esc(m.name)}">
      <div class="lib-thumb ${m.kind}">${thumb}
        <span class="lib-kind">${icon(kindIcon[m.kind])}</span>
        ${m.kind === 'image' ? '' : `<span class="lib-dur">${fmtDur(m.duration)}</span>`}
        <button class="lib-add" data-add title="添加到时间线">${icon('plus')}</button>
        <button class="lib-del" data-del title="删除素材">${icon('trash')}</button>
      </div>
      <div class="lib-name">${esc(m.name)}</div>
    </div>`;
  };

  function paintLib() {
    if (tab === 'media') {
      const list = [...media.values()];
      el.libBody.innerHTML = `
        <label class="lib-drop" id="libDrop">${icon('upload')}<b>导入素材</b><span>视频 / 音频 / 图片，可拖进来</span>
          <input type="file" id="libFile" multiple accept="video/*,audio/*,image/*,.mkv,.flv,.wmv,.ts,.m4a,.flac,.opus,.wma" hidden /></label>
        <div class="lib-uploads" id="libUploads"></div>
        ${list.length ? `<div class="lib-grid">${list.map(mediaItem).join('')}</div>` : '<p class="hint lib-empty">还没有素材。导入后拖到下面的时间线，或点素材上的＋。</p>'}`;
    } else if (tab === 'text') {
      el.libBody.innerHTML = `<p class="hint">点击会在播放头位置添加一段文字，可在右侧调整样式，也能在预览里直接拖动。</p>
        <div class="lib-text">${TEXT_PRESETS.map((p, i) => `<button class="lib-preset" data-preset="${i}"><b>${esc(p.name)}</b><span>${esc(p.hint)}</span></button>`).join('')}</div>`;
    } else {
      if (aiProjects === null) {
        el.libBody.innerHTML = '<p class="hint">读取中…</p>';
        api('/api/projects')
          .then((l) => (aiProjects = l.filter((p) => p.status === 'done')))
          .catch(() => (aiProjects = []))
          .then(() => alive && tab === 'ai' && paintLib());
        return;
      }
      el.libBody.innerHTML = aiProjects.length
        ? `<p class="hint">把「创作」里生成好的 AI 视频导入，继续剪辑。</p><div class="lib-grid">${aiProjects
            .map(
              (p) => `<div class="lib-item" data-ai="${p.id}"><div class="lib-thumb video">${p.cover ? `<img src="${p.cover}" alt="" loading="lazy" />` : `<span class="lib-ic">${icon('film')}</span>`}<span class="lib-dur">${fmtDur(p.duration)}</span><button class="lib-add" data-ai-add title="导入并加入时间线">${icon('plus')}</button></div><div class="lib-name">${esc(p.title)}</div></div>`,
            )
            .join('')}</div>`
        : '<p class="hint lib-empty">还没有已完成的 AI 视频。先到「创作」生成一个。</p>';
    }
    paintIcons(el.libBody);
  }

  $('#libTabs', root).addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    $$('#libTabs button', root).forEach((x) => x.classList.toggle('on', x === b));
    paintLib();
  });

  el.libBody.addEventListener('click', async (ev) => {
    const preset = ev.target.closest('[data-preset]');
    if (preset) return addText(TEXT_PRESETS[Number(preset.dataset.preset)].patch);
    const add = ev.target.closest('[data-add]');
    if (add) return addMediaToTimeline(media.get(add.closest('.lib-item').dataset.id));
    const del = ev.target.closest('[data-del]');
    if (del) {
      const m = media.get(del.closest('.lib-item').dataset.id);
      const used = clips.filter((c) => c.mediaId === m.id).length;
      if (!(await confirmDlg({ title: '删除素材？', body: `「${m.name}」会被删除${used ? `，时间线上用到它的 ${used} 个片段也会一起删除` : ''}。`, okText: '删除', danger: true }))) return;
      try {
        endEdit();
        hist.push(snapshot());
        const r = await api(`/api/edits/${id}/media/${m.id}`, { method: 'DELETE' });
        media.delete(m.id);
        clips = r.clips;
        changed();
        paintLib();
      } catch (err) {
        toast(err.message, 'err');
      }
      return;
    }
    const aiAdd = ev.target.closest('[data-ai-add]');
    if (aiAdd) {
      const pid = aiAdd.closest('[data-ai]').dataset.ai;
      aiAdd.disabled = true;
      try {
        const m = await api(`/api/edits/${id}/media/from-project`, { method: 'POST', body: { projectId: pid } });
        media.set(m.id, m);
        toast('已导入，加到时间线了', 'ok');
        addMediaToTimeline(m);
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        aiAdd.disabled = false;
      }
    }
  });

  el.libBody.addEventListener('change', (ev) => {
    if (ev.target.id === 'libFile') {
      uploadFiles([...ev.target.files]);
      ev.target.value = '';
    }
  });
  el.libBody.addEventListener('dragstart', (ev) => {
    const it = ev.target.closest('.lib-item[data-id]');
    if (!it) return;
    ev.dataTransfer.setData('text/wm-media', it.dataset.id);
    ev.dataTransfer.effectAllowed = 'copy';
  });
  const lib = $('#ctLib', root);
  lib.addEventListener('dragover', (ev) => {
    if (ev.dataTransfer.types.includes('Files')) {
      ev.preventDefault();
      lib.classList.add('over');
    }
  });
  lib.addEventListener('dragleave', (ev) => ev.target === lib && lib.classList.remove('over'));
  lib.addEventListener('drop', (ev) => {
    if (!ev.dataTransfer.files?.length) return;
    ev.preventDefault();
    lib.classList.remove('over');
    if (tab !== 'media') {
      tab = 'media';
      $$('#libTabs button', root).forEach((x) => x.classList.toggle('on', x.dataset.tab === 'media'));
      paintLib();
    }
    uploadFiles([...ev.dataTransfer.files]);
  });

  /** 用 XHR 上传，才有进度；一次一个，服务端按顺序处理 */
  function uploadOne(file, bar) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/edits/${id}/media?name=${encodeURIComponent(file.name)}`);
      xhr.upload.onprogress = (p) => {
        if (p.lengthComputable) {
          bar.style.width = `${Math.round((p.loaded / p.total) * 100)}%`;
          if (p.loaded >= p.total) bar.parentElement.nextElementSibling.textContent = '处理中…';
        }
      };
      xhr.onload = () => {
        let json = {};
        try {
          json = JSON.parse(xhr.responseText);
        } catch {
          /* 非 JSON */
        }
        xhr.status >= 200 && xhr.status < 300 ? resolve(json) : reject(new Error(json.error || `上传失败（HTTP ${xhr.status}）`));
      };
      xhr.onerror = () => reject(new Error('网络错误，上传中断'));
      xhr.send(file);
    });
  }

  async function uploadFiles(files) {
    if (!files.length) return;
    const box = $('#libUploads', root);
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'lib-up';
      row.innerHTML = `<div class="lib-up-name">${esc(file.name)}</div><div class="lib-up-bar"><i></i></div><div class="lib-up-st">上传中…</div>`;
      box?.appendChild(row);
      uploads++;
      try {
        const m = await uploadOne(file, row.querySelector('i'));
        media.set(m.id, m);
        row.remove();
      } catch (err) {
        row.querySelector('.lib-up-st').textContent = err.message;
        row.classList.add('err');
        toast(`${file.name}：${err.message}`, 'err');
        setTimeout(() => row.remove(), 6000);
      } finally {
        uploads--;
      }
      if (alive && tab === 'media' && !uploads) paintLib();
    }
  }

  /* ---------------- 导出 ---------------- */
  const paintExportBtn = (st) => {
    const running = st?.status === 'running';
    el.exp.disabled = false;
    el.exp.querySelector('span').textContent = running ? `导出中 ${Math.round((st.progress || 0) * 100)}%` : '导出';
    el.exp.classList.toggle('busy', running);
  };

  async function pollExport(dlgUpdate) {
    clearInterval(exportPoll);
    const tick = async () => {
      if (!alive) return clearInterval(exportPoll);
      try {
        const cur = await api(`/api/edits/${id}`);
        e.export = cur.export;
        paintExportBtn(cur.export);
        dlgUpdate?.(cur.export);
        if (cur.export?.status !== 'running') {
          clearInterval(exportPoll);
          if (cur.export?.status === 'done') dirtyExport = false;
        }
      } catch {
        /* 下次再试 */
      }
    };
    exportPoll = setInterval(tick, 800);
    tick();
  }

  async function openExport() {
    await save.flush();
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg wide export-dlg';
    document.body.appendChild(dlg);
    const paint = (st) => {
      if (!st) return;
      if (st.status === 'running') {
        dlg.innerHTML = `<div class="dlg-body"><h3>正在导出…</h3>
          <div class="exp-bar"><i style="width:${Math.round((st.progress || 0) * 100)}%"></i></div>
          <p class="hint">${esc(st.stage || '')} · ${Math.round((st.progress || 0) * 100)}%。可以关闭这个窗口，导出会在后台继续。</p></div>
          <div class="dlg-foot"><button class="btn ghost" data-close>关闭</button></div>`;
      } else if (st.status === 'done') {
        dlg.innerHTML = `<div class="dlg-body"><h3>导出完成</h3>
          ${st.warning ? `<div class="notice warn"><span>${esc(st.warning)}</span></div>` : ''}
          <video class="exp-video" controls src="${filesBase}${st.file}?v=${st.finishedAt || ''}"></video>
          <p class="hint">${esc(name)}.mp4 · ${fmtDur(st.duration)}</p></div>
          <div class="dlg-foot"><button class="btn ghost" data-close>关闭</button>${dirtyExport ? '<button class="btn" data-again>重新导出</button>' : ''}<a class="btn primary" href="/api/edits/${id}/download" download>${icon('download')}下载 mp4</a></div>`;
      } else if (st.status === 'error') {
        dlg.innerHTML = `<div class="dlg-body"><h3>导出失败</h3><div class="notice err"><span style="white-space:pre-line">${esc(st.error || '未知错误')}</span></div></div>
          <div class="dlg-foot"><button class="btn ghost" data-close>关闭</button><button class="btn primary" data-again>重试</button></div>`;
      }
      paintIcons(dlg);
    };
    const begin = async () => {
      try {
        const cur = await api(`/api/edits/${id}/export`, { method: 'POST' });
        e.export = cur.export;
        paint(cur.export);
        paintExportBtn(cur.export);
        pollExport(paint);
      } catch (err) {
        toast(err.message, 'err');
        dlg.close();
      }
    };
    dlg.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-close]')) dlg.close();
      if (ev.target.closest('[data-again]')) begin();
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    const st = e.export;
    if (st?.status === 'running') {
      paint(st);
      pollExport(paint);
    } else if (st?.status === 'done' && !dirtyExport) {
      paint(st);
      pollExport(paint);
      clearInterval(exportPoll);
    } else {
      await begin();
    }
  }
  el.exp.addEventListener('click', () => {
    if (!M.totalDuration(clips)) return toast('时间线是空的，先把素材拖到时间线上', 'err');
    openExport();
  });

  /* ---------------- 初始化 ---------------- */
  px = 80;
  paintLib();
  paintInsp();
  paintHistory();
  paintToolbar();
  renderTimeline();
  el.total.textContent = fmtT(M.totalDuration(clips));
  if (clips.length) fit();
  paintExportBtn(e.export);
  if (e.export?.status === 'running') pollExport();
  player.render();

  // 暴露给自测用
  root.__cutter = { player, get clips() { return clips; }, get sel() { return sel; } };

  return {
    async unmount() {
      alive = false;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      clearInterval(exportPoll);
      clearTimeout(editTimer);
      ro.disconnect();
      player.destroy();
      document.querySelectorAll('dialog.export-dlg').forEach((d) => d.remove());
      save.cancel();
      if (!unsaved) return;
      try {
        await api(`/api/edits/${id}`, { method: 'PUT', body: { name, ratio, clips } });
      } catch {
        /* 页面已离开，忽略 */
      }
    },
  };
}
