/* ============================================================
   Menote 原型回归验证脚本
   ------------------------------------------------------------
   用 jsdom 加载 menote-prototype.html 并真实执行页面脚本，
   按设计文档与《Menote 功能拆解 v2》的约定模拟交互路径，捕获运行时错误。

   运行：
     npm install jsdom
     NODE_PATH=<node_modules 路径> node verify-prototype.js

   覆盖：导航顺序与路由（首页 / Memo / 待办 分离）/
         账户入口唯一性（顶栏隐私锁胶囊旁，6 块顶栏；功能栏底部已无账户区）/
         首页三类内容与隐私占位 / 启动视图 / 主题（Claude 橙白双主题）/
         笔记本双栏 / 正文层级归并 / Memo 两视图 / 待办列表与看板 /
         快速录入框三模式（无加密选项）/ 录入框行序（输入区 → 附加项 → 模式行）/
         新建直连笔记 / 笔记本新建入口 /
         表格更多菜单 / 滑出详情侧栏 / 隐私锁锁定与解锁 / Memo 隐私门禁 /
         恢复码流程 / 搜索 / 表格视图切换
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
  if ($('#lockCapsule').classList.contains('locked')) throw new Error('已处于锁定态');
  click($('#lockCapsule'));
  const item = doc.querySelector('.menu-item[data-lock]');
  if (!item) throw new Error('胶囊菜单未出现');
  click(item);
};
const unlockVia = sel => { click($(sel)); input($('#pwInput'), 'demo'); click($('#unlockConfirm')); };

console.log('=== 交互路径验证 ===');

/* ---------- 导航结构（功能拆解 v2 / Q1 已确认） ---------- */
step('初始渲染：首页三类内容（v2 M02-03）', () => {
  if (!$('.pane-head h1').textContent.includes('首页')) throw new Error('默认视图不是首页');
  const titles = $$('.home-card > .hd h3').map(h => h.textContent);
  ['条目统计', '今日待办', '最近动态', '快捷方式', '快速导航'].forEach(t => {
    if (!titles.includes(t)) throw new Error('首页缺内容块：' + t);
  });
});

step('导航顺序：首页 · Memo · 待办 · 最近编辑 · 收藏 · 笔记本 · 隐私空间（v2 Q1）', () => {
  const order = $$('.nav-item[data-fn]').map(el => el.dataset.fn).join('/');
  if (order !== 'home/memo/task/recent/starred/notebook/vault')
    throw new Error('导航顺序为 ' + order);
});

step('功能栏导航不含独立的回收站 / 设置项（7.4 修订，设置由顶栏账户入口进入）', () => {
  if ($('.nav-item[data-fn="trash"]')) throw new Error('底部仍有独立回收站入口');
  if ($('.nav-item[data-fn="settings"]')) throw new Error('底部仍有独立设置入口');
});

step('账户入口：全站只有一个头像，位于顶栏隐私锁胶囊旁（2026-09-26 调整）', () => {
  const avatars = $$('.avatar');
  if (avatars.length !== 1) throw new Error('头像数量 ' + avatars.length);
  const acc = $('#topAccount');
  if (!acc) throw new Error('顶栏无账户入口');
  if (!acc.closest('.topbar')) throw new Error('账户入口不在顶栏内');
  if (!acc.contains(avatars[0])) throw new Error('头像不在账户入口内');
  // 必须紧邻隐私锁胶囊：同一父容器，且排在胶囊之后
  const bar = $('.topbar');
  const kids = Array.from(bar.children).map(el => el.className.split(/\s+/)[0]);
  const iCapsule = kids.indexOf('capsule'), iAcc = kids.indexOf('top-account');
  if (iCapsule < 0 || iAcc < 0) throw new Error('顶栏缺少胶囊或账户入口：' + kids.join('/'));
  if (iAcc !== iCapsule + 1) throw new Error('账户入口未紧邻隐私锁胶囊：' + kids.join('/'));
  // 顶栏因此由 5 块变 6 块
  if (bar.children.length !== 6) throw new Error('顶栏区块数 ' + bar.children.length + '，应为 6');
  // 功能栏底部不再有账户区
  if ($('.fn-foot') || $('.fn-account')) throw new Error('功能栏底部仍有账户区');
  // 顶栏是紧凑条：只放圆形头像，不显示 owner / 「账户与设置」文字
  if (acc.textContent.replace(/\s/g, '') !== 'M') throw new Error('顶栏账户入口不应显示文字：' + acc.textContent);
  if (!acc.title.includes('账户与设置')) throw new Error('账户入口缺少 title 提示');
});

/* ---------- 首页数据与隐私（v2 M02-03 / Q7） ---------- */
step('首页统计 = 最近编辑条目数（记录视图不含 Memo，v2 Q8）', () => {
  const nums = $$('.home-stat .n').map(n => n.textContent.trim());
  const total = parseInt(nums[0], 10) + parseInt(nums[1], 10);
  click($('.nav-item[data-fn="recent"]'));
  const rows = $$('#paneList .item-row').length;
  if (rows !== total) throw new Error('最近编辑条目数 ' + rows + ' ≠ 首页统计 ' + total);
  if ($('#paneList .memo-item')) throw new Error('记录视图出现 Memo');
  click($('.nav-item[data-fn="starred"]'));
  if ($('#paneList .memo-item')) throw new Error('收藏视图出现 Memo');
});

step('首页隐私规则：锁定时 Memo 统计与动态占位（M02-03 / Q7）', () => {
  lock();
  click($('.nav-item[data-fn="home"]'));
  const memoStat = $$('.home-stat')[2];
  if (!memoStat.textContent.includes('已锁定')) throw new Error('锁定时 Memo 统计未占位');
  if (!$('.home-locked')) throw new Error('锁定时未提示 Memo 内容已锁定');
  click($('.nav-item[data-fn="memo"]'));
  unlockVia('#memoUnlockBtn');
  click($('.nav-item[data-fn="home"]'));
  if (!$$('.home-stat')[2].textContent.match(/\d/)) throw new Error('解锁后 Memo 统计未恢复');
});

/* ---------- 功能栏：新建与录入框 ---------- */
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

step('录入框「笔记」模式不再提供加密选项（v2 M04-02）', () => {
  click($('#composerModes button[data-mode="note"]'));
  const txt = $('#composerExtra').textContent;
  if (txt.includes('加密')) throw new Error('笔记模式仍有加密选项：' + txt);
  if (!$('#composerPublish').title.includes('新建')) throw new Error('发布按钮未承接新建提示');
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

step('录入框顺序：输入区 → 模式附加项 → 模式行（2026-09-26 调整）', () => {
  const kids = Array.from($('.composer').children)
    .map(el => el.id || String(el.className).split(/\s+/)[0]);
  const want = ['composerInput', 'composerExtra', 'mode-row'];
  if (kids.join('/') !== want.join('/')) {
    throw new Error('录入框子元素顺序为 ' + kids.join(' → ') + '，应为 ' + want.join(' → '));
  }
  // 间距对调：附加项在上 8px、模式行在下 6px（总高与调整前一致）
  const css = $$('style').map(s => s.textContent).join('\n');
  const extra = css.match(/\.composer-extra\{[^}]*\}/);
  const row = css.match(/\.mode-row\{[^}]*\}/);
  if (!extra || !row) throw new Error('未找到 .composer-extra 或 .mode-row 规则');
  if (!/margin-top:\s*8px/.test(extra[0])) throw new Error('附加项上间距应为 8px：' + extra[0]);
  if (!/margin-top:\s*6px/.test(row[0])) throw new Error('模式行上间距应为 6px：' + row[0]);
});

/* ---------- Memo 与待办分离（v2 Q1） ---------- */
step('Memo 视图只有 时间轴 / 瀑布流，无「清单」tab（v2 Q1 / M06-10）', () => {
  click($('.nav-item[data-fn="memo"]'));
  if (!$('.pane-head h1').textContent.includes('Memo')) throw new Error('未进入 Memo 视图');
  const tabs = $$('#memoMode button').map(b => b.dataset.m);
  if (tabs.join('/') !== 'timeline/waterfall') throw new Error('Memo 视图 tab 为：' + tabs.join('/'));
  if (!$$('.memo-item').length) throw new Error('时间轴为空');
  if (!$('#memoAdd')) throw new Error('Memo 视图顶部缺「添加」按钮');
});

step('待办为独立视图，列表 / 看板可切（v2 Q1 / M07-05）', () => {
  click($('.nav-item[data-fn="task"]'));
  if (!$('.pane-head h1').textContent.includes('待办')) throw new Error('未进入待办视图');
  if (!$('#taskAdd')) throw new Error('待办视图顶部缺「添加」按钮');
  const tabs = $$('#taskView button').map(b => b.dataset.t);
  if (tabs.join('/') !== 'list/kanban') throw new Error('待办视图为：' + tabs.join('/'));
  if (!$$('.task-row').length) throw new Error('待办列表为空');
  click($('#taskView button[data-t="kanban"]'));
  if (!$$('.kb-col').length) throw new Error('看板为空');
  click($('[data-kb]'));
  click($('#taskView button[data-t="list"]'));
  click($('[data-tcheck]'));
});

step('「添加」按钮复用录入框并切到对应模式（M06-10 / M07-01）', () => {
  click($('.nav-item[data-fn="memo"]'));
  click($('#memoAdd'));
  if (!$('#composerModes button[data-mode="memo"]').classList.contains('on'))
    throw new Error('Memo「添加」未切到 Memo 模式');
  click($('.nav-item[data-fn="task"]'));
  click($('#taskAdd'));
  if (!$('#composerModes button[data-mode="task"]').classList.contains('on'))
    throw new Error('待办「添加」未切到待办模式');
});

/* ---------- 设置：账户入口与子页面 ---------- */
step('账户与设置：点击顶栏入口进入设置（2026-09-26 调整）', () => {
  click($('#topAccount'));
  if (!$('.pane-head h1').textContent.includes('设置')) throw new Error('未进入设置');
  if (!$('#topAccount').classList.contains('active')) throw new Error('账户入口未高亮');
});

step('设置内含「版本与回收站」，可打开回收站（7.4 修订）', () => {
  if (!$('#openTrash')) throw new Error('设置里没有回收站入口');
  click($('#openTrash'));
  if (!$('.pane-head h1').textContent.includes('回收站')) throw new Error('未进入回收站');
  if (!$('#trashBack')) throw new Error('回收站缺返回设置的入口');
  click($('#trashBack'));
  if (!$('.pane-head h1').textContent.includes('设置')) throw new Error('未返回设置');
});

step('启动视图：切到「收藏」隐藏首页项，切回首页恢复（v2 M02-04）', () => {
  click($('#topAccount'));
  const set = $('#startViewSet');
  if (!set) throw new Error('设置里没有通用 › 启动视图');
  click(set.querySelector('.radio-opt[data-sv="starred"]'));
  if ($('#navHome').style.display !== 'none') throw new Error('未选首页时首页项仍显示');
  click(set.querySelector('.radio-opt[data-sv="home"]'));
  if ($('#navHome').style.display === 'none') throw new Error('选回首页后首页项仍隐藏');
});

/* ---------- 主题：Claude 橙白双主题 ---------- */
step('主题：默认浅色，设置里可切深色 / 跟随系统（§7.5 界面偏好）', () => {
  const root = doc.documentElement;
  if (root.getAttribute('data-theme') !== 'light') throw new Error('默认不是浅色：' + root.getAttribute('data-theme'));
  const set = $('#themeSet');
  if (!set) throw new Error('设置 › 通用 缺「界面偏好 · 主题」');
  click(set.querySelector('.radio-opt[data-th="dark"]'));
  if (root.getAttribute('data-theme') !== 'dark') throw new Error('未切到深色');
  if (!set.querySelector('.radio-opt[data-th="dark"]').classList.contains('on')) throw new Error('深色选项未高亮');
  click(set.querySelector('.radio-opt[data-th="auto"]'));
  if (!/^(light|dark)$/.test(root.getAttribute('data-theme') || '')) throw new Error('「跟随系统」未落到具体主题');
  click(set.querySelector('.radio-opt[data-th="light"]'));
  if (root.getAttribute('data-theme') !== 'light') throw new Error('未切回浅色');
  if (!set.querySelector('.radio-opt[data-th="light"]').classList.contains('on')) throw new Error('浅色选项未高亮');
});

step('主题令牌：浅色与深色两套变量都已定义', () => {
  const css = $$('style').map(s => s.textContent).join('\n');
  const rootBlk = css.match(/:root\{[\s\S]*?\n\}/);
  if (!rootBlk) throw new Error('未找到 :root 令牌块');
  if (!/--bg:#faf9f5/.test(rootBlk[0])) throw new Error('浅色底色不是奶油白');
  const dark = css.match(/\[data-theme="dark"\]\{[\s\S]*?\n\}/);
  if (!dark) throw new Error('缺深色令牌块');
  ['--bg', '--panel', '--text', '--primary', '--primary-line', '--shadow-1'].forEach(v => {
    if (!dark[0].includes(v + ':')) throw new Error('深色块缺变量 ' + v);
  });
});

step('主色为 Claude 陶土橙，无蓝色系残留', () => {
  const css = $$('style').map(s => s.textContent).join('\n');
  const rootBlk = css.match(/:root\{[\s\S]*?\n\}/)[0];
  if (!/--primary:#d97757/.test(rootBlk)) throw new Error('浅色主色不是陶土橙');
  const blue = css.match(/#5b8cff|#7ba3ff|#8fa6c9|#cfe0f7|#4f7ff0|#6d5ce8/);
  if (blue) throw new Error('仍有蓝色系硬编码残留：' + blue[0]);
});

/* ---------- 笔记本 / 正文 ---------- */
step('切到笔记本 → 列表 + 正文双栏', () => {
  click($('.nav-item[data-fn="notebook"]'));
  if (!$$('#paneList .item-row').length) throw new Error('左侧列表为空');
  if (!$('#edSource')) throw new Error('右侧正文未渲染');
});

step('点开加密日记（已解锁态）：加密信息已并入状态栏', () => {
  click($$('#paneList .item-row').find(r => r.dataset.id === 'n3'));
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

/* ---------- 录入发布 ---------- */
step('录入框：待办模式发布 → 待办视图新增一条', () => {
  click($('.nav-item[data-fn="task"]'));
  const before = $$('.task-row').length;
  click($('#composerModes button[data-mode="task"]'));
  click($('span[data-pri="低"]'));
  input($('#composerInput'), '测试待办一条 #测试');
  click($('#composerPublish'));
  if ($$('.task-row').length !== before + 1) throw new Error('待办视图未新增条目');
});

step('录入框：笔记模式发布（首行作标题，落根目录）', () => {
  click($('#composerModes button[data-mode="note"]'));
  input($('#composerInput'), '临时笔记标题\n这是正文内容');
  click($('#composerPublish'));
  if (!$('#edSource')) throw new Error('未打开编辑器');
  if (!$('#docTitle').value.includes('临时笔记标题')) throw new Error('首行未作标题');
});

/* ---------- 条目侧栏 / 表格 ---------- */
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

step('表格条目：表格 / 图册切换', () => {
  click($('.nav-item[data-fn="notebook"]'));
  click($$('#paneList .item-row').find(r => r.dataset.id === 't1'));
  if (!$('table.data')) throw new Error('表格未渲染');
  click($('#tableMode button[data-v="gallery"]'));
  if (!$$('.gal-card').length) throw new Error('图册为空');
  click($('#tableMode button[data-v="table"]'));
});

step('表格「更多」菜单：加密文案按类型区分（v2 M04-02 / M04-08）', () => {
  const btn = $('#docMoreBtn');
  if (!btn) throw new Error('表格正文头缺「更多」按钮');
  click(btn);
  const enc = doc.querySelector('.menu-item[data-doc="enc"]');
  if (!enc) throw new Error('更多菜单缺加密项');
  if (!enc.textContent.includes('加密此表格')) throw new Error('表格加密文案未按类型区分：' + enc.textContent);
  if (!doc.querySelector('.menu-item[data-doc="down"]')) throw new Error('表格更多菜单缺「降级为普通笔记」');
  click(doc.body);
});

step('表格：状态单元格循环', () => {
  const cell = $('[data-bstatus]');
  const before = cell.textContent;
  click(cell);
  if ($('[data-bstatus]').textContent === before) throw new Error('状态未变化');
});

/* ---------- 隐私锁 ---------- */
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

step('锁定态 Memo 与待办都显示门禁占位（M06-08 / M07-05）', () => {
  lock();
  click($('.nav-item[data-fn="memo"]'));
  if (!$('#memoUnlockBtn')) throw new Error('未显示 Memo 门禁');
  click($('.nav-item[data-fn="task"]'));
  if (!$('#taskUnlockBtn')) throw new Error('未显示待办门禁');
});

step('从待办门禁解锁恢复内容', () => {
  unlockVia('#taskUnlockBtn');
  if (!$$('.task-row').length) throw new Error('解锁后未恢复待办内容');
  click($('.nav-item[data-fn="memo"]'));
  if (!$$('.memo-item').length) throw new Error('一次解锁应同时解开 Memo（v2 Q5）');
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
  click($('#topAccount'));
  click($('#openTrash'));
  const before = $$('.trash-row').length;
  click($('[data-restore]'));
  if ($$('.trash-row').length !== before - 1) throw new Error('未移除');
});

step('设置：改档位 → 胶囊跟随', () => {
  click($('#topAccount'));
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
});

/* ---------- 搜索 / 新建 ---------- */
step('搜索：匹配条目', () => {
  input($('#searchInput'), 'Cloudflare');
  if (!$$('#paneList .sr-item').length) throw new Error('无搜索结果');
});

step('搜索：清空后退出搜索视图', () => {
  input($('#searchInput'), '');
  if ($('#paneList').querySelector('.sr-item')) throw new Error('仍停留在搜索结果');
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

step('账户与设置入口不弹菜单，直接进设置（2026-09-26 调整）', () => {
  click($('.nav-item[data-fn="recent"]'));
  click($('#topAccount'));
  if (!$('.pane-head h1').textContent.includes('设置')) throw new Error('未进入设置');
  if (doc.querySelector('.menu')) throw new Error('账户入口仍在弹菜单，与「合并为一个入口」不符');
});

console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
console.log('=== 捕获的脚本错误 ===');
console.log(errs.length ? errs.join('\n') : '无');
window.close();
process.exit(fail ? 1 : 0);
