/**
 * 生成内置诗词库（精选版）server/poems/poems.json.br。
 * 用法：node scripts/build-poems.js          生成精选版（需要能访问 raw.githubusercontent.com）
 *       node scripts/build-poems.js --full   生成完整版到临时目录，仅用于看统计
 * 数据来源与整理规则见 server/poem-build.js。opencc-js 用来把繁体转简体（用户在界面里下载完整版时也会用到）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, pack } = require('../server/poem-build');

(async () => {
  const full = process.argv.includes('--full');
  const t0 = Date.now();
  const { data, count, authors, missing } = await build({ full, onProgress: (d, t) => d % 20 === 0 && console.log(`下载 ${d}/${t}`) });
  const { buf, jsonBytes } = pack(data);
  const out = full ? path.join(os.tmpdir(), 'wm-poems-full.json.br') : path.join(__dirname, '..', 'server', 'poems', 'poems.json.br');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  const byDyn = {};
  for (const r of data.rows) byDyn[data.dynasties[r[2]]] = (byDyn[data.dynasties[r[2]]] || 0) + 1;
  const tagCnt = {};
  data.tags.forEach((t, i) => (tagCnt[t] = data.rows.filter((r) => r[4] & (1 << i)).length));
  const summary = [
    `${full ? '完整版' : '精选版'}：${count} 首，${authors} 位作者，json ${(jsonBytes / 1e6).toFixed(1)}MB → br ${(buf.length / 1e6).toFixed(2)}MB，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    '朝代：' + JSON.stringify(byDyn),
    '标签：' + JSON.stringify(tagCnt),
    `必背篇目没找到 ${missing.length} 首：`,
    ...missing,
    '输出：' + out,
  ].join('\n');
  fs.writeFileSync(path.join(os.tmpdir(), 'wm-poems-build.txt'), summary, 'utf8'); // 控制台中文会乱码，读这个文件
  console.log('done');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
