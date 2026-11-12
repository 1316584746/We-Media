/**
 * 预览播放引擎：用一个时钟驱动时间线，把当前时刻的视频 / 图片 / 文字 / 音频同步到页面元素上。
 *  - 两个 <video> 轮流使用：下一个片段提前加载并定位到入点，切换时不卡顿
 *  - 视频轨自带声音由 <video> 播放；音频轨每个片段一个 <audio>
 *  - 暂停时拖动播放头只做定位，不播放
 * 预览音量上限 100%（浏览器限制），导出时才会真正放大到 200%。
 */
import { clipAt, trackClips, totalDuration, sourceTime, clipEnd, speedOf } from './model.mjs';

const clamp01 = (n) => Math.min(1, Math.max(0, n));

export class Player {
  /**
   * @param {object} o
   * @param {HTMLElement} o.screen  预览画布容器（已按画幅设置宽高比）
   * @param {() => any[]} o.getClips
   * @param {(id:string) => any} o.getMedia
   * @param {string} o.base  素材文件地址前缀，如 /edit-files/<id>/
   * @param {(t:number) => void} o.onTime  播放时间变化
   * @param {() => void} o.onState  播放 / 暂停状态变化
   * @param {(clipId:string, patch:object) => void} [o.onTextMove] 在预览里拖动文字
   * @param {(msg:string) => void} [o.onError]
   */
  constructor(o) {
    this.o = o;
    this.t = 0;
    this.playing = false;
    this.raf = 0;
    this.last = 0;
    this.audios = new Map();
    this.textKey = '';
    this.erroredMedia = new Set();

    const screen = o.screen;
    screen.innerHTML = '';
    this.vids = [0, 1].map(() => {
      const v = document.createElement('video');
      v.className = 'ct-video';
      v.playsInline = true;
      v.preload = 'auto';
      v.disablePictureInPicture = true;
      v.addEventListener('error', () => this.mediaError(v));
      screen.appendChild(v);
      return v;
    });
    this.img = document.createElement('img');
    this.img.className = 'ct-video';
    this.img.alt = '';
    screen.appendChild(this.img);
    this.textLayer = document.createElement('div');
    this.textLayer.className = 'ct-text-layer';
    screen.appendChild(this.textLayer);
    this.ro = new ResizeObserver(() => this.layoutText());
    this.ro.observe(screen);
    this.bindTextDrag();
    this.render();
  }

  get total() {
    return totalDuration(this.o.getClips());
  }

  url(m) {
    return this.o.base + (m.proxy || m.file);
  }

  mediaError(v) {
    const id = v.dataset.media;
    if (!id || this.erroredMedia.has(id)) return;
    this.erroredMedia.add(id);
    this.o.onError?.('有素材在浏览器里无法预览（不影响导出）');
  }

  /* ---------------- 控制 ---------------- */
  play() {
    if (this.playing) return;
    const total = this.total;
    if (total <= 0) return;
    if (this.t >= total - 0.02) this.t = 0;
    this.playing = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame((n) => this.tick(n));
    this.o.onState();
    this.render();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.vids.forEach((v) => v.pause());
    this.audios.forEach((a) => a.pause());
    this.o.onState();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t) {
    this.t = Math.max(0, Math.min(t, Math.max(this.total, 0)));
    this.o.onTime(this.t);
    this.render();
  }

  tick(now) {
    if (!this.playing) return;
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const total = this.total;
    if (this.t >= total) {
      this.t = total;
      this.o.onTime(this.t);
      this.pause();
      this.render();
      return;
    }
    this.o.onTime(this.t);
    this.render();
    this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  /* ---------------- 同步 ---------------- */
  /** 时间线或播放头变化后调用，把画面 / 声音对齐到当前时刻 */
  render() {
    const clips = this.o.getClips();
    this.syncVisual(clips);
    this.syncAudio(clips);
    this.syncText(clips);
  }

  arm(v, clip, media) {
    if (v.dataset.clip === clip.id && v.dataset.src === this.url(media)) return;
    v.dataset.clip = clip.id;
    v.dataset.media = media.id;
    v.dataset.src = this.url(media);
    v.src = v.dataset.src;
    v.pause();
    const seekIn = () => {
      try {
        v.currentTime = sourceTime(clip, Math.max(clip.start, Math.min(this.t, clipEnd(clip))));
      } catch {
        /* 元数据还没就绪 */
      }
    };
    v.addEventListener('loadedmetadata', seekIn, { once: true });
  }

  syncVisual(clips) {
    const vtrack = trackClips(clips, 'v');
    const c = clipAt(clips, 'v', this.t);
    const media = c && this.o.getMedia(c.mediaId);
    const hideAll = () => {
      this.vids.forEach((v) => {
        v.pause();
        v.style.visibility = 'hidden';
      });
      this.img.style.visibility = 'hidden';
    };
    if (!c || !media) {
      hideAll();
      return;
    }
    const css = this.css(c);
    if (media.kind === 'image') {
      this.vids.forEach((v) => {
        v.pause();
        v.style.visibility = 'hidden';
      });
      const src = this.o.base + media.file;
      if (this.img.dataset.src !== src) {
        this.img.dataset.src = src;
        this.img.src = src;
      }
      Object.assign(this.img.style, { visibility: 'visible', transform: css.transform, filter: css.filter });
      return;
    }
    this.img.style.visibility = 'hidden';

    // 当前片段用哪个 <video>：已经装着它的，否则用空闲的那个
    let cur = this.vids.find((v) => v.dataset.clip === c.id && v.dataset.src === this.url(media));
    if (!cur) {
      cur = this.vids.find((v) => v.style.visibility !== 'visible') || this.vids[0];
      this.arm(cur, c, media);
    }
    const idle = this.vids.find((v) => v !== cur);
    cur.style.visibility = 'visible';
    idle.style.visibility = 'hidden';
    Object.assign(cur.style, { transform: css.transform, filter: css.filter });

    const target = sourceTime(c, this.t);
    cur.playbackRate = speedOf(c);
    cur.muted = !!c.muted || !(c.volume > 0) || !media.hasAudio;
    cur.volume = clamp01(c.volume ?? 1);
    if (this.playing) {
      if (cur.readyState >= 1 && Math.abs(cur.currentTime - target) > 0.3) cur.currentTime = target;
      if (cur.paused) cur.play().catch(() => {});
    } else {
      cur.pause();
      if (cur.readyState >= 1 && Math.abs(cur.currentTime - target) > 0.04) cur.currentTime = target;
    }

    // 提前装好下一个视频片段，切换时不黑屏
    const next = vtrack.find((x) => x.start >= clipEnd(c) - 1e-6);
    const nm = next && this.o.getMedia(next.mediaId);
    if (next && nm && nm.kind === 'video' && idle.dataset.clip !== next.id) {
      this.arm(idle, next, nm);
      idle.muted = true;
    }
  }

  css(c) {
    const b = 1 + (c.brightness || 0);
    return {
      transform: `translate(${c.x || 0}%, ${c.y || 0}%) scale(${c.scale || 1})`,
      filter: `brightness(${b}) contrast(${c.contrast ?? 1}) saturate(${c.saturation ?? 1})`,
    };
  }

  syncAudio(clips) {
    const alive = new Set();
    for (const c of trackClips(clips, 'a')) {
      alive.add(c.id);
      const m = this.o.getMedia(c.mediaId);
      if (!m) continue;
      let a = this.audios.get(c.id);
      if (!a) {
        a = new Audio();
        a.preload = 'auto';
        a.addEventListener('error', () => this.erroredMedia.has(m.id) || (this.erroredMedia.add(m.id), this.o.onError?.('有音频在浏览器里无法预览（不影响导出）')));
        this.audios.set(c.id, a);
      }
      const src = this.url(m);
      if (a.dataset.src !== src) {
        a.dataset.src = src;
        a.src = src;
      }
      const inside = this.t >= c.start - 1e-6 && this.t < clipEnd(c) - 1e-6;
      if (!inside) {
        a.pause();
        continue;
      }
      const rel = this.t - c.start;
      let gain = c.muted ? 0 : (c.volume ?? 1);
      if (c.fadeIn > 0 && rel < c.fadeIn) gain *= rel / c.fadeIn;
      const left = c.dur - rel;
      if (c.fadeOut > 0 && left < c.fadeOut) gain *= left / c.fadeOut;
      a.volume = clamp01(gain);
      a.playbackRate = speedOf(c);
      const target = sourceTime(c, this.t);
      if (this.playing) {
        if (a.readyState >= 1 && Math.abs(a.currentTime - target) > 0.3) a.currentTime = target;
        if (a.paused) a.play().catch(() => {});
      } else {
        a.pause();
        if (a.readyState >= 1 && Math.abs(a.currentTime - target) > 0.04) a.currentTime = target;
      }
    }
    for (const [id, a] of this.audios) {
      if (!alive.has(id)) {
        a.pause();
        a.removeAttribute('src');
        a.load();
        this.audios.delete(id);
      }
    }
  }

  /* ---------------- 文字 ---------------- */
  syncText(clips) {
    const active = trackClips(clips, 't').filter((c) => this.t >= c.start - 1e-6 && this.t < clipEnd(c) - 1e-6);
    const key = JSON.stringify(active.map((c) => [c.id, c.text, c.size, c.color, c.bg, c.bold, c.x, c.y]));
    if (key !== this.textKey) {
      this.textKey = key;
      this.textLayer.innerHTML = '';
      for (const c of active) {
        const el = document.createElement('div');
        el.className = 'ct-text';
        el.dataset.id = c.id;
        el.textContent = c.text;
        this.styleText(el, c);
        this.textLayer.appendChild(el);
      }
    }
    // 淡入淡出
    for (const c of active) {
      const el = this.textLayer.querySelector(`[data-id="${c.id}"]`);
      if (!el) continue;
      let op = 1;
      if (c.fade) {
        const rel = this.t - c.start;
        const left = c.dur - rel;
        op = Math.min(1, rel / 0.25, left / 0.25);
      }
      el.style.opacity = String(Math.max(0, op));
    }
  }

  styleText(el, c) {
    const h = this.o.screen.clientHeight || 360;
    const size = (c.size / 100) * h;
    Object.assign(el.style, {
      left: `${c.x}%`,
      top: `${c.y}%`,
      fontSize: `${size}px`,
      color: c.color,
      fontWeight: c.bold ? '700' : '400',
      background: c.bg ? `${c.bg}cc` : 'transparent',
      padding: c.bg ? `${size * 0.15}px ${size * 0.35}px` : '0',
      textShadow: c.bg ? 'none' : `0 0 ${size * 0.08}px #000, 0 ${size * 0.04}px ${size * 0.1}px rgba(0,0,0,.8)`,
      webkitTextStroke: c.bg ? '0' : `${Math.max(1, size * 0.04)}px rgba(20,20,20,.85)`,
      paintOrder: 'stroke fill',
    });
  }

  layoutText() {
    const clips = this.o.getClips();
    for (const el of this.textLayer.children) {
      const c = clips.find((x) => x.id === el.dataset.id);
      if (c) this.styleText(el, c);
    }
  }

  /** 在预览里直接拖动文字改位置 */
  bindTextDrag() {
    let drag = null;
    this.textLayer.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.ct-text');
      if (!el || this.playing) return;
      const c = this.o.getClips().find((x) => x.id === el.dataset.id);
      if (!c) return;
      const r = this.o.screen.getBoundingClientRect();
      drag = { el, id: c.id, r, sx: e.clientX, sy: e.clientY, x: c.x, y: c.y, moved: false };
      el.setPointerCapture(e.pointerId);
      this.o.onTextMove?.(c.id, null); // 选中
      e.preventDefault();
    });
    this.textLayer.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = ((e.clientX - drag.sx) / drag.r.width) * 100;
      const dy = ((e.clientY - drag.sy) / drag.r.height) * 100;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 0.5) return;
      drag.moved = true;
      const x = Math.round(Math.min(100, Math.max(0, drag.x + dx)) * 10) / 10;
      const y = Math.round(Math.min(100, Math.max(0, drag.y + dy)) * 10) / 10;
      drag.el.style.left = `${x}%`;
      drag.el.style.top = `${y}%`;
      drag.cur = { x, y };
    });
    const end = () => {
      if (drag?.moved && drag.cur) this.o.onTextMove?.(drag.id, drag.cur);
      drag = null;
    };
    this.textLayer.addEventListener('pointerup', end);
    this.textLayer.addEventListener('pointercancel', end);
  }

  destroy() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.vids.forEach((v) => {
      v.pause();
      v.removeAttribute('src');
      v.load();
    });
    this.audios.forEach((a) => {
      a.pause();
      a.removeAttribute('src');
      a.load();
    });
    this.audios.clear();
  }
}
