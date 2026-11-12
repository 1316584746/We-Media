const path = require('path');
const os = require('os');
const fs = require('fs');
const providers = require('./providers');
const { publicFeatured } = require('./featured');
const edits = require('./edits');
const editRender = require('./edit-render');
const express = require('express');
const settingsStore = require('./settings');
const pipeline = require('./pipeline');
const ff = require('./ffmpeg');
const { TEMPLATES, STYLE_PRESETS, VOICES } = require('./templates');

const extensions = require('./extensions');
const mcp = require('./mcp');

const app = express();
// 安全：MCP 本地命令方式会在本机执行命令，默认只监听本机并校验 Host（防 DNS 重绑定）。
// 需要局域网访问时显式设置 WM_HOST=0.0.0.0（风险自负）。
app.use((req, res, next) => {
  if (process.env.WM_HOST) return next();
  const host = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (['localhost', '127.0.0.1', '::1'].includes(host)) return next();
  res.status(403).send('forbidden host');
});
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(settingsStore.ROOT, 'public')));
app.use('/output', express.static(pipeline.OUTPUT_DIR));
app.use('/edit-files', express.static(edits.EDIT_DIR)); // 剪辑素材 / 导出（支持 Range，预览要拖动进度）

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
    featured: publicFeatured(),
    ttsMode: s.tts.mode,
  });
});

/* ---------- 设置 ---------- */
app.get('/api/settings', (req, res) => res.json(settingsStore.masked(settingsStore.load())));
app.put('/api/settings', (req, res) => res.json(settingsStore.masked(settingsStore.save(req.body))));

/* ---------- 音色试听 ----------
 * body: { voice?, text?, tts? }
 * tts 是设置页里「尚未保存」的配音配置，覆盖已保存的值；脱敏的 key 视为未修改。 */
const SAMPLE_TEXT = '春风又绿江南岸，明月何时照我还。';
app.post(
  '/api/tts/preview',
  wrap(async (req, res) => {
    const { voice, text, tts } = req.body || {};
    const saved = settingsStore.load().tts;
    const over = { ...(tts || {}) };
    if (typeof over.apiKey !== 'string' || over.apiKey.startsWith('********') || !over.apiKey) delete over.apiKey;
    const cfg = providers.ttsWithVoice({ ...saved, ...over }, voice);
    const sample = String(text || SAMPLE_TEXT).slice(0, 120);
    const file = path.join(os.tmpdir(), `wm-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
    try {
      await providers.synthesizeSpeech({ cfg, text: sample, outFile: file });
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-TTS-Mode': cfg.mode });
      res.send(fs.readFileSync(file));
    } catch (e) {
      throw Object.assign(new Error(`试听失败：${e.message}`), { status: 502 });
    } finally {
      fs.rm(file, { force: true }, () => {});
    }
  }),
);

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

/* ---------- 视频剪辑 ---------- */
app.get('/api/edits', (req, res) => res.json(edits.list()));
app.post('/api/edits', wrap(async (req, res) => res.json(await edits.create(req.body || {}))));
app.get('/api/edits/:id', wrap(async (req, res) => res.json(edits.view(edits.read(req.params.id)))));
app.put('/api/edits/:id', wrap(async (req, res) => res.json(await edits.update(req.params.id, req.body || {}))));
app.delete(
  '/api/edits/:id',
  wrap(async (req, res) => {
    if (edits.exporting.has(req.params.id)) throw edits.httpError(409, '正在导出，稍后再删除');
    edits.remove(req.params.id);
    res.json({ ok: true });
  }),
);

// 上传素材：原始二进制直接流式落盘（不经过 JSON 解析），文件名放在 ?name=
const MAX_UPLOAD = 4 * 1024 * 1024 * 1024;
app.post(
  '/api/edits/:id/media',
  wrap(async (req, res) => {
    const id = req.params.id;
    edits.read(id);
    const name = String(req.query.name || 'media').slice(0, 160);
    if (!edits.kindOfExt(path.extname(name).slice(1).toLowerCase())) throw edits.httpError(400, `不支持的文件类型：${path.extname(name) || name}（支持视频、音频、图片）`);
    if (Number(req.headers['content-length']) > MAX_UPLOAD) throw edits.httpError(413, '文件太大（上限 4GB）');
    const tmp = path.join(edits.dirOf(id), `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.part`);
    let bytes = 0;
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        req.on('data', (c) => {
          bytes += c.length;
          if (bytes > MAX_UPLOAD) req.destroy(new Error('文件太大'));
        });
        req.on('error', reject);
        req.on('aborted', () => reject(new Error('上传中断')));
        out.on('error', reject);
        out.on('finish', resolve);
        req.pipe(out);
      });
      if (!bytes) throw edits.httpError(400, '收到的文件是空的');
      res.json(await edits.addMedia(id, tmp, name));
    } finally {
      fs.rm(tmp, { force: true }, () => {});
    }
  }),
);
app.delete('/api/edits/:id/media/:mid', wrap(async (req, res) => res.json(await edits.removeMedia(req.params.id, req.params.mid))));
app.post(
  '/api/edits/:id/media/from-project',
  wrap(async (req, res) => {
    edits.read(req.params.id);
    res.json(await edits.importProject(req.params.id, String((req.body || {}).projectId || '')));
  }),
);
app.post(
  '/api/edits/:id/export',
  wrap(async (req, res) => {
    await editRender.startExport(req.params.id);
    res.json(edits.view(edits.read(req.params.id)));
  }),
);
app.get(
  '/api/edits/:id/download',
  wrap(async (req, res) => {
    const e = edits.read(req.params.id);
    if (e.export?.status !== 'done' || !e.export.file) throw edits.httpError(404, '还没有导出成片');
    const abs = path.join(edits.dirOf(e.id), e.export.file);
    if (!fs.existsSync(abs)) throw edits.httpError(404, '成片文件已丢失，请重新导出');
    res.download(abs, `${e.name.replace(/[\\/:*?"<>|]+/g, '_')}.mp4`);
  }),
);

/* ---------- 扩展：技能 / MCP ---------- */
const extList = () => {
  const d = extensions.load();
  return { skills: d.skills, mcp: d.mcp.map(extensions.publicMcp) };
};
app.get('/api/extensions', (req, res) => res.json(extList()));

app.post('/api/skills/preview', wrap(async (req, res) => res.json(await extensions.previewSkillImport(req.body || {}))));
app.post('/api/skills', wrap((req, res) => res.json(extensions.createSkill(req.body || {}))));
app.put('/api/skills/:id', wrap((req, res) => res.json(extensions.updateSkill(req.params.id, req.body || {}))));
app.delete(
  '/api/skills/:id',
  wrap((req, res) => {
    extensions.deleteSkill(req.params.id);
    res.json({ ok: true });
  }),
);

app.post('/api/mcp', wrap((req, res) => res.json(extensions.publicMcp(extensions.createMcp(req.body || {})))));
app.post('/api/mcp/import', wrap((req, res) => res.json(extensions.importMcpJson((req.body || {}).json))));
app.put('/api/mcp/:id', wrap((req, res) => res.json(extensions.publicMcp(extensions.updateMcp(req.params.id, req.body || {})))));
app.delete(
  '/api/mcp/:id',
  wrap((req, res) => {
    extensions.deleteMcp(req.params.id);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/mcp/:id/test',
  wrap(async (req, res) => {
    const cfg = extensions.getMcp(req.params.id);
    if (!cfg) return res.status(404).json({ error: 'MCP 服务不存在' });
    extensions.recordMcpTest(cfg.id, await mcp.testServer(cfg));
    res.json(extensions.publicMcp(extensions.getMcp(cfg.id)));
  }),
);

const port = Number(process.env.WM_PORT) || 3000;
const host = process.env.WM_HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`AI 视频工坊已启动： http://localhost:${port}${process.env.WM_HOST ? `（监听 ${host}）` : '（仅本机访问）'}`);
  console.log(`ffmpeg: ${ff.ffmpegPath}`);
});
