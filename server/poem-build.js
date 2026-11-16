/**
 * 诗词库构建：从开源项目 chinese-poetry（MIT，https://github.com/chinese-poetry/chinese-poetry）下载数据，
 * 整理成统一格式（简体、带朝代 / 作者 / 标签）。
 *   - 精选版（curated）：打进仓库的内置库，唐诗三百首 / 宋词三百首 / 千家诗 / 诗经 / 楚辞 / 必背篇目 + 名家短篇，约 1.2 万首
 *   - 完整版（full）：再加上全唐诗、全宋词等，约 7.5 万首，由用户在界面里一键下载
 * 全唐诗等原文是繁体，用 opencc-js 转成简体（只在构建时用到，按需加载）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/';
const DYNASTIES = ['先秦', '汉', '魏晋南北朝', '唐', '五代', '宋', '金', '元', '明', '清'];
const TAGS = ['小学必背', '初中必背', '唐诗三百首', '宋词三百首', '千家诗', '诗经', '楚辞'];

// 精选版里收全（短篇）的名家
const FAMOUS = new Set(
  (
    '李白 杜甫 白居易 王维 李商隐 杜牧 孟浩然 刘禹锡 柳宗元 韩愈 王昌龄 李贺 岑参 高适 韦应物 贺知章 孟郊 张继 骆宾王 王勃 陈子昂 张九龄 王之涣 元稹 贾岛 崔颢 刘长卿 温庭筠 李绅 杜荀鹤 常建 钱起 韩翃 崔护 李益 卢纶 王建 张祜 罗隐 韦庄 杨炯 卢照邻 宋之问 沈佺期 王翰 祖咏 储光羲 李颀 皎然 寒山 司空曙 戴叔伦 郑谷 许浑 皮日休 陆龟蒙 薛涛 鱼玄机 李端 张若虚 刘希夷 虞世南 魏徵 太宗皇帝 则天皇后 ' +
      '苏轼 辛弃疾 李清照 柳永 周邦彦 姜夔 秦观 晏殊 晏几道 欧阳修 范仲淹 陆游 岳飞 王安石 吴文英 史达祖 张先 贺铸 朱敦儒 李煜 李璟 冯延巳 纳兰性德 蒋捷 刘克庄 陈亮 文天祥 朱熹 杨万里 范成大 黄庭坚 苏辙 司马光 林逋 张孝祥 陆游 叶绍翁 林升 宋祁 韩琦 王观 严蕊 朱淑真 唐婉 谢枋得 ' +
      '曹操 曹植 陶渊明 刘邦 项羽 汉武帝 马致远 关汉卿 白朴 张可久 张养浩 于谦 唐寅 高启 杨慎 郑燮 袁枚 龚自珍 纳兰性德 顾炎武 黄景仁 林则徐 毛泽东'
  ).split(/\s+/),
);
const CURATED_MAX_LINES = 4; // 诗按行（一联一行），词按分句，所以词的上限放宽
const CURATED_MAX_CI = 34;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// 去掉「(腾 一作：螣)」这类校勘注
const lineClean = (s) => clean(s).replace(/[（(][^）)]{0,40}[）)]/g, '').trim();
const norm = (s) => s.replace(/[^\u4e00-\u9fff]/g, '');

function makeFetcher(cacheDir, log) {
  fs.mkdirSync(cacheDir, { recursive: true });
  return async function getJson(rel, tries = 4) {
    const cf = path.join(cacheDir, rel.replace(/[\\/]/g, '__'));
    if (fs.existsSync(cf)) {
      try {
        return JSON.parse(fs.readFileSync(cf, 'utf8'));
      } catch {
        fs.rmSync(cf, { force: true });
      }
    }
    const url = BASE + rel.split('/').map(encodeURIComponent).join('/');
    let err;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const t = await r.text();
        const j = JSON.parse(t);
        fs.writeFileSync(cf, t);
        return j;
      } catch (e) {
        err = e;
        await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
      }
    }
    log?.(`下载失败 ${rel}：${err?.message}`);
    throw new Error(`下载 ${rel} 失败：${err?.message}`);
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

/**
 * @param {{ full?: boolean, cacheDir?: string, onProgress?: (done:number,total:number,label:string)=>void, log?: Function }} opt
 * @returns {Promise<{ data: object, count: number, authors: number, missing: string[] }>}
 */
async function build(opt = {}) {
  const { full = false, onProgress = () => {}, log = () => {} } = opt;
  let OpenCC;
  try {
    OpenCC = require('opencc-js');
  } catch {
    throw new Error('缺少 opencc-js（npm install 后重试）');
  }
  const t2s = OpenCC.Converter({ from: 't', to: 'cn' });
  const getJson = makeFetcher(opt.cacheDir || path.join(os.tmpdir(), 'wm-poems-cache'), log);

  const tangFiles = Array.from({ length: 58 }, (_, i) => `全唐诗/poet.tang.${i * 1000}.json`);
  const ciFiles = Array.from({ length: 22 }, (_, i) => `宋词/ci.song.${i * 1000}.json`);
  const huaFiles = Array.from({ length: 10 }, (_, i) => `五代诗词/huajianji/huajianji-${i + 1}-juan.json`);
  const small = ['蒙学/tangshisanbaishou.json', '宋词/宋词三百首.json', '蒙学/qianjiashi.json', '诗经/shijing.json', '楚辞/chuci.json', '曹操诗集/caocao.json', '纳兰性德/纳兰性德诗集.json', '水墨唐诗/shuimotangshi.json', '五代诗词/nantang/poetrys.json'];
  // 精选版也要从全唐诗 / 全宋词里挑名家的作品，所以两种模式都要下这几十个文件
  const jobs = [...tangFiles, ...ciFiles, ...huaFiles, ...small];
  let done = 0;
  const dl = async (f) => {
    const j = await getJson(f);
    onProgress(++done, jobs.length, f);
    return j;
  };
  const tangRaw = (await pool(tangFiles, 6, dl)).filter(Boolean).flat();
  const ciRaw = (await pool(ciFiles, 6, dl)).filter(Boolean).flat();
  const huajian = (await pool(huaFiles, 5, dl)).filter(Boolean).flat();
  const [t300, ci300, qjs, shijing, chuci, caocao, nalan, shuimo, nantang] = await pool(small, 5, dl);

  const byKey = new Map();
  // 以「作者 + 正文前 4 个字」判断是不是同一首（不同来源异体字多，用标题对不上）
  const keyOf = (author, lines) => `${author}|${norm(lines.join('')).slice(0, 4)}`;
  const mk = (r) => {
    const lines = (r.lines || []).map(lineClean).filter(Boolean);
    const title = clean(r.title);
    if (!title || !lines.length) return null;
    return { title, author: clean(r.author) || '佚名', dynasty: r.dynasty, lines, tags: new Set(r.tags || []), kind: r.kind || 'shi', core: !!r.core };
  };

  // 1) 底库：全唐诗 / 全宋词
  let tick = 0;
  for (const p of tangRaw) {
    if (++tick % 1500 === 0) await new Promise((ok) => setImmediate(ok)); // 繁转简比较耗时，让出事件循环，别把服务卡住
    const paras = (p.paragraphs || []).map((x) => t2s(String(x)));
    if (paras.length < 2) continue; // 残句
    // 去掉乐府分类前缀：「杂曲歌辞 长干曲四首 一」→「长干曲四首 一」
    const title = t2s(String(p.title || '')).replace(/^(杂曲歌辞|横吹曲辞|相和歌辞|琴曲歌辞|清商曲辞|郊庙歌辞|燕射歌辞|鼓吹曲辞|舞曲歌辞|新乐府辞|近代曲辞|杂歌谣辞)\s*/, '');
    if (/^(句|断句|残句)/.test(title)) continue;
    if (paras.some((x) => /[□�]/.test(x))) continue; // 缺字
    const row = mk({ title, author: t2s(String(p.author || '')), dynasty: '唐', lines: paras });
    if (row && !byKey.has(keyOf(row.author, row.lines))) byKey.set(keyOf(row.author, row.lines), row);
  }
  for (const p of ciRaw) {
    const row = mk({ title: p.rhythmic, author: p.author, dynasty: '宋', lines: p.paragraphs, kind: 'ci' });
    if (row && !byKey.has(keyOf(row.author, row.lines))) byKey.set(keyOf(row.author, row.lines), row);
  }

  // 2) 精选集：命中底库的补标签（并换成更规范的标题 / 正文），没命中的新增
  const merge = (r) => {
    const row = mk({ ...r, core: true });
    if (!row) return null;
    const k = keyOf(row.author, row.lines);
    const hit = byKey.get(k);
    if (hit) {
      row.tags.forEach((t) => hit.tags.add(t));
      // 第一个命中的精选集决定标题和正文（唐诗三百首排在千家诗前面，标题更规范）
      if (r.override || (r.prefer !== false && hit.kind === 'shi' && !hit.core)) {
        hit.title = row.title;
        hit.lines = row.lines;
      }
      hit.core = true;
      if (r.forceDynasty && r.dynasty) hit.dynasty = r.dynasty;
      return hit;
    }
    byKey.set(k, row);
    return row;
  };

  for (const g of t300?.content || []) {
    for (const p of g.content || []) {
      const title = t2s(String(p.chapter || '')) || t2s(String(p.subchapter || ''));
      merge({ title, author: t2s(String(p.author)), dynasty: '唐', lines: (p.paragraphs || []).map((x) => t2s(String(x))), tags: ['唐诗三百首'] });
    }
  }
  for (const p of ci300 || []) merge({ title: p.rhythmic, author: p.author, dynasty: '宋', lines: p.paragraphs, tags: ['宋词三百首'], kind: 'ci' });
  const dynMap = { 唐: '唐', 宋: '宋', 明: '明', 清: '清', 元: '元', 南宋: '宋', 北宋: '宋', 五代: '五代', 隋: '唐', 汉: '汉', 魏: '魏晋南北朝', 晋: '魏晋南北朝', 金: '金' };
  for (const g of qjs?.content || []) {
    for (const p of g.content || []) {
      const m = String(p.author || '').match(/[（(]([^）)]+)[）)]\s*(.+)/);
      merge({ title: t2s(String(p.chapter || '')), author: t2s(m ? m[2] : String(p.author || '')), dynasty: dynMap[t2s(m ? m[1] : '')] || '宋', lines: (p.paragraphs || []).map((x) => t2s(String(x))), tags: ['千家诗'], prefer: false });
    }
  }
  for (const p of shuimo || []) merge({ title: p.title, author: p.author, dynasty: '唐', lines: p.paragraphs });
  for (const p of shijing || []) merge({ title: p.title, author: '佚名', dynasty: '先秦', lines: p.content, tags: ['诗经'], prefer: false });
  const preQin = new Set(['屈原', '宋玉', '景差']);
  for (const p of chuci || []) merge({ title: p.title, author: p.author, dynasty: preQin.has(clean(p.author)) ? '先秦' : '汉', lines: p.content, tags: ['楚辞'] });
  for (const p of caocao || []) merge({ title: p.title, author: '曹操', dynasty: '汉', lines: p.paragraphs });
  for (const p of nalan || []) merge({ title: p.title || p.rhythmic, author: '纳兰性德', dynasty: '清', lines: p.para || p.paragraphs || [], kind: p.rhythmic ? 'ci' : 'shi' });
  const tangEnd = new Set(['温庭筠', '皇甫松']);
  for (const p of [...(nantang || []), ...huajian]) {
    const au = clean(p.author);
    merge({ title: p.rhythmic || String(p.title || '').split('·')[0], author: au, dynasty: tangEnd.has(au) ? '唐' : '五代', lines: p.paragraphs, kind: 'ci' });
  }

  // 3) 手工整理：其它朝代名篇 + 必背篇目标签
  const extra = require('./poem-data/extra.js');
  const school = require('./poem-data/school.js');
  for (const e of extra) merge({ title: e.title, author: e.author, dynasty: e.dynasty, forceDynasty: true, override: true, lines: e.text.split('\n'), tags: e.tags || [], kind: e.kind || 'shi' });
  const all = [...byKey.values()];
  const missing = [];
  for (const [title, author, grade, hint] of school) {
    const t = norm(title);
    const cands = all.filter((r) => {
      if (r.author !== author) return false;
      if (hint) return r.lines.join('').includes(hint);
      const rt = norm(r.title);
      return rt === t || rt.startsWith(t) || (t.length >= 3 && rt.includes(t));
    });
    const best = cands.find((r) => r.core) || cands[0];
    if (best) {
      best.tags.add(grade);
      best.core = true;
    } else missing.push(`${grade} ${title}（${author}）`);
  }

  // 4) 精选版本和全唐诗的异体字版本（如「床前看月光」）会各占一条，同作者、同标题、同句数的只留精选的那条
  // （词不能这么去重：同一词牌下有大量不同的词）
  const coreKeys = new Set([...byKey.values()].filter((r) => r.core && r.kind === 'shi').map((r) => `${r.author}|${norm(r.title)}|${r.lines.length}`));
  for (const [k, r] of byKey) if (!r.core && r.kind === 'shi' && coreKeys.has(`${r.author}|${norm(r.title)}|${r.lines.length}`)) byKey.delete(k);

  // 5) 输出
  let final = [...byKey.values()];
  if (!full) final = final.filter((r) => r.core || (FAMOUS.has(r.author) && r.lines.length <= (r.kind === 'ci' ? CURATED_MAX_CI : CURATED_MAX_LINES)));
  final.sort((a, b) => Number(b.core) - Number(a.core)); // 精选的排前面，没有搜索词时先看到的是名篇
  const authors = [...new Set(final.map((r) => r.author))];
  const aIdx = new Map(authors.map((a, i) => [a, i]));
  const data = {
    v: 1,
    full,
    dynasties: DYNASTIES,
    tags: TAGS,
    authors,
    // [标题, 作者序号, 朝代序号, 正文(\n 分行), 标签位图, 体裁 0诗 1词]
    rows: final.map((r) => [
      r.title,
      aIdx.get(r.author),
      Math.max(0, DYNASTIES.indexOf(r.dynasty)),
      r.lines.join('\n'),
      [...r.tags].reduce((m, t) => (TAGS.includes(t) ? m | (1 << TAGS.indexOf(t)) : m), 0),
      r.kind === 'ci' ? 1 : 0,
    ]),
  };
  return { data, count: final.length, authors: authors.length, missing };
}

/** 序列化：JSON → brotli（中文用 brotli 比 gzip 小两成左右） */
function pack(data) {
  const zlib = require('zlib');
  const json = Buffer.from(JSON.stringify(data));
  const buf = zlib.brotliCompressSync(json, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length } });
  return { buf, jsonBytes: json.length };
}
/** 异步版（在线程池里压缩，不卡服务）；quality 低一点换速度，完整库约 15MB JSON */
async function packAsync(data, quality = 6) {
  const zlib = require('zlib');
  const json = Buffer.from(JSON.stringify(data));
  const buf = await new Promise((ok, no) =>
    zlib.brotliCompress(json, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length } }, (e, r) => (e ? no(e) : ok(r))),
  );
  return { buf, jsonBytes: json.length };
}
function unpack(buf) {
  return JSON.parse(require('zlib').brotliDecompressSync(buf).toString('utf8'));
}

module.exports = { build, pack, packAsync, unpack, DYNASTIES, TAGS };
