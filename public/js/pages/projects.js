import { $, api, esc, toast, icon, paintIcons, tplOf, tplColor, STATUS, fmtDur, relTime, confirmDlg } from '../core.js';

const FILTERS = [
  ['all', '全部'],
  ['draft', '草稿'],
  ['running', '生成中'],
  ['done', '已完成'],
  ['error', '失败'],
];
let filter = 'all';
let query = '';

export async function mount(root) {
  let list = [];
  let timer = null;
  let alive = true;

  root.innerHTML = `<div class="page">
    <div class="page-head">
      <h1>项目</h1><span class="sub" id="count"></span><span class="spacer"></span>
      <a class="btn primary" href="#/"><span class="ic" data-ic="plus"></span>新建视频</a>
    </div>
    <div class="toolbar">
      <div class="search"><span class="ic" data-ic="search"></span><input id="q" placeholder="搜索项目名称" value="${esc(query)}" /></div>
      <div class="seg" id="filters">${FILTERS.map(([k, n]) => `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    </div>
    <div id="grid"></div>
  </div>`;
  paintIcons(root);

  const visible = () =>
    list.filter((p) => {
      if (filter === 'running' && !(p.status === 'running' || p.status === 'queued')) return false;
      if (filter !== 'all' && filter !== 'running' && p.status !== filter) return false;
      return !query || p.title.toLowerCase().includes(query.toLowerCase());
    });

  const paint = () => {
    const items = visible();
    $('#count', root).textContent = `${list.length} 个`;
    const grid = $('#grid', root);
    if (!items.length) {
      grid.innerHTML = list.length
        ? `<div class="empty"><b>没有匹配的项目</b>换个关键词或筛选条件试试</div>`
        : `<div class="empty"><b>还没有项目</b>选一个模板，几分钟做出第一支视频<br><a class="btn primary" href="#/"><span class="ic" data-ic="sparkle"></span>开始创作</a></div>`;
      return paintIcons(grid);
    }
    grid.className = 'proj-grid';
    grid.innerHTML = items
      .map((p) => {
        const t = tplOf(p.template);
        const busy = p.status === 'running' || p.status === 'queued';
        return `<div class="proj" data-id="${p.id}">
          <div class="proj-cover ${p.orientation === 'portrait' ? 'portrait' : ''}" style="${p.cover ? '' : `background:${tplColor(t)}`}">
            ${p.cover ? `<img src="${p.cover}" loading="lazy" alt="" />` : `<span class="glyph">${esc(t.glyph)}</span>`}
            <span class="badge ${p.status}">${STATUS[p.status]}${p.dirty && p.status === 'done' ? ' · 有改动' : ''}</span>
            ${p.duration ? `<span class="dur">${fmtDur(p.duration)}</span>` : ''}
            ${busy ? `<div class="proj-bar"><i style="width:${p.progress}%"></i></div>` : ''}
          </div>
          <div class="proj-acts">
            <button class="icon-btn" data-act="dup" title="复制" ${busy ? 'disabled' : ''}>${icon('copy')}</button>
            <button class="icon-btn danger" data-act="del" title="删除" ${busy ? 'disabled' : ''}>${icon('trash')}</button>
          </div>
          <div class="proj-info">
            <div class="t" title="${esc(p.title)}">${esc(p.title)}</div>
            <div class="m"><span>${esc(t.name)}</span><span>·</span><span>${p.sceneCount} 镜头</span><span>·</span><span>${relTime(p.updatedAt)}</span></div>
          </div>
        </div>`;
      })
      .join('');
  };

  const load = async () => {
    try {
      list = await api('/api/projects');
    } catch (e) {
      return toast(`读取项目失败：${e.message}`, 'err');
    }
    if (!alive) return;
    paint();
    clearTimeout(timer);
    if (list.some((p) => p.status === 'running' || p.status === 'queued')) timer = setTimeout(load, 2500);
  };

  $('#q', root).addEventListener('input', (e) => {
    query = e.target.value.trim();
    paint();
  });
  $('#filters', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    root.querySelectorAll('#filters button').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  });
  $('#grid', root).addEventListener('click', async (e) => {
    const card = e.target.closest('.proj');
    if (!card) return;
    const id = card.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) {
      location.hash = `#/p/${id}`;
      return;
    }
    const p = list.find((x) => x.id === id);
    try {
      if (act === 'dup') {
        await api(`/api/projects/${id}/duplicate`, { method: 'POST' });
        toast('已复制', 'ok');
        load();
      } else if (act === 'del') {
        const ok = await confirmDlg({ title: '删除项目？', body: `「${p.title}」的所有素材和成片都会被删除，无法恢复。`, okText: '删除', danger: true });
        if (!ok) return;
        await api(`/api/projects/${id}`, { method: 'DELETE' });
        toast('已删除', 'ok');
        load();
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  await load();
  return {
    unmount() {
      alive = false;
      clearTimeout(timer);
    },
  };
}
