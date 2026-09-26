/* ============================================================
   Menote 页面框架（线框）回归验证脚本
   ------------------------------------------------------------
   用 jsdom 加载 menote-framework.html 并真实执行页面脚本，
   校验「分块 + 标注 + 翻页」这一层交互是否完好，捕获运行时错误。

   运行：
     npm install jsdom
     NODE_PATH=<node_modules 路径> node verify-framework.js

   注意：页面用「页名」定位，不用下标 —— 增删页面后不会假失败。

   覆盖：页面切换器 13 标签 / 逐页渲染不抛错 / 面板标题与标签一致 /
         区块名与说明文字齐全 / 导航顺序与首页项 / 待办独立视图 /
         Memo 去清单 / 录入框三模式与去加密 / 录入框行序（附加项在模式行之上）/
         主题（Claude 橙白双主题）/
         点块进块详情 / 嵌套块选内层 / 返回页面说明 / chip 反向跳转 /
         Esc 退出 / 键盘左右切页 / 切页清选中 / 块说明与网格两个开关
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const abs = 'F:/Git/MeNote/prototype/menote-framework.html';
const file = fs.existsSync(abs) ? abs : path.join(__dirname, 'menote-framework.html');
const html = fs.readFileSync(file, 'utf8');

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push('[jsdomError] ' + e.message));
vc.on('error', (...a) => errs.push('[console.error] ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const $$ = s => Array.from(doc.querySelectorAll(s));
const click = el => { if (!el) throw new Error('目标元素不存在'); el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); };
const key = k => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const tabName = () => $('.fw-tab.on').textContent.replace(/^\d+/, '').trim();
const inspTitle = () => ($('#insp h2') || $('#insp h3')) ? ($('#insp h2') || $('#insp h3')).textContent.trim() : '';
const tabNames = () => $$('.fw-tab').map(t => t.textContent.replace(/^\d+/, '').trim());
/* 按页名切页：页面增删或重新编号后脚本依然有效 */
const gotoPage = name => {
  const i = tabNames().indexOf(name);
  if (i < 0) throw new Error('找不到页面「' + name + '」，现有：' + tabNames().join(' / '));
  click($$('.fw-tab')[i]);
  return i;
};
const noteOf = id => {
  const el = $('#canvas [data-b="' + id + '"]');
  if (!el) throw new Error('缺区块 ' + id);
  return el.querySelector('.blk-note').textContent;
};
/* 点开块详情后取说明面板全文（含 .blk-note 里放不下的要点列表） */
const blockText = id => {
  const el = $('#canvas [data-b="' + id + '"]');
  if (!el) throw new Error('缺区块 ' + id);
  click(el);
  const box = $('#insp .insp-block');
  if (!box) throw new Error('未进入块详情：' + id);
  return box.textContent;
};

let pass = 0, fail = 0;
const step = (name, fn) => {
  try { if (fn() === false) throw new Error('断言失败'); console.log('  OK   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '  → ' + e.message); errs.push(name + ': ' + e.message); fail++; }
};

console.log('=== 页面框架验证 ===');

step('页面切换器渲染 13 个标签', () => {
  const n = $$('.fw-tab').length;
  if (n !== 13) throw new Error('实际 ' + n + ' 个：' + tabNames().join(' / '));
});

step('页面清单含新增的「首页」与「待办」（v2 Q1 / M02-03）', () => {
  const names = tabNames();
  ['首页', '待办', 'Memo', '功能栏', '设置'].forEach(n => {
    if (!names.includes(n)) throw new Error('缺页面「' + n + '」');
  });
});

step('默认停在「全局框架」', () => {
  if (tabName() !== '全局框架') throw new Error('默认页为 ' + tabName());
});

step('说明面板显示页面说明 + 区块清单', () => {
  if (!$('#insp .insp-page')) throw new Error('无页面说明');
  if (!$$('#insp .insp-chip').length) throw new Error('无区块清单');
});

step('逐页切换：全部页面渲染且不抛错（面板标题 === 标签名）', () => {
  const bad = [];
  const total = tabNames().length;
  for (let i = 0; i < total; i++) {
    const errBefore = errs.length;
    click($$('.fw-tab')[i]);
    const name = tabName();
    if (errs.length > errBefore) { bad.push(name + ' 抛错: ' + errs[errs.length - 1]); continue; }
    if (inspTitle() !== name) bad.push(name + ' 面板标题为「' + inspTitle() + '」（说明画布未刷新）');
    const n = $$('#canvas [data-b]').length;
    if (n < 2) bad.push(name + ' 区块数 ' + n);
    if (!$$('#insp .insp-chip').length) bad.push(name + ' 无区块清单');
  }
  if (bad.length) throw new Error(bad.join('；'));
});

step('每页区块都有名称与说明文字', () => {
  const bad = [];
  const total = tabNames().length;
  for (let i = 0; i < total; i++) {
    click($$('.fw-tab')[i]);
    const name = tabName();
    $$('#canvas .blk').forEach(b => {
      const nm = b.querySelector('.blk-name');
      const nt = b.querySelector('.blk-note');
      if (!nm || !nm.textContent.trim()) bad.push(name + '/' + b.dataset.b + ' 缺块名');
      if (!nt || !nt.textContent.trim()) bad.push(name + '/' + b.dataset.b + ' 缺说明');
    });
  }
  if (bad.length) throw new Error(bad.slice(0, 6).join('；'));
});

step('区块总数统计', () => {
  const all = new Set();
  const total = tabNames().length;
  for (let i = 0; i < total; i++) {
    click($$('.fw-tab')[i]);
    $$('#insp .insp-chip').forEach(c => all.add(c.dataset.b));
  }
  console.log('       （字典共 ' + all.size + ' 个区块）');
});

step('顶栏页：账户头像已移出（只剩 5 块）', () => {
  gotoPage('顶栏');
  if ($('#canvas [data-b="fnAccount"]')) throw new Error('顶栏仍存在账户块');
  const n = $$('#canvas .blk-strip > [data-b]').length;
  if (n !== 5) throw new Error('顶栏区块数 ' + n);
});

step('功能栏页：新建笔记 / 笔记本新建入口 / 底部账户与设置', () => {
  gotoPage('功能栏');
  ['newBtn', 'nbAdd', 'fnAccount'].forEach(id => {
    if (!$('#canvas [data-b="' + id + '"]')) throw new Error('缺区块 ' + id);
  });
  if (!noteOf('newBtn').includes('新建笔记')) throw new Error('新建按钮未直连笔记');
  if ($('#canvas [data-b="fnFoot"]')) throw new Error('底部仍有独立回收站 / 设置区块');
});

step('导航按 v2 Q1 重排：含首页与独立的待办项（不再是「待办并入 Memo」）', () => {
  gotoPage('功能栏');
  if (!$('#canvas [data-b="navHome"]')) throw new Error('导航缺「首页」项');
  const nav = blockText('navMain');
  ['首页', 'Memo', '待办', '最近编辑', '收藏'].forEach(x => {
    if (!nav.includes(x)) throw new Error('主导航描述缺「' + x + '」：' + nav);
  });
  if (!nav.includes('独立成项')) throw new Error('主导航未说明待办已独立：' + nav);
});
step('Memo 页：只剩时间轴 / 瀑布流，清单已移出（v2 Q1 / M06-10）', () => {
  gotoPage('Memo');
  const tabs = noteOf('memoMode');
  if (!tabs.includes('时间轴') || !tabs.includes('瀑布流')) throw new Error('缺时间轴/瀑布流：' + tabs);
  if (tabs.includes('清单并入')) throw new Error('仍写「清单并入 Memo」：' + tabs);
  if (!$('#canvas [data-b="memoAdd"]')) throw new Error('Memo 页缺「添加」按钮');
  ['taskList', 'kanban', 'taskFilters'].forEach(id => {
    if ($('#canvas [data-b="' + id + '"]')) throw new Error('Memo 页仍包含清单区块 ' + id);
  });
});

step('待办页：列表 / 看板 + 筛选 + 添加 + 门禁（v2 M07-05）', () => {
  gotoPage('待办');
  ['taskHead', 'taskAdd', 'taskFilters', 'taskList', 'kanban', 'gateState'].forEach(id => {
    if (!$('#canvas [data-b="' + id + '"]')) throw new Error('待办页缺区块 ' + id);
  });
  const f = noteOf('taskFilters');
  if (!f.includes('列表') || !f.includes('看板')) throw new Error('待办筛选未说明两种渲染：' + f);
});

step('首页页：概括预览 / 快捷方式 / 快速导航三类齐全（v2 M02-03）', () => {
  gotoPage('首页');
  ['homeStats', 'homeToday', 'homeRecent', 'homeActs', 'homeNav'].forEach(id => {
    if (!$('#canvas [data-b="' + id + '"]')) throw new Error('首页缺区块 ' + id);
  });
  if (!blockText('homeStats').includes('本地')) throw new Error('条目统计未说明本地计算');
});

step('快速录入框：模式为 Memo / 待办 / 笔记 三档', () => {
  gotoPage('功能栏');
  const s = noteOf('modeTabs');
  ['Memo', '待办', '笔记'].forEach(m => {
    if (!s.includes(m)) throw new Error('模式缺 ' + m + '：' + s);
  });
});

step('录入框不再提供加密选项（v2 M04-02）', () => {
  gotoPage('功能栏');
  const n = blockText('composerExtra');
  if (!n.includes('不提供加密选项')) throw new Error('未标注创建时不提供加密：' + n);
  if (/笔记：首行作标题 \/ 根目录 \/ 加密/.test(n)) throw new Error('笔记附加项仍列出「加密」：' + n);
});

step('模式附加项：锁定只占一排（26px），切换不推挤', () => {
  gotoPage('功能栏');
  const n = noteOf('composerExtra');
  if (!n.includes('锁定')) throw new Error('附加项未标注为锁定一排：' + n);
  if (!n.includes('一排')) throw new Error('附加项未标注排数：' + n);
  const style = $('#canvas [data-b="composerExtra"]').getAttribute('style') || '';
  if (!/height:\s*26px/.test(style)) throw new Error('附加项容器不是一排高度：' + style);
});

step('录入框顺序：输入区 → 附加项 → 模式行（2026-09-26 调整）', () => {
  gotoPage('功能栏');
  const all = $$('#canvas [data-b]').map(el => el.getAttribute('data-b'));
  const iInput = all.indexOf('composerInput');
  const iExtra = all.indexOf('composerExtra');
  const iTabs = all.indexOf('modeTabs');
  const iPub = all.indexOf('composerPublish');
  if ([iInput, iExtra, iTabs, iPub].some(i => i < 0)) {
    throw new Error('录入框区块有缺失：' + all.join(','));
  }
  const seq = [iInput, iExtra, iTabs, iPub];
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] < seq[i - 1]) {
      throw new Error('录入框顺序应为主要 → 附加项 → 模式行，实际 ' + all.slice(iInput, iPub + 1).join(' → '));
    }
  }
  const n = noteOf('composerExtra');
  if (!n.includes('之上')) throw new Error('附加项未标注位于模式选择之上：' + n);
});

step('录入框已压缩：取消独立发布行，发布按钮与模式选择同行', () => {
  gotoPage('功能栏');
  if ($('#canvas [data-b="composerFoot"]')) throw new Error('独立发布行仍在');
  const row = $('#canvas [data-b="modeTabs"]').parentElement;
  const pub = $('#canvas [data-b="composerPublish"]');
  if (!pub) throw new Error('缺发布按钮');
  if (pub.parentElement !== row) throw new Error('发布按钮未与模式选择同行');
  const order = Array.from(row.children).map(el => el.dataset.b);
  if (order.join('/') !== 'modeTabs/composerPublish') throw new Error('行内顺序不对：' + order.join('/'));
  if (!pub.textContent.includes('发布')) throw new Error('发布按钮文案不对');
});

step('设置页：含通用 › 启动视图 与 版本与回收站', () => {
  gotoPage('设置');
  if (!$('#canvas [data-b="startViewSet"]')) throw new Error('设置页无「通用 › 启动视图」');
  if (!$('#canvas [data-b="setTrash"]')) throw new Error('设置页无「版本与回收站」');
  if (!blockText('startViewSet').includes('不显示')) throw new Error('启动视图未说明首页项显隐规则');
  if (!blockText('startViewSet').includes('主题')) throw new Error('通用页未列入主题偏好');
});

step('主题：默认浅色，可切到深色并写回 data-theme（Claude 橙白双主题）', () => {
  const html = $('#canvas').ownerDocument.documentElement;
  if (html.getAttribute('data-theme') !== 'light') throw new Error('默认不是浅色：' + html.getAttribute('data-theme'));
  const btn = $('#swTheme');
  if (!btn) throw new Error('工具栏缺主题开关');
  if (!btn.textContent.includes('浅色')) throw new Error('主题开关文案未跟随：' + btn.textContent);
  click(btn);
  if (html.getAttribute('data-theme') !== 'dark') throw new Error('未切到深色');
  if (!btn.textContent.includes('深色')) throw new Error('深色下文案未更新：' + btn.textContent);
  click(btn);
  if (html.getAttribute('data-theme') !== 'light') throw new Error('未切回浅色');
});

step('主题令牌：浅色与深色两套变量都已定义', () => {
  const css = $$('style').map(s => s.textContent).join('\n');
  if (!/[^-]:root\{[\s\S]*?--bg:#faf9f5/.test(css)) throw new Error('缺浅色令牌（--bg:#faf9f5）');
  const dark = css.match(/\[data-theme="dark"\]\{[\s\S]*?\}/);
  if (!dark) throw new Error('缺深色令牌块');
  ['--bg', '--text', '--wf-sel'].forEach(v => {
    if (!dark[0].includes(v + ':')) throw new Error('深色块缺变量 ' + v);
  });
});

step('笔记本正文：加密状态条与尺寸提示条已并入状态栏', () => {
  gotoPage('笔记本');
  ['secBar', 'sizeWarn'].forEach(id => {
    if ($('#canvas [data-b="' + id + '"]')) throw new Error('仍存在独立块 ' + id);
  });
  const st = $('#canvas [data-b="docStatus"]');
  if (!st) throw new Error('缺正文状态栏');
  if (!st.textContent.includes('唯一一条')) throw new Error('状态栏未标注为合并后唯一一条');
});

step('点击线框块 → 说明面板切到块详情', () => {
  gotoPage('顶栏');
  click($('#canvas [data-b="capsule"]'));
  if (!$('#insp .insp-block')) throw new Error('未进入块详情');
  if (!inspTitle().includes('隐私锁胶囊')) throw new Error('块名不对：' + inspTitle());
  if (!$$('#insp .insp-block li').length) throw new Error('无要点列表');
  if (!$('.blk.sel')) throw new Error('块未高亮');
});

step('嵌套块：点内层选中内层', () => {
  gotoPage('全局框架');
  click($('#canvas [data-b="fnbar"]'));
  if (!inspTitle().includes('功能栏')) throw new Error('选中了 ' + inspTitle());
});

step('返回页面说明', () => {
  click($('#backPage'));
  if (!$('#insp .insp-page')) throw new Error('未返回');
  if ($('.blk.sel')) throw new Error('高亮未清除');
});

step('点说明面板的区块 chip → 块详情', () => {
  gotoPage('全局框架');
  click($$('#insp .insp-chip').find(c => c.dataset.b === 'work'));
  if (!inspTitle().includes('主操作区')) throw new Error('未跳转');
});

step('Esc 退出块详情', () => {
  key('Escape');
  if (!$('#insp .insp-page')) throw new Error('未退出');
});

step('键盘左右切页', () => {
  gotoPage('全局框架');
  key('ArrowRight');
  if (tabName() !== '顶栏') throw new Error('右切到 ' + tabName());
  key('ArrowLeft');
  if (tabName() !== '全局框架') throw new Error('左切到 ' + tabName());
});

step('切页时清除块选中', () => {
  click($('#canvas [data-b]'));
  key('ArrowRight');
  if ($('.blk.sel')) throw new Error('选中未清除');
});

step('「块说明」开关切换块内说明文字', () => {
  const sw = $('#swNote');
  if (!sw.classList.contains('on')) throw new Error('初始应为开');
  click(sw);
  if (sw.classList.contains('on')) throw new Error('未关闭');
  if (!$('#canvas').classList.contains('nonote')) throw new Error('未应用 nonote');
  click(sw);
  if ($('#canvas').classList.contains('nonote')) throw new Error('未恢复');
});

step('「网格」开关切换', () => {
  const sw = $('#swGrid');
  const before = $('#canvas').classList.contains('grid');
  click(sw);
  if ($('#canvas').classList.contains('grid') === before) throw new Error('未切换');
  click(sw);
  if ($('#canvas').classList.contains('grid') !== before) throw new Error('未恢复');
});

console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
console.log('=== 捕获的脚本错误 ===');
console.log(errs.length ? errs.join('\n') : '无');
window.close();
process.exit(fail ? 1 : 0);
