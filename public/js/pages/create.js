import { featuredCardsHtml, hotGroupsHtml, fmtPlay, handleCoverErrors, openFeatured, playInCard, playHotInCard, stopInCard, PLATFORMS } from '../featured.js';
import { estimate, estimateHtml } from '../pricing.js';
import { $, $$, api, esc, state, toast, icon, paintIcons, tplOf, tplColor, VISUAL, mockParts, voiceChoices, previewVoice, previewBtnHtml } from '../core.js';

let tplId = 'poem';
let form = null;
let busy = false;
let exts = { skills: [], mcp: [] };
let featPlatform = '全部';
let featTab = 'hot'; // hot = B 站热门动画；demo = 做同款示范
const hotCache = new Map(); // 模板 id -> /api/discover 结果（页面会话内缓存，服务端另有 30 分钟缓存）
let drafting = false; // 正在让 AI 写文案
let featAll = false; // false = 只看当前模板的同类精选；true = 所有模板

/** 当前模板可用的技能（已启用 + 适用于该模板） */
const applicableSkills = (id) => exts.skills.filter((s) => s.enabled && (!s.templates.length || s.templates.includes(id)));
const toolServers = () => exts.mcp.filter((s) => s.enabled);

function resetForm(id) {
  const t = tplOf(id);
  tplId = t.id;
  form = {
    skills: null, // null = 还没动过，默认勾选所有适用的技能
    useTools: false,
    title: '',
    author: '',
    script: '',
    style: t.defaults.style,
    orientation: t.defaults.orientation,
    voice: t.defaults.voice || '',
    visual: state.settings.render.visual,
    subtitles: t.defaults.subtitles,
    titleCard: t.defaults.titleCard,
    endCard: t.defaults.endCard,
  };
}

const VISUAL_COST = { image: '费用最低', i2v: '效果最好 · 按秒计费', video: '按秒计费' };

// 每个主题的问候语：[标题, 副标题]
const THEME_COPY = {
  poem: ['想为哪一首诗，配一幅画？', '挑一首喜欢的古诗，慢慢读，画面和朗读交给 AI'],
  story: ['今天，讲个什么故事呢？', '写一个暖暖的小故事，让画笔和声音陪它慢慢展开'],
  explainer: ['想把什么道理，讲清楚？', '一个知识点，一组清楚的画面，几分钟就能看明白'],
  talk: ['开口就是重点，说点什么？', '观点先行、节奏干脆，配上字幕，竖屏直接发'],
  heal: ['今天，也辛苦啦', '写下一句温柔的话，让它在柔柔的画面里陪你和别人'],
  free: ['想做一支什么视频？', '想到什么就写什么，分镜、画面、配音、字幕、成片交给 AI'],
};

// clone=true：轮播首尾相接用的副本（不参与读屏 / Tab）
function templatesHtml(clone = false) {
  return state.meta.templates
    .map(
      (t) => `<button type="button" class="tpl${t.id === tplId ? ' on' : ''}${clone ? ' clone' : ''}" data-tpl="${t.id}" style="--g:${tplColor(t)};--h:${t.hue}"${clone ? ' tabindex="-1" aria-hidden="true"' : ''}>
        <span class="tpl-glyph">${esc(t.glyph)}</span>
        <span class="tpl-tag">已选</span>
        <span class="tpl-info"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></span>
      </button>`,
    )
    .join('');
}

// 画风下拉：适合当前模板的排在最前（带「推荐」），其余画风放在「更多画风」，手改过的画风显示为「自定义」
function styleSelectHtml(t) {
  const all = state.meta.stylePresets;
  const rec = (t.styles || []).map((n) => all.find((s) => s.name === n)).filter(Boolean);
  const more = all.filter((s) => !rec.includes(s));
  const cur = all.find((s) => s.value === form.style);
  const opt = (s, tag = '') => `<option value="${esc(s.value)}" ${cur === s ? 'selected' : ''}>${esc(s.name)}${tag}</option>`;
  return `<select data-style-sel>
    ${cur ? '' : '<option value="__custom" selected>自定义（在下方文本框里改）</option>'}
    ${rec.length ? `<optgroup label="适合「${esc(t.name)}」">${rec.map((s, i) => opt(s, i === 0 ? ' · 默认推荐' : ' · 推荐')).join('')}</optgroup>` : ''}
    <optgroup label="${rec.length ? '更多画风' : '全部画风'}">${more.map((s) => opt(s)).join('')}</optgroup>
  </select>`;
}

function composerHtml() {
  const t = tplOf(tplId);
  const voices = voiceChoices();
  const voiceSel = voices
    ? `<select data-k="voice"><option value="">默认音色（设置里的音色）</option>${voices
        .map((v) => `<option value="${esc(v.id)}" ${v.id === form.voice ? 'selected' : ''}>${esc(v.name)}</option>`)
        .join('')}</select>`
    : `<select disabled><option>当前配音服务使用设置里的音色</option></select>`;
  const mocks = mockParts(state.settings, form.visual);
  const sk = applicableSkills(tplId);
  if (form.skills === null) form.skills = sk.map((s) => s.id);
  form.skills = form.skills.filter((id) => sk.some((s) => s.id === id));
  const servers = toolServers();
  const llmOn = state.settings.llm.enabled && state.settings.llm.apiKey;
  const extHtml =
    sk.length || servers.length
      ? `<div class="field"><span class="lbl">扩展 <a href="#/settings/skills" class="hint" style="text-decoration:underline">管理</a></span>
          ${sk.length ? `<div class="chips">${sk.map((s) => `<button class="chip ${form.skills.includes(s.id) ? 'on' : ''}" data-skill="${s.id}" title="${esc(s.description || '')}">${esc(s.name)}</button>`).join('')}</div>` : ''}
          ${servers.length ? `<label class="switch" style="margin-top:6px"><input type="checkbox" data-k="useTools" ${form.useTools ? 'checked' : ''} />工具增强：分镜前用 MCP 工具检索资料（${servers.length} 个服务）</label>` : ''}
          ${llmOn ? '' : '<span class="opt-note">技能和工具增强需要先在设置里启用「分镜 LLM」才会生效。</span>'}
        </div>`
      : `<div class="field"><span class="lbl">扩展</span><span class="opt-note">还没有技能或 MCP 服务。<a href="#/settings/skills" style="text-decoration:underline">去导入</a>后，可以在这里勾选使用。</span></div>`;
  return `
  <div class="card composer">
    <div class="col">
      ${
        form.ref
          ? `<div class="ref-banner"><span>参考视频：<b>${esc(form.ref.title)}</b> · ▶ ${fmtPlay(form.ref.play)}</span>
              <span class="ref-sp">${
                llmOn
                  ? `<button type="button" class="btn sm" data-ai-draft ${drafting ? 'disabled' : ''}>${drafting ? '<i class="spin"></i> 正在写…' : 'AI 按此题材写一版文案（约 0.01 元）'}</button>`
                  : '<span class="hint">启用「分镜 LLM」后，可一键让 AI 按这个题材写文案</span>'
              }<button type="button" class="icon-btn" data-ref-clear title="移除参考" aria-label="移除参考">✕</button></span></div>`
          : ''
      }
      <div class="row-head" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <h3>${esc(t.name)} · 写下内容</h3>
        ${
          t.samples.length
            ? `<div class="chips"><span class="hint" style="align-self:center">试一试</span>${t.samples
                .map((s, i) => `<button class="chip" data-sample="${i}">${esc(s.name)}</button>`)
                .join('')}</div>`
            : ''
        }
      </div>
      <div class="${t.authorLabel ? 'row2' : ''}">
        <div class="field"><label>${esc(t.titleLabel)}</label><input data-k="title" value="${esc(form.title)}" placeholder="${esc(t.titlePlaceholder)}" /></div>
        ${t.authorLabel ? `<div class="field"><label>${esc(t.authorLabel)}</label><input data-k="author" value="${esc(form.author)}" placeholder="${esc(t.authorPlaceholder || '')}" /></div>` : ''}
      </div>
      <div class="field">
        <label>${esc(t.scriptLabel)}</label>
        <textarea data-k="script" rows="9" placeholder="${esc(t.scriptPlaceholder)}">${esc(form.script)}</textarea>
        <span class="hint" id="scriptCount"></span>
      </div>
    </div>
    <div class="col">
      <h3>视频设置</h3>
      <div class="field"><span class="lbl">画幅</span>
        <div class="seg full" data-seg="orientation">
          <button data-v="landscape" class="${form.orientation === 'landscape' ? 'on' : ''}">横屏 16:9</button>
          <button data-v="portrait" class="${form.orientation === 'portrait' ? 'on' : ''}">竖屏 9:16</button>
        </div>
      </div>
      <div class="field"><span class="lbl">画面方式</span>
        <div class="seg full" data-seg="visual">
          ${Object.entries(VISUAL)
            .map(([k, v]) => `<button data-v="${k}" class="${form.visual === k ? 'on' : ''}">${v.name}</button>`)
            .join('')}
        </div>
        <span class="opt-note">${VISUAL[form.visual].desc}</span>
      </div>
      <div class="field"><span class="lbl">画风</span>
        ${styleSelectHtml(t)}
        <textarea data-k="style" rows="2" style="min-height:52px">${esc(form.style)}</textarea>
      </div>
      <div class="field"><span class="lbl">配音</span><div class="voice-row">${voiceSel}${previewBtnHtml()}</div></div>
      ${extHtml}
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <label class="switch"><input type="checkbox" data-k="subtitles" ${form.subtitles ? 'checked' : ''} />字幕</label>
        <label class="switch"><input type="checkbox" data-k="titleCard" ${form.titleCard ? 'checked' : ''} />片头标题</label>
        <label class="switch"><input type="checkbox" data-k="endCard" ${form.endCard ? 'checked' : ''} />片尾</label>
      </div>
    </div>
    <div class="composer-foot" style="grid-column:1 / -1">
      <div class="est-row" id="estRow" title="估算口径：镜头数按拆分规则、旁白约 4 字/秒；价格取自各平台官网价格页（见 设置 → 费用一览）"></div>
      <button class="btn primary lg" id="btnCreate">${busy ? '<i class="spin"></i> 正在拆分镜头…' : `${'<span class="ic" data-ic="sparkle" style="font-size:18px"></span>'}生成分镜并创建项目`}</button>
      <span class="hint">创建项目只做文案拆解，不生成画面、不产生视频费用；在编辑器里确认后再点「生成视频」。</span>
      ${mocks.length ? `<span class="badge warn" title="这些能力还没配置真实模型，会生成占位内容">未配置：${mocks.join('、')}（<a href="#/settings" style="text-decoration:underline">去设置</a>）</span>` : ''}
    </div>
  </div>`;
}

export async function mount(root) {
  if (!form) resetForm(tplId);
  exts = await api('/api/extensions').catch(() => exts);
  const featured = state.meta.featured || [];

  root.innerHTML = `<div class="page">
    <div class="hero"><h1 id="heroTitle"></h1><p id="heroSub"></p></div>
    <div class="tpl-rail" id="tplRail">
      <button class="tpl-nav prev" type="button" data-nav="-1" aria-label="向左滚动" hidden>${icon('back')}</button>
      <div class="tpl-grid" id="tpls"></div>
      <button class="tpl-nav next" type="button" data-nav="1" aria-label="向右滚动" hidden>${icon('back')}</button>
    </div>
    <div id="composer"></div>
    <div id="featured"></div>
  </div>`;

  const tplsEl = $('#tpls', root);
  const featEl = $('#featured', root);
  const compEl = $('#composer', root);
  const rail = $('#tplRail', root);
  // ---- 模板轮播：自动向左缓慢滚动、首尾相接；鼠标悬停 / 拖动 / 触摸 / 滚轮时暂停 ----
  const SPEED = 30; // px/s
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let period = 0; // 一整套模板的宽度，滚动位置落在 [1, period+1) 内循环
  let pos = 0; // 自动滚动用小数位置（scrollLeft 在低分屏上会取整，慢速时会原地不动）
  let lastSet = 0;
  let hovering = false;
  let pauseUntil = 0;
  const setLeft = (v) => {
    pos = v;
    lastSet = tplsEl.scrollLeft = v;
  };
  const wrapPos = () => {
    if (!period) return;
    const sl = tplsEl.scrollLeft;
    if (sl >= period + 1) setLeft(sl - period);
    else if (sl < 1) setLeft(sl + period);
  };
  const buildLoop = () => {
    const x = tplsEl.scrollLeft; // 重绘不要把滚动位置弄丢
    tplsEl.innerHTML = templatesHtml();
    const cards = tplsEl.children;
    const n = cards.length;
    const gap = parseFloat(getComputedStyle(tplsEl).columnGap) || 16;
    const set = n ? cards[n - 1].offsetLeft + cards[n - 1].offsetWidth - cards[0].offsetLeft + gap : 0;
    period = tplsEl.clientWidth && set ? set : 0;
    if (period) {
      const k = Math.ceil(tplsEl.clientWidth / period) + 2;
      tplsEl.innerHTML = Array.from({ length: k }, (_, i) => templatesHtml(i > 0)).join('');
      setLeft(Math.min(Math.max(x, 1), period));
    }
    tplsEl.classList.toggle('loop', !!period);
    $$('.tpl-nav', rail).forEach((b) => (b.hidden = !period));
    rail.classList.toggle('can-l', !!period);
    rail.classList.toggle('can-r', !!period);
  };
  // 选哪个模板，整页换成对应的配色、背景装饰和问候语（样式见 style.css 的 body[data-theme]）
  let shownTheme = null;
  const applyTheme = () => {
    const c = THEME_COPY[tplId] || THEME_COPY.free;
    document.body.dataset.theme = tplId;
    document.body.style.setProperty('--wm', JSON.stringify(tplOf(tplId).glyph));
    $('#heroTitle', root).textContent = c[0];
    $('#heroSub', root).textContent = c[1];
    const page = $('.page', root);
    if (shownTheme && shownTheme !== tplId) {
      page.classList.remove('theme-swap');
      void page.offsetWidth; // 重新触发入场动画
      page.classList.add('theme-swap');
    }
    shownTheme = tplId;
  };
  const paintTpls = () => {
    applyTheme();
    buildLoop();
    requestAnimationFrame(() => !period && buildLoop()); // 首次绘制时容器可能还没挂进页面，下一帧再量一次
  };
  let railW = 0;
  new ResizeObserver(() => {
    if (tplsEl.clientWidth !== railW) {
      railW = tplsEl.clientWidth;
      buildLoop();
    }
  }).observe(tplsEl);
  tplsEl.addEventListener(
    'scroll',
    () => {
      if (Math.abs(tplsEl.scrollLeft - lastSet) > 1.5) pos = tplsEl.scrollLeft; // 用户自己滚的，同步位置
      wrapPos();
    },
    { passive: true },
  );
  rail.addEventListener('mouseenter', () => (hovering = true));
  rail.addEventListener('mouseleave', () => (hovering = false));
  rail.addEventListener('wheel', () => (pauseUntil = performance.now() + 2000), { passive: true });
  rail.addEventListener('touchstart', () => (pauseUntil = performance.now() + 1e9), { passive: true });
  rail.addEventListener('touchend', () => (pauseUntil = performance.now() + 2500), { passive: true });
  rail.addEventListener('focusin', () => (pauseUntil = performance.now() + 4000));
  let seen = false;
  let lastT = 0;
  const tick = (now) => {
    if (rail.isConnected) seen = true;
    else if (seen) return; // 离开创作页后停止
    requestAnimationFrame(tick);
    const dt = Math.min(now - lastT, 64);
    lastT = now;
    if (!period || reduceMotion || hovering || drag || document.hidden || now < pauseUntil) return;
    pos += (SPEED * dt) / 1000;
    if (pos >= period + 1) pos -= period;
    setLeft(pos);
  };
  requestAnimationFrame(tick);
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('.tpl-nav');
    if (!b || !period) return;
    const d = Number(b.dataset.nav) * Math.max(240, tplsEl.clientWidth * 0.7);
    const sl = tplsEl.scrollLeft; // 目标落在循环区外时先无感地挪一套，再平滑滚动
    if (sl + d >= period + 1) setLeft(sl - period);
    else if (sl + d < 1) setLeft(sl + period);
    tplsEl.scrollBy({ left: d, behavior: 'smooth' });
  });  // 鼠标按住拖动滚动（触屏 / 触控板本来就能滚）；拖动后不当成点击
  let drag = null;
  tplsEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, left: tplsEl.scrollLeft, moved: false };
  });
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true;
    tplsEl.classList.add('dragging');
    tplsEl.scrollLeft = drag.left - dx;
  };
  const onUp = () => {
    if (drag?.moved) setTimeout(() => (drag = null), 0);
    else drag = null;
    tplsEl.classList.remove('dragging');
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  tplsEl.addEventListener('click', (e) => {
    if (drag?.moved) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
  const paintComposer = () => {
    compEl.innerHTML = composerHtml();
    paintIcons(compEl);
    updateCount();
  };
  const updateCount = () => {
    const el = $('#scriptCount', compEl);
    if (el) el.textContent = form.script.trim() ? `${form.script.replace(/\s/g, '').length} 字` : '';
    const row = $('#estRow', compEl);
    if (row) {
      row.innerHTML = estimateHtml(
        estimate({ settings: state.settings, split: tplOf(tplId).split, script: form.script, visual: form.visual, titleCard: form.titleCard, endCard: form.endCard }),
        esc,
      );
    }
  };
  paintTpls();
  paintComposer();

  // ---- 创作精选 ----
  // 精选随当前模板联动：选「古诗词动画」就只推荐诗词类；「自由创作」不限题材，展示全部
  // 两个页签：「热门动画」= B 站同主题视频按播放量排序、可原地播放；「做同款示范」= 我们的示范模板
  let hotList = [];
  let hotSeq = 0;
  const paintHot = async () => {
    const grid = $('#featGrid', featEl);
    const note = $('#hotNote', featEl);
    const id = tplId;
    const seq = ++hotSeq;
    let data = hotCache.get(id);
    if (!data) {
      grid.innerHTML = `<div class="empty hot-loading"><i class="spin"></i><b>正在获取热门视频…</b></div>`;
      try {
        data = await api(`/api/discover?template=${encodeURIComponent(id)}`);
        hotCache.set(id, data);
      } catch (err) {
        if (seq !== hotSeq) return;
        hotList = [];
        grid.innerHTML = `<div class="empty"><b>暂时拿不到热门视频</b><p>${esc(err.message)}</p><button class="btn ghost sm" data-hot-retry>重试</button></div>`;
        return;
      }
    }
    if (seq !== hotSeq || tplId !== id) return; // 等待期间用户已经换了模板
    hotList = data.items;
    grid.className = 'hot-groups';
    grid.innerHTML = hotGroupsHtml(hotList);
    if (note && data.stale) {
      // 只在拿不到实时数据时提示，平时不展示任何说明文字
      note.textContent = `B 站暂时限制了访问，当前是 ${new Date(data.fetchedAt).toLocaleDateString('zh-CN')} 的数据快照`;
    }
  };
  const paintFeatured = () => {
    if (!featEl) return;
    hotSeq++;
    const t = tplOf(tplId);
    const hot = featTab === 'hot';
    const scoped = tplId !== 'free' && !featAll;
    const list = featured.filter((f) => (!scoped || f.template === tplId) && (featPlatform === '全部' || f.platform === featPlatform));
    featEl.innerHTML = `<div class="section-title feat-head">
        <div><h2>创作精选${tplId !== 'free' && (hot || scoped) ? ` · ${esc(t.name)}` : ''}</h2><span class="sub" id="hotNote"></span></div>
        <div class="chips" id="featFilter">
          <button class="chip ${hot ? 'on' : ''}" data-tab="hot">热门动画</button>
          <button class="chip ${hot ? '' : 'on'}" data-tab="demo">做同款示范</button>${
            hot
              ? ''
              : `<span class="chip-sep"></span>${PLATFORMS.map((p) => `<button class="chip ${p === featPlatform ? 'on' : ''}" data-plat="${p}"${p === '全部' ? '' : ' title="按该平台常见的内容形态写的示范，不是平台原视频，没有播放量数据"'}>${p}</button>`).join('')}${
                  tplId === 'free' ? '' : `<span class="chip-sep"></span><button class="chip ${featAll ? 'on' : ''}" data-scope>看全部模板</button>`
                }`
          }</div>
      </div>
      <div class="feat-grid" id="featGrid">${hot ? '' : featuredCardsHtml(list)}</div>`;
    if (hot) paintHot();
  };
  const useFeatured = (item) => {
    resetForm(item.template);
    Object.assign(form, { title: item.title, author: item.author || '', script: item.script, style: item.style, orientation: item.orientation });
    paintTpls();
    paintFeatured();
    paintComposer();
    compEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`已套用「${item.title}」，可以直接改文案，再点「生成分镜并创建项目」`, 'ok');
  };
  // 热门视频「做同款」：以它的题材为参考；标题填进表单（诗词模板的标题是诗名，不填），
  // 文案可以自己写，也可以让 AI 按这个题材原创一版（不会照搬原视频）
  const cleanTitle = (s) =>
    s.replace(/【[^】]*】|\[[^\]]*\]|#[^#\s]+#?|[“”"《》「」]/g, '').replace(/[|｜].*$/, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const useHot = (v) => {
    resetForm(tplId);
    form.ref = { title: v.title.length > 34 ? `${v.title.slice(0, 34)}…` : v.title, topic: cleanTitle(v.title) || v.title, url: v.url, play: v.play };
    if (tplId !== 'poem') form.title = form.ref.topic;
    paintComposer();
    compEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`已以「${form.ref.title}」为参考，可以自己写文案，或点「AI 写一版文案」`, 'ok');
  };
  paintFeatured();
  if (featEl) {
    handleCoverErrors(featEl);
    featEl.addEventListener('click', async (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        featTab = tab.dataset.tab;
        return paintFeatured();
      }
      if (e.target.closest('[data-hot-retry]')) return paintHot();
      const hotCard = e.target.closest('[data-hot]');
      if (hotCard) {
        if (e.target.closest('[data-hot-use]')) {
          const v = hotList.find((x) => x.bvid === hotCard.dataset.hot);
          return v && useHot(v);
        }
        if (e.target.closest('[data-stop]')) return stopInCard(hotCard);
        if (e.target.closest('[data-hplay]')) {
          const v = hotList.find((x) => x.bvid === hotCard.dataset.hot);
          if (!v) return;
          $$('.feat', featEl).forEach((c) => c !== hotCard && stopInCard(c));
          playHotInCard(hotCard, v);
        }
        return;
      }
      const pl = e.target.closest('[data-plat]');
      if (pl) {
        featPlatform = pl.dataset.plat;
        return paintFeatured();
      }
      if (e.target.closest('[data-scope]')) {
        featAll = !featAll;
        return paintFeatured();
      }
      const card = e.target.closest('[data-feat]');
      if (!card) return;
      const item = featured.find((f) => f.id === card.dataset.feat);
      if (!item) return;
      if (e.target.closest('[data-stop]')) return stopInCard(card);
      if (e.target.closest('video')) return; // 播放器自己的控件
      if (e.target.closest('[data-play]')) {
        $$('.feat', featEl).forEach((c) => c !== card && stopInCard(c)); // 同一时间只播一个
        return playInCard(card, item);
      }
      if (e.target.closest('[data-use]')) return useFeatured(item);
      if (await openFeatured(item)) useFeatured(item);
    });
  }

  tplsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]');
    if (!b || b.dataset.tpl === tplId) return;
    resetForm(b.dataset.tpl);
    paintTpls();
    paintFeatured();
    paintComposer();
  });

  compEl.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;
    form[k] = e.target.value;
    if (k === 'script') updateCount();
    if (k === 'style') {
      // 手改文本后，下拉跟着变：恰好等于某个预设就选中它，否则显示「自定义」
      const sel = $('[data-style-sel]', compEl);
      const hit = state.meta.stylePresets.find((s) => s.value === form.style);
      $('option[value="__custom"]', sel)?.remove();
      if (hit) sel.value = hit.value;
      else {
        sel.insertAdjacentHTML('afterbegin', '<option value="__custom">自定义（在下方文本框里改）</option>');
        sel.value = '__custom';
      }
    }
  });
  compEl.addEventListener('change', (e) => {
    if (e.target.matches('[data-style-sel]')) {
      if (e.target.value === '__custom') return $('[data-k="style"]', compEl).focus();
      form.style = e.target.value;
      return paintComposer();
    }
    const k = e.target.dataset.k;
    if (!k) return;
    form[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'titleCard' || k === 'endCard') updateCount(); // 片头片尾会多出视频秒数，影响预计费用
  });
  compEl.addEventListener('click', async (e) => {
    const pv = e.target.closest('[data-preview]');
    if (pv) return previewVoice(pv, { voice: form.voice });
    const seg = e.target.closest('[data-seg] button');
    if (seg) {
      form[seg.parentElement.dataset.seg] = seg.dataset.v;
      return paintComposer();
    }
    const skBtn = e.target.closest('[data-skill]');
    if (skBtn) {
      const id = skBtn.dataset.skill;
      form.skills = form.skills.includes(id) ? form.skills.filter((x) => x !== id) : [...form.skills, id];
      skBtn.classList.toggle('on');
      return;
    }
    if (e.target.closest('[data-ref-clear]')) {
      form.ref = null;
      return paintComposer();
    }
    if (e.target.closest('[data-ai-draft]') && form.ref && !drafting) {
      drafting = true;
      paintComposer();
      try {
        const r = await api('/api/script-draft', { method: 'POST', body: { template: tplId, topic: form.ref.topic } });
        Object.assign(form, { script: r.script, author: r.author || form.author });
        if (r.title && (tplId === 'poem' || !form.title)) form.title = r.title;
        toast('AI 已按这个题材写好一版文案，可以直接改', 'ok');
      } catch (err) {
        toast(`AI 写文案失败：${err.message}`, 'err');
      }
      drafting = false;
      return paintComposer();
    }
    const sp = e.target.closest('[data-sample]');
    if (sp) {
      const s = tplOf(tplId).samples[Number(sp.dataset.sample)];
      Object.assign(form, { title: s.title || '', author: s.author || '', script: s.script });
      return paintComposer();
    }
    if (e.target.closest('#btnCreate') && !busy) {
      if (!form.script.trim()) return toast('请先写下文案', 'err');
      busy = true;
      paintComposer();
      try {
        const p = await api('/api/projects', {
          method: 'POST',
          body: {
            template: tplId,
            title: form.title,
            author: form.author,
            script: form.script,
            skills: form.skills || [],
            useTools: form.useTools,
            options: {
              style: form.style,
              orientation: form.orientation,
              voice: form.voice,
              visual: form.visual,
              subtitles: form.subtitles,
              titleCard: form.titleCard,
              endCard: form.endCard,
            },
          },
        });
        resetForm(tplId); // 创建成功后，下次进入创作页是干净的表单
        busy = false;
        location.hash = `#/p/${p.id}`;
      } catch (err) {
        busy = false;
        toast(`创建失败：${err.message}`, 'err');
        paintComposer();
      }
    }
  });

  return {
    unmount() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    },
  };
}
