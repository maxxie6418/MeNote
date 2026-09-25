/* ============================================================
   Menote 页面框架（线框）回归验证脚本
   ------------------------------------------------------------
   用 jsdom 加载 menote-framework.html 并真实执行页面脚本，
   校验「分块 + 标注 + 翻页」这一层交互是否完好，捕获运行时错误。

   运行：
     npm install jsdom
     NODE_PATH=<node_modules 路径> node verify-framework.js

   覆盖：页面切换器 11 标签 / 逐页渲染不抛错 / 面板标题与标签一致 /
         区块名与说明文字齐全 / 点块进块详情 / 嵌套块选内层 /
         返回页面说明 / chip 反向跳转 / Esc 退出 /
         键盘左右切页 / 切页清选中 / 块说明与网格两个开关
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

let pass = 0, fail = 0;
const step = (name, fn) => {
  try { if (fn() === false) throw new Error('断言失败'); console.log('  OK   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '  → ' + e.message); errs.push(name + ': ' + e.message); fail++; }
};

console.log('=== 页面框架验证 ===');

step('页面切换器渲染 11 个标签', () => {
  const n = $$('.fw-tab').length;
  if (n !== 11) throw new Error('实际 ' + n + ' 个');
});

step('默认停在「全局框架」', () => {
  if (tabName() !== '全局框架') throw new Error('默认页为 ' + tabName());
});

step('说明面板显示页面说明 + 区块清单', () => {
  if (!$('#insp .insp-page')) throw new Error('无页面说明');
  if (!$$('#insp .insp-chip').length) throw new Error('无区块清单');
});

step('逐页切换：11 页全部渲染且不抛错', () => {
  const bad = [];
  for (let i = 0; i < 11; i++) {
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
  for (let i = 0; i < 11; i++) {
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
  for (let i = 0; i < 11; i++) {
    click($$('.fw-tab')[i]);
    $$('#insp .insp-chip').forEach(c => all.add(c.dataset.b));
  }
  console.log('       （字典共 ' + all.size + ' 个区块）');
});

step('点击线框块 → 说明面板切到块详情', () => {
  click($$('.fw-tab')[1]);                       // 顶栏页
  click($('#canvas [data-b="capsule"]'));
  if (!$('#insp .insp-block')) throw new Error('未进入块详情');
  if (!inspTitle().includes('隐私锁胶囊')) throw new Error('块名不对：' + inspTitle());
  if (!$$('#insp .insp-block li').length) throw new Error('无要点列表');
  if (!$('.blk.sel')) throw new Error('块未高亮');
});

step('嵌套块：点内层选中内层', () => {
  click($$('.fw-tab')[0]);                       // 全局框架
  click($('#canvas [data-b="fnbar"]'));
  if (!inspTitle().includes('功能栏')) throw new Error('选中了 ' + inspTitle());
});

step('返回页面说明', () => {
  click($('#backPage'));
  if (!$('#insp .insp-page')) throw new Error('未返回');
  if ($('.blk.sel')) throw new Error('高亮未清除');
});

step('点说明面板的区块 chip → 块详情', () => {
  click($$('.fw-tab')[0]);
  click($$('#insp .insp-chip').find(c => c.dataset.b === 'work'));
  if (!inspTitle().includes('主操作区')) throw new Error('未跳转');
});

step('Esc 退出块详情', () => {
  key('Escape');
  if (!$('#insp .insp-page')) throw new Error('未退出');
});

step('键盘左右切页', () => {
  click($$('.fw-tab')[0]);
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
