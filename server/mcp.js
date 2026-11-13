/**
 * MCP 客户端：连接本地命令（stdio）或远程（Streamable HTTP / SSE）服务，列出工具、调用工具。
 * 每次使用都是「连接 → 用 → 关闭」，不常驻进程。
 */
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport, getDefaultEnvironment } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const providers = require('./providers');
const extensions = require('./extensions');

const withTimeout = (p, ms, msg) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(msg)), ms)))]).finally(() => clearTimeout(t));
};
const newClient = () => new Client({ name: 'ai-video-studio', version: '1.0.0' }, { capabilities: {} });

async function connectHttp(cfg) {
  const url = new URL(cfg.url);
  const headers = cfg.headers || {};
  const requestInit = { headers };
  const mk = {
    stream: () => new StreamableHTTPClientTransport(url, { requestInit }),
    sse: () =>
      new SSEClientTransport(url, {
        requestInit,
        eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers || {}), ...headers } }) },
      }),
  };
  const order = /\/sse\/?$/.test(url.pathname) ? ['sse', 'stream'] : ['stream', 'sse'];
  let lastErr;
  for (const kind of order) {
    const client = newClient();
    try {
      await withTimeout(client.connect(mk[kind]()), 20000, '连接超时');
      return { client, stderrTail: () => '' };
    } catch (e) {
      lastErr = e;
      await client.close().catch(() => {});
    }
  }
  throw lastErr;
}

async function connect(cfg) {
  if (cfg.transport === 'http') return connectHttp(cfg);
  const client = newClient();
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args || [],
    env: { ...getDefaultEnvironment(), ...(cfg.env || {}) },
    stderr: 'pipe',
  });
  let err = '';
  transport.stderr?.on('data', (d) => {
    err = (err + d.toString()).slice(-600);
  });
  try {
    await withTimeout(client.connect(transport), 30000, '启动超时（首次用 npx 下载依赖可能较慢，可先在终端手动运行一次）');
  } catch (e) {
    await client.close().catch(() => {});
    e.message = `${e.message}${err.trim() ? `\n${err.trim().split('\n').slice(-3).join('\n')}` : ''}`;
    throw e;
  }
  return { client, stderrTail: () => err };
}

/** 测试连接：成功返回工具清单 */
async function testServer(cfg) {
  let conn;
  try {
    conn = await connect(cfg);
    const { tools } = await withTimeout(conn.client.listTools(), 15000, '列出工具超时');
    return {
      status: 'ok',
      statusMsg: `连接正常，${tools.length} 个工具`,
      tools: tools.map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 300) })),
    };
  } catch (e) {
    return { status: 'error', statusMsg: String(e.message).slice(0, 400), tools: [] };
  } finally {
    await conn?.client.close().catch(() => {});
  }
}

const textOf = (res) =>
  (res.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n') || (res.structuredContent ? JSON.stringify(res.structuredContent) : '');

/**
 * 分镜前的「工具增强」：把已启用的 MCP 工具交给 LLM，让它按需检索资料，最后总结成一段背景资料。
 * 返回 { text, calls, warnings }；没有可用服务时返回 null。
 */
async function research({ llm, task, maxRounds = 4 }) {
  const servers = extensions.enabledMcp();
  if (!servers.length) return null;
  if (providers.isCursor(llm)) {
    return { text: '', calls: [], warnings: ['Cursor 的 Key 不支持函数调用，工具增强（MCP）已跳过；换成阿里百炼或 OpenAI 兼容的 Key 才能用'] };
  }
  const warnings = [];
  const opened = [];
  await Promise.all(
    servers.map(async (cfg) => {
      try {
        const { client } = await connect(cfg);
        const { tools } = await withTimeout(client.listTools(), 15000, '列出工具超时');
        opened.push({ cfg, client, tools });
      } catch (e) {
        warnings.push(`${cfg.name}：${String(e.message).split('\n')[0]}`);
      }
    }),
  );
  try {
    if (!opened.length) throw new Error(`MCP 服务都连接失败：${warnings.join('；')}`);
    const route = new Map();
    const toolDefs = [];
    opened.forEach(({ cfg, client, tools }, si) =>
      tools.forEach((t) => {
        const fname = `s${si}_${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        route.set(fname, { client, tool: t.name, server: cfg.name });
        toolDefs.push({
          type: 'function',
          function: { name: fname, description: `[${cfg.name}] ${t.description || ''}`.slice(0, 500), parameters: t.inputSchema || { type: 'object', properties: {} } },
        });
      }),
    );
    if (!toolDefs.length) return { text: '', calls: [], warnings: [...warnings, '已连接的 MCP 服务没有提供任何工具'] };

    const messages = [
      {
        role: 'system',
        content:
          '你是视频策划助手。下面的文案将被制作成视频，请先判断是否需要检索资料（人物背景、典故、专业概念、事实核对等）。' +
          '需要就调用工具，不需要就不要调用。资料足够后，用 300 字以内的中文总结对设计画面有帮助的要点，只写工具返回的事实，不要编造。',
      },
      { role: 'user', content: task },
    ];
    const calls = [];
    for (let round = 0; round < maxRounds; round++) {
      const msg = await providers.llmComplete(llm, { messages, tools: toolDefs });
      if (!msg.tool_calls?.length) return { text: String(msg.content || '').trim(), calls, warnings };
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        const r = route.get(tc.function?.name);
        let args = {};
        try {
          args = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          /* 参数不是合法 JSON，按空参数调用 */
        }
        let out;
        let ok = true;
        if (!r) {
          out = '未知工具';
          ok = false;
        } else {
          try {
            const res = await withTimeout(r.client.callTool({ name: r.tool, arguments: args }), 30000, '工具调用超时');
            out = textOf(res);
            if (res.isError) ok = false;
          } catch (e) {
            out = `调用失败：${e.message}`;
            ok = false;
          }
        }
        calls.push({ server: r?.server || '?', tool: r?.tool || tc.function?.name, args, ok });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: String(out).slice(0, 4000) });
      }
    }
    messages.push({ role: 'user', content: '请基于已获得的资料，直接用文字总结要点，不要再调用工具。' });
    const fin = await providers.llmComplete(llm, { messages });
    return { text: String(fin.content || '').trim(), calls, warnings };
  } finally {
    await Promise.allSettled(opened.map((o) => o.client.close()));
  }
}

module.exports = { testServer, research };
