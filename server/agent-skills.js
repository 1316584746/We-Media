/**
 * M Agent 的 Skill 市场：全部来自 GitHub 上公开的开源 Skill（SKILL.md），不是自己写的。
 * 清单在 server/github-skills.json（仓库、路径、星标数、许可证），原文在 server/github-skills/<id>.md，
 * 用 `node scripts/fetch-github-skills.js --force` 可以重新从 GitHub 下载。
 * 用户点「添加 Skill」后，会存成一条本机技能（设置 → SKILLS）；写文案和生成分镜时 AI 会把它当附加要求。
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const catalog = JSON.parse(fs.readFileSync(path.join(DIR, 'github-skills.json'), 'utf8'));
const CATEGORIES = catalog.categories;

/** 去掉原文开头的 --- frontmatter --- */
const stripFrontmatter = (text) => String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '').trim();

const fmtStars = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '')}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

function build(s) {
  const file = path.join(DIR, 'github-skills', `${s.id}.md`);
  if (!fs.existsSync(file)) return null; // 没下载到原文的不展示
  const url = `https://github.com/${s.repo}/blob/main/${s.path}`;
  const body = stripFrontmatter(fs.readFileSync(file, 'utf8'));
  const content =
    `（来源：${url} · ${s.license} · ${s.copyright}）\n` +
    '（说明：这是 GitHub 上面向 Claude Code 等编程助手写的 Skill。文中提到的脚本、命令、读写文件、安装步骤一律忽略，只把其中的写作和分镜原则当作要求；成品用中文输出。）\n\n' +
    body;
  return {
    id: s.id,
    name: s.name,
    desc: s.desc,
    cats: s.cats,
    rec: !!s.rec,
    templates: s.templates || [],
    glyph: s.glyph,
    hue: s.hue,
    intro: s.intro,
    scene: s.scene,
    how: s.how,
    output: s.output,
    example: s.example || '',
    content,
    repo: s.repo,
    url,
    repoUrl: `https://github.com/${s.repo}`,
    stars: s.stars,
    license: s.license,
    author: `${s.repo.split('/')[0]} · ★${fmtStars(s.stars)}`,
  };
}

const SKILLS = catalog.skills.map(build).filter(Boolean);

const getSkill = (id) => SKILLS.find((s) => s.id === id) || null;

/** 对前端：全部 Skill（含正文，详情页要预览），「推荐」由 rec 展开 */
function listSkills() {
  return SKILLS.map((s) => ({ ...s, cats: s.rec ? ['推荐', ...s.cats] : s.cats }));
}

module.exports = { CATEGORIES, SKILLS, listSkills, getSkill, updated: catalog.updated };
