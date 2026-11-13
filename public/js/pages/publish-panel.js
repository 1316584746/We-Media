// 设置 → 发布：公众号配置 + 定时发布计划
import { $, $$, api, esc, toast, confirmDlg } from '../core.js';

const STATUS = { pending: ['等待发布', 'queued'], waiting: ['待手动发布', 'warn'], done: ['已完成', 'done'], failed: ['失败', 'error'] };
const P_STATUS = { pending: ['等待', 'draft'], remind: ['待手动发布', 'warn'], done: ['已完成', 'done'], failed: ['失败', 'error'] };

const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toLocalInput = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export async function mountPublishPanel(host) {
  let data = await api('/api/publish');

  const copyText = async (t) => {
    const text = [t.title, t.desc, t.tags.length ? t.tags.map((x) => `#${x}`).join(' ') : ''].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('标题和文案已复制', 'ok');
    } catch {
      toast('复制失败，请手动选择文字复制', 'err');
    }
  };

  const wechatHtml = () => {
    const w = data.wechat;
    return `<div class="st-inner" id="pbWx">
      <div class="st-sub"><span>微信公众号（官方接口）</span><span class="badge ${w.configured ? 'done' : 'draft'}">${w.configured ? '已填写' : '未配置'}</span></div>
      <p class="hint">到点自动把「标题 + 文案 + 封面」存进公众号草稿箱，并把视频上传到素材库（≤10MB）。接口没法把视频嵌进图文，所以最后需要你在公众号后台打开草稿、插入视频后点发布。需要已认证的订阅号 / 服务号，并把本机公网 IP 加进后台的 IP 白名单。</p>
      <div class="field"><label>AppID</label><input name="appId" value="${esc(w.appId)}" placeholder="wx 开头的 AppID" autocomplete="off" /></div>
      <div class="field"><label>AppSecret</label><input name="appSecret" type="password" value="${esc(w.appSecret)}" placeholder="公众号后台 → 设置与开发 → 基本配置" autocomplete="new-password" /></div>
      <details><summary class="hint" style="cursor:pointer">高级：接口地址（走代理 / 固定 IP 的转发服务时才需要）</summary>
        <div class="field" style="margin-top:8px"><input name="baseUrl" value="${esc(w.baseUrl)}" placeholder="留空 = https://api.weixin.qq.com" /></div></details>
      <div class="ext-meta"><button class="btn sm" data-act="wx-save" type="button">保存</button><button class="btn sm ghost" data-act="wx-test" type="button">测试连接</button><span class="hint" id="pbWxMsg"></span></div>
    </div>`;
  };

  const remindHtml = () => {
    const others = data.platforms.filter((p) => p.mode === 'remind');
    return `<div class="st-inner">
      <div class="st-sub"><span>抖音 / 小红书 / 视频号 / B 站</span><span class="badge warn">到点提醒</span></div>
      <p class="hint">这些平台没有面向个人账号的公开发布接口，也不做模拟登录（容易封号、随时失效）。到点后会提醒你，并备好视频、标题、文案：复制 → 打开创作中心 → 发布 → 点「已发布」。</p>
      <div class="chips">${others.map((p) => `<span class="chip" style="cursor:default">${esc(p.name)}</span>`).join('')}</div>
    </div>`;
  };

  const taskHtml = (t) => {
    const [stTxt, stCls] = STATUS[t.status] || STATUS.pending;
    const rows = t.platforms
      .map((p) => {
        const [pTxt, pCls] = P_STATUS[p.status] || P_STATUS.pending;
        const acts =
          p.status === 'remind'
            ? `<a class="btn sm" href="${esc(p.center)}" target="_blank" rel="noopener">打开创作中心</a>
               <button class="btn sm" data-act="copy" type="button">复制标题文案</button>
               ${t.videoUrl ? `<a class="btn sm" href="${esc(t.videoUrl)}" download>下载视频</a>` : ''}
               <button class="btn sm primary" data-act="done" data-plat="${p.key}" type="button">已发布</button>`
            : p.status === 'failed'
              ? `<button class="btn sm" data-act="run" type="button">重试</button>`
              : '';
        return `<div class="pb-plat" data-plat="${p.key}"><div class="pb-plat-h"><b>${esc(p.name)}</b><span class="badge ${pCls}">${pTxt}</span></div>
          ${p.message ? `<div class="${p.status === 'failed' ? 'err-msg' : 'hint'}">${esc(p.message)}</div>` : ''}
          ${acts ? `<div class="ext-meta">${acts}</div>` : ''}</div>`;
      })
      .join('');
    return `<div class="ext pb-task" data-id="${t.id}">
      <div class="ext-head"><div class="tt"><b>${esc(t.title)}</b><p>${esc(t.sourceName)} · ${t.status === 'pending' ? '计划' : '发布'}时间 ${fmtTime(t.status === 'pending' ? t.runAt : t.executedAt || t.runAt)}${t.missing ? ' · <span style="color:var(--err)">视频已被删除</span>' : ''}</p></div>
        <div class="ext-acts"><span class="badge ${stCls}">${stTxt}</span>
          ${t.status === 'pending' ? '<button class="btn sm ghost" data-act="run" type="button">立即执行</button>' : ''}
          <button class="btn sm ghost danger" data-act="del" type="button">删除</button></div></div>
      <div class="pb-plats">${rows}</div></div>`;
  };

  const paint = () => {
    host.innerHTML = `${wechatHtml()}${remindHtml()}
      <div class="st-blk"><div class="st-sub"><span>发布计划</span><button class="btn sm primary" data-act="new" type="button">新建发布计划</button></div>
        <div class="ext-list" id="pbList">${data.tasks.length ? data.tasks.map(taskHtml).join('') : '<p class="hint">还没有发布计划。点右上角「新建发布计划」，选好视频、平台和时间；应用开着、服务在运行时，到点自动处理。</p>'}</div>
        <p class="hint">提示：到点时本程序（node 服务）必须在运行，电脑睡眠 / 关机时错过的计划会在下次启动后立刻处理。</p></div>`;
  };

  const reload = async () => {
    data = await api('/api/publish');
    paint();
  };

  const newDialog = () => {
    const usable = data.sources;
    if (!usable.length) return toast('还没有做好的视频：先在「创作」生成成片或在「剪辑」导出', 'err');
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg wide';
    const when = Math.ceil((Date.now() + 3600000) / 600000) * 600000;
    dlg.innerHTML = `<form method="dialog">
      <div class="dlg-body form">
        <h3>新建发布计划</h3>
        <div class="field"><label>发布哪个视频</label><select name="src">${usable.map((s) => `<option value="${s.type}:${s.id}">${s.type === 'edit' ? '[剪辑] ' : ''}${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>发布到</label><div class="chips" id="pbPlats">${data.platforms.map((p) => `<label class="chip" data-p="${p.key}"><input type="checkbox" value="${p.key}" hidden />${esc(p.name)}${p.mode === 'api' ? ' · 自动存草稿' : ' · 到点提醒'}</label>`).join('')}</div></div>
        <div class="field"><label>发布时间</label><input type="datetime-local" name="when" value="${toLocalInput(when)}" /></div>
        <div class="field"><label>标题</label><input name="title" maxlength="100" placeholder="留空 = 视频名称" /></div>
        <div class="field"><label>文案 / 简介</label><textarea name="desc" rows="4" maxlength="2000" placeholder="发布时附带的文字"></textarea></div>
        <div class="field"><label>话题标签（用逗号或空格分隔，不用写 #）</label><input name="tags" placeholder="例如：自律 成长" /></div>
      </div>
      <div class="dlg-foot"><span class="dlg-err" id="pbErr"></span><button value="no" class="btn ghost">取消</button><button type="button" class="btn primary" id="pbOk">创建</button></div></form>`;
    document.body.appendChild(dlg);
    const sel = new Set();
    $('#pbPlats', dlg).addEventListener('click', (e) => {
      const l = e.target.closest('[data-p]');
      if (!l) return;
      e.preventDefault();
      const k = l.dataset.p;
      if (sel.has(k)) sel.delete(k);
      else sel.add(k);
      l.classList.toggle('on', sel.has(k));
    });
    dlg.addEventListener('close', () => dlg.remove());
    $('#pbOk', dlg).addEventListener('click', async () => {
      const f = dlg.querySelector('form');
      const [sourceType, ...rest] = f.src.value.split(':');
      const runAt = new Date(f.when.value).getTime();
      const err = $('#pbErr', dlg);
      if (!sel.size) return (err.textContent = '至少选一个发布平台');
      if (!Number.isFinite(runAt)) return (err.textContent = '请选择发布时间');
      $('#pbOk', dlg).disabled = true;
      try {
        await api('/api/publish/tasks', { method: 'POST', body: { sourceType, sourceId: rest.join(':'), platforms: [...sel], runAt, title: f.title.value, desc: f.desc.value, tags: f.tags.value } });
        dlg.close();
        toast(runAt <= Date.now() + 30000 ? '已创建，马上处理' : '发布计划已创建', 'ok');
        await reload();
      } catch (e) {
        err.textContent = e.message;
        $('#pbOk', dlg).disabled = false;
      }
    });
    dlg.showModal();
  };

  const onClick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const card = b.closest('[data-id]');
    const t = card && data.tasks.find((x) => x.id === card.dataset.id);
    try {
      if (act === 'new') return newDialog();
      if (act === 'wx-save' || act === 'wx-test') {
        const box = $('#pbWx', host);
        const body = {};
        $$('input', box).forEach((i) => (body[i.name] = i.value));
        const msg = $('#pbWxMsg', host);
        b.disabled = true;
        try {
          data.wechat = await api('/api/publish/wechat', { method: 'PUT', body });
          if (act === 'wx-save') {
            toast('公众号配置已保存', 'ok');
            return paint();
          }
          msg.textContent = '连接中…';
          const r = await api('/api/publish/wechat/test', { method: 'POST' });
          paint();
          const m2 = $('#pbWxMsg', host);
          m2.textContent = (r.ok ? '✓ ' : '✗ ') + r.message;
          m2.style.color = r.ok ? 'var(--ok)' : 'var(--err)';
        } finally {
          b.disabled = false;
        }
        return;
      }
      if (!t) return;
      if (act === 'copy') return copyText(t);
      if (act === 'done') {
        await api(`/api/publish/tasks/${t.id}/done`, { method: 'POST', body: { platform: b.dataset.plat } });
        toast('已标记为已发布', 'ok');
        return reload();
      }
      if (act === 'run') {
        b.disabled = true;
        toast('正在执行…');
        await api(`/api/publish/tasks/${t.id}/run`, { method: 'POST' });
        return reload();
      }
      if (act === 'del') {
        if (!(await confirmDlg({ title: '删除这个发布计划？', body: `「${t.title}」只会删除计划，不影响视频本身。`, okText: '删除', danger: true }))) return;
        await api(`/api/publish/tasks/${t.id}`, { method: 'DELETE' });
        return reload();
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  paint();
  host.addEventListener('click', onClick);
  const timer = setInterval(() => {
    if (host.isConnected && !host.closest('[hidden]') && !document.querySelector('dialog[open]') && !host.contains(document.activeElement?.closest?.('input,textarea'))) reload().catch(() => {});
  }, 15000);
  return { unmount: () => clearInterval(timer) };
}
