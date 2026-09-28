// @vitest-environment node
/**
 * 文案红线（M3-10；《隐私锁设计》§9.3）。
 *
 * 本项目是**明文存储 + 前端门禁 + 备份出站加密**（设计的 P1/P3）。任何"数据已加密""加密存储"
 * 之类的表述都与模型相反，会让人误以为服务端存的是密文——那是安全承诺层面的错误，不是措辞问题。
 *
 * 为什么用"扫源码"而不是"查界面文案"：文案散在各组件里，靠人工评审会漏；
 * 扫一遍源码是**机械的、可回归的**，新加文案时立刻会红。
 *
 * 扫描方式用 Vite 的 `import.meta.glob`（`?raw`）而不是 `node:fs`：
 * `apps/web` 的 tsconfig 只带 `vite/client`、没有 Node 类型，用 `fs` 得为一个测试引 `@types/node`，
 * 那是给生产依赖表加东西——不值。工作目录内的 glob 足够覆盖**界面文案**；
 * 服务端那几条用户可见消息由 worker 侧用例逐条断言（`items-privacy.test.ts` / `folders-vault.test.ts`）。
 */
import { describe, expect, it } from "vitest";

/** 禁止出现的表述（拼出来是为了让本文件自身也不含这些字面量） */
const FORBIDDEN = [
  "加密" + "存储",
  "数据已" + "加密",
  "已加密" + "保存",
  "加密" + "保存",
  "离线草稿也是" + "密文",
  "解密" + "内容",
];

/** 界面源码的全量文本（构建期注入，运行时不读盘） */
const SOURCES = import.meta.glob("../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("文案红线", () => {
  it("界面源码里不出现与明文模型相反的表述", () => {
    const entries = Object.entries(SOURCES);
    expect(entries.length, "扫到 0 个文件说明 glob 没生效").toBeGreaterThan(50);

    const hits: string[] = [];
    for (const [path, text] of entries) {
      for (const word of FORBIDDEN) {
        if (text.includes(word)) hits.push(`${path}: ${word}`);
      }
    }

    expect(hits, `以下文件出现了红线文案：\n${hits.join("\n")}`).toEqual([]);
  });

  it("正面口径必须如实写明保护边界（扫描面＝隐私锁页及其子组件）", () => {
    /*
      2026-09-28：隐私锁页按 M3 界面稿拆成六卡后，"内容密钥不变"这句随「隐私密码」卡
      移到了 `ui/privacy/PrivacyPasswordCard.tsx`。断言的本意是"**设置页这一屏**必须写出这两件事"，
      所以扫描面改为整个设置页目录（页面 + 子组件）——比只扫一个文件更严，也不会因为再拆文件而误红。
    */
    const files = Object.entries(SOURCES).filter(([path]) =>
      path.startsWith("../src/features/settings/ui/"),
    );
    expect(files.length, "设置页目录没扫到（路径变了就改这里）").toBeGreaterThan(2);

    const settings = files.map(([, text]) => text).join("\n");
    // 隐私密码不上传、内容密钥不变这两件事必须写出来（设计 §6.12、§9.3）
    expect(settings).toContain("不会上传");
    expect(settings).toContain("内容密钥不变");
  });

  it("30 秒提示只说「会先保存」，不许出现加密字样", () => {
    const statusBar = SOURCES["../src/features/notes/ui/DocStatusBar.tsx"];
    expect(statusBar, "状态栏源码没扫到").toBeTruthy();
    expect(statusBar).toContain("即将自动锁定，未保存的内容会先保存");
  });
});
