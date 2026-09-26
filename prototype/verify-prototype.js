/* ============================================================
   Menote 原型回归验证脚本
   ------------------------------------------------------------
   用 jsdom 加载 menote-prototype.html 并真实执行页面脚本，
   按设计文档与《Menote 功能拆解 v2》的约定模拟交互路径，捕获运行时错误。

   运行：
     npm install jsdom
     NODE_PATH=<node_modules 路径> node verify-prototype.js

   覆盖：浏览三段（首页 / Memo / 待办 横向合并成一行，保留原名）/
         导航顺序与路由（首页 / Memo / 待办 / 最近编辑 / 收藏 / 笔记本 / 标签 / 加密空间）/
         账户入口（顶栏头像 → 快捷菜单 → 设置，6 块顶栏；功能栏底部已无账户区）/
         首页三类内容与隐私占位 / 启动视图 / 主题（Claude 橙白双主题）/
         笔记本双栏 / 正文层级归并 / Memo 两视图 / 待办列表与看板 /
         快速录入框三模式（无加密选项）/ 录入框行序（输入区 → 附加项 → 模式行）/
         新建直连笔记 / 笔记本新建入口 /
         加密空间贴底且无分组小标题 /
         表格更多菜单 / 滑出详情侧栏 / 隐私锁锁定与解锁 / Memo 隐私门禁 /
         设置两栏分页（左列分类导航 + 右侧内容，§7.5）/ 账户快捷菜单与其配置 / 重置隐私密码流程 /
         搜索 / 表格视图切换
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
/* 2026-09-26 起「首页 / Memo / 待办」是浏览三段 .seg-item，其余导航项仍是 .nav-item。
   统一走这两个助手取，避免后续再调整结构时满脚本改选择器。 */
const navEl = fn => $('.nav-item[data-fn="' + fn + '"], .seg-item[data-fn="' + fn + '"]');
const navAll = () => $$('.nav-item[data-fn], .seg-item[data-fn]');

/* 账户入口（2026-09-26 用户更正）：点头像弹出快捷菜单，「设置」是菜单里的一项。
   先展开菜单，再点「设置」进去 —— 之后才能谈「当前是哪个分类」。 */
function openAccountMenu(){
  if (!$('.menu.open')) click($('#topAccount'));
  const menu = $('.menu.open');
  if (!menu) throw new Error('点头像未弹出快捷菜单（2026-09-26 更正）');
  return menu;
}
function clickQuick(k){
  const item = $$('.menu.open .menu-item').find(el => el.dataset.qm === k);
  if (!item) throw new Error('快捷菜单里没有「' + k + '」');
  click(item);
}
/* 设置是两栏分页（§7.5）：先经头像菜单进设置，再点左列分类导航切到目标分类。
   分类没切到就断言右侧内容 = 拿上一分类残留的 DOM 蒙混过关，所以这一步必须走。 */
function openSetPage(id){
  openAccountMenu();
  clickQuick('settings');
  if (!$('.pane-head h1') || !$('.pane-head h1').textContent.includes('设置')) throw new Error('未进入设置');
  const nav = $('#setNav');
  if (!nav) throw new Error('设置缺左列分类导航（§7.5）');
  const item = nav.querySelector('.set-nav-item[data-set="' + id + '"]');
  if (!item) throw new Error('分类导航里没有「' + id + '」');
  click(item);
  const on = $('#setNav .set-nav-item.on');
  if (!on || on.dataset.set !== id) throw new Error('切分类后左列高亮不对');
  return $('#setPages');
}

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

step('导航顺序：首页 · Memo · 待办 · 最近编辑 · 收藏 · 笔记本 · 加密空间（v2 Q1）', () => {
  const order = navAll().map(el => el.dataset.fn).join('/');
  if (order !== 'home/memo/task/recent/starred/notebook/vault')
    throw new Error('导航顺序为 ' + order);
});

step('浏览三段：首页 / Memo / 待办 压成横向一行，保留原名（2026-09-26 调整）', () => {
  const seg = $('#navSeg');
  if (!seg) throw new Error('缺浏览三段容器 #navSeg');
  const items = Array.from(seg.children).map(el => el.dataset.fn);
  if (items.join('/') !== 'home/memo/task') throw new Error('三段为 ' + items.join('/'));
  // 保留原名字
  const labels = Array.from(seg.children).map(el => el.textContent.trim());
  if (labels.join('/') !== '首页/Memo/待办') throw new Error('段名为 ' + labels.join('/'));
  // 三段不显示数字（2026-09-26 用户要求）
  Array.from(seg.children).forEach(el => {
    if (/[0-9]/.test(el.textContent)) throw new Error(el.dataset.fn + ' 段仍显示数字：' + el.textContent);
    if (el.querySelector('.count')) throw new Error(el.dataset.fn + ' 段仍有计数徽标');
  });
  if ($('#navTaskCount')) throw new Error('待办计数徽标 #navTaskCount 仍在');
  // 旧的三行导航项已清除
  if ($$('#navSeg .nav-item').length) throw new Error('三段里仍残留旧的三行导航项');
  if ($('#fnNav [data-fn="home"], #fnNav [data-fn="memo"], #fnNav [data-fn="task"]'))
    throw new Error('旧导航区仍留着首页 / Memo / 待办');
  // 横向排布 + 等分宽度（靠 CSS 保证）
  const css = $$('style').map(s => s.textContent).join('\n');
  const segRule = css.match(/\.nav-seg\{[^}]*\}/);
  if (!segRule) throw new Error('未找到 .nav-seg 规则');
  if (!/display:\s*flex/.test(segRule[0])) throw new Error('.nav-seg 未横向排布：' + segRule[0]);
  const itemRule = css.match(/\.seg-item\{[^}]*\}/);
  if (!itemRule) throw new Error('未找到 .seg-item 规则');
  if (!/flex:\s*1/.test(itemRule[0])) throw new Error('.seg-item 未等分宽度：' + itemRule[0]);
  // 造型必须与收录框的模式选择（盒式分段控件）明显区分
  if (!css.match(/\.mode-tabs\{[^}]*\}/)) throw new Error('未找到 .mode-tabs 规则，无法比对');
  if (/background/.test(segRule[0])) throw new Error('.nav-seg 不该有盒式底色（那是 .mode-tabs 的形态）：' + segRule[0]);
  if (!/border-bottom/.test(segRule[0])) throw new Error('.nav-seg 应为下划线页签（缺 border-bottom）：' + segRule[0]);
  const activeRule = css.match(/\.seg-item\.active\{[^}]*\}/);
  if (!activeRule) throw new Error('未找到 .seg-item.active 规则');
  if (/background/.test(activeRule[0])) throw new Error('选中态不该是实底盒（那是 .mode-tabs 的形态）：' + activeRule[0]);
  const barRule = css.match(/\.seg-item\.active::after\{[^}]*\}/);
  if (!barRule) throw new Error('缺下划线指示条 .seg-item.active::after');
  if (!/background/.test(barRule[0])) throw new Error('下划线指示条没有上色：' + barRule[0]);
  // 点击每段仍能各自跳转
  ['home', 'memo', 'task'].forEach(fn => {
    click(navEl(fn));
    if ($('.nav-item.active, .seg-item.active') !== navEl(fn)) {
      throw new Error(fn + ' 点击后未高亮为当前项');
    }
  });
  click(navEl('home'));
});

step('加密空间：无分组小标题，贴底固定在功能栏底部（2026-09-26 调整）', () => {
  // 不再有「隐私」小标题（标签分组的标题要保留）
  const titles = $$('.group-title').map(el => el.textContent.trim());
  if (titles.some(t => t.includes('隐私'))) throw new Error('仍有「隐私」小标题：' + titles.join(' / '));
  if (!titles.some(t => t.includes('标签'))) throw new Error('标签分组标题被误删：' + titles.join(' / '));

  const vn = $('#vaultNode');
  if (!vn) throw new Error('缺加密空间节点');
  // 移出可滚动导航区
  if (vn.closest('.fn-scroll')) throw new Error('加密空间仍在可滚动导航区内');
  // 贴底：放在专门的不收缩容器里，且该容器是功能栏最后一段
  const holder = vn.parentElement;
  if (!holder.classList.contains('fn-vault')) throw new Error('加密空间未放在贴底容器 .fn-vault 里');
  const kids = Array.from($('.fnbar').children);
  if (kids[kids.length - 1] !== holder) throw new Error('加密空间不是功能栏最底部的一段');

  const css = $$('style').map(s => s.textContent).join('\n');
  const rule = css.match(/\.fn-vault\{[^}]*\}/);
  if (!rule) throw new Error('未找到 .fn-vault 规则');
  if (!/flex:\s*none/.test(rule[0])) throw new Error('.fn-vault 未锁定为不收缩：' + rule[0]);
  if (!/border-top/.test(rule[0])) throw new Error('.fn-vault 缺分隔线：' + rule[0]);

  // 导航末位仍是加密空间
  const order = navAll().map(el => el.dataset.fn).join('/');
  if (!order.endsWith('/vault')) throw new Error('加密空间不在导航末位：' + order);
});

step('功能栏导航不含独立的回收站 / 设置项（7.4 修订，设置由顶栏账户入口进入）', () => {
  if (navEl('trash')) throw new Error('底部仍有独立回收站入口');
  if (navEl('settings')) throw new Error('底部仍有独立设置入口');
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
step('首页统计含加密空间条目；记录视图仍不含（M02-03 / Q8 / 2026-09-26）', () => {
  click(navEl('home'));
  const nums = $$('.home-stat .n').map(n => n.textContent.trim());
  const total = parseInt(nums[0], 10) + parseInt(nums[1], 10);
  click(navEl('recent'));
  const rows = $$('#paneList .item-row').length;
  // 加密空间内的 2 条（日记 · 2026 秋 / 账户凭证备忘）计入首页统计，但不进记录类视图
  if (rows !== total - 2) {
    throw new Error('最近编辑条目数 ' + rows + ' ≠ 首页统计 ' + total + ' − 加密空间 2 条');
  }
  if ($('#paneList .memo-item')) throw new Error('记录视图出现 Memo');
  click(navEl('starred'));
  if ($('#paneList .memo-item')) throw new Error('收藏视图出现 Memo');
});

step('首页：Memo 占位，但条目统计始终计入（M02-03 / Q7 / 2026-09-26 用户确认）', () => {
  click(navEl('home'));
  const snap = () => $$('.home-stat').slice(0, 2).map(e => e.textContent.replace(/\s+/g, '').trim());
  const before = snap().join('|');
  if (!$('.hint-line') || !$$('.hint-line').some(e => e.textContent.indexOf('始终计入') >= 0)) {
    throw new Error('首页未标注「统计始终计入」口径');
  }
  lock();
  click(navEl('home'));
  const memoStat = $$('.home-stat')[2];
  if (!memoStat.textContent.includes('已锁定')) throw new Error('锁定时 Memo 统计未占位');
  if (!$('.home-locked')) throw new Error('锁定时未提示 Memo 内容已锁定');
  if (snap().join('|') !== before) throw new Error('锁定后条目统计口径变了：' + before + ' → ' + snap().join('|'));
  click(navEl('memo'));
  unlockVia('#memoUnlockBtn');
  click(navEl('home'));
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
  click(navEl('memo'));
  if (!$('.pane-head h1').textContent.includes('Memo')) throw new Error('未进入 Memo 视图');
  const tabs = $$('#memoMode button').map(b => b.dataset.m);
  if (tabs.join('/') !== 'timeline/waterfall') throw new Error('Memo 视图 tab 为：' + tabs.join('/'));
  if (!$$('.memo-item').length) throw new Error('时间轴为空');
  if (!$('#memoAdd')) throw new Error('Memo 视图顶部缺「添加」按钮');
});

step('待办为独立视图，列表 / 看板可切（v2 Q1 / M07-05）', () => {
  click(navEl('task'));
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
  click(navEl('memo'));
  click($('#memoAdd'));
  if (!$('#composerModes button[data-mode="memo"]').classList.contains('on'))
    throw new Error('Memo「添加」未切到 Memo 模式');
  click(navEl('task'));
  click($('#taskAdd'));
  if (!$('#composerModes button[data-mode="task"]').classList.contains('on'))
    throw new Error('待办「添加」未切到待办模式');
});

/* ---------- 设置：账户入口与子页面 ---------- */
step('账户入口：点头像弹快捷菜单，「设置」在菜单里（2026-09-26 用户更正）', () => {
  click($('#topAccount'));
  const menu = $('.menu.open');
  if (!menu) throw new Error('点头像没有弹出快捷菜单');
  if ($('.pane-head h1').textContent.includes('设置')) throw new Error('点头像直接进了设置，未走菜单');
  const has = k => $$('.menu.open .menu-item').some(el => el.dataset.qm === k);
  if (!has('settings')) throw new Error('快捷菜单里没有「设置」入口');
  if (!has('logout')) throw new Error('快捷菜单里没有「退出登录」');
  if (!$('.menu.open .menu-head')) throw new Error('快捷菜单缺账户头部');
  // 主题切换在菜单里是一排三档，不是普通菜单项（默认开启）
  const seg = $('.menu.open .menu-seg');
  if (!seg) throw new Error('快捷菜单里没有默认开启的「主题切换」');
  ['light', 'dark', 'auto'].forEach(t => {
    if (!seg.querySelector('button[data-th="' + t + '"]')) throw new Error('主题档位缺 ' + t);
  });
  if (!$$('.menu.open .menu-label').some(el => el.textContent.includes('主题')))
    throw new Error('主题切换缺分组小标题');
  // 再点一次头像收起（不应误进设置）
  click($('#topAccount'));
  if ($('.menu.open')) throw new Error('再点头像没有收起菜单');
  if ($('.pane-head h1').textContent.includes('设置')) throw new Error('收起菜单的动作进了设置');
  // 走菜单里的「设置」
  click($('#topAccount'));   // 重新展开
  clickQuick('settings');
  if (!$('.pane-head h1').textContent.includes('设置')) throw new Error('菜单里的「设置」没有进入设置');
  if ($('.menu.open')) throw new Error('选完菜单项后菜单未收起');
  if (!$('#topAccount').classList.contains('active')) throw new Error('账户入口未高亮');
});

step('快捷菜单：放什么可配置（设置 › 通用 › 快捷菜单，2026-09-26 用户更正）', () => {
  openSetPage('general');
  const box = $('#quickMenuSet');
  if (!box) throw new Error('通用里缺「快捷菜单」配置卡片');
  const toggles = $$('#quickMenuSet .toggle');
  if (toggles.length < 4) throw new Error('可配置的菜单项太少：' + toggles.length);
  const tg = k => $$('#quickMenuSet .toggle').find(t => t.dataset.qm === k);
  if (!tg('theme') || !tg('lock') || !tg('search') || !tg('trash') || !tg('backup'))
    throw new Error('可配置项不齐（应有 theme / lock / search / trash / backup）');
  // 默认开：主题切换 与 立即锁定
  if (!tg('theme').classList.contains('on') || !tg('lock').classList.contains('on'))
    throw new Error('默认项应为主题切换 + 立即锁定');
  // 勾上「搜索」→ 菜单里出现
  click(tg('search'));
  openAccountMenu();
  if (!$$('.menu.open .menu-item').some(el => el.dataset.qm === 'search')) throw new Error('勾选后菜单里没出现「搜索」');
  // 菜单里的主题档位：切了主题、菜单不收起
  click($('.menu.open .menu-seg button[data-th="dark"]'));
  if (doc.documentElement.getAttribute('data-theme') !== 'dark') throw new Error('菜单里的主题档位未生效');
  if (!$('.menu.open')) throw new Error('切主题后菜单被收起了，应当留在菜单里继续切');
  if (!$('.menu.open .menu-seg button[data-th="dark"]').classList.contains('on')) throw new Error('档位未就地高亮');
  click($('.menu.open .menu-seg button[data-th="light"]'));
  if (doc.documentElement.getAttribute('data-theme') !== 'light') throw new Error('未切回浅色');
  click($('#topAccount'));   // 收起
  // 取消勾选「搜索」→ 菜单里消失；配置是就地生效的，不需要重进设置
  openSetPage('general');
  click($$('#quickMenuSet .toggle').find(t => t.dataset.qm === 'search'));
  openAccountMenu();
  if ($$('.menu.open .menu-item').some(el => el.dataset.qm === 'search')) throw new Error('取消勾选后菜单里仍有「搜索」');
  click($('#topAccount'));
});

step('设置：两栏分页结构 —— 左列分类导航 + 右侧当前分类内容（§7.5）', () => {
  openAccountMenu();
  clickQuick('settings');
  const nav = $('#setNav');
  if (!nav) throw new Error('设置缺左列分类导航');
  const items = $$('#setNav .set-nav-item');
  if (items.length !== 10) throw new Error('分类数不是 10：' + items.map(e => e.textContent.trim()).join(' / '));
  ['通用', '账户与安全', '编辑器', '隐私锁', '版本与回收站', '备份', '分享', 'MCP', '数据管理', '实例管理'].forEach(n => {
    if (!items.some(el => el.textContent.indexOf(n) >= 0)) throw new Error('分类导航缺「' + n + '」');
  });
  // 默认落在「通用」，页头必须跟着分类走
  if (!items.find(el => el.classList.contains('on')) || $('#setNav .set-nav-item.on').dataset.set !== 'general')
    throw new Error('默认分类不是「通用」');
  if (!$('#startViewSet')) throw new Error('默认分类未渲染「通用」内容');
  if (!$('.pane-head .sub').textContent.includes('通用')) throw new Error('页头未跟随当前分类');
  // 切到「编辑器」：左侧高亮、右侧内容、页头三处同时变，且上一分类的内容必须消失
  click($('#setNav .set-nav-item[data-set="editor"]'));
  if ($('#setNav .set-nav-item.on').dataset.set !== 'editor') throw new Error('编辑器分类未高亮');
  if (!$('#editModeSet')) throw new Error('编辑器分类缺「默认编辑模式」');
  if ($('#startViewSet')) throw new Error('切页后「通用」的内容仍在，未真正分页');
  if (!$('.pane-head .sub').textContent.includes('编辑器')) throw new Error('页头未跟随编辑器分类');
  click($$('#editModeSet .radio-opt')[3]);
  if (!$('#editModeSet .radio-opt[data-em="live"]').classList.contains('on')) throw new Error('默认编辑模式未就地高亮');
  // 当前分类记在 state：离开设置再回来仍停在原分类（回收站返回同理，见下一条）
  click(navEl('recent'));
  openAccountMenu();
  clickQuick('settings');
  if ($('#setNav .set-nav-item.on').dataset.set !== 'editor') throw new Error('离开再回来未停在原分类');
  // 实例管理是 owner 专属，导航上要有标记
  const inst = $$('#setNav .set-nav-item').find(el => el.dataset.set === 'instance');
  if (!inst.querySelector('.badge') || inst.querySelector('.badge').textContent.indexOf('owner') < 0)
    throw new Error('实例管理未标「仅 owner」');
  openSetPage('general');
});

step('设置内含「版本与回收站」，可打开回收站并原路返回（7.4 修订）', () => {
  openSetPage('version');
  if (!$('#openTrash')) throw new Error('设置 › 版本与回收站里没有回收站入口');
  click($('#openTrash'));
  if (!$('.pane-head h1').textContent.includes('回收站')) throw new Error('未进入回收站');
  if (!$('#trashBack')) throw new Error('回收站缺返回设置的入口');
  click($('#trashBack'));
  if (!$('.pane-head h1').textContent.includes('设置')) throw new Error('未返回设置');
  if (!$('#setNav .set-nav-item.on') || $('#setNav .set-nav-item.on').dataset.set !== 'version')
    throw new Error('从回收站返回未落回「版本与回收站」分类');
});

step('启动视图：切到「收藏」隐藏首页项，切回首页恢复（v2 M02-04）', () => {
  openSetPage('general');
  const set = $('#startViewSet');
  if (!set) throw new Error('设置 › 通用 里没有启动视图');
  click(set.querySelector('.radio-opt[data-sv="starred"]'));
  if ($('#navHome').style.display !== 'none') throw new Error('未选首页时首页项仍显示');
  click(set.querySelector('.radio-opt[data-sv="home"]'));
  if ($('#navHome').style.display === 'none') throw new Error('选回首页后首页项仍隐藏');
});

/* ---------- 主题：Claude 橙白双主题 ---------- */
step('主题：默认浅色，设置里可切深色 / 跟随系统（§7.5 界面偏好）', () => {
  openSetPage('general');
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
  click(navEl('notebook'));
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
  click(navEl('task'));
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

/* ---------- 双栏打开 / 侧滑详情（2026-09-26 调整） ---------- */
step('记录视图：点条目在右侧直接打开内容，不再侧滑', () => {
  click(navEl('starred'));
  const first = $$('#paneList .item-row')[0];
  if (!first) throw new Error('收藏列表为空');
  click(first);
  if ($('#drawer').classList.contains('open')) throw new Error('点条目仍会侧滑出详情');
  const row = $$('#paneList .item-row').find(r => r.dataset.id === first.dataset.id);
  if (!row.classList.contains('active')) throw new Error('被点条目未高亮为当前项');
  if (!$$('#paneList .item-row').length) throw new Error('列表未保留');
  if ($('#paneList').classList.contains('wide')) throw new Error('记录视图仍是单栏宽列表');
  if (!$('#docTitle') && !$('table.data')) throw new Error('右列未打开内容');
});

step('侧滑详情：能力保留，但不由列表触发（2026-09-26 用户口径）', () => {
  // 容器、样式、函数都还在 —— 留给「主操作区在使用时临时查看属性」
  if (!$('#drawer')) throw new Error('侧滑详情容器被删除');
  if (!/\.drawer\s*\{/.test(html)) throw new Error('侧滑详情样式被删除');
  if (!/function\s+openDrawer\s*\(/.test(html)) throw new Error('openDrawer 被删除');
  // 三个记录视图逐个确认不会侧滑
  ['recent', 'starred', 'notebook'].forEach(fn => {
    click(navEl(fn));
    const row = $$('#paneList .item-row')[0];
    if (!row) throw new Error(fn + ' 视图列表为空');
    click(row);
    if ($('#drawer').classList.contains('open')) throw new Error(fn + ' 视图点条目仍会侧滑');
  });
});

step('标签筛选', () => {
  click($('.tags [data-tag="读书"]'));
  if (!$$('#paneList .item-row').length) throw new Error('标签筛选结果为空');
});

step('表格条目：表格 / 图册切换', () => {
  click(navEl('notebook'));
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
  click(navEl('notebook'));
  click($$('#paneList .item-row').find(r => r.dataset.id === 'n3'));
  if (!$('#docUnlockBtn')) throw new Error('未显示解锁入口');
});

step('锁定态点「加密空间」→ 弹解锁框', () => {
  click(navEl('vault'));
  if (!$('#unlockOverlay').classList.contains('open')) throw new Error('解锁框未打开');
});

step('解锁 → 加密空间为「列表 + 正文」双栏（与笔记本同构，2026-09-26 调整）', () => {
  input($('#pwInput'), 'demo');
  click($('#unlockConfirm'));
  // 双栏：左列条目、右列正文都在
  if ($('#paneList').classList.contains('hidden')) throw new Error('加密空间仍是单栏（左列被隐藏）');
  if (!$('#paneList').innerHTML.trim()) throw new Error('左列未渲染空间内条目');
  if (!$('#paneDoc').innerHTML.trim()) throw new Error('右列未渲染');
  // 空间内条目在列表里，非空间内容不得混入
  const ids = $$('#paneList .item-row').map(r => r.dataset.id);
  if (!ids.includes('v1') || !ids.includes('v2')) throw new Error('空间内条目缺失：' + ids.join('/'));
  if (ids.some(id => id !== 'v1' && id !== 'v2')) throw new Error('非空间内容混进空间列表：' + ids.join('/'));
  // 点空间内条目 → 右列直接打开正文
  click($('#paneList .item-row[data-id="v1"]'));
  if (!$('#docTitle')) throw new Error('点空间内条目后右列未打开编辑器');
  if ($('#docTitle').value.indexOf('日记') < 0) throw new Error('右列打开的不是该条目：' + $('#docTitle').value);
  if (!$('#edSource').value.includes('存储池')) throw new Error('右列打开的是别的正文');
});

step('加密空间内容不泄漏到其它视图', () => {
  ['recent', 'starred', 'notebook', 'home'].forEach(fn => {
    click(navEl(fn));
    const ids = $$('#paneList .item-row').map(r => r.dataset.id);
    if (ids.includes('v1') || ids.includes('v2')) throw new Error('加密空间内容泄漏到 ' + fn);
  });
  click(navEl('vault'));
});

step('锁定态：加密空间不显示任何条目，列表区整块隐藏', () => {
  const b = $('#vaultLockBtn');
  if (!b) throw new Error('加密空间缺「立即锁定」按钮');
  click(b);
  if ($$('#paneList .item-row').length) throw new Error('锁定时空间仍显示条目');
  if (!$('#paneList').classList.contains('hidden')) throw new Error('锁定时列表区未隐藏');
  if (!$('#vaultUnlockBtn')) throw new Error('锁定时缺解锁入口');
  // 复原为解锁态，后续步骤沿用原来的状态
  unlockVia('#vaultUnlockBtn');
});

step('锁定态 Memo 与待办都显示门禁占位（M06-08 / M07-05）', () => {
  lock();
  click(navEl('memo'));
  if (!$('#memoUnlockBtn')) throw new Error('未显示 Memo 门禁');
  click(navEl('task'));
  if (!$('#taskUnlockBtn')) throw new Error('未显示待办门禁');
});

step('从待办门禁解锁恢复内容', () => {
  unlockVia('#taskUnlockBtn');
  if (!$$('.task-row').length) throw new Error('解锁后未恢复待办内容');
  click(navEl('memo'));
  if (!$$('.memo-item').length) throw new Error('一次解锁应同时解开 Memo（v2 Q5）');
});

step('忘记隐私密码 → 重置流程（2026-09-26 模型修订：不再有恢复码）', () => {
  lock();
  click(navEl('memo'));
  click($('#memoUnlockBtn'));
  click($('#forgotLink'));
  if (!$('#resetPwOverlay').classList.contains('open')) throw new Error('重置隐私密码弹窗未开');
  if ($('#recoverOverlay')) throw new Error('旧的恢复码弹窗仍在');
  const txt = $('#resetPwOverlay').textContent;
  if (!txt.includes('备份')) throw new Error('重置弹窗未说明旧备份的后果');
  click($('#resetPwSubmit'));
  if ($('#lockCapsule').textContent.indexOf('已解锁') < 0) throw new Error('未解锁');
});

step('旧加密模型的文案已清干净（DEK / 主钥 / 密文）', () => {
  const src = doc.body.innerHTML;
  ['DEK', '数据密钥', '主钥', '密钥库', '为密文', '同名密文'].forEach(w => {
    if (src.indexOf(w) >= 0) throw new Error('原型仍残留旧模型文案「' + w + '」');
  });
  // 设置 › 隐私锁 分类：原来的恢复码行已换成重置入口
  openSetPage('privacy');
  const card = $$('.set-card').find(c => c.textContent.indexOf('隐私锁') >= 0);
  if (!card) throw new Error('缺隐私锁设置卡片');
  if (card.textContent.indexOf('2026-09-20') >= 0) throw new Error('隐私锁卡片仍留恢复码生成时间');
  if (card.textContent.indexOf('重置') < 0) throw new Error('隐私锁卡片缺重置隐私密码入口');
});

step('回收站：从设置进入并恢复一条（7.4 修订）', () => {
  openSetPage('version');
  click($('#openTrash'));
  const before = $$('.trash-row').length;
  click($('[data-restore]'));
  if ($$('.trash-row').length !== before - 1) throw new Error('未移除');
});

step('设置：改档位 → 胶囊跟随', () => {
  openSetPage('privacy');
  click($('#timeoutSet .radio-opt[data-min="-1"]'));
  if (!$('#lockCapsule').textContent.includes('本次会话')) throw new Error('胶囊未跟随档位');
});

step('设置：关闭 Memo 门禁 → 锁定后 Memo 仍可见', () => {
  openSetPage('privacy');
  click($('#privacyToggle'));
  if ($('#privacyToggle').classList.contains('on')) throw new Error('开关未关闭');
  lock();
  click(navEl('memo'));
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

step('账户入口仍是全站唯一，且只走快捷菜单（2026-09-26 用户更正）', () => {
  click(navEl('recent'));
  // 功能栏与设置页都不应有第二个账户入口
  if ($$('.top-account').length !== 1) throw new Error('顶栏账户入口不是一个');
  if (navEl('settings') || navEl('trash')) throw new Error('功能栏又出现了设置 / 回收站入口');
  openAccountMenu();
  if (!$('.menu.open .menu-item[data-qm="settings"]')) throw new Error('快捷菜单缺「设置」');
  // 菜单是「快捷菜单」，不是把设置项铺进来：不应出现分类导航
  if ($('.menu.open #setNav')) throw new Error('快捷菜单里混进了完整的设置页');
  clickQuick('settings');
  if (!$('.pane-head h1').textContent.includes('设置')) throw new Error('未进入设置');
  if ($$('#setNav .set-nav-item').length !== 10) throw new Error('设置分类导航不是 10 项');
});

console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
console.log('=== 捕获的脚本错误 ===');
console.log(errs.length ? errs.join('\n') : '无');
window.close();
process.exit(fail ? 1 : 0);
