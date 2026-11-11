// 把百炼 Key 写入本机配置（LLM / 文生图 / 配音 / 文生视频 共用）。用法：WM_KEY=xxx node scripts/setup-dashscope.js
const key = process.env.WM_KEY;
if (!key) throw new Error('缺少 WM_KEY');
fetch(`${process.env.WM_BASE || 'http://localhost:3000'}/api/settings`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    llm: { enabled: true, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: key, model: 'qwen-plus' },
    image: { mode: 'dashscope', apiKey: key, baseUrl: '', model: 'qwen-image-2.0' },
    tts: { mode: 'dashscope', apiKey: key, baseUrl: '', model: 'qwen3-tts-flash', voice: 'Ethan' },
    video: { mode: 'dashscope_i2v', apiKey: key, baseUrl: '', model: 'wan2.7-i2v', resolution: '720P', concurrency: 2 },
    render: {
      visual: 'i2v',
      orientation: 'landscape',
      linesPerScene: 1,
      style: '国风手绘水彩插画，清新柔和的色调，薄雾与自然光，细腻的东方意境，画面中不出现任何文字和水印',
    },
  }),
})
  .then((r) => r.json())
  .then((s) => console.log('saved:', JSON.stringify({ llm: s.llm.enabled, image: s.image.mode, tts: s.tts.mode, video: s.video.mode, visual: s.render.visual, orientation: s.render.orientation })));
