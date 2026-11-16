/**
 * 古诗词库选择器：创作页选了「古诗词动画」模板后，在「写下内容」旁边出现「诗词库」按钮，
 * 打开后可按关键词 / 朝代 / 作者 / 合集检索，点一首就把诗名、作者、正文自动填进表单。
 *
 * 这里不改创作页本身：用 MutationObserver 等表单渲染出来后插入按钮，
 * 填充时往输入框派发 input 事件，创作页原有的监听会把值同步进它的表单状态。
 */
import { $, api, esc, toast } from './core.js';

const PAGE = 30;
const LONG = 24; // 超过这么多句，提示会拆出很多镜头

const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

function fillForm(it) {
  const comp = $('#composer');
  if (!comp) return false;
  const set = (k, v) => {
    const el = comp.querySelector(`[data-k="${k}"]`);
    if (!el) return;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('title', it.title);
  set('author', it.author);
  set('script', it.text);
  return true;
}

function openPicker() {
  const st = { q: '', dynasty: '', author: '', tag: '', kind: '', aq: '', items: [], total: 0, loading: false };
  let seqF = 0; // 筛选项 / 列表各自的请求序号，只认最新一次的返回
  let seqS = 0;
  let pollTimer = null;
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg pp-dlg';
  dlg.innerHTML = `
    <div class="pp-head">
      <div><h3>古诗词库</h3><span class="hint" data-pp-count></span></div>
      <button type="button" class="icon-btn" data-pp-close aria-label="关闭">✕</button>
    </div>
    <div class="pp-search">
      <input data-pp-q placeholder="搜诗名、作者、词牌或诗句，例如：李白 / 明月 / 水调歌头" autocomplete="off" />
      <button type="button" class="btn sm" data-pp-random title="在当前筛选范围里随机挑一首">随机一首</button>
    </div>
    <div class="pp-filters">
      <div class="pp-row"><span class="pp-lbl">朝代</span><div class="chips" data-pp-dyn></div></div>
      <div class="pp-row"><span class="pp-lbl">合集</span><div class="chips" data-pp-tag></div></div>
      <div class="pp-row"><span class="pp-lbl">体裁</span><div class="chips" data-pp-kind></div></div>
      <div class="pp-row">
        <span class="pp-lbl">作者</span>
        <div class="pp-author">
          <input data-pp-aq placeholder="输入作者名筛选，如：苏轼" autocomplete="off" />
          <div class="chips" data-pp-authors></div>
        </div>
      </div>
    </div>
    <div class="pp-list" data-pp-list></div>
    <div class="pp-foot" data-pp-foot></div>`;
  document.body.appendChild(dlg);
  const $$d = (s) => dlg.querySelector(s);
  const listEl = $$d('[data-pp-list]');
  const close = () => {
    clearInterval(pollTimer);
    if (dlg.open) dlg.close();
    dlg.remove();
  };

  const chip = (attr, val, label, on, count) =>
    `<button type="button" class="chip ${on ? 'on' : ''}" ${attr}="${esc(val)}">${esc(label)}${count != null ? `<em>${count}</em>` : ''}</button>`;

  const filters = () => ({ q: st.q, dynasty: st.dynasty, author: st.author, tag: st.tag, kind: st.kind });

  async function refreshFacets() {
    const my = ++seqF;
    const f = await api(`/api/poems/facets?${qs(filters())}`).catch(() => null);
    if (!f || my !== seqF) return;
    $$d('[data-pp-count]').textContent = `${f.full ? '完整库' : '精选库'}共 ${f.all.toLocaleString()} 首 · 当前匹配 ${f.total.toLocaleString()} 首`;
    $$d('[data-pp-dyn]').innerHTML = chip('data-dyn', '', '全部', !st.dynasty) + f.dynasties.map((d) => chip('data-dyn', d.name, d.name, st.dynasty === d.name, d.count)).join('');
    $$d('[data-pp-tag]').innerHTML = chip('data-tag', '', '全部', !st.tag) + f.tags.map((d) => chip('data-tag', d.name, d.name, st.tag === d.name, d.count)).join('');
    $$d('[data-pp-kind]').innerHTML =
      chip('data-kind', '', '全部', !st.kind) + chip('data-kind', 'shi', '诗', st.kind === 'shi', f.kinds.shi) + chip('data-kind', 'ci', '词 / 曲', st.kind === 'ci', f.kinds.ci);
    paintFoot(f);
  }

  async function refreshAuthors() {
    const list = await api(`/api/poems/authors?${qs({ ...filters(), author: '', aq: st.aq, limit: 14 })}`).catch(() => []);
    const sel = st.author && !list.some((a) => a.name === st.author) ? `<button type="button" class="chip on" data-au="${esc(st.author)}">${esc(st.author)} ✕</button>` : '';
    $$d('[data-pp-authors]').innerHTML =
      sel +
      list.map((a) => chip('data-au', a.name, a.name, st.author === a.name, a.count)).join('') +
      (!list.length && !sel ? '<span class="hint">没有匹配的作者</span>' : '');
  }

  function itemHtml(it, i) {
    const lines = it.text.split('\n');
    const prev = lines.slice(0, 2).join('　');
    return `<button type="button" class="pp-item" data-i="${i}">
      <div class="pp-t"><b>${esc(it.title)}</b><span class="pp-a">${esc(it.author)} · ${esc(it.dynasty)}</span>${it.lines > LONG ? `<span class="pp-long" title="句子多，会拆出很多镜头，费用更高">较长</span>` : ''}</div>
      <div class="pp-p">${esc(prev)}${lines.length > 2 ? '…' : ''}</div>
      <div class="pp-m"><span>${it.lines} 句</span>${it.tags.map((t) => `<span class="pp-tag">${esc(t)}</span>`).join('')}</div>
    </button>`;
  }

  function paintList() {
    if (st.loading && !st.items.length) {
      listEl.innerHTML = '<div class="empty"><i class="spin"></i></div>';
      return;
    }
    if (!st.items.length) {
      listEl.innerHTML = '<div class="empty"><b>没有找到</b><p>换个关键词，或者放宽朝代 / 作者的筛选。诗词库是简体中文。</p></div>';
      return;
    }
    listEl.innerHTML =
      st.items.map(itemHtml).join('') +
      (st.items.length < st.total ? `<button type="button" class="btn ghost sm pp-more" data-pp-more>${st.loading ? '加载中…' : `再看 ${Math.min(PAGE, st.total - st.items.length)} 首（还有 ${st.total - st.items.length} 首）`}</button>` : '');
  }

  async function runSearch(more = false) {
    const my = ++seqS;
    st.loading = true;
    if (!more) st.items = [];
    paintList();
    const r = await api(`/api/poems?${qs({ ...filters(), offset: more ? st.items.length : 0, limit: PAGE })}`).catch((e) => {
      toast(`读取诗词库失败：${e.message}`, 'err');
      return null;
    });
    if (my !== seqS) return;
    st.loading = false;
    if (r) {
      st.total = r.total;
      st.items = more ? [...st.items, ...r.items] : r.items;
    }
    paintList();
    if (!more) listEl.scrollTop = 0;
  }

  const refreshAll = () => {
    refreshFacets();
    refreshAuthors();
    runSearch();
  };

  // ---------- 完整库下载 ----------
  function paintFoot(f) {
    const foot = $$d('[data-pp-foot]');
    if (foot.dataset.busy) return;
    foot.innerHTML = f.full
      ? '<span class="hint">已载入完整诗库（全唐诗、全宋词等）。数据来自开源项目 chinese-poetry。</span>'
      : `<span class="hint">当前是内置精选库（唐诗三百首、宋词三百首、千家诗、诗经、楚辞、小学/初中必背，加上名家短篇）。想要全唐诗、全宋词的全部作品（约 7.5 万首）：</span><button type="button" class="btn sm" data-pp-full>下载完整诗库</button>`;
  }
  async function pollFull() {
    const foot = $$d('[data-pp-foot]');
    const s = await api('/api/poems/full').catch(() => null);
    if (!s) return;
    if (s.state === 'running') {
      foot.dataset.busy = '1';
      const pct = Math.round((s.done / Math.max(1, s.total)) * 100);
      foot.innerHTML = `<span class="hint">正在下载完整诗库… ${pct}%（${s.done}/${s.total}）</span><div class="pp-bar"><i style="width:${pct}%"></i></div>`;
    } else {
      clearInterval(pollTimer);
      pollTimer = null;
      delete foot.dataset.busy;
      if (s.state === 'done') {
        toast(`完整诗库已就绪，共 ${s.all.toLocaleString()} 首`, 'ok');
        refreshAll();
      } else if (s.state === 'error') {
        foot.innerHTML = `<span class="hint" style="color:var(--err)">下载失败：${esc(s.error)}（需要能访问 GitHub）</span><button type="button" class="btn sm" data-pp-full>重试</button>`;
      } else refreshFacets();
    }
  }
  async function startFull() {
    const foot = $$d('[data-pp-foot]');
    foot.dataset.busy = '1';
    foot.innerHTML = '<span class="hint">正在开始下载…</span>';
    try {
      await api('/api/poems/full', { method: 'POST' });
    } catch (e) {
      delete foot.dataset.busy;
      return toast(`无法开始下载：${e.message}`, 'err');
    }
    clearInterval(pollTimer);
    pollTimer = setInterval(pollFull, 1000);
    pollFull();
  }

  // ---------- 交互 ----------
  let qTimer = null;
  dlg.addEventListener('input', (e) => {
    if (e.target.matches('[data-pp-q]')) {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        st.q = e.target.value.trim();
        refreshAll();
      }, 250);
    } else if (e.target.matches('[data-pp-aq]')) {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        st.aq = e.target.value.trim();
        refreshAuthors();
      }, 200);
    }
  });
  dlg.addEventListener('click', async (e) => {
    const t = e.target;
    if (t === dlg || t.closest('[data-pp-close]')) return close();
    const dy = t.closest('[data-dyn]');
    if (dy) {
      st.dynasty = dy.dataset.dyn === st.dynasty ? '' : dy.dataset.dyn;
      return refreshAll();
    }
    const tg = t.closest('[data-tag]');
    if (tg) {
      st.tag = tg.dataset.tag === st.tag ? '' : tg.dataset.tag;
      return refreshAll();
    }
    const kd = t.closest('[data-kind]');
    if (kd) {
      st.kind = kd.dataset.kind === st.kind ? '' : kd.dataset.kind;
      return refreshAll();
    }
    const au = t.closest('[data-au]');
    if (au) {
      st.author = au.dataset.au === st.author ? '' : au.dataset.au;
      return refreshAll();
    }
    if (t.closest('[data-pp-more]') && !st.loading) return runSearch(true);
    if (t.closest('[data-pp-full]')) return startFull();
    const done = (it) => {
      if (!fillForm(it)) return toast('请先在创作页选择「古诗词动画」模板', 'err');
      close();
      toast(it.lines > LONG ? `已填入《${it.title}》，共 ${it.lines} 句，会拆出较多镜头，费用比短诗高` : `已填入《${it.title}》· ${it.author}，可以直接改`, 'ok');
    };
    if (t.closest('[data-pp-random]')) {
      const r = await api(`/api/poems/random?${qs(filters())}`).catch(() => null);
      return r?.title ? done(r) : toast('当前筛选下没有可选的诗', 'err');
    }
    const item = t.closest('[data-i]');
    if (item) done(st.items[Number(item.dataset.i)]);
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });

  dlg.showModal();
  $$d('[data-pp-q]').focus();
  refreshAll();
  api('/api/poems/full')
    .then((s) => s.state === 'running' && ((pollTimer = setInterval(pollFull, 1000)), pollFull()))
    .catch(() => {});
}

// ---------- 把按钮挂到创作页 ----------
function inject() {
  const comp = document.getElementById('composer');
  if (!comp || !comp.querySelector('[data-k="author"]')) return; // 只有古诗词模板有「作者」栏
  const head = comp.querySelector('.row-head');
  if (!head || head.querySelector('[data-poem-pick]')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn sm poem-pick';
  btn.dataset.poemPick = '1';
  btn.title = '从古诗词库里按朝代、作者、关键词挑一首，自动填好诗名、作者和正文';
  btn.textContent = '诗词库选诗';
  head.querySelector('h3')?.after(btn);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-poem-pick]')) openPicker();
});
new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
inject();

export { openPicker };
