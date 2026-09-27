/**
 * 版本历史模型（M4-11；《M4 界面稿》§四）。
 *
 * 用例名对着界面稿的可验收条目写：中文原因映射（**不回落英文**）、行文案、
 * 行级 diff（含大文本退化）、恢复确认框三段必须写全。
 */
import { describe, expect, it } from "vitest";
import { VERSION_REASON_LABELS, versionReasonLabel, type VersionMeta } from "@menote/shared";
import {
  DIFF_MAX_LINES,
  diffPrefix,
  diffSummary,
  lineDiff,
  restoreConfirmText,
  versionRows,
  versionSizeLabel,
  versionTimeLabel,
} from "../src/features/versions/model";

function version(overrides: Partial<VersionMeta> = {}): VersionMeta {
  return {
    id: "v1",
    rev: 1,
    reason: "autosave_idle",
    label: null,
    keep: 0,
    codec: "gzip",
    size_bytes: 1024,
    content_hash: "h",
    title: "标题",
    created_at: Date.UTC(2026, 8, 27, 12, 3),
    ...overrides,
  };
}

describe("原因的中文映射", () => {
  it("与界面稿 §4.3 逐条一致（界面与日志用同一份）", () => {
    expect(VERSION_REASON_LABELS).toEqual({
      autosave_idle: "停止编辑后自动保存",
      session: "新会话首次编辑",
      manual: "手动保存",
      pre_restore: "恢复前",
      pre_conflict: "冲突前",
      pre_mcp: "AI 修改前",
      pre_convert: "表格降级前",
    });
  });

  it("未知 reason **不回落英文**，给中性中文", () => {
    expect(versionReasonLabel("pre_convert")).toBe("表格降级前");
    expect(versionReasonLabel("future_reason")).toBe("其他改动");
    expect(versionReasonLabel("future_reason")).not.toContain("future");
  });
});

describe("行的文案", () => {
  it("时间：今年省年份，跨年带年份", () => {
    // 用**本地时间**构造期望：`toLocaleString` 一类的展示本来就按本机时区，写死 UTC 会随 TZ 变红
    const local = (year: number) => new Date(year, 8, 27, 12, 3).getTime();
    const now = new Date(2026, 9, 1, 0, 0).getTime();
    expect(versionTimeLabel(local(2026), now)).toBe("09-27 12:03");
    expect(versionTimeLabel(local(2025), now)).toBe("2025-09-27 12:03");
  });

  it("大小：B / KB / MB 三档", () => {
    expect(versionSizeLabel(512)).toBe("512 B");
    expect(versionSizeLabel(2048)).toBe("2.0 KB");
    expect(versionSizeLabel(2 * 1_048_576)).toBe("2.00 MB");
  });

  it("版本列表 → 展示行（保留标记、备注、中文原因）", () => {
    const rows = versionRows(
      [
        version({ id: "a", reason: "manual", keep: 1, label: "发布前" }),
        version({ id: "b", reason: "pre_mcp", keep: 0 }),
      ],
      Date.UTC(2026, 8, 27, 13, 0),
    );

    expect(rows[0]).toMatchObject({
      id: "a",
      reasonLabel: "手动保存",
      keep: true,
      label: "发布前",
      sizeLabel: "1.0 KB",
    });
    expect(rows[1]).toMatchObject({ reasonLabel: "AI 修改前", keep: false, label: null });
  });
});

describe("行级 diff", () => {
  it("只改一行时：旧行标 -、新行标 +，其余保持", () => {
    const result = lineDiff("第一行\n第二行\n第三行", "第一行\n改过的\n第三行");

    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(diffSummary(result)).toBe("新增 1 行 · 删除 1 行");

    const kinds = result.lines.map((line) => `${diffPrefix(line.kind)}${line.text}`);
    expect(kinds).toContain(" 第一行");
    expect(kinds).toContain("-第二行");
    expect(kinds).toContain("+改过的");
  });

  it("内容一致时报告一致", () => {
    const result = lineDiff("同样\n内容", "同样\n内容");
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(diffSummary(result)).toBe("两版内容一致");
  });

  it("新增整段：只有 + 行", () => {
    const result = lineDiff("第一行", "第一行\n第二行\n第三行");
    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
  });

  it("前缀文字与行号都在（颜色不单独表意）", () => {
    const result = lineDiff("a", "b");
    const removed = result.lines.find((line) => line.kind === "remove");
    const added = result.lines.find((line) => line.kind === "add");
    expect(removed?.leftNumber).toBe(1);
    expect(added?.rightNumber).toBe(1);
  });

  it("超大文本退化成整块替换（宁可粗一点，也不要在浏览器里卡住）", () => {
    const big = Array.from({ length: DIFF_MAX_LINES + 5 }, (_, index) => `行 ${index}`).join("\n");
    const result = lineDiff(big, "只有一行");

    expect(result.added).toBe(1);
    expect(result.removed).toBe(DIFF_MAX_LINES + 5);
  });
});

describe("恢复确认框", () => {
  it("三段必须写全：影响对象 / 当前稿会先自动封存 / 可恢复性", () => {
    const row = versionRows(
      [version({ reason: "manual", created_at: new Date(2026, 8, 27, 12, 3).getTime() })],
      new Date(2026, 8, 27, 13, 0).getTime(),
    )[0]!;
    const text = restoreConfirmText(row);

    expect(text.title).toBe("恢复此版本");
    expect(text.body[0]).toContain("09-27 12:03");
    expect(text.body[0]).toContain("手动保存");
    // 第 2 段：这句必须在确认框里可见（不能只写"确定要恢复吗"）
    expect(text.body[1]).toContain("当前稿会先自动封存");
    expect(text.body[1]).toContain("可以再撤回");
    // 第 3 段：可恢复性 + 详情（改动没被丢弃）
    expect(text.body[2]).toContain("版本表不动");
    expect(text.body[2]).toContain("已经变成一个版本");
  });
});
