// @vitest-environment jsdom
/**
 * 添加内容窗口（`app/fnbar/AddEntryDialog.tsx`）——Memo / 待办视图「添加」的新落点
 * （用户 2026-09-29：点添加**不再跳左侧录入框**，改弹窗 + 明确反馈）。
 *
 * 钉住四条不能退的：
 * 1. **一个结构、两种 kind**：标题随 kind 变；待办带截止 + 优先级、Memo 不带（复用 `ModeExtras`）；
 * 2. **打开即聚焦输入区**（可直接打字；`Modal` 自动聚焦够不到 `<textarea>`）；
 * 3. **发布链**：点发布 / Ctrl+Enter → 调 `onPublish*` → `onClose`（关窗，反馈由发布回调的 toast + 列表刷新承载）；
 * 4. **空内容禁用且原因可见**（`DESIGN.md` §6.1），区域**只有一个主操作**（§5.1）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddEntryDialog, type AddEntryKind } from "../src/app/fnbar/AddEntryDialog";
import { assertSinglePrimaryAction } from "./helpers/design";

afterEach(cleanup);

function setup(kind: AddEntryKind = "memo") {
  const onPublishMemo = vi.fn();
  const onPublishTask = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <AddEntryDialog
      open
      kind={kind}
      onClose={onClose}
      onPublishMemo={onPublishMemo}
      onPublishTask={onPublishTask}
    />,
  );
  return { ...view, onPublishMemo, onPublishTask, onClose };
}

describe("结构：一个窗口、两种 kind", () => {
  it("memo：标题与输入区、字段行都在；只有「发布」一个主操作", () => {
    const { container } = setup("memo");

    expect(screen.getByRole("dialog", { name: "添加 Memo" })).toBeTruthy();
    expect(screen.getByLabelText("添加 Memo的内容")).toBeTruthy();
    expect(container.querySelector(".addentry__extras")).not.toBeNull();
    // 区域最多一个主操作（DESIGN.md §5.1）：发布=主，取消=次
    expect(assertSinglePrimaryAction(container, { min: 1 })).toBe(1);
  });

  it("task：带截止日期与优先级三段（与录入框「待办」档一致）", () => {
    setup("task");

    expect(screen.getByRole("dialog", { name: "添加待办" })).toBeTruthy();
    expect(screen.getByLabelText("截止日期")).toBeTruthy();
    const priority = screen.getByRole("group", { name: "优先级" });
    expect(priority).toBeTruthy();
    // 默认优先级「中」被选中
    expect(screen.getByRole("button", { name: "中" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("memo 档**没有**截止 / 优先级（字段随 kind 换）", () => {
    setup("memo");
    expect(screen.queryByLabelText("截止日期")).toBeNull();
    expect(screen.queryByRole("group", { name: "优先级" })).toBeNull();
  });

  it("打开时焦点落在输入区（可直接打字）", () => {
    setup("memo");
    const textarea = screen.getByLabelText("添加 Memo的内容") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
  });
});

describe("发布链", () => {
  it("空内容时「发布」禁用且原因可见；写了才启用", async () => {
    const user = userEvent.setup();
    setup("memo");

    const publish = screen.getByRole("button", { name: "发布" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    // 禁用原因不得只置灰（DESIGN.md §6.1：悬停提示要说明为何禁用）
    expect(publish.getAttribute("title")).toBe("先写点内容再发布");

    await user.type(screen.getByLabelText("添加 Memo的内容"), "写点什么");
    expect(publish.disabled).toBe(false);
    expect(publish.getAttribute("title")).toBe("Ctrl+Enter 发布");
  });

  it("点「发布」→ 调 onPublishMemo + 关窗（反馈由发布回调承载）", async () => {
    const user = userEvent.setup();
    const { onPublishMemo, onClose } = setup("memo");

    await user.type(screen.getByLabelText("添加 Memo的内容"), "今天开会");
    await user.click(screen.getByRole("button", { name: "发布" }));

    expect(onPublishMemo).toHaveBeenCalledTimes(1);
    expect(onPublishMemo).toHaveBeenCalledWith("今天开会", { asTask: false });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Enter 发布（DESIGN.md §6.3 统一提交手势）", async () => {
    const user = userEvent.setup();
    const { onPublishMemo, onClose } = setup("memo");

    await user.type(screen.getByLabelText("添加 Memo的内容"), "快捷发布");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onPublishMemo).toHaveBeenCalledWith("快捷发布", { asTask: false });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Cancel 走 onClose，不发布", async () => {
    const user = userEvent.setup();
    const { onPublishMemo, onClose } = setup("memo");

    await user.type(screen.getByLabelText("添加 Memo的内容"), "不发了");
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(onPublishMemo).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc 关窗（Modal 统一退出手势，DESIGN.md §6.4-5）", async () => {
    const { onClose } = setup("memo");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("字段语义", () => {
  it("memo：写了 `- [ ]` 才能设为清单，点了发布带 asTask=true", async () => {
    const user = userEvent.setup();
    const { onPublishMemo } = setup("memo");

    const textarea = screen.getByLabelText("添加 Memo的内容");
    // `user.type` 会把 `[` 当特殊键，直接赋值（同 `fnbar.test` 的做法）
    fireEvent.change(textarea, { target: { value: "- [ ] 打扫" } });
    await user.click(screen.getByRole("button", { name: /设为清单/ }));
    await user.click(screen.getByRole("button", { name: "发布" }));

    expect(onPublishMemo).toHaveBeenCalledWith("- [ ] 打扫", { asTask: true });
  });

  it("task：截止与优先级一路带到 onPublishTask（截止可空）", async () => {
    const user = userEvent.setup();
    const { onPublishTask } = setup("task");

    await user.type(screen.getByLabelText("添加待办的内容"), "交房租");
    fireEvent.change(screen.getByLabelText("截止日期"), { target: { value: "2026-10-01" } });
    await user.click(screen.getByRole("button", { name: "高" }));
    await user.click(screen.getByRole("button", { name: "发布" }));

    expect(onPublishTask).toHaveBeenCalledWith("交房租", { due: "2026-10-01", priority: "high" });
    // 待办档不走 memo 发布
  });

  it("task：不填截止 → due=null", async () => {
    const user = userEvent.setup();
    const { onPublishTask } = setup("task");

    await user.type(screen.getByLabelText("添加待办的内容"), "不设截止");
    await user.click(screen.getByRole("button", { name: "发布" }));

    expect(onPublishTask).toHaveBeenCalledWith("不设截止", { due: null, priority: "medium" });
  });
});

describe("状态复位", () => {
  it("关窗即清空字段：不留上一次没发出去的内容", async () => {
    const user = userEvent.setup();
    setup("memo");
    const textarea = screen.getByLabelText("添加 Memo的内容") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "没发出去的内容" } });
    expect(textarea.value).toBe("没发出去的内容");

    // 关窗统一走 close()：**先清空**再交回调用方——所以清空发生在关闭动作里
    // （模态遮罩挡着，必须关了才能再点「添加」），下次打开一定是干净输入区。
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect((screen.getByLabelText("添加 Memo的内容") as HTMLTextAreaElement).value).toBe("");
  });
});
