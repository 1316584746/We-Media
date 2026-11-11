const path = require('path');
const express = require('express');
const settingsStore = require('./settings');
const pipeline = require('./pipeline');
const ff = require('./ffmpeg');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(settingsStore.ROOT, 'public')));
app.use('/output', express.static(pipeline.OUTPUT_DIR));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });

app.get('/api/settings', (req, res) => res.json(settingsStore.masked(settingsStore.load())));

app.put('/api/settings', (req, res) => {
  const saved = settingsStore.save(req.body);
  res.json(settingsStore.masked(saved));
});

app.post(
  '/api/storyboard',
  wrap(async (req, res) => {
    const { title, author, poem, style } = req.body || {};
    if (!poem || !String(poem).trim()) return res.status(400).json({ error: '请输入诗词内容' });
    res.json(await pipeline.storyboard({ title, author, poem: String(poem), style }));
  }),
);

app.post(
  '/api/jobs',
  wrap(async (req, res) => {
    const { title, author, scenes } = req.body || {};
    const job = pipeline.createJob({ title, author, scenes });
    pipeline.start(job);
    res.json({ id: job.id });
  }),
);

app.get('/api/jobs', (req, res) => res.json(pipeline.listJobs()));

app.get('/api/jobs/:id', (req, res) => {
  const job = pipeline.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  res.json(job);
});

app.post('/api/jobs/:id/retry', (req, res) => {
  const job = pipeline.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (job.status === 'running') return res.status(409).json({ error: '任务正在运行' });
  pipeline.start(job);
  res.json({ id: job.id });
});

const port = Number(process.env.WM_PORT) || 3000;
app.listen(port, () => {
  console.log(`自媒体视频工坊已启动： http://localhost:${port}`);
  console.log(`ffmpeg: ${ff.ffmpegPath}`);
});
