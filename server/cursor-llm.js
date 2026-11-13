/**
 * 用 Cursor 的 API Key 当「AI Agent」：
 *  - 获取这个 Key 能用的模型：Cursor.models.list()
 *  - 对话补全：Cursor 没有标准的 chat/completions 接口，这里用官方 SDK 起一个「本地 Agent」跑一次，
 *    文件系统换成内存里的空目录（读不到、也写不到你的电脑），让它只回答文字。
 * 注意：推理走 Cursor 的托管模型，计入这个账号的 Cursor 用量；每次调用要几秒到几十秒，不支持函数调用（工具增强）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEY_RE = /^(crsr_|cursor_)/i;
const isCursorKey = (key) => KEY_RE.test(String(key || '').trim());
/** provider 选了 cursor，或者 Key 长得像 Cursor 的（crsr_ / cursor_ 开头，别家的 Key 不会这样开头） */
const isCursor = (cfg) => !!cfg && (cfg.provider === 'cursor' || isCursorKey(cfg.apiKey));

function sdk() {
  try {
    return require('@cursor/sdk');
  } catch {
    throw new Error('还没有安装 Cursor SDK：请在项目目录运行 npm install（需要 Node 22.13 或更新）');
  }
}

const brief = (e) => String(e?.message || e).split('\n')[0].slice(0, 300);

/** @returns {Promise<{id: string, name: string}[]>} */
const modelCache = new Map(); // key -> { at, list }：读一次要好几秒，缓存 10 分钟，打开设置页就是秒出
async function listModels(apiKey) {
  const key = String(apiKey).trim();
  const hit = modelCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.list;
  const { Cursor } = sdk();
  const raw = await Cursor.models.list({ apiKey: key });
  const list = (raw || []).map((m) => ({ id: m.id, name: m.displayName || m.id })).filter((m) => m.id);
  if (list.length) modelCache.set(key, { at: Date.now(), list });
  return list;
}

const PREAMBLE =
  '【重要】这是一次纯文字生成任务：不要调用任何工具，不要读取、搜索或修改任何文件，不要执行命令，也不要提问；' +
  '直接按下面的要求输出最终答案（要求输出 JSON 时只输出 JSON）。\n\n';

function toPrompt(messages) {
  const label = { system: '【要求】', user: '【内容】', assistant: '【你之前的回复】' };
  return (
    PREAMBLE +
    messages
      .filter((m) => m.role in label && m.content)
      .map((m) => `${label[m.role]}\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n\n')
  );
}

/** 返回回复文本。正常 8~15 秒；单次 60 秒没结果就放弃重来一次（偶尔会卡住），再不行才报错，不会让页面一直转 */
async function complete(cfg, messages, timeoutMs = 60000) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    try {
      const text = await completeOnce(cfg, messages, timeoutMs);
      console.log(`[cursor] ${cfg.model} 完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒${i ? '（重试后）' : ''}`);
      return text;
    } catch (e) {
      lastErr = e;
      console.log(`[cursor] ${cfg.model} 第 ${i + 1} 次失败，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒：${brief(e)}`);
      if (!/超时|为空/.test(String(e.message))) break; // 只对卡住 / 空回复重试；Key 无效、模型不可用之类重试没用
    }
  }
  throw lastErr;
}

async function completeOnce(cfg, messages, timeoutMs) {
  const { Agent, tempFs, unionFs } = sdk();
  const cwd = path.join(os.tmpdir(), 'wm-cursor-agent');
  fs.mkdirSync(cwd, { recursive: true });
  let timer;
  try {
    const run = Agent.prompt(toPrompt(messages), {
      apiKey: String(cfg.apiKey).trim(),
      model: { id: cfg.model },
      local: { cwd, fs: unionFs({ '/work': tempFs() }), reportedWorkspacePath: '/work', settingSources: [] },
    });
    const timeout = new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`Cursor 响应超时（${Math.round(timeoutMs / 1000)} 秒没有结果）`)), timeoutMs)));
    const r = await Promise.race([run, timeout]);
    if (r.status !== 'finished') throw new Error(`Cursor 运行${r.status === 'cancelled' ? '被取消' : '出错'}${r.result ? `：${String(r.result).slice(0, 200)}` : ''}`);
    const text = String(r.result || '').trim();
    if (!text) throw new Error('Cursor 返回内容为空');
    return text;
  } catch (e) {
    throw new Error(`Cursor：${brief(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isCursorKey, isCursor, listModels, complete };
