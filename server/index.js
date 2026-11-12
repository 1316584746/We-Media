const path = require('path');
const express = require('express');
const settingsStore = require('./settings');
const pipeline = require('./pipeline');
const ff = require('./ffmpeg');
const { TEMPLATES, STYLE_PRESETS, VOICES } = require('./templates');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(settingsStore.ROOT, 'public')));
app.use('/output', express.static(pipeline.OUTPUT_DIR));

const wrap = (fn) => (req, res) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((e) => {
      if (!e.status) console.error(e);
      res.status(e.status || 500).json({ error: e.message });
    });

/* ---------- 应用元数据：模板、画风预设、音色 ---------- */
app.get('/api/meta', (req, res) => {
  const s = settingsStore.load();
  res.json({
    templates: TEMPLATES,
    stylePresets: STYLE_PRESETS,
    voices: VOICES,
    ttsMode: s.tts.mode,
  });
});

/* ---------- 设置 ---------- */
app.get('/api/settings', (req, res) => res.json(settingsStore.masked(settingsStore.load())));
app.put('/api/settings', (req, res) => res.json(settingsStore.masked(settingsStore.save(req.body))));

/* ---------- 项目 ---------- */
app.get('/api/projects', (req, res) => res.json(pipeline.listProjects()));

app.post(
  '/api/projects',
  wrap(async (req, res) => res.json(await pipeline.createProject(req.body || {}))),
);

app.get(
  '/api/projects/:id',
  wrap((req, res) => {
    const job = pipeline.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '项目不存在' });
    res.json(job);
  }),
);

app.put(
  '/api/projects/:id',
  wrap((req, res) => res.json(pipeline.updateProject(req.params.id, req.body || {}))),
);

app.delete(
  '/api/projects/:id',
  wrap((req, res) => {
    pipeline.deleteProject(req.params.id);
    res.json({ ok: true });
  }),
);

app.post(
  '/api/projects/:id/duplicate',
  wrap((req, res) => res.json(pipeline.duplicateProject(req.params.id))),
);

app.post(
  '/api/projects/:id/generate',
  wrap((req, res) => res.json(pipeline.startGenerate(req.params.id))),
);

app.post(
  '/api/projects/:id/storyboard',
  wrap(async (req, res) => res.json(await pipeline.rebuildStoryboard(req.params.id))),
);

app.post(
  '/api/projects/:id/scenes/:sid/reset',
  wrap((req, res) => res.json(pipeline.resetSceneById(req.params.id, req.params.sid))),
);

const port = Number(process.env.WM_PORT) || 3000;
app.listen(port, () => {
  console.log(`AI 视频工坊已启动： http://localhost:${port}`);
  console.log(`ffmpeg: ${ff.ffmpegPath}`);
});
