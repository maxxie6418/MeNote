/* ============================================================
   Menote 原型回归验证脚本
   ------------------------------------------------------------
   用 jsdom 加载 menote-prototype.html 并真实执行页面脚本，
   按设计文档约定模拟交互路径，捕获运行时错误。

   运行：
     npm install jsdom
     NODE_PATH=<node_modules 路径> node verify-prototype.js

   覆盖：导航路由 / 账户入口唯一性 / 笔记本双栏 / 正文层级归并 /
         Memo 三视图 / 清单列表与看板 / 快速录入框两模式 + 独立待办按钮 /
         新建直连笔记 / 笔记本新建入口 / 滑出详情侧栏 /
         隐私锁锁定与解锁 / Memo 隐私门禁 / 恢复码流程 /
         搜索 / 表格视图切换 / 菜单
   ============================================================ */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync('F:/Git/MeNote/prototype/menote-prototype.html', 'utf8');
const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push('[jsdomError] ' + e.message));
vc.on('error', (...a) => errs.push('[console.error] ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const $$ = s => Array.from(doc.querySelectorAll(s));
const click = el => {
  if (!el) throw new Error('目标元素不存在');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const input = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };

let pass = 0, fail = 0;
function step(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('断言失败');
    console.log('  OK   ' + name); pass++;
  } catch (e) {
    console.log('  FAIL ' + name + '  →  ' + e.message);
    errs.push(name + ': ' + e.message); fail++;
  }
}
const lock = () => {
  click($('#lockCapsule'));
  const item = doc.querySelector('.menu-item[data-lock]');
  if (!item) throw new Error('胶囊菜单未出现');
  click(item);
};

console.log('=== 交互路径验证 ===');

step('初始渲染：最近编辑列表', () => {
  if (!$$('#paneList .item-row').length) throw new Error('列表为空');
});

step('导航含「笔记本」且可点（7.4 导航项）', () => {
  if (!$('.nav-item[data-fn="notebook"]')) throw new Error('笔记本不是导航项');
});

step('账户入口：全站只有一个头像，且位于功能栏底部（7.4 修订）', () => {
  const avatars = $$('.avatar');
  if (avatars.length !== 1) throw new Error('头像数量 ' + avatars.length);
  const acc = $('#fnAccount');
  if (!acc) throw new Error('功能栏底部无账户区');
  if (!acc.closest('.fn-foot')) throw new Error('账户区不在功能栏底部');
  if (!acc.contains(avatars[0])) throw new Error('头像不在账户区内');
});

step('底部已无独立的回收站 / 设置入口（7.4 修订）', () => {
  if ($('.nav-item[data-fn="trash"]')) throw new Error('底部仍有独立回收站入口');
  if ($('.nav-item[data-fn="settings"]')) throw new Error('底部仍有独立设置入口');
});

step('录入框模式为 Memo / 待办 / 笔记 三档', () => {
  const modes = $$('#composerModes button').map(b => b.dataset.mode);
  if (modes.join('/') !== 'memo/task/note') throw new Error('模式为 ' + modes.join('/'));
});

step('模式附加项：锁定一排（26px），三档都不隐藏、不换行（7.4 修订）', () => {
  const css = $$('style').map(s => s.textContent).join('\n');
  const rule = css.match(/\.composer-extra\{[^}]*\}/);
  if (!rule) throw new Error('未找到 .composer-extra 规则');
  if (!/height:\s*26px/.test(rule[0])) throw new Error('附加项未锁定为一排：' + rule[0]);
  if (!/flex-wrap:\s*nowrap/.test(rule[0])) throw new Error('附加项仍允许换行：' + rule[0]);
  const extra = $('#composerExtra');
  ['memo', 'task', 'note'].forEach(m => {
    click($('#composerModes button[data-mode="' + m + '"]'));
    if (extra.classList.contains('hidden')) throw new Error(m + ' 模式下被隐藏，会推挤下方 UI');
  });
  click($('#composerModes button[data-mode="note"]'));
  if (!extra.textContent.includes('首行作标题')) throw new Error('笔记附加项文案未收短：' + extra.textContent);
});

step('录入框已压缩：取消发布行，发布按钮与模式选择同行（7.4 修订）', () => {
  if ($('.composer-foot')) throw new Error('仍存在独立的发布行');
  if ($('#composerTip')) throw new Error('仍存在独立的快捷键提示元素');
  const row = $('.mode-row');
  if (!row) throw new Error('缺模式行');
  const kids = Array.from(row.children).map(el => el.id);
  if (kids.join('/') !== 'composerModes/composerPublish') throw new Error('行内顺序不对：' + kids.join('/'));
  click($('#composerModes button[data-mode="task"]'));
  if (!$('#composerPublish').title) throw new Error('发布按钮未承接快捷键提示');
  click($('#composerModes button[data-mode="memo"]'));
});

step('待办与 Memo 已合并为一个导航项（7.4 / 9.4）', () => {
  if ($('.nav-item[data-fn="task"]')) throw new Error('导航仍有独立待办项');
  click($('.nav-item[data-fn="memo"]'));
  if (!$$('.memo-item').length) throw new Error('Memo 默认未落在时间轴');
  const tabs = $$('#memoMode button').map(b => b.dataset.m);
  if (tabs.join('/') !== 'timeline/waterfall/tasks') throw new Error('Memo 视图 tab 不是三档：' + tabs.join('/'));
});

step('Memo 视图内的「清单」tab 即待办（7.4 / 9.4）', () => {
  click($('#memoMode button[data-m="tasks"]'));
  if (!$$('.task-row').length) throw new Error('清单为空');
  if (!$('.pane-head .sub').textContent.includes('清单不是独立类型'))
    throw new Error('未说明清单与 Memo 的归属关系');
  click($('#memoMode button[data-m="timeline"]'));
  if (!$$('.memo-item').length) throw new Error('返回时间轴失败');
});

step('账户与设置：点击底部入口进入设置（7.4 修订）', () => {
  click($('#fnAccount'));
  if (!$('.pane-head h1').textContent.includes('设置')) throw new Error('未进入设置');
  if (!$('#fnAccount').classList.contains('active')) throw new Error('账户入口未高亮');
});

step('设置内含「版本与回收站」，可打开回收站（7.4 修订）', () => {
  if (!$('#openTrash')) throw new Error('设置里没有回收站入口');
  click($('#openTrash'));
  if (!$('.pane-head h1').textContent.includes('回收站')) throw new Error('未进入回收站');
  if (!$('#trashBack')) throw new Error('回收站缺返回设置的入口');
  click($('#trashBack'));
  if (!$('.pane-head h1').textContent.includes('设置')) throw new Error('未返回设置');
});

step('切到笔记本 → 列表 + 正文双栏', () => {
  click($('.nav-item[data-fn="notebook"]'));
  if (!$$('#paneList .item-row').length) throw new Error('左侧列表为空');
  if (!$('#edSource')) throw new Error('右侧正文未渲染');
});

step('点开加密日记（已解锁态）：加密信息已并入状态栏', () => {
  click($$('#paneList .item-item, #paneList .item-row').find(r => r.dataset.id === 'n3'));
  if (!$('.doc-head .enc-mark')) throw new Error('正文头未显示加密标识');
  if ($$('#paneDoc .doc-status').length !== 1) throw new Error('正文状态栏不是唯一一条');
  const st = $('#paneDoc .doc-status');
  if (!st.querySelector('#edTimer')) throw new Error('状态栏未含解锁倒计时');
  if (!st.querySelector('#docLockNow')) throw new Error('状态栏未含「立即锁定」');
  if ($('#paneDoc .sec-bar')) throw new Error('仍存在独立的加密状态条');
  if ($('#paneDoc .size-warn')) throw new Error('仍存在独立的尺寸提示条');
});

step('编辑器输入 → 预览渲染 + 尺寸统计', () => {
  const t = $('#edSource');
  input(t, t.value + '\n补充一行内容');
  if (!$('#docSize').textContent.includes('/ 2 MB')) throw new Error('尺寸未显示');
  if (!$('#edPreview').innerHTML.length) throw new Error('预览未渲染');
});

step('文件夹筛选 → 双栏只剩该文件夹条目', () => {
  click($('#folderTree [data-folder="英语"]'));
  const rows = $$('#paneList .item-row');
  if (!rows.length) throw new Error('文件夹为空');
});

step('切 Memo → 时间轴', () => {
  click($('.nav-item[data-fn="memo"]'));
  if (!$$('.memo-item').length) throw new Error('时间轴为空');
});

step('Memo 切清单视图', () => {
  click($('#memoMode button[data-m="tasks"]'));
  if (!$$('.task-row').length) throw new Error('清单为空');
});

step('清单切看板 → 点卡片换状态', () => {
  click($('#taskView button[data-t="kanban"]'));
  if (!$$('.kb-col').length) throw new Error('看板为空');
  click($('[data-kb]'));
});

step('清单勾选完成', () => {
  click($('#taskView button[data-t="list"]'));
  click($('[data-tcheck]'));
});

step('录入框：待办模式发布（带优先级，日期与优先级为模式附加项）', () => {
  click($('#composerModes button[data-mode="task"]'));
  click($('span[data-pri="低"]'));
  input($('#composerInput'), '测试待办一条 #测试');
  click($('#composerPublish'));
  if (!$$('.task-row').length) throw new Error('未进入清单');
});

step('录入框：笔记模式发布（首行作标题）', () => {
  click($('#composerModes button[data-mode="note"]'));
  input($('#composerInput'), '临时笔记标题\n这是正文内容');
  click($('#composerPublish'));
  if (!$('#edSource')) throw new Error('未打开编辑器');
  if (!$('#docTitle').value.includes('临时笔记标题')) throw new Error('首行未作标题');
});

step('收藏 → 点击条目滑出详情侧栏', () => {
  click($('.nav-item[data-fn="starred"]'));
  click($$('#paneList .item-row')[0]);
  if (!$('#drawer').classList.contains('open')) throw new Error('抽屉未打开');
});

step('抽屉「在笔记本中打开」', () => {
  click($('#drawerOpen'));
  if (!$('#edSource') && !$('table.data')) throw new Error('未跳转到正文');
});

step('标签筛选', () => {
  click($('.tags [data-tag="读书"]'));
  if (!$$('#paneList .item-row').length) throw new Error('标签筛选结果为空');
});

step('胶囊菜单 → 立即锁定', () => {
  lock();
  if (!$('#lockCapsule').classList.contains('locked')) throw new Error('未锁定');
});

step('锁定态：加密日记转为锁定占位', () => {
  click($('.nav-item[data-fn="notebook"]'));
  click($$('#paneList .item-row').find(r => r.dataset.id === 'n3'));
  if (!$('#docUnlockBtn')) throw new Error('未显示解锁入口');
});

step('锁定态点「隐私空间」→ 弹解锁框', () => {
  click($('.nav-item[data-fn="vault"]'));
  if (!$('#unlockOverlay').classList.contains('open')) throw new Error('解锁框未打开');
});

step('解锁 → 进入隐私空间', () => {
  input($('#pwInput'), 'demo');
  click($('#unlockConfirm'));
  if (!$('.mini-tree')) throw new Error('空间内容未渲染');
});

step('锁定态 Memo 显示门禁占位', () => {
  lock();
  click($('.nav-item[data-fn="memo"]'));
  if (!$('#memoUnlockBtn')) throw new Error('未显示 Memo 门禁');
});

step('从 Memo 门禁解锁恢复内容', () => {
  click($('#memoUnlockBtn'));
  input($('#pwInput'), 'demo');
  click($('#unlockConfirm'));
  click($('#memoMode button[data-m="timeline"]'));
  if (!$$('.memo-item').length) throw new Error('解锁后未恢复');
});

step('忘记密码 → 恢复码流程', () => {
  lock();
  click($('.nav-item[data-fn="memo"]'));
  click($('#memoUnlockBtn'));
  click($('#forgotLink'));
  if (!$('#recoverOverlay').classList.contains('open')) throw new Error('恢复码弹窗未开');
  click($('#recoverSubmit'));
  if (!$('#lockCapsule').textContent.includes('已解锁')) throw new Error('未解锁');
});

step('回收站：从设置进入并恢复一条（7.4 修订）', () => {
  click($('#fnAccount'));
  click($('#openTrash'));
  const before = $$('.trash-row').length;
  click($('[data-restore]'));
  if ($$('.trash-row').length !== before - 1) throw new Error('未移除');
});

step('设置：改档位 → 胶囊跟随', () => {
  click($('#fnAccount'));
  if (!$('.pane-head h1').textContent.includes('设置')) throw new Error('未进入设置');
  click($('#timeoutSet .radio-opt[data-min="-1"]'));
  if (!$('#lockCapsule').textContent.includes('本次会话')) throw new Error('胶囊未跟随档位');
});

step('设置：关闭 Memo 门禁 → 锁定后 Memo 仍可见', () => {
  click($('#privacyToggle'));
  if ($('#privacyToggle').classList.contains('on')) throw new Error('开关未关闭');
  lock();
  click($('.nav-item[data-fn="memo"]'));
  click($('#memoMode button[data-m="timeline"]'));
  if (!$$('.memo-item').length) throw new Error('门禁关闭后 Memo 应可见');
  input($('#pwInput'), '');
});

step('搜索：匹配条目', () => {
  input($('#searchInput'), 'Cloudflare');
  if (!$$('#paneList .sr-item').length) throw new Error('无搜索结果');
});

step('搜索：清空后退出搜索视图', () => {
  input($('#searchInput'), '');
  if ($('#paneList').querySelector('.sr-item')) throw new Error('仍停留在搜索结果');
});

step('表格条目：表格 / 图册切换', () => {
  click($('.nav-item[data-fn="notebook"]'));
  click($$('#paneList .item-row').find(r => r.dataset.id === 't1'));
  if (!$('table.data')) throw new Error('表格未渲染');
  click($('#tableMode button[data-v="gallery"]'));
  if (!$$('.gal-card').length) throw new Error('图册为空');
});

step('表格：状态单元格循环', () => {
  click($('#tableMode button[data-v="table"]'));
  const cell = $('[data-bstatus]');
  const before = cell.textContent;
  click(cell);
  if ($('[data-bstatus]').textContent === before) throw new Error('状态未变化');
});

step('新建按钮：一次点击直接新建笔记（7.4 修订）', () => {
  click($('#btnNew'));
  if (!$('#edSource')) throw new Error('未直接打开编辑器');
  if (!$('#docTitle').value.includes('未命名笔记')) throw new Error('新建的不是笔记：' + $('#docTitle').value);
  if ($$('#paneDoc .doc-status').length !== 1) throw new Error('新笔记的状态栏不是唯一一条');
});

step('笔记本新建入口：文件夹 / 表格（表格不在录入框里）', () => {
  click($('#nbAdd'));
  if (!doc.querySelector('.menu-item[data-new="folder"]')) throw new Error('缺文件夹项');
  click(doc.querySelector('.menu-item[data-new="table"]'));
  if (!$('table.data')) throw new Error('未进入表格');
});

step('账户与设置入口不弹菜单，直接进设置（7.4 修订）', () => {
  click($('.nav-item[data-fn="recent"]'));
  click($('#fnAccount'));
  if (!$('.pane-head h1').textContent.includes('设置')) throw new Error('未进入设置');
  if (doc.querySelector('.menu')) throw new Error('账户入口仍在弹菜单，与「合并为一个入口」不符');
});

console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
console.log('=== 捕获的脚本错误 ===');
console.log(errs.length ? errs.join('\n') : '无');
window.close();
process.exit(fail ? 1 : 0);
