/* 创作精选：卡片网格、详情弹窗。点「做同款」由调用方把内容套进创作表单。 */
import { $, esc, icon, toast, tplOf, tplColor, state } from './core.js';

export const PLATFORMS = ['全部', '抖音风', '小红书风'];

const orientName = (o) => (o === 'portrait' ? '竖屏 9:16' : '横屏 16:9');
const styleName = (item) => state.meta.stylePresets.find((s) => s.value === item.style)?.name || item.styleName;
const platformCls = (p) => (p === '抖音风' ? 'dy' : 'xhs');

function coverHtml(item) {
  const t = tplOf(item.template);
  return `<div class="feat-cover" style="background:${tplColor(t)}">
    <span class="glyph">${esc(t.glyph)}</span>
    <img src="${esc(item.cover)}" loading="lazy" alt="" />
  </div>`;
}

/** 画面区：封面 + 角标 + 播放按钮（有示范视频时） */
function mediaInner(f) {
  return `${coverHtml(f)}
    <span class="feat-plat ${platformCls(f.platform)}">${esc(f.platform)}</span>
    <span class="feat-ori">${f.orientation === 'portrait' ? '竖屏' : '横屏'}</span>
    ${f.video ? `<button type="button" class="feat-play" data-play aria-label="播放示范视频">${icon('play')}</button>` : ''}
    <button type="button" class="feat-use" data-use>做同款</button>`;
}

export function featuredCardsHtml(list) {
  if (!list.length) return '<div class="empty"><b>暂无内容</b></div>';
  return list
    .map((f) => {
      const t = tplOf(f.template);
      return `<div class="feat" data-feat="${f.id}">
        <div class="feat-media">${mediaInner(f)}</div>
        <div class="feat-info" data-detail><div class="t">${esc(f.title)}</div><div class="m"><span>${esc(f.topic)}</span><span>${esc(t.name)}</span></div></div>
      </div>`;
    })
    .join('');
}

/** 在卡片的画面区原地播放示范视频（contain 不裁切，字幕完整可见） */
export function playInCard(card, item) {
  const media = $('.feat-media', card);
  media._saved = media.innerHTML;
  media.innerHTML = `<div class="feat-cover feat-vplayer">
      <video src="${esc(item.video)}" controls autoplay playsinline preload="auto"></video>
    </div>
    <button type="button" class="feat-stop" data-stop aria-label="关闭视频" title="关闭视频">✕</button>`;
  const v = $('video', media);
  v.addEventListener('error', () => {
    stopInCard(card);
    toast('示范视频加载失败', 'err');
  });
  v.play().catch(() => {});
}

/** 恢复成封面；没有在播放的卡片则什么也不做 */
export function stopInCard(card) {
  const media = $('.feat-media', card);
  if (!media || media._saved == null) return;
  $('video', media)?.pause();
  media.innerHTML = media._saved;
  media._saved = null;
}

/** 图片加载失败时退回模板色块（只留字形） */
export function handleCoverErrors(container) {
  container.addEventListener(
    'error',
    (e) => {
      if (e.target.tagName === 'IMG') e.target.remove();
    },
    true,
  );
}

/** 详情弹窗；点「做同款」时 resolve(true)，其余 resolve(false) */
export function openFeatured(item) {
  return new Promise((resolve) => {
    const t = tplOf(item.template);
    const lines = item.script.split('\n').filter(Boolean);
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg feat-dlg';
    dlg.innerHTML = `<form method="dialog">
      <div class="fd-grid">
        <div class="fd-cover">${
          item.video
            ? `<div class="feat-cover feat-vplayer"><video src="${esc(item.video)}" poster="${esc(item.cover)}" controls playsinline preload="metadata"></video></div>`
            : coverHtml(item)
        }</div>
        <div class="fd-info">
          <div class="fd-tags"><span class="feat-plat inline ${platformCls(item.platform)}">${esc(item.platform)}</span><span class="tag">${esc(item.topic)}</span></div>
          <h3>${esc(item.title)}${item.author ? ` <small>· ${esc(item.author)}</small>` : ''}</h3>
          <p class="fd-desc">${esc(item.desc)}</p>
          <div class="fd-params">
            <span class="tag">${esc(t.name)}模板</span><span class="tag">${orientName(item.orientation)}</span><span class="tag">画风：${esc(styleName(item))}</span><span class="tag">${lines.length} 句</span>
          </div>
          <div class="fd-script">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
        </div>
      </div>
      <div class="dlg-foot">
        <span class="hint" style="margin-right:auto">文案是示范内容，套用后可以随意修改。</span>
        <button value="no" class="btn ghost">关闭</button>
        <button value="yes" class="btn primary" autofocus>做同款</button>
      </div></form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      const yes = dlg.returnValue === 'yes';
      dlg.remove();
      resolve(yes);
    });
    handleCoverErrors(dlg);
    dlg.showModal();
  });
}
