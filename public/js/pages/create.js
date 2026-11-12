import { featuredCardsHtml, hotCardsHtml, handleCoverErrors, openFeatured, playInCard, playHotInCard, stopInCard, PLATFORMS } from '../featured.js';
import { estimate, estimateHtml } from '../pricing.js';
import { $, $$, api, esc, state, toast, icon, paintIcons, tplOf, tplColor, VISUAL, mockParts, voiceChoices, previewVoice, previewBtnHtml } from '../core.js';

let tplId = 'poem';
let form = null;
let busy = false;
let exts = { skills: [], mcp: [] };
let featPlatform = '全部';
let featTab = 'hot'; // hot = B 站热门动画；demo = 做同款示范
const hotCache = new Map(); // 模板 id -> /api/discover 结果（页面会话内缓存，服务端另有 30 分钟缓存）
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

function templatesHtml() {
  return state.meta.templates
    .map(
      (t) => `<button class="tpl ${t.id === tplId ? 'on' : ''}" data-tpl="${t.id}">
        <div class="tpl-cover" style="background:${tplColor(t)}">${esc(t.glyph)}</div>
        <div class="tpl-info"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></div>
      </button>`,
    )
    .join('');
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
        <div class="chips">${state.meta.stylePresets
          .map((s) => `<button class="chip ${form.style === s.value ? 'on' : ''}" data-style="${esc(s.value)}">${esc(s.name)}</button>`)
          .join('')}</div>
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
    <div class="hero"><h1>想做一支什么视频？</h1><p>选一个模板，写下文案，剩下的分镜、画面、配音、字幕、成片交给 AI</p></div>
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
  const updateRail = () => {
    const max = tplsEl.scrollWidth - tplsEl.clientWidth;
    const can = max > 4;
    $$('.tpl-nav', rail).forEach((b) => {
      b.hidden = !can || (b.dataset.nav === '-1' ? tplsEl.scrollLeft < 4 : tplsEl.scrollLeft > max - 4);
    });
    rail.classList.toggle('can-l', can && tplsEl.scrollLeft >= 4);
    rail.classList.toggle('can-r', can && tplsEl.scrollLeft <= max - 4);
  };
  // 把选中的模板卡片滚进可视区（只滚这一行，不动整个页面）
  const revealSelected = (smooth = false) => {
    const on = $('.tpl.on', tplsEl);
    if (!on) return;
    const l = on.offsetLeft - tplsEl.offsetLeft;
    const r = l + on.offsetWidth;
    if (l < tplsEl.scrollLeft) tplsEl.scrollTo({ left: l - 8, behavior: smooth ? 'smooth' : 'auto' });
    else if (r > tplsEl.scrollLeft + tplsEl.clientWidth) tplsEl.scrollTo({ left: r - tplsEl.clientWidth + 8, behavior: smooth ? 'smooth' : 'auto' });
  };
  const paintTpls = () => {
    const x = tplsEl.scrollLeft; // 重绘不要把滚动位置弄丢
    tplsEl.innerHTML = templatesHtml();
    tplsEl.scrollLeft = x;
    revealSelected(true);
    updateRail();
    requestAnimationFrame(updateRail); // 首次绘制时容器可能还没挂进页面，下一帧再量一次
  };
  tplsEl.addEventListener('scroll', updateRail, { passive: true });
  new ResizeObserver(updateRail).observe(tplsEl);
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('.tpl-nav');
    if (b) tplsEl.scrollBy({ left: Number(b.dataset.nav) * Math.max(220, tplsEl.clientWidth * 0.8), behavior: 'smooth' });
  });
  // 鼠标按住拖动滚动（触屏 / 触控板本来就能滚）；拖动后不当成点击
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
    grid.className = 'feat-grid hot-grid';
    grid.innerHTML = hotCardsHtml(hotList);
    if (note) {
      const d = new Date(data.fetchedAt).toLocaleDateString('zh-CN');
      note.textContent = `来源 B 站公开搜索「${data.keywords.join(' / ')}」，按播放量从高到低${
        data.stale ? `；B 站暂时限制了访问，当前是 ${d} 的数据快照，稍后会自动刷新` : ''
      }`;
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
        <div><h2>创作精选${tplId !== 'free' && (hot || scoped) ? ` · ${esc(t.name)}` : ''}</h2><span class="sub" id="hotNote">${
          hot ? '' : `${scoped ? `和「${esc(t.name)}」同类型的示范，` : ''}可直接播放看效果，点「做同款」一键套用模板、文案、画幅和画风`
        }</span></div>
        <div class="chips" id="featFilter">
          <button class="chip ${hot ? 'on' : ''}" data-tab="hot">热门动画 · 按播放量</button>
          <button class="chip ${hot ? '' : 'on'}" data-tab="demo">做同款示范</button>${
            hot
              ? ''
              : `<span class="chip-sep"></span>${PLATFORMS.map((p) => `<button class="chip ${p === featPlatform ? 'on' : ''}" data-plat="${p}">${p}</button>`).join('')}${
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
    if (k === 'style') $$('[data-style]', compEl).forEach((c) => c.classList.toggle('on', c.dataset.style === form.style));
  });
  compEl.addEventListener('change', (e) => {
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
    const st = e.target.closest('[data-style]');
    if (st) {
      form.style = st.dataset.style;
      return paintComposer();
    }
    const skBtn = e.target.closest('[data-skill]');
    if (skBtn) {
      const id = skBtn.dataset.skill;
      form.skills = form.skills.includes(id) ? form.skills.filter((x) => x !== id) : [...form.skills, id];
      skBtn.classList.toggle('on');
      return;
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
