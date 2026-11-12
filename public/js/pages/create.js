import { $, $$, api, esc, state, toast, icon, paintIcons, tplOf, tplColor, VISUAL, STATUS, relTime, mockParts, voiceChoices } from '../core.js';

let tplId = 'poem';
let form = null;
let busy = false;

function resetForm(id) {
  const t = tplOf(id);
  tplId = t.id;
  form = {
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
      <div class="field"><span class="lbl">配音</span>${voiceSel}</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <label class="switch"><input type="checkbox" data-k="subtitles" ${form.subtitles ? 'checked' : ''} />字幕</label>
        <label class="switch"><input type="checkbox" data-k="titleCard" ${form.titleCard ? 'checked' : ''} />片头标题</label>
        <label class="switch"><input type="checkbox" data-k="endCard" ${form.endCard ? 'checked' : ''} />片尾</label>
      </div>
    </div>
    <div class="composer-foot" style="grid-column:1 / -1">
      <button class="btn primary lg" id="btnCreate">${busy ? '<i class="spin"></i> 正在拆分镜头…' : `${'<span class="ic" data-ic="sparkle" style="font-size:18px"></span>'}生成分镜并创建项目`}</button>
      <span class="hint">创建项目只做文案拆解，不生成画面、不产生视频费用；在编辑器里确认后再点「生成视频」。</span>
      ${mocks.length ? `<span class="badge warn" title="这些能力还没配置真实模型，会生成占位内容">未配置：${mocks.join('、')}（<a href="#/settings" style="text-decoration:underline">去设置</a>）</span>` : ''}
    </div>
  </div>`;
}

export async function mount(root) {
  if (!form) resetForm(tplId);
  const projects = await api('/api/projects').catch(() => []);
  const recent = projects.slice(0, 4);

  root.innerHTML = `<div class="page">
    <div class="hero"><h1>想做一支什么视频？</h1><p>选一个模板，写下文案，剩下的分镜、画面、配音、字幕、成片交给 AI</p></div>
    <div class="tpl-grid" id="tpls"></div>
    <div id="composer"></div>
    ${
      recent.length
        ? `<div class="section-title"><h2>最近项目</h2><a href="#/projects">全部项目 →</a></div>
           <div class="proj-grid" id="recent">${recent
             .map((p) => {
               const t = tplOf(p.template);
               return `<a class="proj" href="#/p/${p.id}">
                 <div class="proj-cover ${p.orientation === 'portrait' ? 'portrait' : ''}" style="${p.cover ? '' : `background:${tplColor(t)}`}">
                   ${p.cover ? `<img src="${p.cover}" loading="lazy" alt="" />` : `<span class="glyph">${esc(t.glyph)}</span>`}
                   <span class="badge ${p.status}">${STATUS[p.status]}</span>
                 </div>
                 <div class="proj-info"><div class="t">${esc(p.title)}</div><div class="m"><span>${esc(t.name)}</span><span>${relTime(p.updatedAt)}</span></div></div>
               </a>`;
             })
             .join('')}</div>`
        : ''
    }
  </div>`;

  const tplsEl = $('#tpls', root);
  const compEl = $('#composer', root);
  const paintTpls = () => (tplsEl.innerHTML = templatesHtml());
  const paintComposer = () => {
    compEl.innerHTML = composerHtml();
    paintIcons(compEl);
    updateCount();
  };
  const updateCount = () => {
    const el = $('#scriptCount', compEl);
    if (el) el.textContent = form.script.trim() ? `${form.script.replace(/\s/g, '').length} 字` : '';
  };
  paintTpls();
  paintComposer();

  tplsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]');
    if (!b || b.dataset.tpl === tplId) return;
    resetForm(b.dataset.tpl);
    paintTpls();
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
  });
  compEl.addEventListener('click', async (e) => {
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

  return { unmount() {} };
}
