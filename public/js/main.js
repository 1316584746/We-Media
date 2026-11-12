import { $, $$, state, loadMeta, loadSettings, paintIcons, paintRailStatus, toast } from './core.js';
import * as createPage from './pages/create.js';
import * as projectsPage from './pages/projects.js';
import * as editorPage from './pages/editor.js';
import * as settingsPage from './pages/settings.js';

const ROUTES = [
  [/^#?\/?$/, createPage, 'create'],
  [/^#\/projects$/, projectsPage, 'projects'],
  [/^#\/p\/([\w-]+)$/, editorPage, 'editor'],
  [/^#\/settings(?:\/(\w+))?$/, settingsPage, 'settings'],
];

let current = null;
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  if (current?.unmount) await current.unmount();
  current = null;
  const hash = location.hash || '#/';
  if (hash === '#/extensions') return void location.replace('#/settings/skills'); // 旧地址
  const match = ROUTES.map(([re, page, nav]) => [hash.match(re), page, nav]).find(([m]) => m);
  const [m, page, nav] = match || [[''], createPage, 'create'];
  if (nav !== 'settings') state.lastApp = hash; // 设置页「返回」回到这里
  document.body.classList.toggle('in-editor', nav === 'editor');
  document.body.classList.toggle('in-settings', nav === 'settings');
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
  const view = $('#view');
  view.innerHTML = '';
  window.scrollTo(0, 0);
  const inst = await page.mount(view, m.slice(1));
  if (seq !== renderSeq) return inst?.unmount?.(); // 渲染期间又切了路由
  current = inst || null;
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
})();
