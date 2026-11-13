/* M Agent：挑选好用的视频制作 Skill，添加后就能用——写灵感，AI 按所选 Skill 写好标题和分镜文案，再带到创作页生成视频。
 * 「添加 Skill」= 存进本机的「设置 → 技能」，之后创作页生成分镜时也会自动带上。 */
import { $, $$, api, esc, state, toast, icon, paintIcons, tplOf, confirmDlg } from '../core.js';

const FAV_KEY = 'wm.agent.fav';
const loadFav = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
  } catch {
    return new Set();
  }
};
const ORI = { portrait: '竖屏 9:16', landscape: '横屏 16:9' };
const grad = (h) => `linear-gradient(135deg, hsl(${h} 74% 62%), hsl(${(h + 34) % 360} 66% 48%))`;
const hueOf = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

/** 交给创作页：创作页挂载时会取走并套用（只用一次） */
const handoff = (d) => {
  sessionStorage.setItem('wm.agentDraft', JSON.stringify(d));
  location.hash = '#/';
};

export async function mount(root) {
  const [data, exts] = await Promise.all([api('/api/agent/skills'), api('/api/extensions').catch(() => ({ skills: [] }))]);
  const market = data.skills;
  const userSkills = exts.skills; // 设置 → 技能（添加的精选 Skill 也在这里，source 为 market:<id>）
  const fav = loadFav();
  let tab = 'skill'; // skill | fav | mine
  let cat = '推荐';
  let q = '';
  let picked = []; // 选中使用的「技能」id（设置里的）
  let ori = ''; // '' = 随技能 / 模板默认
  let busy = false;
  let last = null;

  const addedOf = (m) => userSkills.find((s) => s.source === `market:${m.id}`);
  const marketOf = (u) => market.find((m) => u.source === `market:${m.id}`);

  /** 统一成卡片项 */
  const itemOfMarket = (m) => ({ key: `m:${m.id}`, m, user: addedOf(m), name: m.name, desc: m.desc, glyph: m.glyph, hue: m.hue, templates: m.templates, author: m.author, content: m.content });
  const itemOfUser = (u) => {
    const m = marketOf(u);
    return { key: `u:${u.id}`, m, user: u, name: u.name, desc: u.description || u.content.replace(/\s+/g, ' ').slice(0, 60), glyph: m?.glyph || u.name.slice(0, 1), hue: m?.hue ?? hueOf(u.name), templates: u.templates, author: m ? m.author : '我的技能', content: u.content };
  };
  const items = () => {
    const kw = q.trim().toLowerCase();
    const hit = (it) => !kw || `${it.name} ${it.desc} ${it.templates.map((x) => tplOf(x).name).join(' ')}`.toLowerCase().includes(kw);
    if (tab === 'mine') return userSkills.map(itemOfUser).filter(hit);
    if (tab === 'fav') return market.filter((m) => fav.has(m.id)).map(itemOfMarket).filter(hit);
    return market.filter((m) => (kw ? true : m.cats.includes(cat))).map(itemOfMarket).filter(hit);
  };
  const findItem = (key) => {
    const [k, id] = [key.slice(0, 1), key.slice(2)];
    return k === 'm' ? itemOfMarket(market.find((m) => m.id === id)) : itemOfUser(userSkills.find((u) => u.id === id));
  };

  root.innerHTML = `<div class="page ag">
    <div class="ag-hero">
      <span class="ag-logo">${icon('agent')}</span>
      <h1>一个 Skill，打开一种可能</h1>
      <p>挑好用的视频制作 Skill 添加进来，写下灵感，M Agent 按它写好标题和分镜文案，再一键做成视频</p>
    </div>
    <div class="ag-box" id="agBox">
      <div class="ag-picked" id="agPicked"></div>
      <textarea id="agIdea" rows="3" maxlength="300" placeholder="请输入你的创作灵感，或从下方挑选一个 Skill 开始"></textarea>
      <div class="ag-bar">
        <select id="agTpl" class="ag-tpl" aria-label="创作模板">${state.meta.templates.map((t) => `<option value="${t.id}"${t.id === 'free' ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <div class="seg sm" id="agOri" title="画幅">
          <button type="button" data-o="" class="on">默认画幅</button><button type="button" data-o="portrait">竖屏</button><button type="button" data-o="landscape">横屏</button>
        </div>
        <select id="agModel" class="ag-tpl ag-model" aria-label="写文案用的模型" title="写文案用的模型（读取你填的 API Key 能用的模型）"><option value="">模型加载中…</option></select>
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
  const tplEl = $('#agTpl', root);
  const resEl = $('#agResult', root);
  const modelEl = $('#agModel', root);

  /* 读取当前 API Key 拥有的模型；选择会记住，下次还用这个 */
  const MODEL_KEY = 'wm.agent.model';
  const loadModels = async () => {
    try {
      const r = await api('/api/llm/models');
      if (!r.enabled) {
        modelEl.innerHTML = '<option value="">未配置模型 · 去设置</option>';
        modelEl.dataset.empty = '1';
        return;
      }
      delete modelEl.dataset.empty;
      const saved = localStorage.getItem(MODEL_KEY);
      const cur = r.models.includes(saved) ? saved : r.current;
      modelEl.innerHTML = r.models.map((m) => `<option value="${esc(m)}"${m === cur ? ' selected' : ''}>${esc(m)}${m === r.current ? '（默认）' : ''}</option>`).join('');
      modelEl.title = r.error ? r.error : `这个 Key 共有 ${r.models.length} 个对话模型，选一个来写文案`;
      if (r.error) toast(r.error, 'err');
    } catch (e) {
      modelEl.innerHTML = '<option value="">读取模型失败</option>';
      modelEl.title = e.message;
    }
  };
  modelEl.addEventListener('change', () => {
    if (modelEl.dataset.empty) {
      modelEl.blur();
      location.hash = '#/settings/model';
      return;
    }
    localStorage.setItem(MODEL_KEY, modelEl.value);
  });
  modelEl.addEventListener('mousedown', (e) => {
    if (modelEl.dataset.empty) {
      e.preventDefault();
      location.hash = '#/settings/model';
    }
  });
  loadModels();
  const pickedUsers = () => picked.map((id) => userSkills.find((u) => u.id === id)).filter(Boolean);
  const inScope = (u, tplId) => !u.templates.length || u.templates.includes(tplId);

  const paintPicked = () => {
    picked = picked.filter((id) => userSkills.some((u) => u.id === id));
    const us = pickedUsers();
    $('#agPicked', root).innerHTML = us
      .map((u) => {
        const m = marketOf(u);
        const off = !inScope(u, tplEl.value);
        return `<span class="ag-chip${off ? ' off' : ''}" style="--g:${grad(m?.hue ?? hueOf(u.name))}" title="${off ? '这个 Skill 不适用于当前模板，生成时不会生效' : ''}"><i>${esc(m?.glyph || u.name.slice(0, 1))}</i>${esc(u.name)}${off ? '（当前模板不适用）' : ''}<button type="button" data-unpick="${u.id}" aria-label="取消使用">×</button></span>`;
      })
      .join('');
    const first = us.map(marketOf).find((m) => m?.example);
    ideaEl.placeholder = first ? first.example : '请输入你的创作灵感，或从下方挑选一个 Skill 开始';
    sendEl.disabled = busy || !ideaEl.value.trim();
  };

  const cardHtml = (it) => {
    const on = it.user && picked.includes(it.user.id);
    return `<div class="ag-card${on ? ' on' : ''}" data-key="${esc(it.key)}" tabindex="0" role="button">
      <div class="ag-cover" style="--g:${grad(it.hue)}"><span class="ag-glyph">${esc(it.glyph)}</span><span class="ag-kind">视频</span>
        ${it.m ? `<button type="button" class="ag-star${fav.has(it.m.id) ? ' on' : ''}" data-star aria-label="收藏" title="${fav.has(it.m.id) ? '取消收藏' : '收藏'}">${icon('star')}</button>` : ''}
        ${it.user ? `<span class="ag-added">${on ? '使用中' : '已添加'}</span>` : ''}
      </div>
      <div class="ag-body"><b>${esc(it.name)}</b><p>${esc(it.desc)}</p>
        <div class="ag-by"><i>${it.m ? 'M' : '我'}</i><span>${esc(it.author)}</span>${it.templates.length ? `<em>${it.templates.map((t) => esc(tplOf(t).name)).slice(0, 2).join(' / ')}${it.templates.length > 2 ? '…' : ''}</em>` : '<em>通用</em>'}</div></div>
    </div>`;
  };

  const paintGrid = () => {
    $$('#agTabs [data-t]', root).forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    const catsEl = $('#agCats', root);
    catsEl.hidden = tab !== 'skill' || !!q.trim();
    catsEl.innerHTML = data.categories.map((c) => `<button type="button" class="chip${c === cat ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    const list = items();
    $('#agGrid', root).innerHTML = list.length
      ? list.map(cardHtml).join('')
      : `<div class="empty ag-empty"><b>${tab === 'mine' ? '还没有添加 Skill' : tab === 'fav' ? '还没有收藏' : '没有找到匹配的 Skill'}</b><p>${
          tab === 'mine' ? '到「Skill」里挑一个，点开后「添加 Skill」就会出现在这里；也可以在 <a href="#/settings/skills">设置 → 技能</a> 自己写。' : tab === 'fav' ? '点技能卡片左上角的星标收藏常用的。' : '换个关键词试试。'
        }</p></div>`;
    paintIcons($('#agGrid', root));
  };

  /* ---- 详情弹窗 ---- */
  const detail = (key) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg wide ag-dlg';
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    const paint = () => {
      const it = findItem(key);
      const m = it.m;
      const tpls = it.templates.length ? it.templates.map((t) => esc(tplOf(t).name)).join('、') : '所有模板';
      const used = it.user && picked.includes(it.user.id);
      const rows = m
        ? [['介绍', m.intro], ['使用场景', m.scene], ['如何使用', m.how], ['输出内容', m.output], ['适用模板', tpls]]
        : [['适用模板', tpls]];
      dlg.innerHTML = `<div class="ag-d">
        <div class="ag-d-head">
          <div class="ag-d-cover" style="--g:${grad(it.hue)}"><span>${esc(it.glyph)}</span></div>
          <div class="ag-d-title"><h3>${esc(it.name)}</h3>
            <div class="ag-d-meta"><span class="ag-by"><i>${m ? 'M' : '我'}</i>${esc(it.author)}</span>${m ? `<span class="tag">${esc(m.cats.filter((c) => c !== '推荐')[0])}</span>` : ''}${it.user ? '<span class="tag ok">已添加</span>' : ''}</div>
            <p>${esc(it.desc)}</p></div>
          <div class="ag-d-act">
            ${m ? `<button type="button" class="icon-btn ag-d-star${fav.has(m.id) ? ' on' : ''}" data-dstar title="${fav.has(m.id) ? '取消收藏' : '收藏'}">${icon('star')}</button>` : ''}
            ${
              it.user
                ? `<button type="button" class="btn primary" data-use>${used ? '取消使用' : '用它创作'}</button>`
                : `<button type="button" class="btn primary" data-add>添加 Skill</button>`
            }
          </div>
        </div>
        <div class="ag-d-body">
          <h4>简介</h4>
          <dl class="ag-d-info">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${m && k !== '适用模板' ? esc(v) : v}</dd>`).join('')}</dl>
          <h4>Skill 指引内容</h4>
          <pre class="ag-d-pre">${esc(it.content)}</pre>
          <p class="hint">${
            it.user
              ? '已存进本机「设置 → 技能」，可以随时修改；创作页生成分镜时会自动带上（可在创作页取消勾选）。'
              : '点「添加 Skill」会把它存进本机「设置 → 技能」，之后 M Agent 和创作页都会按它的指引来写。'
          }</p>
        </div>
        <div class="ag-d-foot">${it.user && m ? '<button type="button" class="btn ghost danger" data-remove>移除</button>' : ''}<span class="spacer"></span><button type="button" class="btn ghost" data-close>关闭</button></div>
      </div>`;
      paintIcons(dlg);
    };
    paint();
    dlg.addEventListener('click', async (e) => {
      const it = findItem(key);
      if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
      if (e.target.closest('[data-dstar]') && it.m) {
        fav.has(it.m.id) ? fav.delete(it.m.id) : fav.add(it.m.id);
        localStorage.setItem(FAV_KEY, JSON.stringify([...fav]));
        paint();
        return paintGrid();
      }
      if (e.target.closest('[data-add]') && it.m) {
        const btn = e.target.closest('[data-add]');
        btn.disabled = true;
        try {
          const u = await api('/api/skills', { method: 'POST', body: { name: it.m.name, description: it.m.desc, content: it.m.content, templates: it.m.templates, source: `market:${it.m.id}` } });
          userSkills.push(u);
          toast(`已添加「${u.name}」，可以直接用它创作了`, 'ok');
        } catch (err) {
          btn.disabled = false;
          return toast(err.message, 'err');
        }
        paint();
        return paintGrid();
      }
      if (e.target.closest('[data-use]') && it.user) {
        const id = it.user.id;
        if (picked.includes(id)) picked = picked.filter((x) => x !== id);
        else {
          picked.push(id);
          // 技能只适用于某些模板时，把模板切到适用的那个；画幅跟着技能建议走
          if (!inScope(it.user, tplEl.value)) tplEl.value = it.user.templates[0];
        }
        paintPicked();
        paintGrid();
        dlg.close();
        ideaEl.focus();
        $('#agBox', root).scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (e.target.closest('[data-remove]') && it.user) {
        if (!(await confirmDlg({ title: `移除「${it.name}」？`, body: '只是从「设置 → 技能」里删除这条技能，之后还能重新添加。', okText: '移除', danger: true }))) return;
        try {
          await api(`/api/skills/${it.user.id}`, { method: 'DELETE' });
        } catch (err) {
          return toast(err.message, 'err');
        }
        const i = userSkills.findIndex((u) => u.id === it.user.id);
        if (i >= 0) userSkills.splice(i, 1);
        picked = picked.filter((x) => x !== it.user.id);
        paintPicked();
        paintGrid();
        paint();
      }
    });
    dlg.showModal();
  };

  /* ---- 结果 ---- */
  const effOri = () => ori || pickedUsers().map((u) => marketOf(u)?.orientation).find(Boolean) || '';
  const paintResult = () => {
    if (!last) return void (resEl.innerHTML = '');
    if (last.error) {
      resEl.innerHTML = `<div class="ag-res err"><b>${esc(last.error)}</b>
        <div class="ag-res-act"><button type="button" class="btn ghost" data-manual>不用 AI，直接去创作页</button></div></div>`;
      return;
    }
    const r = last;
    const styleName = state.meta.stylePresets.find((x) => x.value === r.style)?.name || '自定义';
    resEl.innerHTML = `<div class="ag-res">
      <div class="ag-res-head"><b>${esc(r.title || '（未命名）')}</b>${r.author ? `<span class="hint">${esc(r.author)}</span>` : ''}</div>
      <div class="ag-script">${r.script.split('\n').filter(Boolean).map((l, i) => `<p><i>${i + 1}</i>${esc(l)}</p>`).join('')}</div>
      <div class="ag-res-tags"><span class="tag">${esc(tplOf(r.template).name)}模板</span><span class="tag">${ORI[r.orientation]}</span>${r.model ? `<span class="tag">模型 · ${esc(r.model)}</span>` : ''}<span class="tag">画风：${esc(styleName)}</span>${
        r.skillsUsed.length ? r.skillsUsed.map((s) => `<span class="tag ok">Skill · ${esc(s.name)}</span>`).join('') : '<span class="tag">未使用 Skill</span>'
      }</div>
      <div class="ag-res-act"><button type="button" class="btn ghost" data-regen>${icon('refresh')}换一版</button><button type="button" class="btn primary" data-go>去创作页，生成视频</button></div>
    </div>`;
    paintIcons(resEl);
  };

  const run = async () => {
    const idea = ideaEl.value.trim();
    if (!idea || busy) return;
    busy = true;
    sendEl.disabled = true;
    sendEl.classList.add('busy');
    resEl.innerHTML = `<div class="ag-res thinking"><i class="spin"></i><b>M Agent 正在构思…</b></div>`;
    try {
      const r = await api('/api/agent/run', { method: 'POST', body: { idea, template: tplEl.value, skills: picked, orientation: effOri() || undefined, model: modelEl.value || undefined } });
      last = { ...r, idea };
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
  tplEl.addEventListener('change', paintPicked);
  $('#agOri', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-o]');
    if (!b) return;
    ori = b.dataset.o;
    $$('#agOri button', root).forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#agPicked', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-unpick]');
    if (!b) return;
    picked = picked.filter((x) => x !== b.dataset.unpick);
    paintPicked();
    paintGrid();
  });
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
    const card = e.target.closest('[data-key]');
    if (!card) return;
    if (e.target.closest('[data-star]')) {
      const id = card.dataset.key.slice(2);
      const mid = card.dataset.key.startsWith('m:') ? id : marketOf(userSkills.find((u) => u.id === id))?.id;
      if (!mid) return;
      fav.has(mid) ? fav.delete(mid) : fav.add(mid);
      localStorage.setItem(FAV_KEY, JSON.stringify([...fav]));
      return paintGrid();
    }
    detail(card.dataset.key);
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
      const { template, title, author, script, style, orientation } = last;
      return handoff({ template, title, author, script, style, orientation, from: 'agent' });
    }
    if (e.target.closest('[data-manual]') && last) {
      const t = tplOf(tplEl.value);
      handoff({ template: t.id, title: t.id === 'poem' ? '' : last.idea.slice(0, 24), script: '', style: t.defaults.style, orientation: effOri() || t.defaults.orientation, from: 'agent-manual' });
    }
  });

  paintPicked();
  paintGrid();
  return { unmount() {} };
}
