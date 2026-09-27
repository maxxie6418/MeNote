// @vitest-environment jsdom
/**
 * 标签格 chip 编辑（M4-9 补；界面稿 §2.3「标签」类型 + §2.4 的键盘底线）。
 *
 * 这一条此前是"标签列暂用逗号分隔输入"的退化项；现在改成 chip 编辑，
 * 但**存储格式不变**（仍写回逗号分隔的字符串）——所以用例一开始就钉住"写回的字符串长什么样"。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagChipsEditor } from "../src/features/tables/ui/TagChipsEditor";
import { joinTags, splitTags } from "../src/features/tables/model";

afterEach(cleanup);

function renderEditor(value = "工作, 重要") {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <TagChipsEditor value={value} ariaLabel="标签（编辑）" onCommit={onCommit} onCancel={onCancel} />,
  );
  return { onCommit, onCancel };
}

describe("标签的读写纯函数", () => {
  it("切分：去空白、去重、丢空串", () => {
    expect(splitTags(" 工作 , 重要 ,, 工作 ")).toEqual(["工作", "重要"]);
    expect(splitTags("")).toEqual([]);
  });

  it("拼接是幂等的（join(split(x)) === x 的规范化形式）", () => {
    expect(joinTags(["工作", "重要"])).toBe("工作,重要");
    expect(joinTags(["工作", " 工作 ", "重要"])).toBe("工作,重要");
    const once = joinTags([" a ", "b"]);
    expect(joinTags(splitTags(once))).toBe(once);
  });
});

describe("chip 编辑", () => {
  it("已有的标签显示成 chip，输入框初始为空", () => {
    renderEditor();
    expect(screen.getByText("工作")).toBeTruthy();
    expect(screen.getByText("重要")).toBeTruthy();
    expect((screen.getByLabelText("标签（编辑）") as HTMLInputElement).value).toBe("");
  });

  it("回车把输入变成一个 chip，失焦后写回逗号分隔的字符串", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderEditor();

    await user.type(screen.getByLabelText("标签（编辑）"), "新标签{Enter}");
    expect(screen.getByText("新标签")).toBeTruthy();
    // 还没失焦 → 尚未提交
    expect(onCommit).not.toHaveBeenCalled();

    await user.tab();
    expect(onCommit).toHaveBeenCalledWith("工作,重要,新标签");
  });

  it("**逗号即分隔符**：输入「甲,乙」直接落成两个 chip（中文逗号也认）", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderEditor("");

    const input = screen.getByLabelText("标签（编辑）") as HTMLInputElement;
    await user.type(input, "甲,乙，丙");
    // 逗号之前的内容立刻成为 chip；**最后一段还在输入框里**（没敲回车就不算数）
    expect(screen.getByText("甲")).toBeTruthy();
    expect(screen.getByText("乙")).toBeTruthy();
    expect(input.value).toBe("丙");

    await user.tab();
    expect(onCommit).toHaveBeenCalledWith("甲,乙,丙");
  });

  it("每个 chip 都能单独删掉（可点，不是悬停才出现）", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderEditor();

    await user.click(screen.getByRole("button", { name: "移除标签 工作" }));
    expect(screen.queryByText("工作")).toBeNull();
    expect(screen.getByText("重要")).toBeTruthy();

    await user.tab();
    expect(onCommit).toHaveBeenCalledWith("重要");
  });

  it("输入框为空时按退格删掉最后一个 chip（键盘就能全流程）", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderEditor();

    const input = screen.getByLabelText("标签（编辑）");
    await user.click(input);
    await user.keyboard("{Backspace}");
    expect(screen.queryByText("重要")).toBeNull();

    await user.tab();
    expect(onCommit).toHaveBeenCalledWith("工作");
  });

  it("打字打到一半就点别处：草稿也算上，不丢内容", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderEditor("");

    await user.type(screen.getByLabelText("标签（编辑）"), "草稿");
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith("草稿");
  });

  it("Escape 取消整格编辑（不提交）", async () => {
    const user = userEvent.setup();
    const { onCommit, onCancel } = renderEditor();

    await user.click(screen.getByLabelText("标签（编辑）"));
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("重复输入同一个标签不会出现两个 chip", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderEditor("");

    await user.type(screen.getByLabelText("标签（编辑）"), "甲{Enter}甲{Enter}");
    expect(screen.getAllByText("甲")).toHaveLength(1);

    await user.tab();
    expect(onCommit).toHaveBeenCalledWith("甲");
  });
});
