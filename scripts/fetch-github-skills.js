// 把 server/github-skills.json 里登记的 GitHub Skill 原文下载到 server/github-skills/<id>.md
// 用法：node scripts/fetch-github-skills.js        只下载缺失的
//       node scripts/fetch-github-skills.js --force 全部重新下载
// 来源是各仓库公开的 SKILL.md（MIT / Apache-2.0），下载后原文保存，不做改写。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'server');
const OUT = path.join(ROOT, 'github-skills');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'github-skills.json'), 'utf8'));
const force = process.argv.includes('--force');

async function download(repo, file) {
  for (const branch of ['main', 'master']) {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${file}`, { signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res && res.ok) return { text: await res.text(), branch };
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let bad = 0;
  for (const s of catalog.skills) {
    const dest = path.join(OUT, `${s.id}.md`);
    if (!force && fs.existsSync(dest)) {
      console.log(`跳过（已有）${s.id}`);
      continue;
    }
    const r = await download(s.repo, s.path);
    if (!r) {
      console.log(`失败 ${s.id}  ${s.repo}/${s.path}`);
      bad++;
      continue;
    }
    fs.writeFileSync(dest, r.text.replace(/\r\n/g, '\n'), 'utf8');
    console.log(`完成 ${s.id}  ${s.repo}@${r.branch}/${s.path}  ${r.text.length} 字符`);
  }
  if (bad) process.exitCode = 1;
})();
