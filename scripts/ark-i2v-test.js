// 火山方舟「图生视频」(ark_i2v) 的请求格式自测：用本地假服务，不花钱、不需要 Key
//   node scripts/ark-i2v-test.js
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const providers = require('../server/providers');

let failed = 0;
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
  if (!c) failed++;
};

(async () => {
  const seen = { submit: null, auth: null, polled: 0 };
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

  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `${failed} 项失败` : '全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
