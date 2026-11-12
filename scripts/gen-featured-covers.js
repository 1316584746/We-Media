// 一次性生成「创作精选」的封面图到 public/featured/<id>.jpg
// 用已配置的文生图（设置里的 image 配置），每张约一次文生图费用。
//   node scripts/gen-featured-covers.js            只补缺失的封面
//   node scripts/gen-featured-covers.js --force    全部重新生成
//   node scripts/gen-featured-covers.js cat-cafe   只生成指定 id
const fs = require('fs');
const os = require('os');
const path = require('path');
const settingsStore = require('../server/settings');
const providers = require('../server/providers');
const ff = require('../server/ffmpeg');
const { FEATURED, styleOf } = require('../server/featured');

const OUT = path.join(settingsStore.ROOT, 'public', 'featured');
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

(async () => {
  const cfg = settingsStore.load().image;
  if (cfg.mode === 'mock') {
    console.error('文生图还是 mock 模式，请先在设置里配置真实的文生图再运行');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const todo = FEATURED.filter((f) => (!only.length || only.includes(f.id)) && (force || only.length || !fs.existsSync(path.join(OUT, `${f.id}.jpg`))));
  console.log(`需要生成 ${todo.length} 张封面`);
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const f = todo[next++];
      const tmp = path.join(os.tmpdir(), `wm-cover-${f.id}.png`);
      try {
        // 百炼文生图有限流（429）：退避后重试
        for (let attempt = 1; ; attempt++) {
          try {
            await providers.generateImage({ cfg, render: { orientation: f.orientation }, prompt: `${f.coverPrompt}，${styleOf(f.styleName)}`, outFile: tmp });
            break;
          } catch (e) {
            if (attempt >= 4 || !/429|rate|Throttling/i.test(e.message)) throw e;
            await new Promise((r) => setTimeout(r, 6000 * attempt));
          }
        }
        // 统一压成宽 540 的 jpg，仓库里每张几十 KB
        await ff.run(['-y', '-i', tmp, '-vf', f.orientation === 'portrait' ? 'scale=540:-2' : 'scale=960:-2', '-q:v', '4', path.join(OUT, `${f.id}.jpg`)]);
        fs.rmSync(tmp, { force: true });
        console.log(`OK    ${f.id}`);
      } catch (e) {
        failed++;
        console.error(`FAIL  ${f.id}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, todo.length || 1) }, worker));
  console.log(failed ? `${failed} 张失败，可以重新运行补齐` : '完成');
  process.exit(failed ? 1 : 0);
})();
