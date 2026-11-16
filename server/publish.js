/**
 * 定时发布：把做好的视频（AI 成片 / 剪辑导出）排进发布计划，到点处理。
 *  - 微信公众号：走官方接口 —— 上传封面和视频到素材库，并把「标题 + 文案 + 封面」存进公众号草稿箱。
 *    （接口没法把视频嵌进图文正文，所以最后还要在公众号后台打开草稿、插入刚上传的视频素材再点发布；
 *     需要 AppID / AppSecret，并把本机公网 IP 加入公众号后台的 IP 白名单。）
 *  - 抖音 / 小红书 / 视频号 / B 站：没有可用于个人账号的公开发布接口，也不做模拟登录（容易封号、随时失效），
 *    所以是「到点提醒」：到点在应用里提醒，准备好视频、标题、文案，一键复制后去平台创作中心发布，再标记「已发布」。
 * 数据存在 data/publish.json（含公众号密钥，已被 .gitignore 的 data/ 覆盖，接口返回时脱敏）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const settingsStore = require('./settings');
const pipeline = require('./pipeline');
const edits = require('./edits');
const ff = require('./ffmpeg');

const FILE = path.join(settingsStore.DATA_DIR, 'publish.json');
const MASK = '********';
const WECHAT_BASE = 'https://api.weixin.qq.com';

const PLATFORMS = [
  { key: 'wechat', name: '微信公众号', mode: 'api', center: 'https://mp.weixin.qq.com/' },
  { key: 'douyin', name: '抖音', mode: 'remind', center: 'https://creator.douyin.com/creator-micro/content/upload' },
  { key: 'xhs', name: '小红书', mode: 'remind', center: 'https://creator.xiaohongshu.com/publish/publish' },
  { key: 'channels', name: '视频号', mode: 'remind', center: 'https://channels.weixin.qq.com/platform/post/create' },
  { key: 'bili', name: 'B 站', mode: 'remind', center: 'https://member.bilibili.com/platform/upload/video/frame' },
];

const httpError = (status, message) => Object.assign(new Error(message), { status });
const rid = () => crypto.randomBytes(4).toString('hex');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ----------------------------- 存取 ----------------------------- */

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { wechat: d.wechat || {}, bili: d.bili || {}, tasks: Array.isArray(d.tasks) ? d.tasks : [] };
  } catch {
    return { wechat: {}, bili: {}, tasks: [] };
  }
}
function save(d) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2), 'utf8');
}

function publicWechat(w) {
  return { appId: w.appId || '', appSecret: w.appSecret ? MASK + w.appSecret.slice(-4) : '', baseUrl: w.baseUrl || '', configured: !!(w.appId && w.appSecret) };
}

function saveWechat(input = {}) {
  const d = load();
  const w = { ...d.wechat };
  if (typeof input.appId === 'string') w.appId = input.appId.trim().slice(0, 64);
  if (typeof input.appSecret === 'string' && !input.appSecret.startsWith(MASK)) w.appSecret = input.appSecret.trim().slice(0, 128);
  if (typeof input.baseUrl === 'string') {
    const b = input.baseUrl.trim().replace(/\/+$/, '');
    if (b && !/^https?:\/\//i.test(b)) throw httpError(400, '接口地址要以 http:// 或 https:// 开头');
    w.baseUrl = b;
  }
  d.wechat = w;
  save(d);
  statsCache.delete('wechat');
  return publicWechat(w);
}

/** B 站：只存自己的 UID（公开接口按 UID 读粉丝、投稿、获赞，不需要登录） */
function saveBili(input = {}) {
  const uid = String(input.uid ?? '').trim();
  if (uid && !/^\d{1,18}$/.test(uid)) throw httpError(400, 'B 站 UID 是一串数字，在个人空间网址 space.bilibili.com/ 后面');
  const d = load();
  d.bili = { uid };
  save(d);
  statsCache.delete('bili');
  return { uid };
}

/* ----------------------------- 视频来源 ----------------------------- */

/** 解析来源：返回 { name, file(绝对路径), url(给前端下载 / 预览), cover? }；没做好的来源直接报错 */
function resolveSource(type, id) {
  if (type === 'project') {
    const p = pipeline.listProjects().find((x) => x.id === id);
    if (!p) throw httpError(404, '项目不存在');
    if (p.status !== 'done' || !p.result) throw httpError(400, `「${p.title}」还没有生成成片`);
    const file = path.join(pipeline.OUTPUT_DIR, id, 'final.mp4');
    if (!fs.existsSync(file)) throw httpError(400, `「${p.title}」的成片文件不存在，请重新生成`);
    return { name: p.title, file, url: `/output/${id}/final.mp4` };
  }
  if (type === 'edit') {
    const e = edits.read(id);
    if (e.export?.status !== 'done' || !e.export.file) throw httpError(400, `「${e.name}」还没有导出成片`);
    const file = path.join(edits.dirOf(id), e.export.file);
    if (!fs.existsSync(file)) throw httpError(400, `「${e.name}」的导出文件不存在，请重新导出`);
    return { name: e.name, file, url: `/api/edits/${id}/download` };
  }
  throw httpError(400, '视频来源类型不对');
}

/** 可选的视频：已完成的 AI 项目 + 已导出的剪辑工程 */
function listSources() {
  const out = [];
  for (const p of pipeline.listProjects()) if (p.status === 'done' && p.result) out.push({ type: 'project', id: p.id, name: p.title, duration: p.duration, cover: p.cover });
  for (const e of edits.list()) if (e.export?.status === 'done') out.push({ type: 'edit', id: e.id, name: e.name, duration: e.duration, cover: e.cover });
  return out;
}

/* ----------------------------- 计划 ----------------------------- */

const platName = (k) => PLATFORMS.find((p) => p.key === k)?.name || k;

function taskView(t) {
  let src = null;
  try {
    const r = resolveSource(t.sourceType, t.sourceId);
    src = { name: r.name, url: r.url };
  } catch {
    /* 来源被删了：保留任务，下面标记 */
  }
  const res = t.results || {};
  const vals = t.platforms.map((p) => res[p]?.status || 'pending');
  const status = !t.executed ? 'pending' : vals.includes('failed') ? 'failed' : vals.includes('remind') ? 'waiting' : 'done';
  return {
    id: t.id,
    sourceType: t.sourceType,
    sourceId: t.sourceId,
    sourceName: src?.name || t.sourceName || '（视频已删除）',
    videoUrl: src?.url || '',
    missing: !src,
    title: t.title,
    desc: t.desc,
    tags: t.tags,
    platforms: t.platforms.map((k) => ({ key: k, name: platName(k), center: PLATFORMS.find((p) => p.key === k)?.center, ...(res[k] || { status: 'pending' }) })),
    runAt: t.runAt,
    status,
    executedAt: t.executedAt || 0,
    createdAt: t.createdAt,
  };
}

function listTasks() {
  return load()
    .tasks.map(taskView)
    .sort((a, b) => (a.status === 'pending' && b.status !== 'pending' ? -1 : b.status === 'pending' && a.status !== 'pending' ? 1 : a.status === 'pending' ? a.runAt - b.runAt : b.runAt - a.runAt));
}

function createTask(input = {}) {
  const src = resolveSource(input.sourceType, String(input.sourceId || ''));
  const platforms = [...new Set((Array.isArray(input.platforms) ? input.platforms : []).filter((k) => PLATFORMS.some((p) => p.key === k)))];
  if (!platforms.length) throw httpError(400, '至少选一个发布平台');
  const runAt = Number(input.runAt);
  if (!Number.isFinite(runAt) || runAt <= 0) throw httpError(400, '请选择发布时间');
  const title = str(input.title, 100) || src.name;
  const tags = (Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(/[,，\s#]+/))
    .map((x) => String(x).trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 10);
  const d = load();
  const t = { id: `pb_${rid()}`, sourceType: input.sourceType, sourceId: String(input.sourceId), sourceName: src.name, title, desc: str(input.desc, 2000), tags, platforms, runAt: Math.round(runAt), createdAt: Date.now(), executed: false, results: {} };
  d.tasks.push(t);
  save(d);
  return taskView(t);
}

function deleteTask(id) {
  const d = load();
  if (!d.tasks.some((t) => t.id === id)) throw httpError(404, '发布计划不存在');
  d.tasks = d.tasks.filter((t) => t.id !== id);
  save(d);
}

/** 手动发布的平台：用户在平台发完后点「已发布」 */
function markDone(id, platform) {
  const d = load();
  const t = d.tasks.find((x) => x.id === id);
  if (!t) throw httpError(404, '发布计划不存在');
  if (!t.platforms.includes(platform)) throw httpError(400, '这个计划没有选该平台');
  t.results = { ...t.results, [platform]: { status: 'done', message: '已手动发布', at: Date.now() } };
  save(d);
  return taskView(t);
}

/* ----------------------------- 微信公众号 ----------------------------- */

const WX_HINTS = {
  40013: 'AppID 不正确',
  40125: 'AppSecret 不正确',
  40164: '本机公网 IP 不在公众号后台的 IP 白名单里（公众号后台 → 设置与开发 → 基本配置 → IP 白名单，把报错里的 IP 加进去）',
  40001: 'access_token 无效，请重试',
  48001: '这个公众号没有该接口的权限（个人订阅号通常没有；需要认证后的订阅号或服务号）',
  45009: '接口调用次数超限，请稍后再试',
  45002: '内容超过长度限制',
  40005: '素材文件类型不支持',
  40007: '素材 media_id 无效',
};
function wxError(step, j) {
  const hint = WX_HINTS[j.errcode];
  return new Error(`${step}失败：${hint ? `${hint}（${j.errcode}）` : `${j.errmsg || '未知错误'}（${j.errcode}）`}`);
}
const wxBase = (w) => (w.baseUrl || process.env.WM_WECHAT_BASE || WECHAT_BASE).replace(/\/+$/, '');

async function wxJson(res, step) {
  const j = await res.json().catch(() => ({}));
  if (j.errcode && j.errcode !== 0) throw wxError(step, j);
  return j;
}

async function wxToken(w) {
  if (!w.appId || !w.appSecret) throw new Error('还没有填写公众号的 AppID 和 AppSecret');
  let res;
  try {
    res = await fetch(`${wxBase(w)}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(w.appId)}&secret=${encodeURIComponent(w.appSecret)}`, { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new Error(`连接微信接口失败：${e.message}`);
  }
  const j = await wxJson(res, '获取 access_token ');
  if (!j.access_token) throw new Error('获取 access_token 失败：接口没有返回 token');
  return j.access_token;
}

async function wxUpload(w, token, type, file, filename, description) {
  const form = new FormData();
  form.append('media', new Blob([fs.readFileSync(file)]), filename);
  if (description) form.append('description', JSON.stringify(description));
  let res;
  try {
    res = await fetch(`${wxBase(w)}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=${type}`, { method: 'POST', body: form, signal: AbortSignal.timeout(180000) });
  } catch (e) {
    throw new Error(`上传${type === 'image' ? '封面' : '视频'}失败：${e.message}`);
  }
  const j = await wxJson(res, `上传${type === 'image' ? '封面' : '视频'}`);
  if (!j.media_id) throw new Error(`上传${type === 'image' ? '封面' : '视频'}失败：接口没有返回 media_id`);
  return j.media_id;
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function testWechat() {
  const w = load().wechat;
  await wxToken(w);
  return { ok: true, message: '连接正常，已拿到 access_token' };
}

/** 存进公众号草稿箱：封面（视频截一帧）+ 视频素材 + 图文草稿 */
async function publishWechat(t, src) {
  const w = load().wechat;
  const token = await wxToken(w);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pub-'));
  try {
    const cover = path.join(tmp, 'cover.jpg');
    await ff.run(['-y', '-ss', '0.5', '-i', src.file, '-frames:v', '1', '-vf', 'scale=900:-2', '-q:v', '3', cover]);
    const thumb = await wxUpload(w, token, 'image', cover, 'cover.jpg');
    const warnings = [];
    let videoId = '';
    const size = fs.statSync(src.file).size;
    if (size > 10 * 1024 * 1024) warnings.push(`视频 ${(size / 1048576).toFixed(1)}MB，超过公众号素材库 10MB 的限制，没有上传，请压缩后在后台手动上传`);
    else {
      try {
        videoId = await wxUpload(w, token, 'video', src.file, `${t.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40) || 'video'}.mp4`, { title: t.title.slice(0, 64), introduction: (t.desc || t.title).slice(0, 200) });
      } catch (e) {
        warnings.push(e.message);
      }
    }
    const paras = (t.desc || t.title).split(/\n+/).filter(Boolean).map((p) => `<p>${escHtml(p)}</p>`).join('');
    const tagLine = t.tags.length ? `<p>${t.tags.map((x) => `#${escHtml(x)}`).join(' ')}</p>` : '';
    let res;
    try {
      res = await fetch(`${wxBase(w)}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articles: [{ title: t.title.slice(0, 64), digest: (t.desc || t.title).replace(/\s+/g, ' ').slice(0, 120), content: `${paras}${tagLine}`, thumb_media_id: thumb, need_open_comment: 0, only_fans_can_comment: 0 }] }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new Error(`新建草稿失败：${e.message}`);
    }
    const j = await wxJson(res, '新建草稿');
    const next = videoId ? `视频已上传到素材库，请在公众号后台打开草稿，插入视频素材「${t.title.slice(0, 20)}」后点发布` : '请在公众号后台打开草稿补上视频后发布';
    return { status: 'done', message: `已存入公众号草稿箱（${j.media_id || ''}）。${next}${warnings.length ? `；注意：${warnings.join('；')}` : ''}`, at: Date.now() };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ----------------------------- 数据看板 ----------------------------- */

const STATS_TTL = 5 * 60 * 1000;
const statsCache = new Map();
/** 远端数据 5 分钟内不重复请求（微信接口有调用次数限制） */
async function cachedStats(key, fn, force) {
  const hit = statsCache.get(key);
  if (!force && hit && Date.now() - hit.at < STATS_TTL) return hit.value;
  const value = { ...(await fn()), updatedAt: Date.now() };
  statsCache.set(key, { at: Date.now(), value });
  return value;
}

const ymd = (daysAgo) => {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 公众号官方「数据统计」接口：用户总数、近 7 天新增 / 取关（认证后的号才有权限） */
async function wechatStats() {
  const w = load().wechat;
  if (!w.appId || !w.appSecret) return { status: 'unconfigured', message: '还没有填写公众号的 AppID 和 AppSecret，去「设置 → 发布」填写后这里就能显示粉丝数据。', metrics: [] };
  try {
    const token = await wxToken(w);
    const post = async (api, step) => {
      let res;
      try {
        res = await fetch(`${wxBase(w)}/datacube/${api}?access_token=${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ begin_date: ymd(7), end_date: ymd(1) }),
          signal: AbortSignal.timeout(20000),
        });
      } catch (e) {
        throw new Error(`${step}失败：${e.message}`);
      }
      return wxJson(res, step);
    };
    const [cum, sum] = await Promise.all([post('getusercumulate', '读取用户总数'), post('getusersummary', '读取用户增减')]);
    const list = Array.isArray(cum.list) ? cum.list : [];
    const last = list.length ? list[list.length - 1] : null;
    const rows = Array.isArray(sum.list) ? sum.list : [];
    const add = rows.reduce((n, r) => n + (Number(r.new_user) || 0), 0);
    const cancel = rows.reduce((n, r) => n + (Number(r.cancel_user) || 0), 0);
    return {
      status: 'ok',
      message: `统计到 ${last?.ref_date || ymd(1)}（微信数据有一天延迟）`,
      metrics: [
        { key: 'fans', label: '粉丝总数', value: Number(last?.cumulate_user) || 0 },
        { label: '近 7 天新增', value: add },
        { label: '近 7 天取关', value: cancel },
        { label: '近 7 天净增', value: add - cancel },
      ],
    };
  } catch (e) {
    return { status: 'error', message: e.message, metrics: [] };
  }
}

/** B 站公开的用户名片接口（按 UID 读粉丝、关注、投稿数、获赞） */
async function biliStats() {
  const uid = load().bili?.uid;
  if (!uid) return { status: 'unconfigured', message: '填上你的 B 站 UID（个人空间网址 space.bilibili.com/ 后面那串数字），就能读到粉丝和投稿数据。', metrics: [] };
  try {
    const base = process.env.WM_BILI_API || 'https://api.bilibili.com';
    const res = await fetch(`${base}/x/web-interface/card?mid=${encodeURIComponent(uid)}&photo=false`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', Referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (j.code !== 0) throw new Error(j.code === -404 ? '没有找到这个 UID，请检查是不是填对了' : `B 站接口返回：${j.message || res.status}（${j.code ?? res.status}）`);
    const c = j.data?.card || {};
    return {
      status: 'ok',
      message: `账号：${c.name || uid}`,
      metrics: [
        { key: 'fans', label: '粉丝', value: Number(c.fans ?? j.data?.follower) || 0 },
        { label: '关注', value: Number(c.attention) || 0 },
        { label: '投稿数', value: Number(j.data?.archive_count) || 0 },
        { label: '获赞', value: Number(j.data?.like_num) || 0 },
      ],
    };
  } catch (e) {
    return { status: 'error', message: `读取 B 站数据失败：${e.message}`, metrics: [] };
  }
}

const NO_API = '这个平台没有对个人账号开放的数据接口，暂时没法自动获取；先显示本机的发布记录，数据请到创作中心查看。';
const REMOTE = {
  wechat: { source: '官方接口', fn: wechatStats },
  bili: { source: '公开接口', fn: biliStats },
};

/** 数据看板：总览（所有平台）+ 每个平台的发布记录和远端数据 */
async function dashboard({ refresh = false } = {}) {
  const tasks = listTasks();
  const platforms = await Promise.all(
    PLATFORMS.map(async (p) => {
      const mine = tasks.map((t) => ({ t, p: t.platforms.find((x) => x.key === p.key) })).filter((x) => x.p);
      const count = (st) => mine.filter((x) => x.p.status === st).length;
      const recent = mine
        .map(({ t, p: pp }) => ({ id: t.id, title: t.title, status: pp.status, message: pp.message || '', time: pp.at || t.executedAt || t.runAt }))
        .sort((a, b) => b.time - a.time)
        .slice(0, 5);
      const def = REMOTE[p.key];
      const remote = def
        ? { source: def.source, ...(await cachedStats(p.key, def.fn, refresh)) }
        : { source: '暂无接口', status: 'unavailable', message: NO_API, metrics: [], updatedAt: 0 };
      return {
        key: p.key,
        name: p.name,
        center: p.center,
        mode: p.mode,
        local: { total: mine.length, published: count('done'), waiting: count('remind'), failed: count('failed'), pending: count('pending') },
        recent,
        remote,
        bili: p.key === 'bili' ? { uid: load().bili?.uid || '' } : undefined,
      };
    }),
  );
  const sum = (f) => platforms.reduce((n, p) => n + f(p), 0);
  const fansList = platforms.map((p) => p.remote.metrics.find((m) => m.key === 'fans')).filter(Boolean);
  return {
    now: Date.now(),
    totals: {
      videos: listSources().length,
      published: sum((p) => p.local.published),
      pending: sum((p) => p.local.pending),
      waiting: sum((p) => p.local.waiting),
      failed: sum((p) => p.local.failed),
      fans: fansList.reduce((n, m) => n + m.value, 0),
      fansPlatforms: fansList.length,
      apiPlatforms: platforms.filter((p) => p.remote.status === 'ok').length,
    },
    platforms,
  };
}

/* ----------------------------- 执行 / 调度 ----------------------------- */

const running = new Set();

async function runTask(id) {
  if (running.has(id)) return;
  running.add(id);
  try {
    const d0 = load();
    const t0 = d0.tasks.find((x) => x.id === id);
    if (!t0) throw httpError(404, '发布计划不存在');
    let src = null;
    let srcErr = '';
    try {
      src = resolveSource(t0.sourceType, t0.sourceId);
    } catch (e) {
      srcErr = e.message;
    }
    const results = { ...t0.results };
    for (const p of t0.platforms) {
      if (results[p]?.status === 'done') continue;
      const at = Date.now();
      if (!src) {
        results[p] = { status: 'failed', message: srcErr || '视频不可用', at };
      } else if (p === 'wechat') {
        try {
          results[p] = await publishWechat(t0, src);
        } catch (e) {
          results[p] = { status: 'failed', message: e.message, at: Date.now() };
        }
      } else {
        results[p] = { status: 'remind', message: '到发布时间了，请打开平台创作中心手动发布', at };
      }
    }
    const d = load();
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    t.executed = true;
    t.executedAt = Date.now();
    t.results = results;
    save(d);
    return taskView(t);
  } finally {
    running.delete(id);
  }
}

/** 执行所有到点的计划（调度器每隔一会儿调一次；接口里也能手动触发，方便测试） */
async function tick(now = Date.now()) {
  const due = load().tasks.filter((t) => !t.executed && t.runAt <= now);
  for (const t of due) await runTask(t.id).catch((e) => console.error('发布计划执行出错', e));
  return due.length;
}

/** 需要用户处理的提醒：到点了但要手动发布的平台 */
function alerts() {
  return listTasks().filter((t) => t.status === 'waiting' || t.status === 'failed').map((t) => ({ id: t.id, title: t.title, status: t.status, platforms: t.platforms.filter((p) => p.status === 'remind' || p.status === 'failed').map((p) => ({ key: p.key, name: p.name, status: p.status })) }));
}

let timer = null;
function startScheduler() {
  if (timer) return;
  const every = Number(process.env.WM_PUBLISH_TICK) || 20000;
  timer = setInterval(() => tick().catch((e) => console.error(e)), every);
  timer.unref?.();
  tick().catch(() => {});
}

module.exports = { PLATFORMS, load, publicWechat, saveWechat, saveBili, dashboard, testWechat, listSources, listTasks, createTask, deleteTask, markDone, runTask, tick, alerts, startScheduler };
