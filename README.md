# AI 视频工坊

一个通用的 AI 视频制作应用：选模板 → 写文案 → AI 分镜 → 插画 / 图生视频 → 配音 + 字幕 → 一键合成成片。
古诗词动画只是其中一个模板，另有故事绘本、知识科普、口播短视频、自由创作。

## 启动

```bash
npm install
npm start          # 默认 http://localhost:3000，可用 WM_PORT 改端口，WM_HOST 改监听地址（默认仅本机）
```

打开页面，到「设置」填 API Key。没有 Key 也能跑：各项选 `mock` 可以走通整条流水线（画面是占位图）。

> 依赖：Node.js ≥ 18。ffmpeg 通过 `ffmpeg-static` 自带，无需另外安装。字幕默认字体为「微软雅黑」，在 Linux 部署时请改成已安装的中文字体（`server/ffmpeg.js` 的 `buildAss`）。

## 应用结构

| 页面 | 路由 | 作用 |
|---|---|---|
| 创作 | `#/` | 选模板、写文案、设画幅 / 画风 / 配音 / 画面方式，一键创建项目（只拆分镜，不花钱） |
| 项目 | `#/projects` | 项目卡片网格：搜索、按状态筛选、复制、删除，生成中的项目实时显示进度 |
| 编辑器 | `#/p/<id>` | 左：分镜列表（可拖拽 / 上下移动、增删）· 中：成片 / 单镜头预览 + 时间线 · 右：镜头属性与项目设置；改动自动保存 |
| 设置 | `#/settings` | LLM / 文生图 / 配音 / 视频生成的模型与密钥，百炼一键配置 |

编辑器里的规则：

- 项目有状态：草稿 → 生成中 → 已完成 / 失败。改过分镜后成片标记「有改动」，点「重新生成」只重做改动过的镜头。
- 改旁白只重做该镜头的配音；改画面描述 / 动作只重做该镜头的画面；改画幅 / 画面方式 / 音色会让对应素材整体失效（会先确认）。
- 「重画此镜头」清除单个镜头的画面；「按脚本重新生成分镜」会丢弃所有修改。
- 生成中不能编辑，避免素材与分镜错位。

## 模板

模板在 `server/templates.js` 定义（输入项文案、切分方式、默认画风 / 画幅 / 配音、片头片尾、分镜师角色）。新增一个模板只需要加一项，前端自动出现。

| 模板 | 切分方式 | 默认 |
|---|---|---|
| 古诗词动画 | 一句诗一镜 | 横屏、国风水彩、片头标题 + 片尾全诗 |
| 故事绘本 | 按句合并（≤26 字 / 镜） | 横屏、儿童绘本、片头 + 「完」 |
| 知识科普 | 按句合并 | 横屏、扁平信息插画、片头 + 「感谢观看」 |
| 口播短视频 | 按句合并 | 竖屏、电影写实、无片头片尾 |
| 自由创作 | 按句合并 | 横屏、自定画风 |

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

配音也可以选免费的 Edge 在线朗读（无需 Key）。

## 三种画面方式

| 方式 | 效果 | 成本 |
|---|---|---|
| **图生视频**（默认推荐） | 先画插画定角色，再让画面动起来 | 中，按视频秒数计费 |
| 插画 + 镜头推拉 | 静态插画 + 缓慢推拉，画面本身不动 | 最低 |
| 纯文生视频 | 每镜头直接生成视频，角色一致性较差 | 高 |

## 生成流程

1. 创建项目：文案按模板规则切成分句；LLM 输出全片统一的「角色 / 场景设定」，并为每个分句给出景别、画面描述、动作描述；按需加片头标题卡和片尾。
2. 在编辑器里微调（生图、生视频都要钱，建议在这里改满意）。
3. 生成：并行配音与出图；图生视频按旁白时长生成对应长度的片段。片头 / 片尾复用首 / 尾镜头的画面，不额外生图。
4. ffmpeg：对齐配音 → 烧录字幕（ASS）→ 统一规格 → 拼接 `final.mp4`。
5. 产物在 `output/<projectId>/`；失败后点「重试生成」，已完成的素材会跳过，不重复计费。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 模板、画风预设、音色列表 |
| GET / PUT | `/api/settings` | 读取（Key 脱敏）/ 保存设置 |
| GET / POST | `/api/projects` | 项目列表 / 创建（`template, title, author, script, options`） |
| GET / PUT / DELETE | `/api/projects/:id` | 详情 / 保存（`title, options, scenes`）/ 删除 |
| POST | `/api/projects/:id/generate` | 开始或重试生成 |
| POST | `/api/projects/:id/duplicate` | 复制项目（连同已生成素材） |
| POST | `/api/projects/:id/storyboard` | 按脚本重新生成分镜 |
| POST | `/api/projects/:id/scenes/:sid/reset` | 清除单个镜头的画面 |
| GET | `/api/extensions` | 技能列表 + MCP 服务列表（env / headers 脱敏） |
| POST | `/api/skills/preview` | 解析 SKILL.md（`text` 或 `url`），不保存 |
| POST / PUT / DELETE | `/api/skills[/:id]` | 新增 / 修改（含启用开关、适用模板）/ 删除技能 |
| POST / PUT / DELETE | `/api/mcp[/:id]` | 新增 / 修改 / 删除 MCP 服务 |
| POST | `/api/mcp/import` | 导入标准 `mcp.json`（`{json}`，同名则更新） |
| POST | `/api/mcp/:id/test` | 测试连接并列出工具 |

## 扩展：技能（Skills）与 MCP

在左侧「扩展」页管理，数据保存在本机 `data/extensions.json`（已 gitignore）。

- **技能**：一份 `SKILL.md`（frontmatter 里的 `name` / `description` + 正文）。可粘贴、选文件或填 URL 导入，也可以手写。
  创建项目时勾选的技能会注入「分镜 LLM」的系统提示词，用来约束分镜风格、镜头语言、改写规则等。可设置只适用于某些模板。
- **MCP 服务**：支持本地命令（stdio）和远程地址（Streamable HTTP，自动回退 SSE）。可直接粘贴标准 `mcp.json`（`mcpServers`）导入。
  创建项目时打开「工具增强」，分镜前 LLM 会按需调用这些服务的工具（搜索、查资料……），把结果作为背景资料再写分镜；
  调用结果和失败原因在编辑器「项目」页签里可查。工具失败不会中断创建，会退回普通分镜。
- 技能和工具增强都依赖「分镜 LLM」，且所选模型要支持函数调用（工具增强）。未启用 LLM 时会给出提示。
- 自带一个示例 MCP 服务 `scripts/sample-mcp-server.js`（工具 `lookup_background`），用来验证连接：命令填 `node`，参数填它的绝对路径。

**安全提示**：stdio 的 MCP 会在本机执行命令，所以服务默认只监听 `127.0.0.1`，并拒绝非本机的 `Host` 请求。
只导入你信任的 MCP / 技能。需要局域网访问时才设置 `WM_HOST=0.0.0.0`，此时任何能访问该端口的人都能配置并执行本机命令，请务必谨慎。

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
server/    index.js 路由 · pipeline.js 项目与流水线 · templates.js 模板 · providers.js 模型适配 · ffmpeg.js 合成 · settings.js 配置
public/    前端：index.html 应用外壳 · style.css 设计系统 · js/main.js 路由 · js/core.js 公共工具 · js/pages/ 四个页面
data/      settings.json（含 API Key）· extensions.json（技能与 MCP 配置，可能含 env 密钥），均已 gitignore
output/    每个项目的素材与成片（已 gitignore）
scripts/   api-test.js 后端接口自测 · ui-check.js 真实浏览器 UI 自测 · e2e.js 真实模型端到端 · setup-dashscope.js 一键写入百炼配置
```

## 自测

用独立目录 + mock 配置，不动本地设置、不产生费用：

```powershell
$env:WM_DATA_DIR='E:\tmp\wm-data'; $env:WM_OUTPUT_DIR='E:\tmp\wm-out'; $env:WM_PORT='3100'; node server/index.js
node scripts/api-test.js http://localhost:3100     # 接口：创建 / 编辑 / 缓存失效 / 生成 / 复制 / 删除
node scripts/ui-check.js http://localhost:3100     # 浏览器：Windows + Edge，驱动真实页面交互
```

## 后续可扩展

- 背景音乐混音 / 用图生视频自带的环境音做底噪
- 逐字高亮字幕（按 TTS 时间戳生成 ASS）
- 镜头之间的转场（交叉溶解）
- 素材库（上传自己的图片 / 视频 / 音乐作为镜头素材）、模板市场
- 任务队列持久化 / 多用户与账号（目前单机内存 + 文件）
- 一键发布到抖音 / 视频号 / B站
