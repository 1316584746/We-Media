import { $, $$, state, stopPreview, loadMeta, loadSettings, paintIcons, paintRailStatus, toast } from './core.js';
import * as createPage from './pages/create.js';
import * as projectsPage from './pages/projects.js';
import * as editorPage from './pages/editor.js';
import * as settingsPage from './pages/settings.js';
import * as editsPage from './pages/edits.js';
import * as cutterPage from './pages/cutter.js';
import * as agentPage from './pages/agent.js';
import * as dashboardPage from './pages/dashboard.js';
import './poem-picker.js'; // 创作页「古诗词动画」的诗词库选择器（自己监听页面，把按钮挂上去）

const ROUTES = [
  [/^#?\/?$/, createPage, 'create'],
  [/^#\/agent$/, agentPage, 'agent'],
  [/^#\/dashboard$/, dashboardPage, 'dashboard'],
  [/^#\/projects$/, projectsPage, 'projects'],
  [/^#\/edits$/, editsPage, 'edits'],
  [/^#\/e\/(e_[a-z0-9]+)$/, cutterPage, 'edits'],
  [/^#\/p\/([\w-]+)$/, editorPage, 'editor'],
  [/^#\/settings(?:\/(\w+))?$/, settingsPage, 'settings'],
];

let current = null;
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  stopPreview();
  if (current?.unmount) await current.unmount();
  current = null;
  const hash = location.hash || '#/';
  if (hash === '#/extensions') return void location.replace('#/settings/skills'); // 旧地址
  const match = ROUTES.map(([re, page, nav]) => [hash.match(re), page, nav]).find(([m]) => m);
  const [m, page, nav] = match || [[''], createPage, 'create'];
  if (nav !== 'settings') state.lastApp = hash; // 设置页「返回」回到这里
  delete document.body.dataset.theme; // 创作页的主题配色只在创作页生效，由创作页自己设置
  document.body.style.removeProperty('--wm');
  document.body.classList.toggle('in-editor', nav === 'editor');
  document.body.classList.toggle('in-cutter', /^#\/e\//.test(hash));
  document.body.classList.toggle('in-settings', nav === 'settings');
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
  const view = $('#view');
  view.innerHTML = '';
  window.scrollTo(0, 0);
  const inst = await page.mount(view, m.slice(1));
  if (seq !== renderSeq) return inst?.unmount?.(); // 渲染期间又切了路由
  current = inst || null;
  // 创作页：模板卡片依次出现（只在刚进页面时播一次，点选模板重绘时不重播）
  const tpls = $('#tpls');
  if (tpls) {
    tpls.classList.add('intro');
    setTimeout(() => tpls.classList.remove('intro'), 1400);
  }
}

window.addEventListener('hashchange', render);

(async function boot() {
  paintIcons();
  try {
    await Promise.all([loadMeta(), loadSettings()]);
  } catch (e) {
    toast(`初始化失败：${e.message}`, 'err');
  }
  paintRailStatus();
  render();
  pollPublishAlerts();
})();

/* 定时发布：到点要手动发布 / 失败的计划，提醒一次（toast + 系统通知） */
function pollPublishAlerts() {
  const KEY = 'wm.pubNotified';
  const seen = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
  const check = async () => {
    try {
      const list = await fetch('/api/publish/alerts').then((r) => r.json());
      if (!Array.isArray(list)) return;
      const fresh = list.filter((a) => !seen.has(`${a.id}:${a.status}`));
      for (const a of fresh) {
        seen.add(`${a.id}:${a.status}`);
        const names = a.platforms.map((p) => p.name).join('、');
        const msg = a.status === 'failed' ? `「${a.title}」发布失败（${names}），去「设置 → 发布」查看原因` : `「${a.title}」到发布时间了：请手动发布到 ${names}（设置 → 发布）`;
        toast(msg, a.status === 'failed' ? 'err' : 'ok');
        if (window.Notification && Notification.permission === 'granted') new Notification('AI 视频工坊 · 定时发布', { body: msg });
      }
      if (fresh.length) localStorage.setItem(KEY, JSON.stringify([...seen].slice(-200)));
    } catch {
      /* 服务暂时不可用，下次再查 */
    }
  };
  if (window.Notification && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  check();
  setInterval(check, 30000);
}
