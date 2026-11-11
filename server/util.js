const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读取 "a.b[0].c" 形式的路径 */
function getPath(obj, p) {
  if (!p) return undefined;
  const parts = String(p).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const k of parts) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * 模板渲染：字符串里的 {{var}} 会被替换；
 * 若整个字符串恰好是 "{{var}}"，则保留变量原始类型（数字/布尔）。
 */
function renderTemplate(value, vars) {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{\s*(\w+)\s*\}\}$/);
    if (whole) return vars[whole[1]] ?? '';
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''));
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, vars));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderTemplate(v, vars);
    return out;
  }
  return value;
}

/** 按模板发起 HTTP 请求，返回 fetch Response */
async function httpRequest(spec, vars, timeoutMs = 120000) {
  const req = renderTemplate(spec, vars);
  const headers = { ...(req.headers || {}) };
  let body;
  if (req.body !== undefined && req.body !== null && req.method !== 'GET') {
    if (typeof req.body === 'string') body = req.body;
    else {
      body = JSON.stringify(req.body);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }
  return fetch(req.url, {
    method: req.method || 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function readJsonOrThrow(res, label) {
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (json == null) throw new Error(`${label} 返回的不是 JSON: ${text.slice(0, 200)}`);
  return json;
}

async function downloadTo(url, file) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
}

function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

async function retry(fn, times = 2, delayMs = 3000, onRetry) {
  let lastErr;
  for (let i = 0; i <= times; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < times) {
        if (onRetry) onRetry(e, i + 1);
        await sleep(delayMs * (i + 1));
      }
    }
  }
  throw lastErr;
}

module.exports = {
  sleep,
  getPath,
  renderTemplate,
  httpRequest,
  readJsonOrThrow,
  downloadTo,
  pLimit,
  retry,
};
