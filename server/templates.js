/**
 * 视频模板：决定"输入什么、怎么分镜、默认画风/画幅/配音、有没有片头片尾"。
 * 古诗词只是其中一个模板；新增模板只需在这里加一项，前端自动出现。
 */

const NO_TEXT = '画面中不出现任何文字、字幕和水印';

const TEMPLATES = [
  {
    id: 'poem',
    name: '古诗词动画',
    glyph: '诗',
    hue: 8,
    desc: '输入一首古诗，自动分镜、绘制国风插画、配音配字幕',
    titleLabel: '诗名',
    titlePlaceholder: '例如：池上',
    authorLabel: '作者',
    authorPlaceholder: '例如：白居易',
    scriptLabel: '诗词正文',
    scriptPlaceholder: '小娃撑小艇，偷采白莲回。\n不解藏踪迹，浮萍一道开。',
    split: 'line',
    role: '古诗词动画短片的分镜师',
    unit: '诗句',
    fallbackPrefix: '诗句意境：',
    defaultMotion: '画面中的人物与景物自然缓慢地运动，水面泛起涟漪，花草随风轻摆，薄雾缓缓流动，镜头缓慢推进',
    keepStyle: `保持原画的国风手绘水彩风格与人物外观，${NO_TEXT}。`,
    endMode: 'script', // 片尾展示全文
    endText: '',
    defaults: {
      style: `国风手绘水彩插画，清新柔和的色调，薄雾与自然光，细腻的东方意境，${NO_TEXT}`,
      orientation: 'landscape',
      titleCard: true,
      endCard: true,
      subtitles: true,
      voice: 'zh-CN-YunxiNeural',
    },
    samples: [
      { name: '池上', title: '池上', author: '白居易', script: '小娃撑小艇，偷采白莲回。\n不解藏踪迹，浮萍一道开。' },
      { name: '静夜思', title: '静夜思', author: '李白', script: '床前明月光，疑是地上霜。\n举头望明月，低头思故乡。' },
      { name: '登鹳雀楼', title: '登鹳雀楼', author: '王之涣', script: '白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。' },
      { name: '春晓', title: '春晓', author: '孟浩然', script: '春眠不觉晓，处处闻啼鸟。\n夜来风雨声，花落知多少。' },
    ],
  },
  {
    id: 'story',
    name: '故事绘本',
    glyph: '故',
    hue: 32,
    desc: '把一个小故事做成绘本风动画，适合儿童故事、寓言、睡前故事',
    titleLabel: '故事名',
    titlePlaceholder: '例如：小兔子找月亮',
    authorLabel: '',
    scriptLabel: '故事文本',
    scriptPlaceholder: '夜深了，小兔子睡不着。它抬头一看，月亮不见了。\n小兔子决定出门去找月亮……',
    split: 'sentence',
    role: '儿童绘本动画短片的分镜师',
    unit: '段落',
    fallbackPrefix: '故事情节：',
    defaultMotion: '角色做出自然轻柔的动作，背景里的草木云朵轻轻摆动，镜头缓慢推进',
    keepStyle: `保持原画的绘本风格与角色外观，${NO_TEXT}。`,
    endMode: 'text',
    endText: '— 完 —',
    defaults: {
      style: `温暖治愈的儿童绘本插画，柔和水彩与彩铅质感，明亮的暖色调，圆润可爱的造型，${NO_TEXT}`,
      orientation: 'landscape',
      titleCard: true,
      endCard: true,
      subtitles: true,
      voice: 'zh-CN-XiaoyiNeural',
    },
    samples: [
      {
        name: '小兔找月亮',
        title: '小兔子找月亮',
        script:
          '夜深了，小兔子睡不着。它抬头一看，月亮不见了。\n小兔子决定出门去找月亮。它走过安静的森林，萤火虫为它点亮小路。\n在小河边，它看见水里有一个圆圆的月亮。小兔子伸手去捞，月亮却碎成了一圈圈波纹。\n这时，一只老乌龟笑着说：月亮没有丢，它一直挂在天上。\n小兔子抬起头，月亮正温柔地看着它。它笑了，回家安心地睡着了。',
      },
    ],
  },
  {
    id: 'explainer',
    name: '知识科普',
    glyph: '知',
    hue: 210,
    desc: '把一段知识讲解做成图文动画，适合科普、教程、概念解释',
    titleLabel: '主题',
    titlePlaceholder: '例如：为什么天空是蓝色的',
    authorLabel: '',
    scriptLabel: '讲解文案',
    scriptPlaceholder: '阳光看起来是白色的，其实它由七种颜色的光组成。\n当阳光穿过大气层，蓝光更容易被空气分子散射……',
    split: 'sentence',
    role: '知识科普视频的分镜师（用场景示意、图形隐喻、实物特写来表达知识点）',
    unit: '讲解段',
    fallbackPrefix: '讲解内容：',
    defaultMotion: '画面中的元素平稳缓慢地运动，光线与粒子轻轻流动，镜头缓慢推进',
    keepStyle: `保持原画的插画风格与配色，${NO_TEXT}。`,
    endMode: 'text',
    endText: '感谢观看',
    defaults: {
      style: `现代扁平化矢量信息插画，简洁明快的蓝色系配色，清晰的图形隐喻，${NO_TEXT}`,
      orientation: 'landscape',
      titleCard: true,
      endCard: true,
      subtitles: true,
      voice: 'zh-CN-YunyangNeural',
    },
    samples: [
      {
        name: '天空为什么是蓝的',
        title: '为什么天空是蓝色的',
        script:
          '阳光看起来是白色的，其实它由七种颜色的光组成。\n当阳光穿过大气层，波长较短的蓝光更容易被空气分子散射到四面八方。\n所以无论你看向天空的哪个方向，都会看到散射过来的蓝光。\n而到了日落时分，阳光要穿过更厚的大气，蓝光几乎散光了，剩下的红橙光把天边染成了晚霞。',
      },
    ],
  },
  {
    id: 'talk',
    name: '口播短视频',
    glyph: '播',
    hue: 160,
    desc: '一段口播文案配电影感画面，竖屏，适合抖音、视频号、小红书',
    titleLabel: '标题（可选）',
    titlePlaceholder: '例如：三个习惯，让你更自律',
    authorLabel: '',
    scriptLabel: '口播文案',
    scriptPlaceholder: '想变得自律，别靠意志力。\n第一，把目标拆到小到不可能失败……',
    split: 'sentence',
    role: '竖屏短视频的分镜师（电影感写实画面，注重情绪与氛围）',
    unit: '文案段',
    fallbackPrefix: '文案内容：',
    defaultMotion: '人物与环境自然轻微地运动，光影缓缓变化，镜头缓慢推进',
    keepStyle: `保持原画的画面风格与人物外观，${NO_TEXT}。`,
    endMode: 'text',
    endText: '',
    defaults: {
      style: `电影感写实摄影，浅景深，柔和自然光，高级调色，${NO_TEXT}`,
      orientation: 'portrait',
      titleCard: false,
      endCard: false,
      subtitles: true,
      voice: 'zh-CN-XiaoxiaoNeural',
    },
    samples: [
      {
        name: '自律三招',
        title: '三个习惯，让你更自律',
        script:
          '想变得自律，别靠意志力。\n第一，把目标拆到小到不可能失败，比如每天只读一页书。\n第二，固定时间固定地点，让行动变成条件反射。\n第三，当天就奖励自己，让大脑记住这件事是愉快的。\n从今天开始，先做最小的那一步。',
      },
    ],
  },
  {
    id: 'heal',
    name: '心灵鸡汤',
    glyph: '愈',
    hue: 338,
    desc: '治愈系的温暖文字配柔和画面：睡前安慰、情绪价值、自我疗愈，竖屏适合小红书、抖音',
    titleLabel: '标题（可选）',
    titlePlaceholder: '例如：给今天有点累的你',
    authorLabel: '',
    scriptLabel: '治愈文案',
    scriptPlaceholder: '今天过得不太好也没关系。\n不是每一天都要闪闪发光……\n（每一句会对应一个镜头，句子短一点、语气轻一点，效果更好）',
    split: 'sentence',
    role: '治愈系情感短视频的分镜师（用安静的生活场景、自然风景、小动物、光影和留白来承载情绪；避免真人面部特写和夸张动作，画面柔和、慢节奏、有呼吸感）',
    unit: '句子',
    fallbackPrefix: '治愈意境：',
    defaultMotion: '画面极轻微地运动，云朵缓缓飘过，光斑与微尘轻轻浮动，窗帘与草叶微微摆动，镜头缓慢推进',
    keepStyle: `保持原画的治愈系柔和风格与主体外观，${NO_TEXT}。`,
    endMode: 'text',
    endText: '愿你被世界温柔以待',
    defaults: {
      style: `治愈系插画，柔和的暖色调与晨光黄昏光线，云朵、植物、窗边、小猫与小房子，安静温柔的氛围，细腻水彩质感，大面积留白，${NO_TEXT}`,
      orientation: 'portrait',
      titleCard: false,
      endCard: true,
      subtitles: true,
      voice: 'zh-CN-XiaoxiaoNeural',
    },
    samples: [
      {
        name: '允许自己慢下来',
        title: '给今天有点累的你',
        script:
          '今天过得不太好，也没关系。\n不是每一天都要闪闪发光，有些日子，能好好吃完一顿饭，就已经很了不起。\n你已经走了很远的路，偶尔停下来歇一歇，没有人会怪你。\n风会吹散今天的疲惫，明天的太阳，照常升起。\n晚安，愿你睡个好觉。',
      },
      {
        name: '每个人都有自己的花期',
        title: '你有你的花期',
        script:
          '花不会因为别人先开，就怀疑自己的春天。\n你也一样。\n有的人走得快，有的人走得慢，但每个人，都有自己的花期。\n别着急，也别比较。\n把今天好好过完，就是在慢慢开花。',
      },
      {
        name: '给焦虑的你',
        title: '先深呼吸一下',
        script:
          '如果你现在有一点焦虑，请先深呼吸。\n吸气，数到四，再慢慢地把气吐出来。\n你担心的很多事情，其实还没有发生。\n把注意力放回此刻：脚踩着地面，身体被稳稳地接住。\n你很安全，你已经做得很好了。',
      },
    ],
  },
  {
    id: 'free',
    name: '自由创作',
    glyph: '✦',
    hue: 270,
    desc: '任意文案都可以：自己写脚本，自己定画风，其余交给 AI',
    titleLabel: '标题（可选）',
    titlePlaceholder: '给视频起个名字',
    authorLabel: '',
    scriptLabel: '脚本文案',
    scriptPlaceholder: '写下你想讲的内容，每段话会对应一个镜头。',
    split: 'sentence',
    role: '短视频分镜师',
    unit: '段落',
    fallbackPrefix: '画面内容：',
    defaultMotion: '画面自然缓慢地运动，光影轻轻变化，镜头缓慢推进',
    keepStyle: `保持原画的画面风格与主体外观，${NO_TEXT}。`,
    endMode: 'text',
    endText: '',
    defaults: {
      style: `精致的数字插画，色彩丰富，电影感构图，${NO_TEXT}`,
      orientation: 'landscape',
      titleCard: false,
      endCard: false,
      subtitles: true,
      voice: 'zh-CN-YunxiNeural',
    },
    samples: [],
  },
];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));
const getTemplate = (id) => byId.get(id) || byId.get('free');

/** 画风快捷选项（创建页的画风 chips） */
const STYLE_PRESETS = [
  { name: '国风水彩', value: `国风手绘水彩插画，清新柔和的色调，薄雾与自然光，细腻的东方意境，${NO_TEXT}` },
  { name: '儿童绘本', value: `温暖治愈的儿童绘本插画，柔和水彩与彩铅质感，明亮的暖色调，圆润可爱的造型，${NO_TEXT}` },
  { name: '扁平插画', value: `现代扁平化矢量信息插画，简洁明快的配色，清晰的图形隐喻，${NO_TEXT}` },
  { name: '电影写实', value: `电影感写实摄影，浅景深，柔和自然光，高级调色，${NO_TEXT}` },
  { name: '治愈柔光', value: `治愈系插画，柔和的暖色调与晨光黄昏光线，云朵、植物、窗边、小猫与小房子，安静温柔的氛围，细腻水彩质感，大面积留白，${NO_TEXT}` },
  { name: '日系动漫', value: `日系动漫风格插画，清透的色彩，细腻的光影与天空，精致的人物线条，${NO_TEXT}` },
  { name: '3D 卡通', value: `3D 卡通渲染风格，皮克斯质感，柔和打光，饱满可爱的色彩，${NO_TEXT}` },
  { name: '水墨写意', value: `中国水墨写意画，留白与淡墨渲染，远山近水，墨色浓淡相宜，点缀少量朱砂红，意境悠远，${NO_TEXT}` },
  { name: '工笔重彩', value: `中国工笔重彩插画，线条精细，矿物颜料般浓郁的色彩，典雅的传统纹样与器物，画卷质感，${NO_TEXT}` },
  { name: '蜡笔童话', value: `蜡笔与彩铅手绘的童话插画，纸张纹理，色彩明快跳跃，造型夸张可爱，充满童趣，${NO_TEXT}` },
  { name: '剪纸拼贴', value: `层叠剪纸与布艺拼贴风格插画，柔和的纸张纹理与立体投影，温暖明快的配色，手作质感，${NO_TEXT}` },
  { name: '手绘白板', value: `手绘白板科普风格，黑色线条加少量高亮色，简笔画人物与图标，清晰的示意图与箭头，干净的白色背景，${NO_TEXT}` },
  { name: '等距信息图', value: `等距视角 3D 信息图风格，清爽的蓝白配色，简洁的模型与图标，柔和投影，${NO_TEXT}` },
  { name: '杂志海报', value: `现代杂志海报质感，大面积纯色背景与简洁构图，高级配色，几何图形点缀，人物半身特写，${NO_TEXT}` },
  { name: '梦幻水彩', value: `梦幻水彩插画，粉紫与奶油色渐变晕染，星光与花瓣，轻盈通透，柔和的光斑，${NO_TEXT}` },
  { name: '莫兰迪低饱和', value: `莫兰迪低饱和配色的极简插画，柔和的灰粉、灰蓝、灰绿，干净的几何形体，安静治愈的氛围，大面积留白，${NO_TEXT}` },
  { name: '数字插画', value: `精致的数字插画，色彩丰富，电影感构图，${NO_TEXT}` },];

const VOICES = {
  edge: [
    { id: 'zh-CN-YunxiNeural', name: '云希 · 男 · 沉稳' },
    { id: 'zh-CN-YunjianNeural', name: '云健 · 男 · 浑厚' },
    { id: 'zh-CN-YunyangNeural', name: '云扬 · 男 · 新闻播报' },
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 · 女 · 温柔' },
    { id: 'zh-CN-XiaoyiNeural', name: '晓伊 · 女 · 清亮' },
  ],
  dashscope: [
    { id: 'Ethan', name: 'Ethan · 男' },
    { id: 'Cherry', name: 'Cherry · 女' },
    { id: 'Serena', name: 'Serena · 女' },
    { id: 'Chelsie', name: 'Chelsie · 女' },
  ],
};

/** 每个模板推荐的画风（STYLE_PRESETS 的 name，第一个是默认）；创建页的画风下拉里「适合本模板」的排在最前 */
const RECOMMENDED_STYLES = {
  poem: ['国风水彩', '水墨写意', '工笔重彩', '治愈柔光'],
  story: ['儿童绘本', '蜡笔童话', '剪纸拼贴', '3D 卡通', '梦幻水彩'],
  explainer: ['扁平插画', '手绘白板', '等距信息图', '3D 卡通'],
  talk: ['电影写实', '杂志海报', '扁平插画', '日系动漫'],
  heal: ['治愈柔光', '梦幻水彩', '莫兰迪低饱和', '日系动漫'],
  free: ['数字插画', '日系动漫', '电影写实', '3D 卡通'],
};
const presetValue = (name) => STYLE_PRESETS.find((s) => s.name === name).value;
for (const t of TEMPLATES) {
  t.styles = RECOMMENDED_STYLES[t.id];
  t.defaults.style = presetValue(t.styles[0]); // 默认画风就是推荐的第一个，下拉里能对上
}
module.exports = { TEMPLATES, STYLE_PRESETS, VOICES, getTemplate, NO_TEXT };
