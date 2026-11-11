# 诗词视频工坊

输入一首古诗 → AI 分镜 → 插画 → 图生视频（画面真的会动）→ 配音 + 字幕 → 一键合成成片。

参考效果：国风手绘水彩动画，同一角色贯穿全片，片头标题卡、逐句字幕、片尾全诗。

## 启动

```bash
npm install
npm start          # 默认 http://localhost:3000，可用 WM_PORT 改端口
```

打开页面，点右上角「模型配置」填 API Key。没有 Key 也能跑：各项选 `mock` 可以走通整条流水线（画面是占位图）。

> 依赖：Node.js ≥ 18。ffmpeg 通过 `ffmpeg-static` 自带，无需另外安装。字幕默认字体为「微软雅黑」，在 Linux 部署时请改成已安装的中文字体（`server/ffmpeg.js` 的 `buildAss`）。

## 推荐配置：阿里百炼（一个 Key 全搞定）

| 能力 | 模式 | 模型 |
|---|---|---|
| 分镜 LLM | OpenAI 兼容，Base URL `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| 文生图 | 阿里百炼 | `qwen-image-2.0` |
| 配音 | 阿里百炼 `qwen3-tts` | `qwen3-tts-flash`，音色如 `Ethan` / `Cherry` |
| 视频 | 阿里百炼 万相2.7 图生视频 | `wan2.7-i2v`，720P |

也可以用命令行一次写入配置（Key 通过环境变量传入，不落盘到代码里）：

```bash
WM_KEY=sk-xxxx node scripts/setup-dashscope.js     # 需先 npm start
```

## 三种画面方式

| 方式 | 效果 | 成本 |
|---|---|---|
| **图生视频**（默认推荐） | 先画插画定角色，再让画面动起来（划船、水波、荷叶摇曳） | 中，按视频秒数计费 |
| 插画 + 镜头推拉 | 静态插画 + 缓慢推拉，画面本身不动 | 最低 |
| 纯文生视频 | 每镜头直接生成视频，角色一致性较差 | 高 |

## 流程

1. `POST /api/storyboard`：诗 → 一句一镜；LLM 输出全片统一的「角色 / 场景设定」，并为每句诗给出景别（远景 / 中景 / 特写…）、插画提示词、动作描述；自动加上片头标题卡和片尾全诗。
2. 页面上人工微调（生图、生视频都要钱，建议先在这里改满意）。
3. `POST /api/jobs`：并行配音与出图；图生视频按旁白时长生成对应长度的片段。片头 / 片尾复用诗句镜头的插画，不额外生图。
4. ffmpeg：对齐配音 → 烧录字幕（ASS）→ 统一规格 → 拼接 `final.mp4`。
5. 产物在 `output/<jobId>/`；失败后可点「重试」，已完成的素材会跳过，不重复计费。

## 接入其他 AI 服务

LLM / 文生图 / 配音 / 视频都支持 `custom` 模式：用「请求模板」描述任意 HTTP 接口，不用改代码。
模板里 `{{变量}}` 会被替换；整串恰好是 `{{变量}}` 时保留原类型（数字）。

内置预设：OpenAI（LLM、TTS、Sora）、火山方舟 Seedance、阿里百炼、免费的 Edge 在线朗读（无需 Key）。

**配音** 变量：`apiKey model voice speed text`；`responseType`：`binary` | `url` | `base64`（后两者配 `path`）

```json
{
  "request": { "method": "POST", "url": "https://example.com/tts",
               "headers": { "Authorization": "Bearer {{apiKey}}" },
               "body": { "text": "{{text}}", "voice": "{{voice}}" } },
  "responseType": "binary"
}
```

**文生图** 变量：`apiKey model prompt size width height ratio`

```json
{
  "request": { "method": "POST", "url": "https://example.com/image",
               "headers": { "Authorization": "Bearer {{apiKey}}" },
               "body": { "model": "{{model}}", "prompt": "{{prompt}}", "size": "{{size}}" } },
  "responseType": "url",
  "path": "data[0].url"
}
```

**视频**（异步：提交 → 轮询 → 下载）变量：`apiKey model prompt imageData duration resolution ratio size width height`，轮询 / 下载时额外有 `taskId`

```json
{
  "submit": { "method": "POST", "url": "https://example.com/video/submit",
              "headers": { "Authorization": "Bearer {{apiKey}}" },
              "body": { "model": "{{model}}", "prompt": "{{prompt}}", "image": "{{imageData}}", "duration": "{{duration}}" } },
  "taskIdPath": "data.task_id",
  "poll": { "method": "GET", "url": "https://example.com/video/{{taskId}}",
            "headers": { "Authorization": "Bearer {{apiKey}}" } },
  "statusPath": "data.status",
  "successValues": ["succeeded"],
  "failValues": ["failed"],
  "videoUrlPath": "data.video_url",
  "intervalMs": 6000,
  "timeoutMs": 900000
}
```

`imageData` 是首帧图的 base64 data URL；如果视频地址需要带 Key 下载，用 `download` 字段（见 `server/providers.js` 中 OpenAI Sora 预设）。

## 安全

- API Key 只保存在本机 `data/settings.json`（已加入 `.gitignore`），接口返回时会脱敏。
- 不要把 Key 写进代码、脚本或提交记录；如果 Key 泄露，请到对应平台重置。

## 目录

```
server/   index.js 路由 · pipeline.js 流水线 · providers.js 模型适配 · ffmpeg.js 合成 · settings.js 配置
public/   前端页面
data/     settings.json（含 API Key，已 gitignore）
output/   每个任务的中间素材与成片（已 gitignore）
scripts/  e2e.js 端到端自测 · setup-dashscope.js 一键写入百炼配置
```

## 后续可扩展

- 背景音乐混音 / 用图生视频自带的环境音做底噪
- 逐字高亮字幕（按 TTS 时间戳生成 ASS）
- 镜头之间的转场（交叉溶解）
- 任务队列持久化 / 多用户（目前单机内存 + 文件）
- 一键发布到抖音 / 视频号 / B站
