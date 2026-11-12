/* 模型费用说明：哪些免费、哪些收费、怎么收。
 * 价格来自各平台官网价格页（人民币，原价，不含限时优惠），核对日期见 PRICE_DATE。
 * 价格会变，这里只做参考；真正扣费以服务商账单为准。 */

export const PRICE_DATE = '2026-11-12';
export const SOURCES = {
  bailian: ['阿里云百炼 · 模型价格', 'https://help.aliyun.com/zh/model-studio/model-pricing'],
  ark: ['火山方舟 · 模型价格', 'https://ark.volcengine.com/region:cn-beijing/docs/model-pricing'],
};

/** 按「一条约 30 秒的视频」估算：8 个镜头、约 150 字旁白 */
export const SAMPLE = { seconds: 30, scenes: 8, chars: 150 };

const yuan = (n) => (n < 0.1 ? '不到 0.1 元' : n >= 10 ? `${n.toFixed(1)} 元` : `${n.toFixed(2)} 元`);

/* ---------------- 价格表（元） ---------------- */
// 视频：元/秒，按成功生成的秒数计费，失败不收费
const VIDEO = {
  'wan2.7-i2v': { '720P': 0.6, '1080P': 1, note: '按有声视频计费' },
  'wan2.6-i2v': { '720P': 0.6, '1080P': 1, note: '按有声视频计费' },
  'wan2.7-t2v': { '720P': 0.6, '1080P': 1 },
  'wan2.2-t2v-plus': { '480P': 0.14, '1080P': 0.7, note: '没有 720P 档，只有 480P / 1080P' },
};
// 文生图：元/张
const IMAGE = {
  'qwen-image-2.0': { price: 0.2 },
  'qwen-image-2.0-pro': { price: 0.5 },
  'qwen-image-3.0': { price: 0.18, free: '新用户 10 张（90 天）' },
  'qwen-image-3.0-pro': { price: 0.25, note: '1K 分辨率；2K 为 0.5 元/张', free: '新用户 10 张（90 天）' },
};
// 分镜 LLM：元 / 百万 token（输入, 输出）
const LLM = {
  'qwen-plus': { inp: 0.8, out: 2, note: '输出价为非思考模式；思考模式输出 8 元' },
  'qwen-max': { inp: 2.4, out: 9.6 },
  'qwen3.5-plus': { inp: 0.8, out: 4.8 },
  'qwen3.7-plus': { inp: 2, out: 8, free: '新用户 100 万 token（90 天）' },
};

/** 每个下拉选项前面的标签，让人一眼分清 */
export const TAG = { free: '【免费】', paid: '【收费】', test: '【测试】', dead: '【已停用】', vary: '【按服务商】' };

/** 下拉选项的显示文字（只有 mode 选项用） */
export const MODE_LABEL = {
  'image.mode': {
    mock: `${TAG.test}mock，渐变底图，不调用模型`,
    dashscope: `${TAG.paid}阿里百炼 qwen-image，0.2 元/张起`,
    custom: `${TAG.vary}自定义请求模板`,
  },
  'tts.mode': {
    mock: `${TAG.test}mock，提示音，不调用模型`,
    edge: `${TAG.free}Edge 在线朗读，无需 Key`,
    dashscope: `${TAG.paid}阿里百炼 qwen3-tts，0.8 元/万字符`,
    openai: `${TAG.vary}OpenAI 兼容 /audio/speech`,
    custom: `${TAG.vary}自定义请求模板`,
  },
  'video.mode': {
    mock: `${TAG.test}mock，占位视频，不调用模型`,
    dashscope_i2v: `${TAG.paid}阿里百炼 万相2.7 图生视频，0.6 元/秒起（配合「图生视频」）`,
    dashscope: `${TAG.paid}阿里百炼 万相 文生视频，0.14 元/秒起`,
    openai: `${TAG.dead}OpenAI Sora，官方已于 2026-09-24 关闭 API`,
    ark: `${TAG.paid}火山方舟 Seedance，约 0.2 元/秒`,
    custom: `${TAG.vary}自定义请求模板`,
  },
};

/** 状态徽标：该环节当前用的是免费还是收费 */
export function kindOf(block, cfg) {
  if (block === 'llm') return cfg.enabled && cfg.apiKey ? 'paid' : 'none';
  const m = cfg.mode;
  if (m === 'mock') return 'test';
  if (m === 'edge') return 'free';
  if (m === 'openai' && block === 'video') return 'dead';
  if (m === 'custom') return 'vary';
  return 'paid';
}

/* ---------------- 费用说明卡片 ---------------- */
/**
 * 返回当前配置的费用说明。
 * @returns {{kind: 'free'|'paid'|'test'|'dead'|'vary'|'none', head: string, lines: string[], sample?: string}}
 */
export function describe(block, cfg) {
  const model = String(cfg.model || '').trim();
  const noFree = '免费额度：无（官方价格页明确该模型各地域均无免费额度）';

  if (block === 'llm') {
    if (!cfg.enabled) return { kind: 'none', head: '未启用', lines: ['不启用时用内置规则拆分镜头，不调用任何模型，不花钱；但角色、画风一致性会差一些。'] };
    const p = LLM[model];
    if (!p) return { kind: 'vary', head: '价格见服务商', lines: [`「${model || '未填写'}」不在内置价格表里，请查看该服务商的价格页。`, '分镜只需要几千 token，通常不到 1 分钱。'] };
    return {
      kind: 'paid',
      head: `输入 ${p.inp} 元 / 输出 ${p.out} 元（每百万 token）`,
      lines: [p.note, p.free ? `免费额度：${p.free}` : '免费额度：无', '按输入、输出 token 分别计费。'].filter(Boolean),
      sample: '写一次分镜约 0.01 元，几乎可以忽略。',
    };
  }

  if (block === 'image') {
    if (cfg.mode === 'mock') return { kind: 'test', head: '免费（测试用）', lines: ['不调用任何模型，只生成渐变底图，用来走通流程。'] };
    if (cfg.mode === 'custom') return { kind: 'vary', head: '取决于你接入的服务商', lines: ['自定义请求模板，费用由对应服务商决定。'] };
    const p = IMAGE[model];
    if (!p) return { kind: 'vary', head: '价格见服务商', lines: [`「${model || '未填写'}」不在内置价格表里，请查看百炼价格页。`] };
    return {
      kind: 'paid',
      head: `${p.price} 元 / 张`,
      lines: [p.note, p.free ? `免费额度：${p.free}` : '免费额度：无', '每个镜头画 1 张；重画、重试成功才计费，失败不收费。'].filter(Boolean),
      sample: `一条约 ${SAMPLE.seconds} 秒、${SAMPLE.scenes} 个镜头的视频：约 ${yuan(p.price * SAMPLE.scenes)}`,
    };
  }

  if (block === 'tts') {
    if (cfg.mode === 'mock') return { kind: 'test', head: '免费（测试用）', lines: ['只生成提示音，不是真人朗读，用来走通流程。'] };
    if (cfg.mode === 'edge') return { kind: 'free', head: '完全免费，无需 Key', lines: ['使用微软 Edge 在线朗读服务，有云希、晓晓等中文音色，可以试听。', '需要联网；这是非官方开放接口，个别时段可能不稳定，失败会自动提示。'] };
    if (cfg.mode === 'dashscope') {
      const billed = SAMPLE.chars * 2;
      return {
        kind: 'paid',
        head: '0.8 元 / 万字符',
        lines: ['计费字符数：1 个汉字算 2 个字符，字母、数字、标点算 1 个。', '免费额度：新用户 1 万字符（90 天，仅北京地域）。', '只按输入文字计费，生成的音频不收费。'],
        sample: `${SAMPLE.chars} 字旁白 ≈ ${billed} 字符：约 ${yuan((billed / 10000) * 0.8)}`,
      };
    }
    if (cfg.mode === 'openai') return { kind: 'vary', head: '取决于服务商', lines: ['OpenAI 兼容接口，费用按你填写的 Base URL 对应的服务商计算。'] };
    return { kind: 'vary', head: '取决于你接入的服务商', lines: ['自定义请求模板，费用由对应服务商决定。'] };
  }

  // video
  if (cfg.mode === 'mock') return { kind: 'test', head: '免费（测试用）', lines: ['不调用任何模型，只做占位，用来走通流程。'] };
  if (cfg.mode === 'openai') {
    return {
      kind: 'dead',
      head: 'OpenAI 已于 2026-09-24 关闭 Sora API',
      lines: ['sora-2 / sora-2-pro 以及 Videos API 已不可用，选它会一直调用失败。', '停用前的价格：sora-2 720p 约 0.10 美元/秒，sora-2-pro 720p 约 0.30 美元/秒、1080p 约 0.70 美元/秒。', '建议改用「阿里百炼 万相」或「火山方舟 Seedance」。'],
    };
  }
  if (cfg.mode === 'custom') return { kind: 'vary', head: '取决于你接入的服务商', lines: ['自定义请求模板，费用由对应服务商决定。'] };
  if (cfg.mode === 'ark') {
    return {
      kind: 'paid',
      head: '10 元 / 百万 token（Seedance 1.0 lite）',
      lines: ['按 token 计费，token 数 ≈ 宽 × 高 × 帧率 × 秒数 ÷ 1024，所以分辨率、时长越大越贵。', '免费额度：新用户有一定的免费 token（在线推理），具体以方舟控制台为准。', '720P、24 帧、5 秒的片段约 10.8 万 token ≈ 1.1 元，折合约 0.2 元/秒。'],
      sample: `${SAMPLE.seconds} 秒视频：约 ${yuan(0.216 * SAMPLE.seconds)}（720P 估算）`,
    };
  }
  // 百炼万相
  const res = cfg.resolution === '1080P' ? '1080P' : '720P';
  const p = VIDEO[model];
  if (!p) return { kind: 'vary', head: '价格见百炼价格页', lines: [`「${model || '未填写'}」不在内置价格表里，请查看百炼价格页。`, '视频模型都按「成功生成的秒数」计费，失败不收费。'] };
  const price = p[res] ?? p[res === '720P' ? '480P' : '1080P'];
  const usedRes = p[res] != null ? res : res === '720P' ? '480P' : '1080P';
  return {
    kind: 'paid',
    head: `${price} 元 / 秒（${usedRes}）`,
    lines: [
      `全部档位：${['480P', '720P', '1080P'].filter((r) => p[r] != null).map((r) => `${r} ${p[r]} 元/秒`).join('，')}`,
      p.note,
      noFree,
      '输入图片、提示词不计费，只按成功生成的视频秒数收费，失败不收费。',
    ].filter(Boolean),
    sample: `${SAMPLE.seconds} 秒视频：约 ${yuan(price * SAMPLE.seconds)}`,
  };
}

/** 说明卡片的 HTML */
export function costHtml(block, cfg, esc) {
  const d = describe(block, cfg);
  const tag = { free: '免费', paid: '收费', test: '测试', dead: '已停用', vary: '按服务商', none: '不花钱' }[d.kind];
  return `<span class="cost-tag">${tag}</span><div class="cost-body"><b>${esc(d.head)}</b>${d.sample ? `<div class="cost-sample">${esc(d.sample)}</div>` : ''}<ul>${d.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
}

/* ---------------- 费用一览 ---------------- */
/** 以默认推荐配置估算「一条约 30 秒的视频」的总花费 */
function totals() {
  const imgs = IMAGE['qwen-image-2.0'].price * SAMPLE.scenes;
  const tts = ((SAMPLE.chars * 2) / 10000) * 0.8;
  const llm = 0.01;
  const base = imgs + llm;
  return [
    { name: '插画 + 镜头推拉（画面不动）', note: `${SAMPLE.scenes} 张图${'，配音用 Edge 免费'}`, cost: base, withTts: base + tts },
    { name: '图生视频 720P（推荐，真动画）', note: `${SAMPLE.scenes} 张图 + ${SAMPLE.seconds} 秒视频`, cost: base + 0.6 * SAMPLE.seconds, withTts: base + 0.6 * SAMPLE.seconds + tts },
    { name: '图生视频 1080P', note: `${SAMPLE.scenes} 张图 + ${SAMPLE.seconds} 秒视频`, cost: base + 1 * SAMPLE.seconds, withTts: base + 1 * SAMPLE.seconds + tts },
    { name: '纯文生视频 480P（wan2.2-t2v-plus）', note: `${SAMPLE.seconds} 秒视频，不画图，角色一致性较差`, cost: llm + 0.14 * SAMPLE.seconds, withTts: llm + 0.14 * SAMPLE.seconds + tts },
  ];
}

export function overviewHtml(esc) {
  const rows = [
    ['分镜 LLM', '规则模板（不启用 LLM）', 'free', '免费', '不拆得那么细，角色一致性差一些'],
    ['分镜 LLM', '阿里百炼 qwen-plus', 'paid', '输入 0.8 / 输出 2 元（每百万 token）', '一次分镜约 0.01 元'],
    ['文生图', 'mock', 'test', '免费', '渐变占位图，只用于测试'],
    ['文生图', 'qwen-image-2.0', 'paid', '0.2 元/张', '无免费额度'],
    ['文生图', 'qwen-image-3.0', 'paid', '0.18 元/张', '新用户 10 张免费'],
    ['配音', 'Edge 在线朗读', 'free', '免费，无需 Key', '音色有限，非官方接口'],
    ['配音', '阿里百炼 qwen3-tts-flash', 'paid', '0.8 元/万字符', '新用户 1 万字符免费'],
    ['视频生成', 'mock', 'test', '免费', '占位，只用于测试'],
    ['视频生成', '万相2.7 图生视频', 'paid', '720P 0.6 / 1080P 1 元/秒', '无免费额度'],
    ['视频生成', '万相 wan2.2 文生视频', 'paid', '480P 0.14 / 1080P 0.7 元/秒', '无免费额度'],
    ['视频生成', '火山方舟 Seedance lite', 'paid', '约 0.2 元/秒（720P）', '新用户有免费 token'],
    ['视频生成', 'OpenAI Sora', 'dead', '已停用', '2026-09-24 关闭 API'],
  ];
  const tag = { free: '免费', paid: '收费', test: '测试', dead: '已停用' };
  const t = totals();
  const money = (n) => `约 ${n < 10 ? n.toFixed(2) : n.toFixed(1)} 元`;
  return `<summary>费用一览：哪些免费、哪些收费、怎么收费</summary>
    <div class="cost-all-body">
      <table class="cost-table"><thead><tr><th>环节</th><th>选项</th><th>类型</th><th>费用</th><th>免费额度 / 说明</th></tr></thead><tbody>
        ${rows.map(([a, b, k, c, d]) => `<tr><td>${a}</td><td>${esc(b)}</td><td><span class="cost-tag ${k}">${tag[k]}</span></td><td>${esc(c)}</td><td>${esc(d)}</td></tr>`).join('')}
      </tbody></table>
      <h4>一条约 ${SAMPLE.seconds} 秒视频大概多少钱</h4>
      <table class="cost-table"><thead><tr><th>画面方式</th><th>包含</th><th>配音用 Edge</th><th>配音用百炼</th></tr></thead><tbody>
        ${t.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.note)}</td><td><b>${money(r.cost)}</b></td><td>${money(r.withTts)}</td></tr>`).join('')}
      </tbody></table>
      <p class="hint">按 ${SAMPLE.scenes} 个镜头、约 ${SAMPLE.chars} 字旁白估算；重画、重试成功才会再次计费，失败不收费。价格为各平台官网原价（人民币，不含限时优惠，核对于 ${PRICE_DATE}），实际以账单为准。
      <a href="${SOURCES.bailian[1]}" target="_blank" rel="noreferrer">${SOURCES.bailian[0]}</a> · <a href="${SOURCES.ark[1]}" target="_blank" rel="noreferrer">${SOURCES.ark[0]}</a>。
      「免费额度」只有新用户、北京地域、90 天有效，用完或过期就按量收费；本应用没有任何内置的免费视频模型，想不花钱可以用「插画 + 镜头推拉」配 Edge 配音，主要花费就是画图（0.2 元/张）。</p>
    </div>`;
}

/* ---------------- 创作页：按文案估算本次生成的费用 ---------------- */

/** 与服务端 pipeline.js 的拆分规则保持一致：返回每个镜头的旁白文本 */
function sceneTexts(script, split) {
  const text = String(script || '').replace(/\r/g, '');
  if (split === 'line') return text.split(/[\n，。！？；,.!?;]+/).map((s) => s.trim()).filter(Boolean);
  const maxChars = 26;
  const pieces = [];
  for (const s of text.split(/(?<=[。！？!?…])|\n+/).map((x) => x.trim()).filter(Boolean)) {
    if (s.length <= maxChars * 1.5) {
      pieces.push(s);
      continue;
    }
    let cur = '';
    for (const part of s.split(/(?<=[，,；;：:、])/)) {
      if (cur && (cur + part).length > maxChars) {
        pieces.push(cur);
        cur = part;
      } else cur += part;
    }
    if (cur) pieces.push(cur);
  }
  const units = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && (cur + p).length > maxChars) {
      units.push(cur);
      cur = p;
    } else cur += p;
  }
  if (cur) units.push(cur);
  return units;
}

/** 每秒单价；null = 价格表里没有 */
function videoPerSec(cfg) {
  if (cfg.mode === 'ark') return 0.216;
  const p = VIDEO[String(cfg.model || '').trim()];
  if (!p) return null;
  const res = cfg.resolution === '1080P' ? '1080P' : '720P';
  return p[res] ?? p[res === '720P' ? '480P' : '1080P'] ?? null;
}

/**
 * 估算「把当前文案生成成片」要花多少钱（创建项目本身不花钱，花钱的是之后点「生成视频」）。
 * 估算口径：镜头数按服务端同样的规则拆；旁白约 4 字/秒；图生视频每镜头 = 旁白秒数 + 0.6 秒（2~15 秒），
 * 片头 ≈ 4 秒、片尾 ≈ 5 秒；文生视频每镜头取设置里的时长（默认 5 秒）。重试成功才计费，失败不收费。
 * @returns {null | {scenes:number, chars:number, seconds:number, total:number, unknown:string[], parts:{label:string, cost:number|null, detail:string}[]}}
 */
export function estimate({ settings, split, script, visual, titleCard, endCard }) {
  const texts = sceneTexts(script, split);
  if (!texts.length) return null;
  const n = texts.length;
  const chars = texts.join('').replace(/\s/g, '').length;
  const parts = [];

  const llmOn = settings.llm.enabled && settings.llm.apiKey;
  parts.push({ label: '分镜', cost: llmOn ? 0.01 : 0, detail: llmOn ? '大模型写分镜' : '规则拆分' });

  if (visual !== 'video') {
    const cfg = settings.image;
    const p = IMAGE[String(cfg.model || '').trim()];
    if (cfg.mode === 'mock') parts.push({ label: '画图', cost: 0, detail: `${n} 张 · 测试模式` });
    else if (cfg.mode === 'dashscope' && p) parts.push({ label: '画图', cost: p.price * n, detail: `${n} 张 × ${p.price} 元` });
    else parts.push({ label: '画图', cost: null, detail: `${n} 张` });
  }

  const tts = settings.tts;
  if (tts.mode === 'edge') parts.push({ label: '配音', cost: 0, detail: 'Edge 免费' });
  else if (tts.mode === 'mock') parts.push({ label: '配音', cost: 0, detail: '测试模式' });
  else if (tts.mode === 'dashscope') parts.push({ label: '配音', cost: ((chars * 2) / 10000) * 0.8, detail: `${chars} 字` });
  else parts.push({ label: '配音', cost: null, detail: `${chars} 字` });

  let seconds = 0;
  if (visual !== 'image') {
    const cfg = settings.video;
    if (visual === 'i2v') {
      seconds = texts.reduce((a, t) => a + Math.min(15, Math.max(2, Math.ceil(t.replace(/\s/g, '').length / 4 + 0.6))), 0) + (titleCard ? 4 : 0) + (endCard ? 5 : 0);
    } else {
      seconds = n * (Math.round(Number(cfg.duration)) || 5);
    }
    const unit = videoPerSec(cfg);
    const label = visual === 'i2v' ? '图生视频' : '文生视频';
    if (cfg.mode === 'mock') parts.push({ label, cost: 0, detail: `${seconds} 秒 · 测试模式` });
    else if (cfg.mode === 'openai') parts.push({ label, cost: null, detail: 'Sora 已停用' });
    else if (unit != null && cfg.mode !== 'custom') parts.push({ label, cost: unit * seconds, detail: `约 ${seconds} 秒 × ${unit} 元` });
    else parts.push({ label, cost: null, detail: `约 ${seconds} 秒` });
  }

  const total = parts.reduce((a, p) => a + (p.cost || 0), 0);
  return { scenes: n, chars, seconds, total, unknown: parts.filter((p) => p.cost == null).map((p) => p.label), parts };
}

export const money = yuan;

/** 创作页那一行预计费用的 HTML */
export function estimateHtml(est, esc) {
  if (!est) return '<span class="est-empty">写好文案后，这里会显示生成成片的预计费用</span>';
  const cost = (p) => (p.cost == null ? '按服务商' : p.cost === 0 ? '免费' : yuan(p.cost));
  const free = est.total === 0 && !est.unknown.length;
  const head = free ? '预计费用：免费' : `预计费用：约 ${yuan(est.total)}${est.unknown.length ? `（另有 ${est.unknown.join('、')} 按服务商计费，未计入）` : ''}`;
  return `<b class="est-total ${free ? 'free' : ''}">${esc(head)}</b>
    <span class="est-parts">${est.parts.map((p) => `<span title="${esc(p.detail)}">${esc(p.label)} ${esc(cost(p))}</span>`).join('<i>+</i>')}</span>
    <span class="est-note">${est.scenes} 个镜头 · ${est.chars} 字，估算值，实际以账单为准；失败不收费</span>`;
}
