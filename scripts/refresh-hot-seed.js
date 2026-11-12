// 刷新「热门动画」内置快照 server/hot-seed.json：B 站限流 / 断网时前端还有数据可展示。
// 用法：node scripts/refresh-hot-seed.js
// 会依次抓取每个模板（间隔 4 秒，避免触发 B 站风控）；任何一个失败就不写快照。
const discover = require('../server/discover');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ids = Object.keys(discover.QUERIES);
  for (let i = 0; i < ids.length; i++) {
    if (i) await sleep(4000);
    let r;
    try {
      r = await discover.hot(ids[i], { force: true });
    } catch (e) {
      r = { stale: true, staleReason: e.message };
    }
    if (r.stale) {
      console.error(`FAIL  ${ids[i]}: ${r.staleReason}（没有写入快照，稍后再试）`);
      process.exit(1);
    }
    console.log(`OK    ${ids[i]}  ${r.items.length} 条，最高 ${r.items[0].play} 播放：${r.items[0].title.slice(0, 24)}`);
  }
  discover.writeSeed();
  console.log('已写入 server/hot-seed.json');
})();
