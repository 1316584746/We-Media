/* M Agent：一句灵感 + 一个技能 → 标题和分镜文案，再带到创作页一键生成视频。 */
import { $, $$, api, esc, state, toast, icon, paintIcons, tplOf, tplColor } from '../core.js';

const FAV_KEY = 'wm.agent.fav';
const loadFav = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
  } catch {
    return new Set();
  }
};
const ORI = { portrait: '竖屏 9:16', landscape: '横屏 16:9' };

/** 交给创作页：创作页挂载时会取走并套用（只用一次） */
export const DRAFT_KEY = 'wm.agentDraft';
const handoff = (d) => {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  location.hash = '#/';
};

export async function mount(root) {
  const [data, exts] = await Promise.all([api('/api/agent/skills'), api('/api/extensions').catch(() => ({ skills: [] }))]);
  const skills = data.skills;
  const fav = loadFav();
  let tab = 'skill'; // skill | fav | mine
  let cat = '推荐';
  let q = '';
  let picked = null; // { id, user? }：内置技能 id，user 是「设置 → 技能」里自己写的技能 id
  let orientation = ''; // '' = 随技能
  let busy = false;
  let last = null; // 最近一次生成的结果

  const builtin = (id) => skills.find((s) => s.id === id);
  const baseFor = (tplId) => skills.find((s) => s.template === tplId) || builtin('free-any');
  const mine = exts.skills.map((s) => {
    const tplId = s.templates[0] || 'free';
    return { id: `user:${s.id}`, user: s.id, name: s.name, desc: s.description || s.content.replace(/\s+/g, ' ').slice(0, 60), template: tplId, mine: true, example: '写下你的灵感，会按这个技能的指引来写' };
  });
  const find = (id) => builtin(id) || mine.find((m) => m.id === id);

  root.innerHTML = `<div class="page ag">
    <div class="ag-hero">
      <span class="ag-logo">${icon('agent')}</span>
      <h1>一个 Skill，打开一种可能</h1>
      <p>写下灵感，选一个技能，M Agent 帮你写好标题和分镜文案，再一键做成视频</p>
    </div>
    <div class="ag-box" id="agBox">
      <div class="ag-picked" id="agPicked"></div>
      <textarea id="agIdea" rows="3" maxlength="300" placeholder="请输入你的创作灵感，或从下方挑选一个 Skill 开始"></textarea>
      <div class="ag-bar">
        <div class="seg sm" id="agOri" title="画幅">
          <button type="button" data-o="" class="on">随技能</button><button type="button" data-o="portrait">竖屏</button><button type="button" data-o="landscape">横屏</button>
        </div>
        <span class="spacer"></span>
        <span class="hint" id="agCount">0 / 300</span>
        <button type="button" class="ag-send" id="agSend" disabled aria-label="生成文案" title="生成文案（Ctrl + 回车）">${icon('send')}</button>
      </div>
    </div>
    <div id="agResult"></div>
    <div class="ag-sec">
      <div class="ag-tabs" id="agTabs">
        <button type="button" data-t="skill" class="on">Skill</button>
        <button type="button" data-t="fav">收藏</button>
        <button type="button" data-t="mine">我的</button>
        <label class="ag-search">${icon('search')}<input id="agQ" placeholder="搜索 Skill" autocomplete="off" /></label>
      </div>
      <div class="chips ag-cats" id="agCats"></div>
      <div class="ag-grid" id="agGrid"></div>
    </div>
  </div>`;
  paintIcons(root);

  const ideaEl = $('#agIdea', root);
  const sendEl = $('#agSend', root);
  const resEl = $('#agResult', root);

  const paintPicked = () => {
    const s = picked && find(picked.id);
    $('#agPicked', root).innerHTML = s
      ? `<span class="ag-chip" style="--g:${tplColor(tplOf(s.template))}"><i>${esc(tplOf(s.template).glyph)}</i>${esc(s.name)}<button type="button" data-unpick aria-label="取消选择">×</button></span><span class="hint">${esc(tplOf(s.template).name)}模板${orientation ? '' : s.orientation ? ` · ${ORI[s.orientation]}` : ''}</span>`
      : '';
    ideaEl.placeholder = s ? s.example : '请输入你的创作灵感，或从下方挑选一个 Skill 开始';
    sendEl.disabled = busy || !ideaEl.value.trim();
  };

  const cardHtml = (s) => {
    const t = tplOf(s.template);
    const on = picked?.id === s.id;
    return `<div class="ag-card${on ? ' on' : ''}" data-skill="${esc(s.id)}" tabindex="0" role="button" aria-pressed="${on}">
      <div class="ag-cover" style="--g:${tplColor(t)}"><span class="ag-glyph">${esc(t.glyph)}</span><span class="ag-kind">视频</span>
        ${s.mine ? '' : `<button type="button" class="ag-star${fav.has(s.id) ? ' on' : ''}" data-star aria-label="收藏" title="${fav.has(s.id) ? '取消收藏' : '收藏'}">${icon('star')}</button>`}
      </div>
      <div class="ag-body"><b>${esc(s.name)}</b><p>${esc(s.desc)}</p>
        <div class="ag-by"><i>${s.mine ? '我' : 'M'}</i><span>${s.mine ? '我的技能' : 'M Agent'}</span><em>${esc(t.name)}</em></div></div>
    </div>`;
  };

  const paintGrid = () => {
    $$('#agTabs [data-t]', root).forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    $('#agCats', root).hidden = tab !== 'skill' || !!q;
    $('#agCats', root).innerHTML = data.categories.map((c) => `<button type="button" class="chip${c === cat ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    const kw = q.trim().toLowerCase();
    let list = tab === 'mine' ? mine : tab === 'fav' ? skills.filter((s) => fav.has(s.id)) : skills.filter((s) => q || s.cats.includes(cat));
    if (kw) list = [...(tab === 'mine' ? mine : skills)].filter((s) => `${s.name} ${s.desc} ${tplOf(s.template).name}`.toLowerCase().includes(kw));
    $('#agGrid', root).innerHTML = list.length
      ? list.map(cardHtml).join('')
      : `<div class="empty ag-empty"><b>${tab === 'mine' ? '还没有自己的技能' : tab === 'fav' ? '还没有收藏' : '没有找到匹配的 Skill'}</b><p>${
          tab === 'mine' ? '到 <a href="#/settings/skills">设置 → 技能</a> 添加你自己的写作指引，这里就会出现。' : tab === 'fav' ? '点技能卡片左上角的星标收藏常用的。' : '换个关键词试试。'
        }</p></div>`;
    paintIcons($('#agGrid', root));
  };

  const pick = (id) => {
    picked = picked?.id === id ? null : { id };
    paintPicked();
    paintGrid();
    if (picked) ideaEl.focus();
  };

  /* ---- 结果 ---- */
  const paintResult = () => {
    if (!last) return void (resEl.innerHTML = '');
    if (last.error) {
      resEl.innerHTML = `<div class="ag-res err"><b>${esc(last.error)}</b>
        <div class="ag-res-act"><button type="button" class="btn ghost" data-manual>不用 AI，直接去创作页</button></div></div>`;
      return;
    }
    const r = last;
    const s = find(r.skillId);
    const styleName = state.meta.stylePresets.find((x) => x.value === r.style)?.name || '自定义';
    resEl.innerHTML = `<div class="ag-res">
      <div class="ag-res-head"><span class="badge">${esc(s?.name || '')}</span><b>${esc(r.title || '（未命名）')}</b>${r.author ? `<span class="hint">${esc(r.author)}</span>` : ''}</div>
      <div class="ag-script">${r.script.split('\n').filter(Boolean).map((l, i) => `<p><i>${i + 1}</i>${esc(l)}</p>`).join('')}</div>
      <div class="ag-res-tags"><span class="tag">${esc(tplOf(r.template).name)}模板</span><span class="tag">${ORI[r.orientation]}</span><span class="tag">画风：${esc(styleName)}</span></div>
      <div class="ag-res-act"><button type="button" class="btn ghost" data-regen>${icon('refresh')}换一版</button><button type="button" class="btn primary" data-go>去创作页，生成视频</button></div>
    </div>`;
    paintIcons(resEl);
  };

  const run = async () => {
    const idea = ideaEl.value.trim();
    if (!idea || busy) return;
    const s = picked && find(picked.id);
    busy = true;
    sendEl.disabled = true;
    sendEl.classList.add('busy');
    resEl.innerHTML = `<div class="ag-res thinking"><i class="spin"></i><b>M Agent 正在构思${s ? `「${esc(s.name)}」` : ''}…</b></div>`;
    try {
      const body = { idea, skill: s ? (s.mine ? baseFor(s.template).id : s.id) : 'free-any', orientation: orientation || undefined };
      if (s?.mine) body.userSkill = s.user;
      const r = await api('/api/agent/run', { method: 'POST', body });
      last = { ...r, skillId: s && !s.mine ? s.id : r.skill, idea, userSkill: s?.mine ? s.user : '' };
    } catch (err) {
      last = { error: err.message, idea };
    } finally {
      busy = false;
      sendEl.classList.remove('busy');
      paintPicked();
    }
    paintResult();
    resEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  /* ---- 事件 ---- */
  ideaEl.addEventListener('input', () => {
    $('#agCount', root).textContent = `${ideaEl.value.length} / 300`;
    sendEl.disabled = busy || !ideaEl.value.trim();
  });
  ideaEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run();
    }
  });
  sendEl.addEventListener('click', run);
  $('#agOri', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-o]');
    if (!b) return;
    orientation = b.dataset.o;
    $$('#agOri button', root).forEach((x) => x.classList.toggle('on', x === b));
    paintPicked();
  });
  $('#agPicked', root).addEventListener('click', (e) => e.target.closest('[data-unpick]') && pick(picked.id));
  $('#agTabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    tab = b.dataset.t;
    paintGrid();
  });
  $('#agQ', root).addEventListener('input', (e) => {
    q = e.target.value;
    paintGrid();
  });
  $('#agCats', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat;
    paintGrid();
  });
  const onCard = (e) => {
    const card = e.target.closest('[data-skill]');
    if (!card) return;
    if (e.target.closest('[data-star]')) {
      const id = card.dataset.skill;
      fav.has(id) ? fav.delete(id) : fav.add(id);
      localStorage.setItem(FAV_KEY, JSON.stringify([...fav]));
      return paintGrid();
    }
    pick(card.dataset.skill);
  };
  $('#agGrid', root).addEventListener('click', onCard);
  $('#agGrid', root).addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-star]')) {
      e.preventDefault();
      onCard(e);
    }
  });
  resEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-regen]')) return run();
    if (e.target.closest('[data-go]') && last && !last.error) {
      const { template, title, author, script, style, orientation: o } = last;
      return handoff({ template, title, author, script, style, orientation: o, from: 'agent' });
    }
    if (e.target.closest('[data-manual]') && last) {
      const s = picked && find(picked.id);
      const tplId = s?.template || 'free';
      const t = tplOf(tplId);
      handoff({ template: tplId, title: tplId === 'poem' ? '' : last.idea.slice(0, 24), script: '', style: t.defaults.style, orientation: orientation || s?.orientation || t.defaults.orientation, from: 'agent-manual' });
    }
  });

  paintPicked();
  paintGrid();
  return { unmount() {} };
}
