import { $, $$, api, esc, state, toast, icon, paintIcons, relTime, confirmDlg } from '../core.js';

/* ---------------- 通用表单对话框 ---------------- */
function formModal({ title, body, okText = '保存', wide = true, onMount, onOk }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `dlg ${wide ? 'wide' : ''}`;
    dlg.innerHTML = `<form method="dialog" novalidate>
      <div class="dlg-body form"><h3>${esc(title)}</h3>${body}</div>
      <div class="dlg-foot"><span class="dlg-err"></span><button type="button" class="btn ghost" data-cancel>取消</button><button type="submit" class="btn primary" data-ok>${esc(okText)}</button></div>
    </form>`;
    document.body.appendChild(dlg);
    const err = $('.dlg-err', dlg);
    const ok = $('[data-ok]', dlg);
    let result = false;
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    $('form', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      if (ok.disabled) return;
      err.textContent = '';
      ok.disabled = true;
      try {
        await onOk(dlg);
        result = true;
        dlg.close();
      } catch (ex) {
        err.textContent = ex.message;
        ok.disabled = false;
      }
    });
    dlg.showModal();
    onMount?.(dlg);
  });
}

const lines = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
const kvParse = (t, sep) =>
  Object.fromEntries(
    lines(t)
      .map((l) => {
        const i = l.indexOf(sep);
        return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
      .filter((x) => x && x[0]),
  );

/* ---------------- 技能 ---------------- */
async function skillModal({ skill, mode }) {
  // mode: import | new | edit
  const tpls = state.meta.templates;
  let sel = new Set(skill?.templates || []);
  const chips = () =>
    tpls.map((t) => `<button type="button" class="chip ${sel.has(t.id) ? 'on' : ''}" data-tpl="${t.id}">${esc(t.name)}</button>`).join('');
  const showForm = mode !== 'import';
  const src = `
    <div class="field"><span class="lbl">导入方式</span>
      <div class="seg" id="srcSeg"><button type="button" class="on" data-s="paste">粘贴文本</button><button type="button" data-s="file">上传文件</button><button type="button" data-s="url">从链接</button></div></div>
    <div id="srcPaste" class="field"><textarea id="srcText" rows="6" class="mono" placeholder="粘贴 SKILL.md 的完整内容（--- name / description --- 加正文）"></textarea></div>
    <div id="srcFile" class="field" hidden><input type="file" id="srcFileInput" accept=".md,.markdown,.txt" /><span class="hint">选择 SKILL.md 文件，读取后自动解析</span></div>
    <div id="srcUrl" class="field" hidden><input id="srcUrlInput" placeholder="https://github.com/…/SKILL.md 或 raw 链接" /></div>
    <div><button type="button" class="btn sm" id="btnParse">解析</button> <span class="hint" id="parseHint"></span></div>`;
  const form = `
    <div id="skForm" style="display:${showForm ? 'flex' : 'none'};flex-direction:column;gap:14px">
      <div class="field"><label>名称</label><input id="skName" maxlength="60" value="${esc(skill?.name || '')}" placeholder="例如：国风分镜规范" /></div>
      <div class="field"><label>描述（可选）</label><input id="skDesc" maxlength="300" value="${esc(skill?.description || '')}" placeholder="一句话说明这个技能做什么" /></div>
      <div class="field"><span class="lbl">适用模板 <span class="hint">（都不选 = 所有模板）</span></span><div class="chips" id="skTpls">${chips()}</div></div>
      <div class="field"><label>指引内容</label><textarea id="skContent" rows="10" class="mono" placeholder="写给分镜 AI 的额外要求，例如构图、色调、镜头节奏……">${esc(skill?.content || '')}</textarea><span class="hint" id="skCount"></span></div>
    </div>`;
  const title = mode === 'import' ? '导入技能' : mode === 'edit' ? '编辑技能' : '新建技能';
  let source = skill?.source || 'manual';

  return formModal({
    title,
    body: (mode === 'import' ? src : '') + form,
    okText: mode === 'import' ? '导入' : '保存',
    onMount(dlg) {
      const ok = $('[data-ok]', dlg);
      if (mode === 'import') ok.disabled = true;
      const fill = (p) => {
        $('#skName', dlg).value = p.name || '';
        $('#skDesc', dlg).value = p.description || '';
        $('#skContent', dlg).value = p.content || '';
        source = p.source || source;
        $('#skForm', dlg).style.display = 'flex';
        ok.disabled = false;
        count();
      };
      const count = () => ($('#skCount', dlg).textContent = `${$('#skContent', dlg).value.length} / 40000 字`);
      count();
      $('#skContent', dlg).addEventListener('input', count);
      $('#skTpls', dlg).addEventListener('click', (e) => {
        const b = e.target.closest('[data-tpl]');
        if (!b) return;
        sel.has(b.dataset.tpl) ? sel.delete(b.dataset.tpl) : sel.add(b.dataset.tpl);
        b.classList.toggle('on');
      });
      if (mode !== 'import') return;
      let srcMode = 'paste';
      const parse = async (body) => {
        const hint = $('#parseHint', dlg);
        hint.textContent = '解析中…';
        try {
          fill(await api('/api/skills/preview', { method: 'POST', body }));
          hint.textContent = '已解析，可在下方修改后导入';
        } catch (e) {
          hint.textContent = '';
          toast(e.message, 'err');
        }
      };
      $('#srcSeg', dlg).addEventListener('click', (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        srcMode = b.dataset.s;
        $$('#srcSeg button', dlg).forEach((x) => x.classList.toggle('on', x === b));
        $('#srcPaste', dlg).hidden = srcMode !== 'paste';
        $('#srcFile', dlg).hidden = srcMode !== 'file';
        $('#srcUrl', dlg).hidden = srcMode !== 'url';
        $('#btnParse', dlg).hidden = srcMode === 'file';
      });
      $('#srcFileInput', dlg).addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > 300 * 1024) return toast('文件太大（超过 300KB），不像是单个技能文件', 'err');
        const text = await f.text();
        source = `file:${f.name}`;
        await parse({ text });
      });
      $('#btnParse', dlg).addEventListener('click', () => {
        if (srcMode === 'paste') {
          source = 'paste';
          parse({ text: $('#srcText', dlg).value });
        } else parse({ url: $('#srcUrlInput', dlg).value.trim() });
      });
    },
    async onOk(dlg) {
      const body = {
        name: $('#skName', dlg).value,
        description: $('#skDesc', dlg).value,
        content: $('#skContent', dlg).value,
        templates: [...sel],
        source,
      };
      if (mode === 'edit') await api(`/api/skills/${skill.id}`, { method: 'PUT', body });
      else await api('/api/skills', { method: 'POST', body });
    },
  });
}

function skillsHtml(list) {
  const tplName = (id) => state.meta.templates.find((t) => t.id === id)?.name || id;
  const toolbar = `<div class="toolbar">
      <button class="btn primary" data-act="import-skill">${icon('download')}导入技能</button>
      <button class="btn" data-act="new-skill">${icon('plus')}新建技能</button>
    </div>`;
  if (!list.length) {
    return `${toolbar}<div class="empty"><b>还没有技能</b>导入一个 SKILL.md，或者自己写一条分镜规范。<br>例如「古诗词多用留白构图」「口播镜头节奏要快」。</div>`;
  }
  return `${toolbar}<div class="ext-list">${list
    .map(
      (s) => `<div class="card ext ${s.enabled ? '' : 'off'}" data-id="${s.id}">
        <div class="ext-head">
          <div class="tt"><b>${esc(s.name)}</b>${s.description ? `<p>${esc(s.description)}</p>` : ''}</div>
          <div class="ext-acts">
            <label class="switch" title="启用 / 停用"><input type="checkbox" data-act="toggle-skill" ${s.enabled ? 'checked' : ''} /></label>
            <button class="btn sm" data-act="edit-skill">编辑</button>
            <button class="icon-btn danger" data-act="del-skill" title="删除">${icon('trash')}</button>
          </div>
        </div>
        <div class="ext-body">
          <div class="ext-meta">
            ${s.templates.length ? s.templates.map((t) => `<span class="tag">${esc(tplName(t))}</span>`).join('') : '<span class="tag">所有模板</span>'}
            <span class="hint">${s.content.length} 字 · ${relTime(s.updatedAt)}更新${s.source && s.source !== 'manual' ? ` · 来源 ${esc(s.source.length > 50 ? s.source.slice(0, 50) + '…' : s.source)}` : ''}</span>
          </div>
          <div class="snip">${esc(s.content)}</div>
        </div>
      </div>`,
    )
    .join('')}</div>`;
}

/* ---------------- MCP ---------------- */
async function mcpModal({ server }) {
  const edit = !!server;
  let transport = server?.transport || 'stdio';
  const envText = Object.entries(server?.env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
  const hdrText = Object.entries(server?.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const body = `
    <div class="field"><label>名称</label><input id="mName" maxlength="60" value="${esc(server?.name || '')}" placeholder="例如：web-search" /></div>
    <div class="field"><span class="lbl">连接方式</span>
      <div class="seg full" id="mTransport">
        <button type="button" data-v="stdio" class="${transport === 'stdio' ? 'on' : ''}">本地命令（stdio）</button>
        <button type="button" data-v="http" class="${transport === 'http' ? 'on' : ''}">远程地址（HTTP / SSE）</button>
      </div></div>
    <div id="mStdio" style="display:${transport === 'stdio' ? 'flex' : 'none'};flex-direction:column;gap:14px">
      <div class="notice"><span>本地命令会在这台电脑上直接执行，只添加你信任来源的服务。</span></div>
      <div class="field"><label>启动命令</label><input id="mCmd" value="${esc(server?.command || '')}" placeholder="npx、node、uvx、python …" /></div>
      <div class="field"><label>参数（每行一个）</label><textarea id="mArgs" rows="3" class="mono" placeholder="-y&#10;@modelcontextprotocol/server-fetch">${esc((server?.args || []).join('\n'))}</textarea></div>
      <div class="field"><label>环境变量（每行 KEY=VALUE，可放密钥）</label><textarea id="mEnv" rows="3" class="mono" placeholder="API_KEY=xxxx">${esc(envText)}</textarea>${edit ? '<span class="hint">已保存的值显示为 ********，不改动就原样保留。</span>' : ''}</div>
    </div>
    <div id="mHttp" style="display:${transport === 'http' ? 'flex' : 'none'};flex-direction:column;gap:14px">
      <div class="field"><label>服务地址</label><input id="mUrl" value="${esc(server?.url || '')}" placeholder="https://example.com/mcp" /></div>
      <div class="field"><label>请求头（每行 Name: value，可放鉴权）</label><textarea id="mHdr" rows="3" class="mono" placeholder="Authorization: Bearer xxxx">${esc(hdrText)}</textarea></div>
    </div>`;
  return formModal({
    title: edit ? '编辑 MCP 服务' : '添加 MCP 服务',
    body,
    onMount(dlg) {
      $('#mTransport', dlg).addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        transport = b.dataset.v;
        $$('#mTransport button', dlg).forEach((x) => x.classList.toggle('on', x === b));
        $('#mStdio', dlg).style.display = transport === 'stdio' ? 'flex' : 'none';
        $('#mHttp', dlg).style.display = transport === 'http' ? 'flex' : 'none';
      });
    },
    async onOk(dlg) {
      const payload = { name: $('#mName', dlg).value, transport };
      if (transport === 'stdio') Object.assign(payload, { command: $('#mCmd', dlg).value, args: lines($('#mArgs', dlg).value), env: kvParse($('#mEnv', dlg).value, '=') });
      else Object.assign(payload, { url: $('#mUrl', dlg).value, headers: kvParse($('#mHdr', dlg).value, ':') });
      if (edit) await api(`/api/mcp/${server.id}`, { method: 'PUT', body: payload });
      else await api('/api/mcp', { method: 'POST', body: payload });
    },
  });
}

const MCP_EXAMPLE = `{
  "mcpServers": {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    },
    "my-remote": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer xxxx" }
    }
  }
}`;

async function mcpImportModal() {
  let summary = '';
  const done = await formModal({
    title: '导入 MCP 配置',
    okText: '导入',
    body: `<p class="hint">粘贴 Claude Desktop / Cursor 等使用的标准 <code class="mono">mcp.json</code> 内容（含 <code class="mono">mcpServers</code>）。同名服务会被更新。</p>
      <div class="notice"><span>带 <code class="mono">command</code> 的服务会在本机执行命令，只导入你信任的配置。</span></div>
      <div class="field"><textarea id="mjson" rows="12" class="mono" placeholder="${esc(MCP_EXAMPLE)}"></textarea></div>`,
    async onOk(dlg) {
      const r = await api('/api/mcp/import', { method: 'POST', body: { json: $('#mjson', dlg).value } });
      summary = `新增 ${r.added.length} 个，更新 ${r.updated.length} 个${r.skipped.length ? `；跳过：${r.skipped.join('；')}` : ''}`;
    },
  });
  if (done) toast(`导入完成：${summary}`, 'ok');
  return done;
}

function mcpHtml(list) {
  const toolbar = `<div class="toolbar">
      <button class="btn primary" data-act="import-mcp">${icon('download')}导入 JSON</button>
      <button class="btn" data-act="new-mcp">${icon('plus')}添加服务</button>
    </div>`;
  if (!list.length) {
    return `${toolbar}<div class="empty"><b>还没有 MCP 服务</b>粘贴你的 mcp.json 一键导入，或手动添加一个服务。<br>想先试试？示例服务在 <code class="mono">scripts/sample-mcp-server.js</code>（命令 <code class="mono">node</code>，参数填它的绝对路径）。</div>`;
  }
  return `${toolbar}<div class="ext-list">${list
    .map((s) => {
      const st =
        s.status === 'ok'
          ? `<span class="badge done">${esc(s.statusMsg)}</span>`
          : s.status === 'error'
            ? `<span class="badge error">连接失败</span>`
            : `<span class="badge draft">未测试</span>`;
      const target = s.transport === 'http' ? s.url : [s.command, ...s.args].join(' ');
      return `<div class="card ext ${s.enabled ? '' : 'off'}" data-id="${s.id}">
        <div class="ext-head">
          <div class="tt"><b>${esc(s.name)}</b></div>
          <div class="ext-acts">
            ${st}
            <button class="btn sm" data-act="test-mcp">测试连接</button>
            <label class="switch" title="启用 / 停用"><input type="checkbox" data-act="toggle-mcp" ${s.enabled ? 'checked' : ''} /></label>
            <button class="btn sm" data-act="edit-mcp">编辑</button>
            <button class="icon-btn danger" data-act="del-mcp" title="删除">${icon('trash')}</button>
          </div>
        </div>
        <div class="ext-body">
          <div class="ext-meta"><span class="tag">${s.transport === 'http' ? '远程' : '本地命令'}</span><code>${esc(target.length > 120 ? target.slice(0, 120) + '…' : target)}</code></div>
          ${s.status === 'error' ? `<div class="err-msg">${esc(s.statusMsg)}</div>` : ''}
          ${s.tools?.length ? `<details><summary>${s.tools.length} 个工具</summary><div class="chips">${s.tools.map((t) => `<span class="tool-chip" title="${esc(t.description)}">${esc(t.name)}</span>`).join('')}</div></details>` : ''}
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

/* ---------------- 页面 ---------------- */
/**
 * 把「技能」或「MCP 服务」面板挂到 root 上（设置页的两个分区共用）。
 * onChange(data) 在每次重新读取后调用，用来刷新侧边栏里的数量。
 */
export async function mountPanel(root, kind, onChange) {
  let data = { skills: [], mcp: [] };
  let alive = true;
  const panel = document.createElement('div');
  panel.className = 'ext-panel';
  root.appendChild(panel);

  const paint = () => {
    panel.innerHTML = kind === 'skills' ? skillsHtml(data.skills) : mcpHtml(data.mcp);
    paintIcons(panel);
  };
  const load = async () => {
    try {
      data = await api('/api/extensions');
    } catch (e) {
      return toast(`读取失败：${e.message}`, 'err');
    }
    if (!alive) return;
    paint();
    onChange?.(data);
  };

  panel.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.type === 'checkbox') return;
    const act = btn.dataset.act;
    const id = btn.closest('[data-id]')?.dataset.id;
    try {
      if (act === 'import-skill') (await skillModal({ mode: 'import' })) && (toast('技能已导入', 'ok'), load());
      else if (act === 'new-skill') (await skillModal({ mode: 'new' })) && (toast('技能已创建', 'ok'), load());
      else if (act === 'edit-skill') (await skillModal({ mode: 'edit', skill: data.skills.find((s) => s.id === id) })) && (toast('已保存', 'ok'), load());
      else if (act === 'del-skill') {
        const s = data.skills.find((x) => x.id === id);
        if (await confirmDlg({ title: '删除技能？', body: `「${s.name}」会被删除；已经用过它的项目不受影响。`, okText: '删除', danger: true })) {
          await api(`/api/skills/${id}`, { method: 'DELETE' });
          load();
        }
      } else if (act === 'import-mcp') (await mcpImportModal()) && load();
      else if (act === 'new-mcp') (await mcpModal({})) && (toast('服务已添加，点「测试连接」确认可用', 'ok'), load());
      else if (act === 'edit-mcp') (await mcpModal({ server: data.mcp.find((s) => s.id === id) })) && (toast('已保存', 'ok'), load());
      else if (act === 'del-mcp') {
        const s = data.mcp.find((x) => x.id === id);
        if (await confirmDlg({ title: '删除 MCP 服务？', body: `「${s.name}」的配置会被删除。`, okText: '删除', danger: true })) {
          await api(`/api/mcp/${id}`, { method: 'DELETE' });
          load();
        }
      } else if (act === 'test-mcp') {
        btn.disabled = true;
        btn.innerHTML = '<i class="spin"></i> 测试中…';
        try {
          const r = await api(`/api/mcp/${id}/test`, { method: 'POST' });
          toast(r.status === 'ok' ? `连接正常：${r.statusMsg}` : '连接失败，详情见卡片', r.status === 'ok' ? 'ok' : 'err');
        } finally {
          await load();
        }
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  panel.addEventListener('change', async (e) => {
    const act = e.target.dataset.act;
    if (act !== 'toggle-skill' && act !== 'toggle-mcp') return;
    const id = e.target.closest('[data-id]').dataset.id;
    try {
      await api(`/api/${act === 'toggle-skill' ? 'skills' : 'mcp'}/${id}`, { method: 'PUT', body: { enabled: e.target.checked } });
      await load();
    } catch (err) {
      toast(err.message, 'err');
      load();
    }
  });

  await load();
  return { unmount() { alive = false; } };
}
