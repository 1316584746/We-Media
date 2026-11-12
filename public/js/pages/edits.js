/* 剪辑工程列表：新建 / 打开 / 删除。编辑器见 cutter.js */
import { $, $$, api, esc, toast, icon, paintIcons, confirmDlg, relTime, fmtDur } from '../core.js';

const RATIOS = [
  ['16:9', '横屏'],
  ['9:16', '竖屏'],
  ['1:1', '方形'],
  ['4:3', '4:3'],
  ['3:4', '3:4'],
];

function newDialog(aiProjects) {
  return new Promise((resolve) => {
    let ratio = '16:9';
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg wide';
    dlg.innerHTML = `<form method="dialog" novalidate>
      <div class="dlg-body form"><h3>新建剪辑</h3>
        <div class="field"><label>名称</label><input id="nName" maxlength="60" placeholder="未命名剪辑" /></div>
        <div class="field"><span class="lbl">画布比例</span>
          <div class="seg full" id="nRatio">${RATIOS.map(([r, n]) => `<button type="button" data-r="${r}" class="${r === ratio ? 'on' : ''}">${r}<small>${n}</small></button>`).join('')}</div></div>
        ${
          aiProjects.length
            ? `<div class="field"><label>从 AI 视频开始（可选）</label>
          <select id="nFrom"><option value="">空白工程，自己导入素材</option>${aiProjects.map((p) => `<option value="${p.id}">${esc(p.title)}（${fmtDur(p.duration)}）</option>`).join('')}</select>
          <span class="hint">会把这个项目的成片放到时间线上，继续剪辑；画布比例按成片自动设置。</span></div>`
            : ''
        }
      </div>
      <div class="dlg-foot"><button type="button" class="btn ghost" data-cancel>取消</button><button type="submit" class="btn primary" data-ok>创建</button></div>
    </form>`;
    document.body.appendChild(dlg);
    let result = null;
    $('#nRatio', dlg).addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-r]');
      if (!b) return;
      ratio = b.dataset.r;
      $$('#nRatio button', dlg).forEach((x) => x.classList.toggle('on', x === b));
    });
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    $('form', dlg).addEventListener('submit', (ev) => {
      ev.preventDefault();
      result = { name: $('#nName', dlg).value.trim(), ratio, fromProject: $('#nFrom', dlg)?.value || '' };
      dlg.close();
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.showModal();
    $('#nName', dlg).focus();
  });
}

export async function mount(root) {
  let list = [];
  let aiProjects = [];
  let alive = true;

  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>剪辑</h1><span class="sub">导入视频、音频、图片，在时间线上自由剪辑，加文字，导出成片</span></div>
    <div class="toolbar"><button class="btn primary" id="btnNew">${icon('plus')}新建剪辑</button><span class="spacer"></span></div>
    <div id="grid"></div>
  </div>`;
  paintIcons(root);

  const paint = () => {
    const grid = $('#grid', root);
    if (!list.length) {
      grid.innerHTML = `<div class="empty"><b>还没有剪辑工程</b>点「新建剪辑」开始，或在「创作」生成 AI 视频后，选择「从 AI 视频开始」继续精修。</div>`;
      return;
    }
    grid.innerHTML = `<div class="proj-grid">${list
      .map(
        (e) => `<a class="proj" href="#/e/${e.id}" data-id="${e.id}">
        <div class="proj-cover ${e.ratio === '9:16' || e.ratio === '3:4' ? 'portrait' : ''}" style="${e.cover ? '' : 'background:linear-gradient(135deg,#27324f,#161b2b)'}">
          ${e.cover ? `<img src="${e.cover}" loading="lazy" alt="" />` : `<span class="glyph">${icon('scissors')}</span>`}
          ${e.export?.status === 'done' ? '<span class="badge done">已导出</span>' : ''}
          <span class="dur">${fmtDur(e.duration)}</span>
          <div class="proj-acts"><button class="icon-btn danger" data-del title="删除">${icon('trash')}</button></div>
        </div>
        <div class="proj-info"><div class="t">${esc(e.name)}</div><div class="m"><span>${e.ratio}</span><span>${e.clips} 个片段</span><span>${relTime(e.updatedAt)}</span></div></div>
      </a>`,
      )
      .join('')}</div>`;
    paintIcons(grid);
  };

  const load = async () => {
    [list, aiProjects] = await Promise.all([api('/api/edits').catch(() => []), api('/api/projects').then((l) => l.filter((p) => p.status === 'done')).catch(() => [])]);
    if (alive) paint();
  };

  $('#btnNew', root).addEventListener('click', async () => {
    const r = await newDialog(aiProjects);
    if (!r) return;
    try {
      const e = await api('/api/edits', { method: 'POST', body: { name: r.name, ratio: r.ratio, fromProject: r.fromProject || undefined } });
      location.hash = `#/e/${e.id}`;
    } catch (err) {
      toast(`创建失败：${err.message}`, 'err');
    }
  });

  $('#grid', root).addEventListener('click', async (ev) => {
    const del = ev.target.closest('[data-del]');
    if (!del) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = del.closest('[data-id]').dataset.id;
    const e = list.find((x) => x.id === id);
    if (!(await confirmDlg({ title: '删除这个剪辑？', body: `「${e.name}」及其素材、导出文件都会被删除，无法恢复。`, okText: '删除', danger: true }))) return;
    try {
      await api(`/api/edits/${id}`, { method: 'DELETE' });
      list = list.filter((x) => x.id !== id);
      paint();
      toast('已删除', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  await load();
  return { unmount() { alive = false; } };
}
