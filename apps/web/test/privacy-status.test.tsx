// @vitest-environment jsdom
/**
 * 正文状态栏的隐私部分（M3-10；《隐私锁设计》§9.2-④）。
 *
 * 从 `ui.test.tsx` 分出来：那个文件已经到了行数预算，而这两件事（档位行 + 30 秒提示）
 * 与"大小/保存状态"是两码事，单独一份更好找。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocStatusBar } from "../src/features/notes/ui/DocStatusBar";

afterEach(cleanup);

const SNAPSHOT = { bytes: 0, sizeLabel: "0.0 MB / 2 MB", sizeLevel: "ok", saveState: "synced" } as const;

describe("状态栏的隐私锁那一句", () => {
  it("常驻显示档位，并带「立即锁定」出口", async () => {
    const user = userEvent.setup();
    const onLock = vi.fn();
    render(
      <DocStatusBar
        snapshot={SNAPSHOT}
        privacyLine={{
          text: "加密空间 · 已解锁 · 本次会话",
          expiresAt: null,
          onLock,
          lockLabel: "立即锁定",
        }}
      />,
    );

    expect(screen.getByText("加密空间 · 已解锁 · 本次会话")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "立即锁定" }));
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("设备长期档用「锁定此设备」这个说法", () => {
    render(
      <DocStatusBar
        snapshot={SNAPSHOT}
        privacyLine={{ text: "本设备始终解锁", expiresAt: null, onLock: vi.fn(), lockLabel: "锁定此设备" }}
      />,
    );
    expect(screen.getByRole("button", { name: "锁定此设备" })).toBeTruthy();
  });

  it("N 分钟档剩 30 秒内才提示「会先保存」，且文案不含加密字样", () => {
    const now = 1_700_000_000_000;
    const { rerender } = render(
      <DocStatusBar
        snapshot={SNAPSHOT}
        privacyLine={{ text: "隐私锁 · 已解锁", expiresAt: now + 31_000 }}
        now={now}
      />,
    );
    expect(screen.queryByText(/即将自动锁定/)).toBeNull();

    rerender(
      <DocStatusBar
        snapshot={SNAPSHOT}
        privacyLine={{ text: "隐私锁 · 已解锁", expiresAt: now + 12_000 }}
        now={now}
      />,
    );
    expect(screen.getByText("即将自动锁定，未保存的内容会先保存")).toBeTruthy();
  });

  it("单篇加密未解密：只显示「已加密」，不显示实时大小", () => {
    render(
      <DocStatusBar
        snapshot={{ ...SNAPSHOT, sizeLabel: "3.2 KB" }}
        encryption={{ encrypted: true, unlocked: false }}
      />,
    );
    expect(screen.getByText("已加密")).toBeTruthy();
    expect(screen.queryByText("3.2 KB")).toBeNull();
  });

  it("单篇加密已解密：标明本次已解密，并恢复显示大小", () => {
    render(
      <DocStatusBar
        snapshot={{ ...SNAPSHOT, sizeLabel: "3.2 KB" }}
        encryption={{ encrypted: true, unlocked: true }}
      />,
    );
    expect(screen.getByText("已加密 · 本次已解锁")).toBeTruthy();
    expect(screen.getByText("3.2 KB")).toBeTruthy();
  });
});
