/**
 * 创作精选：抖音 / 小红书上常见爆款题材的「同类型」示范。
 * 这些是我们自己写的示范文案 + 自动生成的封面，不是平台上的原作品；
 * 目的是给用户灵感，点「做同款」把模板、文案、画幅、画风一次套进创作页。
 *
 * platform：内容形态更接近哪个平台（抖音风=竖屏强节奏，小红书风=氛围/生活方式）
 * styleName：对应 templates.js 里 STYLE_PRESETS 的 name
 * coverPrompt：生成封面用的画面描述（scripts/gen-featured-covers.js 读取，不会下发给前端）
 */
const fs = require('fs');
const path = require('path');
const { STYLE_PRESETS } = require('./templates');

const DIR = path.join(__dirname, '..', 'public', 'featured');

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

  /* ---------------- 古诗词 ---------------- */
  {
    id: 'jingyesi',
    platform: '抖音风',
    topic: '古诗词',
    template: 'poem',
    orientation: 'portrait',
    styleName: '国风水彩',
    title: '静夜思',
    author: '李白',
    desc: '最短的乡愁：四句诗，一轮明月，一个人的思念。',
    script: '床前明月光，疑是地上霜。\n举头望明月，低头思故乡。',
    coverPrompt: '深夜的窗前，一束清冷的月光洒在木床前的地面上，像铺了一层白霜，窗外挂着一轮明月，国风水彩意境，竖构图',
  },
  {
    id: 'dengguanque',
    platform: '小红书风',
    topic: '古诗词',
    template: 'poem',
    orientation: 'landscape',
    styleName: '国风水彩',
    title: '登鹳雀楼',
    author: '王之涣',
    desc: '大开大合的气象，适合横屏慢慢铺开的壮阔画面。',
    script: '白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。',
    coverPrompt: '夕阳落在远山后面，浩荡的黄河向东流入大海，近处一座古楼，一位古人在高处极目远眺，国风水彩，气势开阔，横构图',
  },
  {
    id: 'jiangxue',
    platform: '抖音风',
    topic: '古诗词',
    template: 'poem',
    orientation: 'landscape',
    styleName: '国风水彩',
    title: '江雪',
    author: '柳宗元',
    desc: '大片留白的清冷意境，一叶孤舟一个钓翁。',
    script: '千山鸟飞绝，万径人踪灭。\n孤舟蓑笠翁，独钓寒江雪。',
    coverPrompt: '大雪覆盖的群山，江面一叶孤舟，舟上一位披蓑戴笠的老翁独自垂钓，天地一片苍茫的白，大面积留白，国风水墨水彩，横构图',
  },

  /* ---------------- 故事绘本 ---------------- */
  {
    id: 'star-pond',
    platform: '小红书风',
    topic: '睡前故事',
    template: 'story',
    orientation: 'portrait',
    styleName: '儿童绘本',
    title: '掉进池塘的星星',
    author: '',
    desc: '温柔的小童话：一颗星星、一只小青蛙和一个晚安。',
    script:
      '夜深了，一颗小星星不小心从天上滑了下来，扑通一声掉进了池塘。\n小青蛙被吓了一跳，探出头来问：你是谁呀？\n小星星委屈地说：我找不到回家的路了。\n小青蛙想了想，爬上最高的荷叶，举起双手托住了星星。\n星星一点点亮起来，越飞越高，终于回到了夜空。\n从那以后，每当池塘安静下来，水面上总会闪着一点点光。',
    coverPrompt: '夜晚的荷塘，一颗发光的小星星掉在水面上，一只小青蛙站在荷叶上抬头看着它，水面泛起金色的涟漪，满天繁星，温暖的儿童绘本插画，竖构图',
  },

  /* ---------------- 知识科普 ---------------- */
  {
    id: 'rainbow',
    platform: '小红书风',
    topic: '自然科普',
    template: 'explainer',
    orientation: 'landscape',
    styleName: '扁平插画',
    title: '彩虹是怎么出现的',
    author: '',
    desc: '雨后一抬头就能看到的现象，三十秒讲明白。',
    script:
      '雨后的天空，为什么会出现彩虹？\n因为空气中还漂浮着无数细小的水滴。\n阳光照进水滴时，会发生折射，把白光拆成七种颜色。\n光线在水滴内部反射一次，再折射出来，颜色就彻底分开了。\n所以，背对太阳、面朝雨幕，你才最容易看见彩虹。',
    coverPrompt: '雨后初晴的草原，天空中一道清晰明亮的彩虹，远处有小山和一朵朵白云，简洁明快的扁平插画，色彩清新，横构图',
  },
  {
    id: 'yawn',
    platform: '抖音风',
    topic: '生活科普',
    template: 'explainer',
    orientation: 'portrait',
    styleName: '扁平插画',
    title: '为什么别人打哈欠你也想打',
    author: '',
    desc: '一个人人都有过的小现象，用一个问题钩住观众。',
    script:
      '为什么看到别人打哈欠，你也会忍不住打一个？\n科学家发现，这和大脑里的镜像神经元有关。\n看到别人做动作时，这些神经元会被同步激活。\n它让我们能够理解他人，也让我们更容易感同身受。\n所以，会被哈欠传染，说明你很有同理心。',
    coverPrompt: '几个卡通人物围坐在一起，其中一个在打哈欠，旁边的人也跟着打哈欠，头顶有简洁的大脑和连线图标，明亮的扁平插画，竖构图',
  },

  /* ---------------- 口播短视频 ---------------- */
  {
    id: 'interview',
    platform: '抖音风',
    topic: '职场干货',
    template: 'talk',
    orientation: 'portrait',
    styleName: '电影写实',
    title: '面试自我介绍，三步就够',
    author: '',
    desc: '结论先行的职场口播：一分钟说清楚你是谁。',
    script:
      '面试自我介绍，别再背简历了。\n第一步，一句话说清你是谁，做过什么。\n第二步，挑一个最能证明你的成绩，用数字说话。\n第三步，说说你为什么想来这家公司。\n控制在一分钟以内，面试官记住的，就是你。',
    coverPrompt: '明亮的现代办公室，一张整洁的桌子上有笔记本电脑、简历和一杯咖啡，窗外是城市天际线，电影感摄影，浅景深，竖构图',
  },
  {
    id: 'sleep-habit',
    platform: '小红书风',
    topic: '生活干货',
    template: 'talk',
    orientation: 'portrait',
    styleName: '电影写实',
    title: '睡不好？先改掉这三个习惯',
    author: '',
    desc: '生活方式类口播：问题、原因、方法，一气呵成。',
    script:
      '总是睡不好，可能不是你的问题，是习惯的问题。\n第一，睡前一小时别刷手机，蓝光会让大脑以为还是白天。\n第二，晚上别喝咖啡和浓茶，咖啡因能在身体里留六个小时。\n第三，固定起床时间，周末也一样。\n坚持一周，你会发现入睡变得容易多了。',
    coverPrompt: '安静的卧室夜晚，床头一盏暖黄色的小夜灯，整洁的白色床品，手机被放在远处的桌子上，窗外是夜色，电影感摄影，温暖柔和，竖构图',
  },
  {
    id: 'save-money',
    platform: '抖音风',
    topic: '理财干货',
    template: 'talk',
    orientation: 'portrait',
    styleName: '电影写实',
    title: '月光族存钱的三个小办法',
    author: '',
    desc: '轻松上手的理财小技巧，观点清晰、节奏利落。',
    script:
      '每个月都存不下钱？试试这三个小办法。\n第一，发工资当天，先转走百分之二十，剩下的再花。\n第二，记账不用复杂，只记超过一百块的支出。\n第三，下单前等二十四小时，冲动消费会少一半。\n存钱不是省出来的，是设计出来的。',
    coverPrompt: '木质桌面上一个玻璃存钱罐，里面装着硬币，旁边是一本打开的记账本和一支笔，窗边的自然光，电影感写实，浅景深，竖构图',
  },

  /* ---------------- 心灵鸡汤 ---------------- */
  {
    id: 'heal-slow',
    platform: '小红书风',
    topic: '睡前安慰',
    template: 'heal',
    orientation: 'portrait',
    styleName: '治愈柔光',
    title: '给今天有点累的你',
    author: '',
    desc: '睡前听一听：今天辛苦了，允许自己慢下来。',
    script:
      '今天过得不太好，也没关系。\n不是每一天都要闪闪发光，有些日子，能好好吃完一顿饭，就已经很了不起。\n你已经走了很远的路，偶尔停下来歇一歇，没有人会怪你。\n风会吹散今天的疲惫，明天的太阳，照常升起。\n晚安，愿你睡个好觉。',
    coverPrompt: '傍晚的小房间，窗边一盏暖黄的灯，一只小猫蜷在软垫上睡着，窗外是粉橙色的晚霞和云朵，温柔的治愈系插画，大面积留白，竖构图',
  },
  {
    id: 'heal-bloom',
    platform: '抖音风',
    topic: '自我鼓励',
    template: 'heal',
    orientation: 'portrait',
    styleName: '治愈柔光',
    title: '你有你的花期',
    author: '',
    desc: '写给正在和别人比较的你：慢一点，也在开花。',
    script:
      '花不会因为别人先开，就怀疑自己的春天。\n你也一样。\n有的人走得快，有的人走得慢，但每个人，都有自己的花期。\n别着急，也别比较。\n把今天好好过完，就是在慢慢开花。',
    coverPrompt: '清晨的田野小路，路边一株含苞待放的小花，旁边已经盛开了许多花朵，柔和的晨光与薄雾，水彩质感的治愈系插画，竖构图',
  },
  {
    id: 'heal-breath',
    platform: '小红书风',
    topic: '缓解焦虑',
    template: 'heal',
    orientation: 'portrait',
    styleName: '治愈柔光',
    title: '先深呼吸一下',
    author: '',
    desc: '焦虑的时候看一看，跟着画面把呼吸放慢。',
    script:
      '如果你现在有一点焦虑，请先深呼吸。\n吸气，数到四，再慢慢地把气吐出来。\n你担心的很多事情，其实还没有发生。\n把注意力放回此刻：脚踩着地面，身体被稳稳地接住。\n你很安全，你已经做得很好了。',
    coverPrompt: '宁静的湖边，清晨的薄雾缓缓升起，湖面平静如镜，岸边有一棵小树和一只白色的小鸟，淡蓝与淡粉的柔和色调，治愈系水彩插画，大面积留白，竖构图',
  },
  {
    id: 'heal-rain',
    platform: '抖音风',
    topic: '雨天情绪',
    template: 'heal',
    orientation: 'landscape',
    styleName: '治愈柔光',
    title: '下雨天，也很温柔',
    author: '',
    desc: '把坏天气写成一封温柔的信，适合横屏慢节奏播放。',
    script:
      '下雨了，就在家里待一会儿吧。\n泡一杯热茶，看雨点一颗一颗落在窗上。\n不用赶着去哪里，也不用急着变好。\n雨会停的，就像所有难过的日子，终究会过去。\n到那时，你会闻到空气里，干净又温柔的味道。',
    coverPrompt: '下雨天的窗边，窗玻璃上挂着细小的雨珠，窗台上一杯冒着热气的茶和一盆绿植，一只小猫望着窗外，窗外是朦胧的绿色庭院，治愈系水彩插画，横构图',
  },

  /* ---------------- 自由创作 ---------------- */
  {
    id: 'free-mountain',
    platform: '小红书风',
    topic: '山居日常',
    template: 'free',
    orientation: 'portrait',
    styleName: '国风水彩',
    title: '山里的一天',
    author: '',
    desc: '慢生活 vlog 感：从清晨到黄昏，把平凡的一天拍成诗。',
    script:
      '清晨，山间的雾还没散，鸟叫声先醒了。\n我在院子里煮了一壶茶，看阳光慢慢爬上屋檐。\n中午，溪水边的石头晒得暖暖的，我坐着发了一会儿呆。\n傍晚，炊烟升起来，远处的山被染成了淡淡的橘色。\n夜里，满天都是星星，原来安静，也是一种富有。',
    coverPrompt: '清晨的山间小院，薄雾缭绕，青瓦白墙，院里有一张小桌和一壶茶，远处是层叠的青山，国风水彩，宁静悠远，竖构图',
  },
  {
    id: 'free-night',
    platform: '抖音风',
    topic: '城市夜景',
    template: 'free',
    orientation: 'portrait',
    styleName: '日系动漫',
    title: '深夜便利店',
    author: '',
    desc: '城市里的小确幸：一盏灯、一碗热汤、一段安静的时光。',
    script:
      '深夜十二点，街上的人已经很少了。\n只有街角的便利店，还亮着温暖的灯。\n我买了一碗热腾腾的关东煮，坐在窗边的位置。\n窗外下着细雨，霓虹灯在水洼里一闪一闪。\n原来在这座城市里，也有一个地方，在等晚归的人。',
    coverPrompt: '深夜细雨中的城市街角，一家亮着暖光的便利店，窗边一位背影的人在吃关东煮，湿漉漉的街道映着霓虹灯，清透的日系动漫风格，竖构图',
  },
  {
    id: 'free-autumn',
    platform: '小红书风',
    topic: '季节氛围',
    template: 'free',
    orientation: 'landscape',
    styleName: '儿童绘本',
    title: '秋天来了',
    author: '',
    desc: '一组秋日小景，适合配轻音乐的氛围短片。',
    script:
      '风吹过来，树叶一片一片变成了金黄色。\n小路上铺满了落叶，踩上去沙沙作响。\n松鼠忙着把栗子藏进树洞，准备过冬。\n傍晚的夕阳，把整片田野染成了暖橘色。\n秋天，是大自然送给我们的一封金色的信。',
    coverPrompt: '金黄色的秋天森林小路，满地落叶，一只松鼠抱着栗子站在树根旁，远处是夕阳下的田野，温暖的儿童绘本插画，横构图',
  },
];

const styleOf = (name) => STYLE_PRESETS.find((s) => s.name === name)?.value || STYLE_PRESETS[0].value;

/** 下发给前端：补全画风文案与封面地址，去掉生成封面用的提示词 */
function publicFeatured() {
  // 示范视频由 scripts/gen-featured-videos.js 生成；文件存在才下发地址，前端据此决定显示不显示播放按钮
  return FEATURED.map(({ coverPrompt, ...f }) => ({
    ...f,
    style: styleOf(f.styleName),
    cover: `/featured/${f.id}.jpg`,
    video: fs.existsSync(path.join(DIR, `${f.id}.mp4`)) ? `/featured/${f.id}.mp4` : '',
  }));
}

module.exports = { FEATURED, publicFeatured, styleOf };
