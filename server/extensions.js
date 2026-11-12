/**
 * 扩展：技能（Skills）与 MCP 服务的配置存储、导入解析。
 *  - 技能：一段写给分镜 AI 的额外指引（SKILL.md 格式：frontmatter + 正文），创建项目时勾选后注入分镜提示词
 *  - MCP：本地命令（stdio）或远程 URL（http/sse）服务，供「工具增强」在分镜前检索资料
 * 存储在 data/extensions.json（MCP 的环境变量 / 请求头可能含密钥，接口返回时脱敏）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const settingsStore = require('./settings');

const FILE = path.join(settingsStore.DATA_DIR, 'extensions.json');
const MASK = '********';
const MAX_SKILL_CHARS = 20000;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { skills: d.skills || [], mcp: d.mcp || [] };
  } catch {
    return { skills: [], mcp: [] };
  }
}

function save(data) {
  fs.mkdirSync(settingsStore.DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

const rid = () => crypto.randomBytes(4).toString('hex');
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ----------------------------- 技能 ----------------------------- */

/** 解析 SKILL.md：--- frontmatter（name / description）--- + 正文 */
function parseSkillMarkdown(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) {
    const h1 = raw.match(/^#\s+(.+)$/m);
    return { name: h1 ? h1[1].trim() : '', description: '', content: raw };
  }
  const meta = {};
  let key = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      meta[key] = kv[2].replace(/^(>-|>|\|-|\|)$/, '').trim();
    } else if (key && /^\s+/.test(line)) {
      meta[key] = `${meta[key]} ${line.trim()}`.trim();
    }
  }
  const unquote = (s) => String(s || '').replace(/^["'](.*)["']$/, '$1');
  return { name: unquote(meta.name), description: unquote(meta.description), content: m[2].trim() };
}

function sanitizeSkill(input, old = {}) {
  const name = str(input.name ?? old.name, 60);
  const content = String(input.content ?? old.content ?? '').trim();
  if (!name) throw httpError(400, '技能需要一个名称');
  if (!content) throw httpError(400, '技能内容不能为空');
  if (content.length > MAX_SKILL_CHARS) throw httpError(400, `技能内容过长（${content.length} 字，上限 ${MAX_SKILL_CHARS}），请精简`);
  const templates = Array.isArray(input.templates ?? old.templates) ? (input.templates ?? old.templates).filter((t) => typeof t === 'string') : [];
  return {
    name,
    description: str(input.description ?? old.description, 300),
    content,
    templates, // 空数组 = 适用于所有模板
    enabled: typeof input.enabled === 'boolean' ? input.enabled : old.enabled ?? true,
  };
}

function createSkill(input) {
  const data = load();
  const now = Date.now();
  const skill = { id: `sk_${rid()}`, source: str(input.source, 200) || 'manual', createdAt: now, updatedAt: now, ...sanitizeSkill(input) };
  data.skills.push(skill);
  save(data);
  return skill;
}

function updateSkill(id, input) {
  const data = load();
  const i = data.skills.findIndex((s) => s.id === id);
  if (i < 0) throw httpError(404, '技能不存在');
  data.skills[i] = { ...data.skills[i], ...sanitizeSkill(input, data.skills[i]), updatedAt: Date.now() };
  save(data);
  return data.skills[i];
}

function deleteSkill(id) {
  const data = load();
  if (!data.skills.some((s) => s.id === id)) throw httpError(404, '技能不存在');
  data.skills = data.skills.filter((s) => s.id !== id);
  save(data);
}

/** 从 SKILL.md 文本或 URL 导入（不入库，返回解析结果让用户确认后再创建） */
async function previewSkillImport({ text, url }) {
  let source = 'paste';
  if (!text && url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw httpError(400, '链接格式不正确');
    }
    if (!/^https?:$/.test(u.protocol)) throw httpError(400, '只支持 http / https 链接');
    // GitHub 页面链接转 raw
    const gh = u.href.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    const target = gh ? `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}` : u.href;
    const res = await fetch(target, { signal: AbortSignal.timeout(20000) }).catch((e) => {
      throw httpError(400, `下载失败：${e.message}`);
    });
    if (!res.ok) throw httpError(400, `下载失败：HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 300 * 1024) throw httpError(400, '文件太大（超过 300KB），不像是单个技能文件');
    text = buf.toString('utf8');
    source = target;
  }
  if (!String(text || '').trim()) throw httpError(400, '没有读取到内容');
  const parsed = parseSkillMarkdown(text);
  if (!parsed.content) throw httpError(400, '没有解析到技能正文');
  return { ...parsed, source };
}

/** 选出本次要用的技能：已启用 + 被勾选 + 适用于该模板 */
function pickSkills(ids, templateId) {
  if (!Array.isArray(ids) || !ids.length) return [];
  return load().skills.filter((s) => s.enabled && ids.includes(s.id) && (!s.templates.length || s.templates.includes(templateId)));
}

function skillsPrompt(skills) {
  if (!skills.length) return '';
  return (
    '\n\n以下是用户额外指定的「技能」指引，请在不违反上面 JSON 输出格式的前提下遵循：\n' +
    skills.map((s) => `【${s.name}】\n${s.content}`).join('\n\n')
  );
}

/* ----------------------------- MCP ----------------------------- */

const maskMap = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, v ? MASK : '']));

function publicMcp(s) {
  return { ...s, env: maskMap(s.env), headers: maskMap(s.headers) };
}

/** 脱敏的值原样回传时视为"未修改" */
function unmask(incoming, old = {}) {
  const out = {};
  for (const [k, v] of Object.entries(incoming || {})) {
    if (!k.trim()) continue;
    out[k.trim()] = v === MASK ? old[k] ?? '' : String(v ?? '');
  }
  return out;
}

function sanitizeMcp(input, old = {}) {
  const name = str(input.name ?? old.name, 60);
  if (!name) throw httpError(400, 'MCP 服务需要一个名称');
  const transport = (input.transport ?? old.transport) === 'http' ? 'http' : 'stdio';
  const out = {
    name,
    transport,
    command: '',
    args: [],
    env: {},
    url: '',
    headers: {},
    enabled: typeof input.enabled === 'boolean' ? input.enabled : old.enabled ?? true,
  };
  if (transport === 'stdio') {
    out.command = str(input.command ?? old.command, 300);
    if (!out.command) throw httpError(400, '本地命令方式需要填写启动命令（如 npx）');
    out.args = (Array.isArray(input.args ?? old.args) ? input.args ?? old.args : []).map((a) => String(a)).filter((a) => a !== '');
    out.env = unmask(input.env ?? old.env, old.env);
  } else {
    out.url = str(input.url ?? old.url, 500);
    if (!/^https?:\/\//i.test(out.url)) throw httpError(400, '远程方式需要填写 http(s) 地址');
    out.headers = unmask(input.headers ?? old.headers, old.headers);
  }
  return out;
}

function createMcp(input) {
  const data = load();
  const now = Date.now();
  const srv = { id: `mcp_${rid()}`, status: 'untested', statusMsg: '', tools: [], testedAt: null, createdAt: now, updatedAt: now, ...sanitizeMcp(input) };
  data.mcp.push(srv);
  save(data);
  return srv;
}

function updateMcp(id, input) {
  const data = load();
  const i = data.mcp.findIndex((s) => s.id === id);
  if (i < 0) throw httpError(404, 'MCP 服务不存在');
  const next = { ...data.mcp[i], ...sanitizeMcp(input, data.mcp[i]), updatedAt: Date.now() };
  // 连接参数变了，旧的测试结果作废
  const connChanged = ['transport', 'command', 'url'].some((k) => next[k] !== data.mcp[i][k]) || JSON.stringify(next.args) !== JSON.stringify(data.mcp[i].args);
  if (connChanged) Object.assign(next, { status: 'untested', statusMsg: '', tools: [], testedAt: null });
  data.mcp[i] = next;
  save(data);
  return next;
}

function deleteMcp(id) {
  const data = load();
  if (!data.mcp.some((s) => s.id === id)) throw httpError(404, 'MCP 服务不存在');
  data.mcp = data.mcp.filter((s) => s.id !== id);
  save(data);
}

function recordMcpTest(id, result) {
  const data = load();
  const s = data.mcp.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, result, { testedAt: Date.now() });
  save(data);
}

/**
 * 导入标准 mcp.json：{ "mcpServers": { name: { command,args,env } | { url,headers,type } } }
 * 也接受只有内层对象、或单个服务对象。同名服务视为更新。
 */
function importMcpJson(text) {
  let json;
  try {
    json = JSON.parse(String(text || '').trim());
  } catch (e) {
    throw httpError(400, `JSON 格式有误：${e.message}`);
  }
  let servers = json.mcpServers || json.servers;
  if (!servers) servers = json.command || json.url ? { [json.name || 'mcp-server']: json } : json;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw httpError(400, '没有找到 mcpServers 配置');
  const data = load();
  const result = { added: [], updated: [], skipped: [] };
  for (const [name, c] of Object.entries(servers)) {
    if (!c || typeof c !== 'object') continue;
    try {
      const transport = c.url ? 'http' : 'stdio';
      const input = { name, transport, command: c.command, args: c.args, env: c.env, url: c.url, headers: c.headers, enabled: c.disabled === true ? false : true };
      const existing = data.mcp.find((s) => s.name === name);
      if (existing) {
        Object.assign(existing, sanitizeMcp(input, {}), { status: 'untested', statusMsg: '', tools: [], testedAt: null, updatedAt: Date.now() });
        result.updated.push(name);
      } else {
        const now = Date.now();
        data.mcp.push({ id: `mcp_${rid()}`, status: 'untested', statusMsg: '', tools: [], testedAt: null, createdAt: now, updatedAt: now, ...sanitizeMcp(input) });
        result.added.push(name);
      }
    } catch (e) {
      result.skipped.push(`${name}（${e.message}）`);
    }
  }
  if (!result.added.length && !result.updated.length) throw httpError(400, `没有可导入的服务${result.skipped.length ? '：' + result.skipped.join('；') : ''}`);
  save(data);
  return result;
}

const enabledMcp = () => load().mcp.filter((s) => s.enabled);
const getMcp = (id) => load().mcp.find((s) => s.id === id);

module.exports = {
  load, MASK,
  parseSkillMarkdown, previewSkillImport, createSkill, updateSkill, deleteSkill, pickSkills, skillsPrompt,
  publicMcp, createMcp, updateMcp, deleteMcp, importMcpJson, recordMcpTest, enabledMcp, getMcp,
};
