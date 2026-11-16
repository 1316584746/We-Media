// 数据看板：先看所有平台的汇总，再按平台分别列出（平台接口读到的数据 + 本机的发布记录）
import { $, api, esc, toast, paintIcons } from '../core.js';

const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtNum = (n) => (n >= 100000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')} 万` : Number(n).toLocaleString('zh-CN'));

const REC_STATUS = { pending: ['等待发布', 'queued'], remind: ['待手动发布', 'warn'], done: ['已发布', 'done'], failed: ['失败', 'error'] };
const REMOTE_BADGE = { ok: ['已读到数据', 'done'], unconfigured: ['待填写', 'warn'], error: ['读取失败', 'error'], unavailable: ['暂无接口', 'draft'] };

const badgeText = (p) => (p.remote.status === 'unavailable' ? p.remote.source : `${p.remote.source} · ${(REMOTE_BADGE[p.remote.status] || REMOTE_BADGE.unavailable)[0]}`);

// 汇总数字从 0 慢慢涨到真实值（0.65 秒；系统设置了「减少动态效果」就直接显示）
function countUp(root) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('[data-n]').forEach((el) => {
    const to = Number(el.dataset.n);
    if (!(to >= 2)) return;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 650);
      el.textContent = fmtNum(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export async function mount(root) {
  root.innerHTML = `<div class="page db">
    <div class="page-head">
      <div><h1>数据看板</h1><span class="sub" id="dbSub">所有平台的数据汇总，下面再按平台分别列出</span></div>
      <button type="button" class="btn ghost" id="dbRefresh"><span class="ic" data-ic="refresh"></span>刷新数据</button>
    </div>
    <div id="dbBody"><div class="empty"><b>正在读取各平台数据…</b></div></div>
  </div>`;
  paintIcons(root);

  let alive = true;
  let data = null;

  const summaryHtml = (t) => `<section class="db-sum">
    <div class="db-stat"><b data-n="${t.fans}">${fmtNum(t.fans)}</b><span>粉丝合计</span><em>${t.fansPlatforms ? `来自 ${t.fansPlatforms} 个已接入接口的平台` : '还没有平台接入数据接口'}</em></div>
    <div class="db-stat"><b data-n="${t.published}">${fmtNum(t.published)}</b><span>已发布</span><em>各平台累计次数</em></div>
    <div class="db-stat"><b data-n="${t.pending}">${fmtNum(t.pending)}</b><span>等待发布</span><em>还没到发布时间</em></div>
    <div class="db-stat${t.waiting ? ' warn' : ''}"><b data-n="${t.waiting}">${fmtNum(t.waiting)}</b><span>待手动发布</span><em>到点了，要去平台发</em></div>
    <div class="db-stat${t.failed ? ' err' : ''}"><b data-n="${t.failed}">${fmtNum(t.failed)}</b><span>发布失败</span><em>去「设置 → 发布」看原因</em></div>
    <div class="db-stat"><b data-n="${t.videos}">${fmtNum(t.videos)}</b><span>可发布的成片</span><em>AI 成片 + 剪辑导出</em></div>
  </section>`;

  const overviewHtml = (ps) => `<section class="db-block">
    <h2>各平台总览</h2>
    <div class="db-table-wrap"><table class="db-table">
      <thead><tr><th>平台</th><th>数据来源</th><th>粉丝</th><th>已发布</th><th>等待</th><th>待手动</th><th>失败</th></tr></thead>
      <tbody>${ps
        .map((p) => {
          const fans = p.remote.metrics.find((m) => m.key === 'fans');
          const [rt, rc] = REMOTE_BADGE[p.remote.status] || REMOTE_BADGE.unavailable;
          return `<tr data-goto="${esc(p.key)}"><td><b>${esc(p.name)}</b></td>
            <td><span class="badge ${rc}">${esc(badgeText(p))}</span></td>
            <td>${fans ? fmtNum(fans.value) : '<span class="muted">—</span>'}</td>
            <td>${p.local.published}</td><td>${p.local.pending}</td><td>${p.local.waiting}</td><td>${p.local.failed}</td></tr>`;
        })
        .join('')}</tbody>
    </table></div>
    <p class="hint">「—」表示这个平台暂时读不到数据（没有开放接口，或还没填账号信息）。已发布 / 等待 / 失败是应用里「定时发布」的记录。</p>
  </section>`;

  const platformHtml = (p) => {
    const [rt, rc] = REMOTE_BADGE[p.remote.status] || REMOTE_BADGE.unavailable;
    const metrics = p.remote.metrics.length
      ? `<div class="db-metrics">${p.remote.metrics.map((m) => `<div><b data-n="${m.value}">${fmtNum(m.value)}</b><span>${esc(m.label)}</span></div>`).join('')}</div>`
      : '';
    const upd = p.remote.updatedAt && p.remote.status === 'ok' ? `<span class="muted"> · ${fmtTime(p.remote.updatedAt)} 读取</span>` : '';
    const biliForm =
      p.key === 'bili'
        ? `<div class="db-uid"><label>我的 B 站 UID</label><input id="dbBiliUid" inputmode="numeric" placeholder="例如 12345678" value="${esc(p.bili?.uid || '')}" /><button type="button" class="btn sm" id="dbBiliSave">保存并读取</button></div>`
        : '';
    const recent = p.recent.length
      ? `<ul class="db-recent">${p.recent
          .map((r) => {
            const [st, sc] = REC_STATUS[r.status] || REC_STATUS.pending;
            return `<li><span class="badge ${sc}">${st}</span><b>${esc(r.title)}</b><em>${fmtTime(r.time)}</em></li>`;
          })
          .join('')}</ul>`
      : '<p class="hint">这个平台还没有发布记录。在「设置 → 发布」里排一个发布计划，这里就会出现。</p>';
    return `<section class="db-plat card" id="db-${esc(p.key)}">
      <div class="db-plat-head">
        <h3>${esc(p.name)}</h3><span class="badge ${rc}">${esc(badgeText(p))}</span>
        <span class="spacer"></span>
        <a class="btn sm ghost" href="${esc(p.center)}" target="_blank" rel="noopener noreferrer">打开创作中心</a>
      </div>
      <div class="db-remote ${esc(p.remote.status)}">
        ${metrics}
        <p class="${p.remote.status === 'error' ? 'err-msg' : 'hint'}">${esc(p.remote.message)}${upd}</p>
        ${biliForm}
      </div>
      <h4>本机发布记录</h4>
      <div class="db-local">
        <span><b>${p.local.published}</b>已发布</span><span><b>${p.local.pending}</b>等待</span><span><b>${p.local.waiting}</b>待手动</span><span><b>${p.local.failed}</b>失败</span>
      </div>
      ${recent}
    </section>`;
  };

  const paint = () => {
    if (!alive || !data) return;
    $('#dbBody', root).innerHTML = `${summaryHtml(data.totals)}${overviewHtml(data.platforms)}<section class="db-block"><h2>分平台详情</h2><div class="db-plats">${data.platforms.map(platformHtml).join('')}</div></section>`;
    countUp(root);
    $('#dbSub', root).textContent = `更新于 ${fmtTime(data.now)} · 已接入数据接口的平台 ${data.totals.apiPlatforms} 个`;
  };

  const load = async (refresh) => {
    const btn = $('#dbRefresh', root);
    btn.disabled = true;
    try {
      data = await api(`/api/dashboard${refresh ? '?refresh=1' : ''}`);
      paint();
    } catch (e) {
      $('#dbBody', root).innerHTML = `<div class="empty"><b>读取失败</b><p>${esc(e.message)}</p></div>`;
    } finally {
      btn.disabled = false;
    }
  };

  root.addEventListener('click', async (e) => {
    if (e.target.closest('#dbRefresh')) return load(true);
    const row = e.target.closest('tr[data-goto]');
    if (row) return void document.getElementById(`db-${row.dataset.goto}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (e.target.closest('#dbBiliSave')) {
      const btn = e.target.closest('#dbBiliSave');
      btn.disabled = true;
      try {
        await api('/api/publish/bili', { method: 'PUT', body: { uid: $('#dbBiliUid', root).value } });
        await load(true);
        toast('已保存 B 站 UID', 'ok');
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
      }
    }
  });

  await load(false);
  return {
    unmount() {
      alive = false;
    },
  };
}
