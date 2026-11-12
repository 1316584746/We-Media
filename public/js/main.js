import { $, $$, loadMeta, loadSettings, paintIcons, paintRailStatus, toast } from './core.js';
import * as createPage from './pages/create.js';
import * as projectsPage from './pages/projects.js';
import * as editorPage from './pages/editor.js';
import * as settingsPage from './pages/settings.js';
import * as extensionsPage from './pages/extensions.js';

const ROUTES = [
  [/^#\/extensions$/, extensionsPage, 'extensions'],
  [/^#?\/?$/, createPage, 'create'],
  [/^#\/projects$/, projectsPage, 'projects'],
  [/^#\/p\/([\w-]+)$/, editorPage, 'editor'],
  [/^#\/settings$/, settingsPage, 'settings'],
];

let current = null;
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  if (current?.unmount) await current.unmount();
  current = null;
  const hash = location.hash || '#/';
  const match = ROUTES.map(([re, page, nav]) => [hash.match(re), page, nav]).find(([m]) => m);
  const [m, page, nav] = match || [[''], createPage, 'create'];
  document.body.classList.toggle('in-editor', nav === 'editor');
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
