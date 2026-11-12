// 一次性生成「创作精选」的示范视频 public/featured/<id>.mp4
// 做法：封面图 + 逐句推拉镜头 + 微软 Edge 免费朗读 + 烧录字幕，不调用任何收费接口。
// 用法：
//   node scripts/gen-featured-videos.js            只生成缺失的
//   node scripts/gen-featured-videos.js --force    全部重新生成
//   node scripts/gen-featured-videos.js jingyesi   只生成指定 id
// 前置：先有封面（node scripts/gen-featured-covers.js）。生成的 mp4 不进 git。
const fs = require('fs');
const os = require('os');
const path = require('path');
const providers = require('../server/providers');
const ff = require('../server/ffmpeg');
const { getTemplate } = require('../server/templates');
const { FEATURED } = require('../server/featured');

const OUT = path.join(__dirname, '..', 'public', 'featured');
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

const hsl = (h, s, l) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '0x' + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
};

/** 没有封面图（例如文生图额度用完）时，用模板色渐变 + 标题做一张临时海报，保证示范视频照样能生成 */
async function makePoster(f, tpl, dir, width, height) {
  const base = Math.min(width, height);
  const ass = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 2', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Poster,Microsoft YaHei,${Math.round(base * 0.1)},&H00FFFFFF,&H00FFFFFF,&H40000000,&H80000000,-1,0,0,0,100,100,3,0,1,3,1,5,60,60,0,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.00,0:00:02.00,Poster,,0,0,0,,${f.title}${f.author ? `\\N{\\fs${Math.round(base * 0.045)}}${f.author}` : ''}\\N{\\fs${Math.round(base * 0.04)}}${f.topic} · ${tpl.name}`,
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'poster.ass'), ass, 'utf8');
  const c0 = hsl(tpl.hue, 0.55, 0.42);
  const c1 = hsl((tpl.hue + 40) % 360, 0.5, 0.28);
  await ff.run(['-f', 'lavfi', '-i', `gradients=s=${width}x${height}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${width}:y1=${height}:d=1:speed=0.01`, '-vf', 'subtitles=poster.ass', '-frames:v', '1', 'cover.jpg'], { cwd: dir });
}

async function build(f) {
  const tpl = getTemplate(f.template);
  const cover = path.join(OUT, `${f.id}.jpg`);
  const portrait = f.orientation === 'portrait';
  const [width, height] = portrait ? [540, 960] : [960, 540];
  const dir = path.join(os.tmpdir(), `wm-featvid-${f.id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(cover)) fs.copyFileSync(cover, path.join(dir, 'cover.jpg'));
  else {
    console.warn(`WARN  ${f.id} 还没有封面图，先用临时海报代替（补齐封面后加 --force 重新生成）`);
    await makePoster(f, tpl, dir, width, height);
  }

  const lines = f.script.split('\n').map((s) => s.trim()).filter(Boolean);
  const cfg = { mode: 'edge', edgeVoice: tpl.defaults.voice || 'zh-CN-XiaoxiaoNeural', speed: f.template === 'heal' || f.template === 'poem' ? 0.9 : 1 };
  const tail = f.template === 'poem' ? 1.1 : 0.5;

  const segs = [];
  for (let i = 0; i < lines.length; i++) {
    const audio = `a${i}.mp3`;
    for (let attempt = 1; ; attempt++) {
      try {
        await providers.synthesizeSpeech({ cfg, text: lines[i], outFile: path.join(dir, audio) });
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    const out = `s${i}.mp4`;
    await ff.makeSegment({ dir, visual: { type: 'image', file: 'cover.jpg' }, audio, kind: 'shot', display: lines[i], out, width, height, fps: 25, subtitles: true, tail, index: i });
    segs.push(out);
  }
  await ff.concatSegments({ dir, segments: segs, out: 'full.mp4' });
  // 二次压缩：示范片只要看得清，体积越小越好（约 1MB / 30 秒）
  await ff.run(['-i', 'full.mp4', '-c:v', 'libx264', '-preset', 'medium', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '80k', '-ac', '1', '-movflags', '+faststart', path.join(OUT, `${f.id}.mp4`)], { cwd: dir });
  const dur = await ff.getDuration(path.join(OUT, `${f.id}.mp4`));
  fs.rmSync(dir, { recursive: true, force: true });
  return dur;
}

(async () => {
  const todo = FEATURED.filter((f) => (!only.length || only.includes(f.id)) && (force || only.length || !fs.existsSync(path.join(OUT, `${f.id}.mp4`))));
  console.log(`需要生成 ${todo.length} 个示范视频`);
  let failed = 0;
  for (const f of todo) {
    try {
      const dur = await build(f);
      const mb = (fs.statSync(path.join(OUT, `${f.id}.mp4`)).size / 1048576).toFixed(2);
      console.log(`OK    ${f.id}  ${dur.toFixed(1)}s  ${mb}MB`);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${f.id}: ${e.message}`);
    }
  }
  console.log(failed ? `${failed} 个失败，可重新运行补齐` : '完成');
  process.exit(failed ? 1 : 0);
})();
