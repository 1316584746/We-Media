const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let ffmpegPath = process.env.FFMPEG_PATH || null;
if (!ffmpegPath) {
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch {
    ffmpegPath = 'ffmpeg';
  }
}

function run(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { cwd, windowsHide: true });
    let stderr = '';
    p.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve({ stderr });
      else {
        const err = new Error(`ffmpeg 退出码 ${code}\n${stderr.slice(-1500)}`);
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

/** 通过 `ffmpeg -i` 的输出解析时长（秒）；ffmpeg-static 不带 ffprobe */
async function getDuration(file) {
  let stderr = '';
  try {
    ({ stderr } = await run(['-i', file]));
  } catch (e) {
    stderr = e.stderr || '';
  }
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`无法读取媒体时长: ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/* ----------------------------- 字幕（ASS） ----------------------------- */

function assTime(sec) {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

const stripPunct = (s) => s.replace(/[，。！？；、,.!?;：:]/g, '');

/**
 * 生成 ASS。PlayRes 与视频分辨率一致，字号直接用像素。
 * verse：底部粗体描边单句字幕；title：居中大标题 + 作者；ending：居中全诗。
 */
function buildAss({ kind, display, width, height, total }) {
  const base = Math.min(width, height);
  const font = 'Microsoft YaHei';
  const subSize = Math.round(base * 0.065);
  const style = (name, size, align, marginV, outline) =>
    `Style: ${name},${font},${size},&H00FFFFFF,&H00FFFFFF,&H00202020,&H80000000,-1,0,0,0,100,100,2,0,1,${outline},1,${align},60,60,${marginV},1`;
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Sub', subSize, 2, Math.round(height * 0.08), Math.max(3, Math.round(subSize * 0.08))),
    style('Center', subSize, 5, 0, Math.max(3, Math.round(subSize * 0.08))),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  let text;
  let styleName = 'Sub';
  if (kind === 'title' || kind === 'ending') {
    styleName = 'Center';
    const lines = String(display).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const bigSize = Math.round(base * (kind === 'title' ? 0.14 : 0.075));
    const smallSize = Math.round(base * (kind === 'title' ? 0.05 : 0.058));
    text = lines
      .map((l, i) => `{\\fs${i === 0 ? bigSize : smallSize}}${l}`)
      .join('\\N');
  } else {
    const lines = String(display)
      .split(/[，。！？；、,.!?;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    text = lines.join('\\N');
  }
  const start = kind === 'ending' ? 0.4 : 0.2;
  const end = Math.max(start + 0.5, total - 0.2);
  return `${header}\nDialogue: 0,${assTime(start)},${assTime(end)},${styleName},,0,0,0,,{\\fad(400,400)}${text}\n`;
}

/* ----------------------------- 镜头动画（插画推拉） ----------------------------- */

/** 返回 zoompan 的 z/x/y 表达式；N 为总帧数。按序号轮换，避免每个镜头动作雷同 */
function motionExpr(index, N) {
  const centerX = "iw/2-(iw/zoom/2)";
  const centerY = "ih/2-(ih/zoom/2)";
  const list = [
    { z: `1+0.12*on/${N}`, x: centerX, y: centerY }, // 缓慢推近
    { z: '1.12', x: `(iw-iw/zoom)*on/${N}`, y: '(ih-ih/zoom)/2' }, // 向右平移
    { z: `1.12-0.12*on/${N}`, x: centerX, y: centerY }, // 缓慢拉远
    { z: '1.12', x: `(iw-iw/zoom)*(1-on/${N})`, y: '(ih-ih/zoom)/2' }, // 向左平移
  ];
  return list[index % list.length];
}

/**
 * 合成单个分镜：画面(插画推拉 或 视频循环) + 配音 + 字幕 → 统一规格 mp4
 * cwd 内使用相对路径，避免 Windows 盘符在滤镜里要转义。
 * visual: { type: 'image'|'clip', file }
 */
async function makeSegment({ dir, visual, audio, kind = 'verse', display, out, width, height, fps, subtitles, tail, index = 0 }) {
  const audioDur = await getDuration(path.join(dir, audio));
  const total = audioDur + tail;
  const N = Math.max(2, Math.round(total * fps));

  const pre = 1.5; // 推拉前先放大底图，减少亚像素抖动
  const pw = Math.round((width * pre) / 2) * 2;
  const ph = Math.round((height * pre) / 2) * 2;
  const fade = `fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0, total - 0.35).toFixed(2)}:d=0.35`;
  const dim = kind === 'ending' ? ',eq=brightness=-0.28' : '';

  let inputArgs;
  let vfBase;
  if (visual.type === 'image') {
    const m = motionExpr(index, N);
    inputArgs = ['-loop', '1', '-framerate', String(fps), '-i', visual.file];
    vfBase =
      `scale=${pw}:${ph}:force_original_aspect_ratio=increase,crop=${pw}:${ph},` +
      `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=1:s=${width}x${height}:fps=${fps},` +
      `setsar=1,format=yuv420p${dim},${fade}`;
  } else {
    inputArgs = ['-stream_loop', '-1', '-i', visual.file];
    vfBase =
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
      `fps=${fps},setsar=1,format=yuv420p${dim},${fade}`;
  }

  const build = (vf) => [
    ...inputArgs,
    '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', vf,
    '-af', 'apad',
    '-t', total.toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '160k',
    '-movflags', '+faststart',
    out,
  ];

  let usedSubtitles = false;
  if (subtitles && display) {
    fs.writeFileSync(path.join(dir, 'sub.ass'), buildAss({ kind, display, width, height, total }), 'utf8');
    try {
      await run(build(`${vfBase},subtitles=sub.ass`), { cwd: dir });
      usedSubtitles = true;
    } catch (e) {
      // 字幕滤镜不可用（例如 ffmpeg 没带 libass）时降级为无字幕，不阻断流程
      console.warn('[ffmpeg] 字幕烧录失败，降级为无字幕：', e.message.split('\n').slice(-6).join(' | '));
    }
  }
  if (!usedSubtitles) await run(build(vfBase), { cwd: dir });
  return { duration: total, subtitles: usedSubtitles };
}

/** 拼接各分镜（规格一致，直接 copy 不重编码） */
async function concatSegments({ dir, segments, out }) {
  const list = segments.map((s) => `file '${s.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(path.join(dir, 'list.txt'), list, 'utf8');
  await run(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', out], { cwd: dir });
}

module.exports = { run, getDuration, makeSegment, concatSegments, ffmpegPath };
