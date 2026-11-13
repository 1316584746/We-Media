/**
 * M Agent 的内置技能：每个技能 = 一个模板 + 画幅 / 画风偏好 + 一段给文案模型的角色说明。
 * 用户输入一句灵感，选一个技能，就能得到「标题 + 分镜文案」，再带到创作页一键生成视频。
 * 新增技能只需在 SKILLS 里加一项；字段说明：
 *  - cats：分类（「推荐」由 rec 决定，不用写）；template：套用的创作模板；
 *  - orientation：覆盖模板默认画幅；styleName：对应 STYLE_PRESETS 的名字（找不到就用模板默认画风）；
 *  - brief：给模型的角色与风格说明；rule：覆盖默认的输出要求；example：输入框占位提示。
 */
const { STYLE_PRESETS } = require('./templates');

const CATEGORIES = ['推荐', '古诗国风', '故事绘本', '知识科普', '口播干货', '治愈情感', '自媒体创作', '通用技能'];

const SKILLS = [
  {
    id: 'poem-classic',
    name: '古诗词动画',
    desc: '选一首意境相符的经典古诗，配国风插画、朗读和字幕',
    cats: ['古诗国风'],
    rec: true,
    template: 'poem',
    brief: '你熟悉中国古典诗词，会按用户给的意境、季节或情绪，挑一首真实存在的经典诗词。',
    example: '例如：想要一首写秋天思乡的诗',
  },
  {
    id: 'poem-ink',
    name: '水墨山水意境',
    desc: '山水田园类古诗，水墨写意画风，留白悠远',
    cats: ['古诗国风'],
    template: 'poem',
    styleName: '水墨写意',
    brief: '你偏爱山水田园与羁旅怀古类的古诗词（王维、柳宗元、苏轼一路），画面感强、意境悠远。',
    example: '例如：雨后空山、一个人的夜晚',
  },
  {
    id: 'story-bedtime',
    name: '睡前小故事',
    desc: '温暖短故事，一个主角一件小事，适合睡前听',
    cats: ['故事绘本'],
    rec: true,
    template: 'story',
    brief: '你是儿童睡前故事作者：主角形象鲜明，情节简单温暖，结尾安稳，语言口语化、适合朗读。',
    example: '例如：一只怕黑的小刺猬找到了会发光的萤火虫朋友',
  },
  {
    id: 'story-fairy',
    name: '童话绘本',
    desc: '蜡笔手绘童话风，充满童趣的小冒险',
    cats: ['故事绘本'],
    template: 'story',
    styleName: '蜡笔童话',
    brief: '你是童话绘本作者：想象力丰富，有一点点冒险和一个温柔的小道理，句子短、节奏轻快。',
    example: '例如：云朵城堡里的小面包师',
  },
  {
    id: 'sci-minute',
    name: '一分钟科普',
    desc: '把一个知识点讲清楚：现象 → 原因 → 一个生活例子',
    cats: ['知识科普'],
    rec: true,
    template: 'explainer',
    brief: '你是科普短视频编导：先抛出一个有趣的现象，再用最通俗的话讲原因，最后落到一个生活化的例子，不堆术语。',
    example: '例如：天空为什么是蓝色的',
  },
  {
    id: 'sci-cold',
    name: '冷知识盘点',
    desc: '一组让人「原来如此」的小知识，节奏快',
    cats: ['知识科普'],
    template: 'explainer',
    styleName: '手绘白板',
    brief: '你擅长冷知识短视频：每句一个让人意外的小事实，准确、不夸张，结尾给一个轻松的收束。',
    example: '例如：和咖啡有关的五个冷知识',
  },
  {
    id: 'talk-dry',
    name: '干货口播',
    desc: '观点先行、层层递进，竖屏口播字幕直接发',
    cats: ['口播干货'],
    rec: true,
    template: 'talk',
    brief: '你是知识类口播文案写手：开头一句抓人的观点或问题，中间 2~3 个要点，结尾一句可执行的建议。',
    example: '例如：睡不好，先改掉这三个习惯',
  },
  {
    id: 'talk-career',
    name: '职场成长口播',
    desc: '面试、沟通、效率类的实用建议',
    cats: ['口播干货', '自媒体创作'],
    template: 'talk',
    brief: '你是职场成长博主：说人话，给具体可操作的做法和一个简短的例子，避免空洞鸡汤。',
    example: '例如：第一次带团队，最容易踩的三个坑',
  },
  {
    id: 'heal-night',
    name: '晚安治愈',
    desc: '一句温柔的话，配柔光插画，陪你入睡',
    cats: ['治愈情感'],
    rec: true,
    template: 'heal',
    brief: '你是治愈系文字作者：语气轻柔，不说教，不贩卖焦虑，用具体的小场景（窗边、台灯、一杯热茶）带出安慰。',
    example: '例如：加班到很晚的你，今天辛苦了',
  },
  {
    id: 'heal-quote',
    name: '心灵鸡汤',
    desc: '短小有力的人生感悟，有画面、不空洞',
    cats: ['治愈情感', '自媒体创作'],
    template: 'heal',
    styleName: '莫兰迪低饱和',
    brief: '你写的心灵短句有画面、有生活细节，不堆砌大道理，读完让人想点头。',
    example: '例如：慢一点也没关系',
  },
  {
    id: 'media-xhs',
    name: '小红书风短视频',
    desc: '竖屏、清新好看、一条讲清一件事（生活 / 好物 / 经验）',
    cats: ['自媒体创作'],
    rec: true,
    template: 'free',
    orientation: 'portrait',
    styleName: '梦幻水彩',
    brief: '你是小红书风格的内容策划：口吻亲切像朋友分享，信息具体，有「收藏感」，不出现平台名与「点赞关注」。',
    example: '例如：租房党的 5 个小空间改造技巧',
  },
  {
    id: 'media-douyin',
    name: '抖音风短视频',
    desc: '竖屏、前三秒抓人、节奏快、结尾有反转或金句',
    cats: ['自媒体创作'],
    template: 'free',
    orientation: 'portrait',
    styleName: '杂志海报',
    brief: '你是抖音风格的编导：第一句就要抓住人（反常识、提问或冲突），节奏紧凑，结尾要有反转或一句金句，不出现平台名与「点赞关注」。',
    example: '例如：为什么越努力的人越容易焦虑',
  },
  {
    id: 'media-wechat',
    name: '公众号 / 视频号口播',
    desc: '横屏或竖屏皆可，讲清一个观点，适合配文章发布',
    cats: ['自媒体创作', '口播干货'],
    template: 'talk',
    brief: '你是公众号 / 视频号的口播撰稿人：观点完整、论述有逻辑、语气沉稳，一段话能独立成篇。',
    example: '例如：为什么好的内容需要「慢」下来',
  },
  {
    id: 'hot-remix',
    name: '爆款选题仿写',
    desc: '贴一个爆款视频的标题或题材，原创一版同类文案（不照搬）',
    cats: ['自媒体创作', '通用技能'],
    template: 'free',
    brief: '你擅长拆解爆款选题的结构（钩子、冲突、反转、情绪点），并用完全原创的内容写同类文案，绝不照搬原作品的句子。',
    example: '粘贴一个爆款视频的标题，或描述它的题材',
  },
  {
    id: 'free-any',
    name: '自由创作',
    desc: '想到什么写什么，AI 帮你写成分镜文案',
    cats: ['通用技能'],
    rec: true,
    template: 'free',
    brief: '你是全能的短视频文案策划，能根据任何灵感写出画面感强、节奏清楚的分镜文案。',
    example: '例如：一个关于秋天的小故事',
  },
];

const styleValue = (name) => STYLE_PRESETS.find((s) => s.name === name)?.value || '';

function listSkills() {
  return SKILLS.map(({ brief, rule, styleName, ...s }) => ({ ...s, cats: s.rec ? ['推荐', ...s.cats] : s.cats }));
}
const getSkill = (id) => SKILLS.find((s) => s.id === id) || null;

module.exports = { CATEGORIES, SKILLS, listSkills, getSkill, styleValue };
