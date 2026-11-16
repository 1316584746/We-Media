// 调试用：node scripts/poems-peek.js 作者 [标题片段]，结果写到临时目录的 wm-peek.txt（控制台中文会乱码）
const fs = require('fs');
const os = require('os');
const path = require('path');
const poems = require('../server/poems');
const [author, part] = process.argv.slice(2);
const db = poems.load();
const rows = db.items.filter((i) => (!author || i.author === author) && (!part || i.title.includes(part) || i.text.includes(part)));
fs.writeFileSync(path.join(os.tmpdir(), 'wm-peek.txt'), `${rows.length} 首\n` + rows.slice(0, 80).map((i) => `${i.title} | ${i.author} | ${i.dynasty} | ${i.tags.join(',')} | ${i.text.split('\n')[0]}`).join('\n'), 'utf8');
