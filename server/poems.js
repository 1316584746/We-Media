/**
 * 古诗词库：按关键词 / 朝代 / 作者 / 标签检索，选中后前端自动填充到「古诗词动画」的表单里。
 * - 内置精选版 server/poems/poems.json.br（约 2.5 万首，随仓库发布）
 * - 完整版（全唐诗 + 全宋词等约 7.5 万首）由用户在界面里一键下载，存到 data/poems-full.json.br，下载后优先用它
 * 数据来源与整理规则见 poem-build.js。
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./settings');
const builder = require('./poem-build');

const BUNDLED = path.join(__dirname, 'poems', 'poems.json.br');
const FULL = path.join(DATA_DIR, 'poems-full.json.br');

let db = null;

const plainOf = (s) => s.replace(/[^\u4e00-\u9fff]/g, '');

function prepare(data) {
  const items = data.rows.map((r, i) => {
    const [title, ai, di, text, bits, kind] = r;
    return {
      id: i,
      title,
      author: data.authors[ai],
      dynasty: data.dynasties[di],
      text,
      kind: kind ? 'ci' : 'shi',
      tags: data.tags.filter((_, k) => bits & (1 << k)),
      n: text.split('\n').length,
      plain: plainOf(text),
    };
  });
  return { full: !!data.full, dynasties: data.dynasties, tags: data.tags, items };
}

function load() {
  if (db) return db;
  const file = fs.existsSync(FULL) ? FULL : BUNDLED;
  try {
    db = prepare(builder.unpack(fs.readFileSync(file)));
  } catch (e) {
    console.error('[poems] 读取诗词库失败：', e.message);
    db = { full: false, dynasties: builder.DYNASTIES, tags: builder.TAGS, items: [] };
  }
  return db;
}

const num = (v, d, max) => Math.max(0, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : d));

/** 把查询条件整理成过滤函数。skip 里列出的维度不参与过滤（算筛选项数量时用） */
function matcher(f, skip = []) {
  const terms = String(f.q || '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ raw: t, plain: plainOf(t) }));
  const dyn = f.dynasty || '';
  const author = f.author || '';
  const tag = f.tag || '';
  const kind = f.kind === 'ci' || f.kind === 'shi' ? f.kind : '';
  const score = (it) => {
    let s = 0;
    for (const t of terms) {
      let ts = 0;
      if (it.title === t.raw) ts = 100;
      else if (it.author === t.raw) ts = 80;
      else if (it.title.includes(t.raw)) ts = 50;
      else if (it.author.includes(t.raw)) ts = 40;
      else if (t.plain && it.plain.includes(t.plain)) ts = 10;
      else return -1;
      s += ts;
    }
    return s;
  };
  const ok = (it) => {
    if (!skip.includes('dynasty') && dyn && it.dynasty !== dyn) return false;
    if (!skip.includes('author') && author && it.author !== author) return false;
    if (!skip.includes('tag') && tag && !it.tags.includes(tag)) return false;
    if (!skip.includes('kind') && kind && it.kind !== kind) return false;
    return true;
  };
  return { score, ok, hasTerms: terms.length > 0 };
}

const brief = (it) => ({ id: it.id, title: it.title, author: it.author, dynasty: it.dynasty, kind: it.kind, tags: it.tags, lines: it.n, text: it.text });

function search(f = {}) {
  const { items } = load();
  const m = matcher(f);
  const offset = num(f.offset, 0, 1e7);
  const limit = num(f.limit, 30, 100) || 30;
  let hits = [];
  if (m.hasTerms) {
    for (const it of items) {
      if (!m.ok(it)) continue;
      const s = m.score(it);
      if (s >= 0) hits.push([s, it]);
    }
    hits.sort((a, b) => b[0] - a[0]); // Array.sort 稳定：同分保持库里的顺序（名篇在前）
    hits = hits.map((h) => h[1]);
  } else {
    hits = items.filter(m.ok);
  }
  return { total: hits.length, offset, items: hits.slice(offset, offset + limit).map(brief) };
}

function facets(f = {}) {
  const d = load();
  const count = (skip, key, names) => {
    const m = matcher(f, skip);
    const c = new Map();
    for (const it of d.items) {
      if (!m.ok(it) || (m.hasTerms && m.score(it) < 0)) continue;
      if (key === 'tags') it.tags.forEach((t) => c.set(t, (c.get(t) || 0) + 1));
      else c.set(it[key], (c.get(it[key]) || 0) + 1);
    }
    return { list: names.map((name) => ({ name, count: c.get(name) || 0 })), c };
  };
  const dyn = count(['dynasty'], 'dynasty', d.dynasties);
  const tags = count(['tag'], 'tags', d.tags);
  const kinds = count(['kind'], 'kind', ['shi', 'ci']);
  const total = search({ ...f, limit: 1 }).total;
  return {
    total,
    all: d.items.length,
    full: d.full,
    dynasties: dyn.list.filter((x) => x.count || x.name === f.dynasty),
    tags: tags.list.filter((x) => x.count || x.name === f.tag),
    kinds: { shi: kinds.c.get('shi') || 0, ci: kinds.c.get('ci') || 0 },
  };
}

/** 作者列表（带数量），aq 是在作者名里搜索；按篇数从多到少 */
function authors(f = {}) {
  const d = load();
  const m = matcher(f, ['author']);
  const aq = String(f.aq || '').trim();
  const c = new Map();
  for (const it of d.items) {
    if (aq && !it.author.includes(aq)) continue;
    if (!m.ok(it) || (m.hasTerms && m.score(it) < 0)) continue;
    const e = c.get(it.author) || { name: it.author, dynasty: it.dynasty, count: 0 };
    e.count++;
    c.set(it.author, e);
  }
  return [...c.values()].sort((a, b) => b.count - a.count).slice(0, num(f.limit, 30, 200) || 30);
}

function random(f = {}) {
  const d = load();
  const m = matcher(f);
  const pool = d.items.filter((it) => m.ok(it) && (!m.hasTerms || m.score(it) >= 0) && it.n <= 16);
  if (!pool.length) return null;
  return brief(pool[Math.floor(Math.random() * pool.length)]);
}

// ---------- 完整版下载 ----------
let job = { state: 'idle', done: 0, total: 0, label: '', error: '', count: 0 };

function status() {
  const d = load();
  return { ...job, full: d.full, all: d.items.length, fullFile: fs.existsSync(FULL) };
}

function startFullDownload() {
  if (job.state === 'running') return status();
  job = { state: 'running', done: 0, total: 1, label: '准备下载', error: '', count: 0 };
  const cacheDir = path.join(DATA_DIR, 'poems-cache');
  (async () => {
    try {
      const { data, count } = await builder.build({
        full: true,
        cacheDir,
        onProgress: (done, total, label) => Object.assign(job, { done, total, label }),
      });
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${FULL}.tmp`;
      fs.writeFileSync(tmp, (await builder.packAsync(data)).buf);
      fs.renameSync(tmp, FULL);
      fs.rmSync(cacheDir, { recursive: true, force: true });
      db = null;
      load();
      job = { ...job, state: 'done', count, done: job.total };
    } catch (e) {
      job = { ...job, state: 'error', error: e.message };
    }
  })();
  return status();
}

module.exports = { search, facets, authors, random, status, startFullDownload, load };
