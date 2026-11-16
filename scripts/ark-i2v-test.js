// 火山方舟「图生视频」(ark_i2v) 和「文生图」(Seedream) 的请求格式自测：用本地假服务，不花钱、不需要 Key
//   node scripts/ark-i2v-test.js
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const providers = require('../server/providers');
const ff = require('../server/ffmpeg');

let failed = 0;
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
  if (!c) failed++;
};

(async () => {
  const seen = { submit: null, auth: null, polled: 0, image: null };
  const jpgFile = path.join(os.tmpdir(), `ark-pic-${Date.now()}.jpg`);
  await ff.run(['-f', 'lavfi', '-i', 'testsrc2=size=2560x1440:rate=1:duration=1', '-frames:v', '1', jpgFile]); // 假装是方舟返回的 2560x1440 jpeg
  const jpg = fs.readFileSync(jpgFile);
  fs.rmSync(jpgFile, { force: true });
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/api/v3/contents/generations/tasks') {
        seen.submit = JSON.parse(body);
        seen.auth = req.headers.authorization;
        return res.end(JSON.stringify({ id: 'cgt-test-1' }));
      }
      if (req.method === 'GET' && req.url === '/api/v3/contents/generations/tasks/cgt-test-1') {
        seen.polled++;
        return res.end(JSON.stringify({ id: 'cgt-test-1', status: 'succeeded', content: { video_url: `http://127.0.0.1:${srv.address().port}/video.mp4` } }));
      }
      if (req.url === '/video.mp4') return res.end(Buffer.from('FAKE-MP4'));
      if (req.method === 'POST' && req.url === '/api/v3/images/generations') {
        seen.image = { body: JSON.parse(body), auth: req.headers.authorization };
        return res.end(JSON.stringify({ model: 'doubao-seedream-5-0-flash-260915', data: [{ url: `http://127.0.0.1:${srv.address().port}/pic.jpg`, size: '2560x1440' }] }));
      }
      if (req.url === '/pic.jpg') return res.end(jpg);
      res.writeHead(404).end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-i2v-'));
  const img = path.join(tmp, 'image.png');
  fs.writeFileSync(img, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const out = path.join(tmp, 'clip.mp4');

  const cfg = { mode: 'ark_i2v', baseUrl: `http://127.0.0.1:${srv.address().port}`, apiKey: 'ark-key', model: 'doubao-seedance-1-0-pro-fast-251015', resolution: '720P' };
  await providers.generateClip({ cfg, render: { orientation: 'landscape' }, prompt: '镜头缓慢推近，轻风吹动', outFile: out, imageFile: img, duration: 5 });

  const b = seen.submit || {};
  ok(seen.auth === 'Bearer ark-key', '带上了 Authorization');
  ok(b.model === 'doubao-seedance-1-0-pro-fast-251015', '模型 ID 传对');
  ok(Array.isArray(b.content) && b.content[0].type === 'text' && b.content[0].text === '镜头缓慢推近，轻风吹动', '第一项是文字提示词');
  ok(b.content[1]?.type === 'image_url' && b.content[1].role === 'first_frame' && /^data:image\/png;base64,/.test(b.content[1].image_url.url), '第二项是首帧图（base64）');
  ok(b.resolution === '720p' && b.ratio === 'adaptive' && b.duration === 5 && b.watermark === false, '分辨率小写、比例跟随图片、时长是数字、不加水印');
  ok(seen.polled >= 1 && fs.readFileSync(out, 'utf8') === 'FAKE-MP4', '轮询到成功后把视频下载到本地');

  // 文生视频（ark）保持原来的格式
  seen.submit = null;
  await providers.generateClip({ cfg: { ...cfg, mode: 'ark', model: 'doubao-seedance-1-0-lite-t2v-250428' }, render: { orientation: 'portrait' }, prompt: '一只猫', outFile: out, duration: 4 });
  ok(seen.submit.content.length === 1 && seen.submit.content[0].text === '一只猫 --ratio 9:16 --dur 4', '文生视频（ark）格式没变');

  // 文生图（Seedream）
  const picOut = path.join(tmp, 'scene', 'image.png');
  const icfg = { mode: 'ark', baseUrl: cfg.baseUrl, apiKey: 'ark-key', model: 'doubao-seedream-5-0-flash-260915' };
  await providers.generateImage({ cfg: icfg, render: { orientation: 'landscape' }, prompt: '一叶扁舟', outFile: picOut });
  const ib = seen.image?.body || {};
  ok(seen.image?.auth === 'Bearer ark-key' && ib.model === 'doubao-seedream-5-0-flash-260915', '文生图：Key 和模型 ID 传对');
  ok(typeof ib.prompt === 'string' && ib.prompt.startsWith('一叶扁舟'), '文生图：提示词传对');
  ok(ib.size === '2560x1440' && ib.response_format === 'url' && ib.watermark === false, '文生图：横屏 2560x1440、返回链接、不加水印');
  const head = fs.readFileSync(picOut).subarray(0, 8);
  ok(head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47, '文生图：下载后转成了真正的 PNG（图生视频按 PNG 上传）');
  ok(!fs.existsSync(`${picOut}.dl`), '文生图：临时文件已清理');
  const probe = await new Promise((resolve) => {
    const { spawn } = require('child_process');
    const p = spawn(require('ffmpeg-static'), ['-hide_banner', '-i', picOut]);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', () => resolve(err));
  });
  ok(/1920x1080/.test(probe), '文生图：统一成 1920x1080');
  await providers.generateImage({ cfg: icfg, render: { orientation: 'portrait' }, prompt: '竖屏', outFile: picOut });
  ok(seen.image.body.size === '1440x2560', '文生图：竖屏 1440x2560');

  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `${failed} 项失败` : '全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
