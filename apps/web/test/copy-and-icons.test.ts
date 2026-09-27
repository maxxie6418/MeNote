/**
 * 文案红线（禁止项 #9）与 emoji 作图标（禁止项 #10）的守卫。
 *
 * 实况：这两条**当前都合规**（0 处）——但"扫不到"的风险很实在，所以先给扫描器写自证，
 * 再断言真源码。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findEmoji, findForbiddenCopy, stripComments } from "./helpers/copy-and-icons";

/** Vite 的 raw glob：不需要 Node 文件系统 API（本包 tsconfig 只 shim 了少数几个） */
const sources = import.meta.glob("../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("文案红线（DESIGN.md 禁止项 #9）", () => {
  it("源码里不出现「已加密存储」这类与服务端明文模型不符的表述", () => {
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap(([path, source]) =>
      findForbiddenCopy(stripComments(source)).map((phrase) => `${path}: ${phrase}`),
    );
    expect(offenders, `文案红线命中：${offenders.join("、")}`).toEqual([]);
  });

  it("自证：禁语抓得到，正常表述不误报", () => {
    expect(findForbiddenCopy("这条已加密存储了")).toEqual(["已加密存储"]);
    expect(findForbiddenCopy("加密空间的正文解锁后可读")).toEqual([]);
    // 「已加密」本身是允许的（标题旁的锁标识就该这么说）
    expect(findForbiddenCopy("已加密")).toEqual([]);
  });
});

describe("图标只能用 sprite（DESIGN.md 禁止项 #10）", () => {
  it("源码里没有 emoji（不含注释里的举例）", () => {
    const offenders = Object.entries(sources).flatMap(([path, source]) =>
      findEmoji(stripComments(source)).map((glyph) => `${path}: ${glyph}`),
    );
    expect(offenders, `emoji 命中：${offenders.join("、")}`).toEqual([]);
  });

  it("自证：emoji 抓得到，`✓`/`×` 这类排版符号不误报", () => {
    expect(findEmoji("好了 ✅")).toContain("✅");
    expect(findEmoji("标一下 ⚠️")).toContain("⚠️");
    // 不是 emoji：勾号与乘号是排版符号（本程用它做过 chip 的删除按钮与表格勾选）
    expect(findEmoji("✓ × ⋮⋮")).toEqual([]);
  });

  it("没有引入图标库（依赖里只有功能库）", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const iconLibs = deps.filter((name) =>
      /(lucide|heroicons|feather|font-?awesome|material-icons|remixicon|bootstrap-icons|iconify|react-icons)/i.test(
        name,
      ),
    );
    expect(iconLibs, `引入了图标库：${iconLibs.join("、")}`).toEqual([]);
  });
});
