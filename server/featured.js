/**
 * 创作精选：抖音 / 小红书上常见爆款题材的「同类型」示范。
 * 这些是我们自己写的示范文案 + 自动生成的封面，不是平台上的原作品；
 * 目的是给用户灵感，点「做同款」把模板、文案、画幅、画风一次套进创作页。
 *
 * platform：内容形态更接近哪个平台（抖音风=竖屏强节奏，小红书风=氛围/生活方式）
 * styleName：对应 templates.js 里 STYLE_PRESETS 的 name
 * coverPrompt：生成封面用的画面描述（scripts/gen-featured-covers.js 读取，不会下发给前端）
 */
const { STYLE_PRESETS } = require('./templates');

const FEATURED = [
  {
    id: 'cat-cafe',
    platform: '小红书风',
    topic: '治愈故事',
    template: 'story',
    orientation: 'portrait',
    styleName: '儿童绘本',
    title: '雨天的猫咖啡馆',
    author: '',
    desc: '暖黄灯光、橘猫和一杯热可可，治愈系氛围短片。',
    script:
      '下雨的傍晚，小满推开了街角那家小小的猫咖啡馆。\n店里暖黄的灯亮着，一只橘猫正趴在窗边打盹。\n小满点了一杯热可可，橘猫慢悠悠地跳到了她的腿上。\n窗外的雨越下越大，店里却安静又温暖。\n那一刻，小满觉得，所有的疲惫都被轻轻接住了。',
    coverPrompt: '雨天傍晚的街角小猫咖啡馆，暖黄色灯光从窗户透出，一只橘猫趴在窗台上，窗外细雨朦胧，温暖治愈的氛围，竖构图',
  },
  {
    id: 'sky-blue',
    platform: '抖音风',
    topic: '知识科普',
    template: 'explainer',
    orientation: 'portrait',
    styleName: '扁平插画',
    title: '天空为什么是蓝色的',
    author: '',
    desc: '一个问题开头，三十秒讲清楚的科普小短片。',
    script:
      '天空为什么是蓝色的？答案藏在阳光里。\n阳光看起来是白色，其实由七种颜色的光混合而成。\n光穿过大气层时，会撞上空气中的小分子，发生散射。\n蓝光波长短，最容易被散射，于是漫天都是蓝光。\n到了傍晚，阳光穿过更厚的大气，蓝光被散射殆尽，只剩下红橙色。\n这就是日落总是那么红的原因。',
    coverPrompt: '晴朗的蓝天白云，一束阳光穿过大气层折射出彩虹般的光线，下方是翠绿的原野，简洁明快的科普插画，竖构图',
  },
  {
    id: 'self-discipline',
    platform: '抖音风',
    topic: '口播干货',
    template: 'talk',
    orientation: 'portrait',
    styleName: '电影写实',
    title: '三个小习惯，让你越来越自律',
    author: '',
    desc: '一人口播风格的干货清单：观点先行，层层递进。',
    script:
      '想变自律，别靠意志力，靠这三个小习惯。\n第一，睡前花两分钟，写下明天最重要的一件事。\n第二，把手机放到够不着的地方，专注二十五分钟再看。\n第三，每天只要求自己进步百分之一。\n坚持三十天，你会感谢现在的自己。',
    coverPrompt: '清晨的木质书桌，阳光斜照，一本打开的笔记本、一支笔和一杯热咖啡，窗外是安静的城市，电影感，竖构图',
  },
  {
    id: 'shanju-qiuming',
    platform: '小红书风',
    topic: '古诗词',
    template: 'poem',
    orientation: 'portrait',
    styleName: '国风水彩',
    title: '山居秋暝',
    author: '王维',
    desc: '一首诗一个意境，国风水彩逐句成画。',
    script: '空山新雨后，天气晚来秋。\n明月松间照，清泉石上流。\n竹喧归浣女，莲动下渔舟。\n随意春芳歇，王孙自可留。',
    coverPrompt: '雨后秋夜的空山，明月挂在松林之间，清泉流过山石，远处竹林和荷塘，国风水彩意境，竖构图',
  },
  {
    id: 'last-metro',
    platform: '抖音风',
    topic: '悬疑短片',
    template: 'story',
    orientation: 'portrait',
    styleName: '电影写实',
    title: '深夜的末班地铁',
    author: '',
    desc: '三十秒的小悬念：铺垫、异常、反转一句话搞定。',
    script:
      '深夜十一点，我坐上了末班地铁，车厢里只剩我一个人。\n列车在隧道里穿行，灯光忽明忽暗。\n到了下一站，门开了，却没有一个人上来。\n我低头看手机，屏幕上突然跳出一条消息：别回头。\n身后的玻璃上，缓缓映出了另一个人影。',
    coverPrompt: '深夜空无一人的地铁车厢，冷色调灯光忽明忽暗，车窗外是漆黑的隧道，窗玻璃上隐约映出一个模糊的人影，电影感悬疑氛围，竖构图',
  },
  {
    id: 'seaside-town',
    platform: '小红书风',
    topic: '旅行氛围',
    template: 'free',
    orientation: 'portrait',
    styleName: '日系动漫',
    title: '一个人的海边小镇',
    author: '',
    desc: '慢节奏 vlog 感的旅行碎片，适合配轻音乐。',
    script:
      '清晨的海边小镇，海风带着淡淡的咸味。\n我背着相机，沿着白色的石阶慢慢往下走。\n路边的小店刚开门，老板笑着递来一杯冰柠檬水。\n傍晚，天空被染成粉紫色，海浪一遍遍拍着沙滩。\n原来最好的旅行，就是什么都不赶。',
    coverPrompt: '傍晚的海边小镇，白色石阶通向海边，天空是粉紫色的晚霞，远处有小小的灯塔和帆船，清透的日系动漫风格，竖构图',
  },
  {
    id: 'bear-honey',
    platform: '抖音风',
    topic: '睡前故事',
    template: 'story',
    orientation: 'landscape',
    styleName: '3D 卡通',
    title: '小熊找蜂蜜',
    author: '',
    desc: '有起承转合的暖心小故事，适合亲子、睡前内容。',
    script:
      '小熊米米今天醒得特别早，肚子咕咕叫。\n它想起森林深处有一棵老橡树，树洞里藏着最甜的蜂蜜。\n米米翻过小山坡，跳过小溪，终于来到了橡树下。\n可是树洞里，已经有一只小松鼠在舔蜂蜜了。\n米米想了想，笑着说：我们一起吃吧。\n那天，森林里多了一个好朋友。',
    coverPrompt: '清晨的森林里，一只圆滚滚的棕色小熊站在老橡树下，树洞里有金黄的蜂蜜，一只小松鼠在旁边，阳光穿过树叶，皮克斯风格，竖构图',
  },
  {
    id: 'coffee-journey',
    platform: '小红书风',
    topic: '生活科普',
    template: 'explainer',
    orientation: 'portrait',
    styleName: '扁平插画',
    title: '一颗咖啡豆的旅行',
    author: '',
    desc: '把日常小物讲成一条清晰的流程，信息量大又好看。',
    script:
      '你每天喝的咖啡，其实是一颗果实的种子。\n咖啡树结出红色的果子，人们叫它咖啡樱桃。\n采摘之后，果肉被剥去，种子晾晒发酵。\n烘焙时，生豆在高温里慢慢变成深褐色，香气随之释放。\n研磨、冲泡，一杯咖啡才终于来到你的手上。',
    coverPrompt: '一棵挂满红色咖啡果的咖啡树，旁边是烘焙好的深褐色咖啡豆和一杯冒着热气的咖啡，暖色调扁平插画，竖构图',
  },
];

const styleOf = (name) => STYLE_PRESETS.find((s) => s.name === name)?.value || STYLE_PRESETS[0].value;

/** 下发给前端：补全画风文案与封面地址，去掉生成封面用的提示词 */
function publicFeatured() {
  return FEATURED.map(({ coverPrompt, ...f }) => ({ ...f, style: styleOf(f.styleName), cover: `/featured/${f.id}.jpg` }));
}

module.exports = { FEATURED, publicFeatured, styleOf };
