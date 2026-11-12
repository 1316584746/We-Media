/**
 * 剪辑工程导出：把时间线渲染成 mp4。
 *  1. 视频轨逐段渲染成统一规格（含变速 / 缩放 / 位移 / 调色），空档补黑场，再 concat
 *  2. 视频轨自带声音 + 音频轨 → 一次 filter_complex 混音（变速 / 音量 / 淡入淡出 / 定位）
 *  3. 文字轨 → ASS 字幕烧录
 *  4. 合成最终文件
 */
const fs = require('fs');
const path = require('path');
const ff = require('./ffmpeg');
const edits = require('./edits');

const f3 = (n) => Number(n).toFixed(3);

/** atempo 单级只支持 0.5–2，其他倍速拆成链 */
function atempoChain(speed) {
  const out = [];
  let s = speed;
  while (s > 2) {
    out.push(2);
    s /= 2;
  }
  while (s < 0.5) {
    out.push(0.5);
    s /= 0.5;
  }
  out.push(s);
  return out.filter((x) => Math.abs(x - 1) > 1e-6).map((x) => `atempo=${x.toFixed(5)}`);
}

/* ---------------- ASS ---------------- */
const assTime = (sec) => {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const assColor = (hex, alpha = 0) => {
  const h = hex.replace('#', '');
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};

function buildTextAss(texts, W, H) {
  const styles = texts.map((c, i) => {
    const size = Math.round((c.size / 100) * H);
    const outline = Math.max(2, Math.round(size * 0.06));
    const box = !!c.bg;
    // BorderStyle 3 = 不透明底框；1 = 描边
    return `Style: T${i},Microsoft YaHei,${size},${assColor(c.color)},${assColor(c.color)},${box ? assColor(c.bg, 0x40) : '&H00202020'},${box ? assColor(c.bg, 0x40) : '&H80000000'},${c.bold ? -1 : 0},0,0,0,100,100,1,0,${box ? 3 : 1},${box ? Math.round(size * 0.25) : outline},${box ? 0 : 1},5,${Math.round(W * 0.05)},${Math.round(W * 0.05)},20,1`;
  });
  const events = texts.map((c, i) => {
    const px = Math.round((c.x / 100) * W);
    const py = Math.round((c.y / 100) * H);
    const body = String(c.text).replace(/\r?\n/g, '\\N');
    const fade = c.fade ? '\\fad(250,250)' : '';
    return `Dialogue: ${i},${assTime(c.start)},${assTime(c.start + c.dur)},T${i},,0,0,0,,{\\an5\\pos(${px},${py})${fade}}${body}`;
  });
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

/* ---------------- 视频分段 ---------------- */
const VENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an'];

async function renderGap({ work, name, dur, W, H, fps }) {
  await ff.run(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}:d=${f3(dur)}`, '-t', f3(dur), ...VENC, name], { cwd: work });
}

async function renderVideoClip({ work, name, clip, media, abs, W, H, fps }) {
  const isImage = media.kind === 'image';
  const input = isImage ? ['-loop', '1', '-framerate', String(fps), '-t', f3(clip.dur), '-i', abs] : ['-ss', f3(clip.in), '-t', f3(clip.dur * clip.speed), '-i', abs];
  const chain = [`setpts=(PTS-STARTPTS)/${clip.speed}`, `scale=${W}:${H}:force_original_aspect_ratio=decrease`];
  if (Math.abs(clip.scale - 1) > 1e-3) chain.push(`scale='max(2,trunc(iw*${clip.scale}/2)*2)':'max(2,trunc(ih*${clip.scale}/2)*2)'`);
  if (clip.brightness !== 0 || clip.contrast !== 1 || clip.saturation !== 1) chain.push(`eq=brightness=${clip.brightness}:contrast=${clip.contrast}:saturation=${clip.saturation}`);
  chain.push(`fps=${fps}`, 'setsar=1', 'format=yuv420p');
  const ox = Math.round((clip.x / 100) * W);
  const oy = Math.round((clip.y / 100) * H);
  const filter = `[0:v]${chain.join(',')}[fg];color=c=black:s=${W}x${H}:r=${fps}:d=${f3(clip.dur)}[bg];[bg][fg]overlay=x=(W-w)/2+(${ox}):y=(H-h)/2+(${oy}):shortest=1,format=yuv420p[out]`;
  await ff.run([...input, '-filter_complex', filter, '-map', '[out]', '-t', f3(clip.dur), ...VENC, name], { cwd: work });
}

/* ---------------- 主流程 ---------------- */
async function renderEdit(id, onProgress = () => {}) {
  const e = edits.read(id);
  const [W, H] = edits.RATIOS[e.ratio];
  const fps = e.fps || 30;
  const dir = edits.dirOf(id);
  const total = edits.totalOf(e.clips);
  if (!e.clips.length || total < 0.1) throw edits.httpError(400, '时间线是空的，先把素材拖到时间线上');

  const mediaOf = (c) => e.media.find((m) => m.id === c.mediaId);
  const absOf = (m) => path.join(dir, m.file);
  const vclips = e.clips.filter((c) => c.track === 'v').sort((a, b) => a.start - b.start);
  const texts = e.clips.filter((c) => c.track === 't').sort((a, b) => a.start - b.start);

  const work = path.join(dir, 'exports', `_work-${Date.now()}`);
  fs.mkdirSync(work, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const safeName = e.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'video';
  const outRel = `exports/${safeName}-${stamp}.mp4`;
  const outAbs = path.join(dir, outRel);

  try {
    // 1) 视频轨：空档补黑场，末尾补到总长
    const plan = [];
    let cursor = 0;
    for (const c of vclips) {
      if (c.start - cursor > 0.02) plan.push({ gap: c.start - cursor });
      plan.push({ clip: c });
      cursor = Math.max(cursor, c.start + c.dur);
    }
    if (total - cursor > 0.02) plan.push({ gap: total - cursor });
    if (!plan.length) plan.push({ gap: total });

    const steps = plan.length + 3;
    let done = 0;
    const tick = (stage) => onProgress({ stage, progress: Math.min(0.99, ++done / steps) });

    const segs = [];
    for (let i = 0; i < plan.length; i++) {
      const name = `seg_${String(i).padStart(3, '0')}.mp4`;
      const p = plan[i];
      if (p.gap) await renderGap({ work, name, dur: p.gap, W, H, fps });
      else await renderVideoClip({ work, name, clip: p.clip, media: mediaOf(p.clip), abs: absOf(mediaOf(p.clip)), W, H, fps });
      segs.push(name);
      tick(`渲染画面 ${i + 1}/${plan.length}`);
    }
    fs.writeFileSync(path.join(work, 'list.txt'), segs.map((s) => `file '${s}'`).join('\n'), 'utf8');
    await ff.run(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'video.mp4'], { cwd: work });
    tick('拼接画面');

    // 2) 音频混音
    const sources = e.clips
      .filter((c) => (c.track === 'a' || c.track === 'v') && !c.muted && c.volume > 0)
      .map((c) => ({ c, m: mediaOf(c) }))
      .filter(({ m }) => m && m.hasAudio);
    const aargs = [];
    const afilters = [];
    sources.forEach(({ c, m }, i) => {
      aargs.push('-ss', f3(c.in), '-t', f3(c.dur * c.speed), '-i', absOf(m));
      const chain = [...atempoChain(c.speed), `volume=${c.volume}`];
      if (c.fadeIn > 0.01) chain.push(`afade=t=in:st=0:d=${f3(c.fadeIn)}`);
      if (c.fadeOut > 0.01) chain.push(`afade=t=out:st=${f3(Math.max(0, c.dur - c.fadeOut))}:d=${f3(c.fadeOut)}`);
      chain.push('aresample=44100', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `adelay=${Math.round(c.start * 1000)}:all=1`);
      afilters.push(`[${i}:a]${chain.join(',')}[a${i}]`);
    });
    if (sources.length) {
      const ins = sources.map((_, i) => `[a${i}]`).join('');
      const mix = sources.length > 1 ? `${ins}amix=inputs=${sources.length}:duration=longest:normalize=0[mx]` : `${ins}anull[mx]`;
      afilters.push(mix, `[mx]alimiter=limit=0.97,apad=whole_dur=${f3(total)},atrim=0:${f3(total)}[aout]`);
      await ff.run([...aargs, '-filter_complex', afilters.join(';'), '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', 'audio.m4a'], { cwd: work });
    } else {
      await ff.run(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', f3(total), '-c:a', 'aac', '-b:a', '128k', 'audio.m4a'], { cwd: work });
    }
    tick('混合音频');

    // 3) 文字 + 合成
    const outArg = path.relative(work, outAbs);
    const finalArgs = (withText) => [
      '-i', 'video.mp4', '-i', 'audio.m4a', '-map', '0:v:0', '-map', '1:a:0', '-t', f3(total),
      ...(withText ? ['-vf', 'subtitles=text.ass', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy']),
      '-c:a', 'copy', '-movflags', '+faststart', outArg,
    ];
    if (texts.length) {
      fs.writeFileSync(path.join(work, 'text.ass'), buildTextAss(texts, W, H), 'utf8');
      try {
        await ff.run(finalArgs(true), { cwd: work });
        return { file: outRel, duration: total };
      } catch (err) {
        // 字幕滤镜不可用时，不带文字也要能导出，并如实告知
        console.warn('[edit-render] 文字烧录失败，降级为无文字：', err.message.split('\n').slice(-4).join(' | '));
        await ff.run(finalArgs(false), { cwd: work });
        return { file: outRel, duration: total, warning: '文字烧录失败，成片里没有文字' };
      }
    }
    await ff.run(finalArgs(false), { cwd: work });
    return { file: outRel, duration: total };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** 后台启动导出；状态写进 edit.json 的 export 字段，前端轮询 */
async function startExport(id) {
  edits.read(id);
  if (edits.exporting.has(id)) throw edits.httpError(409, '正在导出中');
  edits.exporting.add(id);
  await edits.setExport(id, { status: 'running', progress: 0, stage: '准备中', file: null, error: null, warning: null, startedAt: Date.now() });
  let last = 0;
  (async () => {
    try {
      const r = await renderEdit(id, ({ stage, progress }) => {
        const now = Date.now();
        if (now - last > 300) {
          last = now;
          edits.setExport(id, { stage, progress }).catch(() => {});
        }
      });
      await edits.setExport(id, { status: 'done', progress: 1, stage: '完成', file: r.file, duration: r.duration, warning: r.warning || null, finishedAt: Date.now() });
    } catch (err) {
      console.error('[edit-render]', err.message);
      await edits.setExport(id, { status: 'error', error: String(err.message).split('\n').slice(0, 6).join('\n'), finishedAt: Date.now() }).catch(() => {});
    } finally {
      edits.exporting.delete(id);
    }
  })();
}

module.exports = { renderEdit, startExport, atempoChain, buildTextAss };
