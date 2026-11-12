/**
 * 热门相关视频：按模板主题去 B 站公开搜索接口取「播放量最高」的视频，供创作页找灵感、站内嵌入播放。
 * - 只读公开搜索结果，不登录、不下载、不转存视频；播放用 B 站官方外嵌播放器（player.bilibili.com）。
 * - 抖音 / 小红书没有开放的搜索接口，所以这里只接 B 站。
 * - B 站有风控（短时间请求多了返回 412）：结果缓存 6 小时并落盘，被限流后冷却 15 分钟，
 *   实时抓取失败时依次回退到磁盘缓存、随仓库发布的内置快照 server/hot-seed.json。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL = 6 * 3600 * 1000; // 新鲜期：6 小时内不重复请求 B 站（风控友好）
const LIMIT = 12;

/** 每个模板对应的搜索关键词（多个会合并后统一按播放量排序） */
const QUERIES = {
  poem: ['古诗词动画', '古诗 国风动画'],
  story: ['睡前故事 动画', '绘本动画 儿童故事'],
  explainer: ['科普动画', '知识科普 动画短片'],
  talk: ['口播 干货 职场', '口播 知识分享 短视频'],
  heal: ['治愈系动画短片', '暖心 治愈 动画 温柔'],
  free: ['AI动画短片', '原创动画短片'],
};

/** 相关性过滤：标题 / 标签 / 简介里至少命中一个主题词，且不命中通用黑名单（B 站搜索会混进吃播、做饭这类） */
const MUST = {
  poem: /诗|词|古风|国风|国漫|唐|宋|李白|杜甫|苏轼|意境|山水|水墨|汉服/,
  story: /故事|绘本|童话|睡前|寓言|动画/,
  explainer: /科普|原理|为什么|怎么|知识|演示|科学|揭秘|冷知识|动画/,
  talk: /口播|干货|技巧|方法|教程|职场|面试|习惯|知识|vlog|分享/i,
  heal: /治愈|晚安|温柔|暖心|心灵|自愈|安慰|情绪|陪伴/,
  free: /动画|短片|AI/i,
};
const BAN = /吃播|美食|食谱|烹饪|做饭|探店|煲汤|做一碗|直播回放|盘点.*吃|生殖|情色|擦边|成人|耽美|【腐】/;

let cookieCache = { at: 0, value: '' };
const decode = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

async function getCookie() {
  if (cookieCache.value && Date.now() - cookieCache.at < 6 * 3600 * 1000) return cookieCache.value;
  try {
    const r = await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j?.data?.b_3) cookieCache = { at: Date.now(), value: `buvid3=${j.data.b_3}; buvid4=${j.data.b_4 || ''}` };
  } catch {
    /* 没拿到也先试，搜索接口有时不校验 */
  }
  return cookieCache.value;
}

async function search(keyword, page = 1) {
  const u = new URL('https://api.bilibili.com/x/web-interface/search/type');
  u.search = new URLSearchParams({ search_type: 'video', keyword, order: 'click', duration: '1', page: String(page), page_size: '50' }).toString();
  const r = await fetch(u, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: await getCookie() },
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.code !== 0) throw new Error(`B 站搜索失败：${j?.message || `HTTP ${r.status}`}`);
  return j.data?.result || [];
}

const secs = (d) => {
  if (typeof d === 'number') return d;
  const p = String(d || '').split(':').map(Number);
  if (p.some((x) => Number.isNaN(x))) return 0;
  return p.reduce((a, x) => a * 60 + x, 0);
};

function shape(v) {
  const pic = String(v.pic || '');
  return {
    bvid: v.bvid,
    title: decode(v.title),
    author: decode(v.author),
    play: Number(v.play) || 0,
    danmaku: Number(v.danmaku) || 0,
    duration: secs(v.duration),
    pic: pic.startsWith('//') ? `https:${pic}` : pic,
    pubdate: Number(v.pubdate) || 0,
    url: `https://www.bilibili.com/video/${v.bvid}`,
  };
}

/* ----------------------------- 缓存：内置快照 → 磁盘缓存 → 实时抓取 ----------------------------- */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./settings');

const SEED_FILE = path.join(__dirname, 'hot-seed.json'); // 随仓库发布的快照：B 站限流 / 断网时兜底
const DISK_FILE = path.join(DATA_DIR, 'discover-cache.json');
let store = null; // { [templateId]: { source, keywords, fetchedAt, items } }
let blockedUntil = 0; // B 站返回 412 等限流后，一段时间内不再请求，避免越封越久

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return {};
  }
};

function loadStore() {
  if (store) return store;
  const seed = readJson(SEED_FILE);
  const disk = readJson(DISK_FILE);
  store = { ...seed };
  for (const [k, v] of Object.entries(disk)) if (!store[k] || v.fetchedAt > store[k].fetchedAt) store[k] = v;
  return store;
}

function saveDisk() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DISK_FILE, JSON.stringify(store));
  } catch {
    /* 缓存写不进去不影响功能 */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 实时抓取某模板的热门视频：每个关键词只请求 1 次（每页 50 条），请求之间留间隔 */
async function fetchLive(key) {
  const seen = new Set();
  const items = [];
  const relevant = [];
  let first = true;
  for (const kw of QUERIES[key]) {
    if (!first) await sleep(1200);
    first = false;
    const list = await search(kw);
    for (const v of list) {
      if (v.type && v.type !== 'video') continue;
      const it = shape(v);
      if (!it.bvid || seen.has(it.bvid) || !it.play || it.duration < 5 || it.duration > 600) continue;
      seen.add(it.bvid);
      const text = `${it.title} ${decode(v.tag)} ${decode(v.description)}`;
      if (BAN.test(text)) continue;
      items.push(it);
      if (MUST[key].test(text)) relevant.push(it);
    }
  }
  // 命中主题词的足够多就只用它们；太少则退回全部（仍剔除黑名单），保证不至于一片空白
  const pool = relevant.length >= 6 ? relevant : items;
  pool.sort((a, b) => b.play - a.play);
  if (!pool.length) throw new Error('没有搜到相关视频');
  return { source: 'bilibili', keywords: QUERIES[key], fetchedAt: Date.now(), items: pool.slice(0, LIMIT) };
}

/** 取某模板的热门视频，按播放量从高到低。stale=true 表示这是旧数据（实时抓取失败时的兜底） */
async function hot(templateId, { force = false } = {}) {
  const key = QUERIES[templateId] ? templateId : 'free';
  const s = loadStore();
  const have = s[key];
  if (have && !force && Date.now() - have.fetchedAt < TTL) return { ...have, cached: true };
  const fallback = (e) => {
    if (have) return { ...have, cached: true, stale: true, staleReason: e.message };
    throw e;
  };
  if (Date.now() < blockedUntil) return fallback(new Error('B 站暂时限制了访问，稍后会自动重试'));
  try {
    const data = await fetchLive(key);
    s[key] = data;
    saveDisk();
    return { ...data, cached: false };
  } catch (e) {
    if (/412|429|风控|频繁/.test(e.message)) blockedUntil = Date.now() + 15 * 60 * 1000;
    return fallback(e);
  }
}

/** 把当前缓存写成内置快照（scripts/refresh-hot-seed.js 用） */
function writeSeed() {
  fs.writeFileSync(SEED_FILE, JSON.stringify(loadStore(), null, 1));
}

module.exports = { hot, writeSeed, QUERIES };
