/**
 * 版本号一致性守卫（AGENTS.md「版本号规范」）。
 *
 * 规则原文：`package.json` 的 `version` 是**唯一当前版本**，`CHANGELOG.md` 条目与之一致。
 * 这条一直靠人工维持——改了代码忘了记 CHANGELOG、或记了 CHANGELOG 忘了改 version，都不会有人拦。
 * 这里把两个方向都盯住，顺带守住 CHANGELOG 的排版约定（新条目在最上方、日期用小标题）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const pkg = JSON.parse(read("../../../package.json")) as { version: string };
const changelog = read("../../../CHANGELOG.md");

/** 取最新日期小标题（`## YYYY-MM-DD`）及其下面的条目 */
function newestSection(text: string): { date: string; body: string } {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^## \d{4}-\d{2}-\d{2}$/.test(line));
  if (start === -1) return { date: "", body: "" };
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return {
    date: lines[start]?.replace("## ", "") ?? "",
    body: (end === -1 ? rest : rest.slice(0, end)).join("\n"),
  };
}

describe("版本号与 CHANGELOG 一致性", () => {
  it("package.json 的 version 是 v主.次.修 格式", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("CHANGELOG 最新日期小节里有当前版本的条目", () => {
    const { date, body } = newestSection(changelog);
    expect(date, "CHANGELOG 顶部必须有 `## YYYY-MM-DD` 日期小标题").not.toBe("");
    expect(
      body.includes(`v${pkg.version}`),
      `CHANGELOG 最新的 ${date} 小节里没有 v${pkg.version} 的条目——改完代码要按 AGENTS.md 追加条目，` +
        "纯文档改动则沿用当前版本号",
    ).toBe(true);
  });

  it("CHANGELOG 顶部没有游离在日期小节之外的条目（格式约定）", () => {
    const lines = changelog.split("\n");
    const firstDate = lines.findIndex((line) => /^## \d{4}-\d{2}-\d{2}$/.test(line));
    const strayBullets = lines
      .slice(0, firstDate)
      .filter((line) => /^- v?\d/.test(line.trim()));
    expect(strayBullets, "条目必须写在日期小标题之下").toEqual([]);
  });

  it("条目里的版本号不超过 package.json 的当前版本（防止超前记账）", () => {
    const versions = [...changelog.matchAll(/^- v(\d+)\.(\d+)\.(\d+)/gm)].map((match) => ({
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
    }));
    expect(versions.length).toBeGreaterThan(0);

    const [curMajor, curMinor, curPatch] = pkg.version.split(".").map(Number);
    for (const version of versions) {
      const older =
        version.major < curMajor! ||
        (version.major === curMajor &&
          (version.minor < curMinor! ||
            (version.minor === curMinor && version.patch <= curPatch!)));
      expect(
        older,
        `CHANGELOG 出现 v${version.major}.${version.minor}.${version.patch}，` +
          `高于 package.json 的 v${pkg.version}——版本号只能落后或持平，不能超前`,
      ).toBe(true);
    }
  });
});
