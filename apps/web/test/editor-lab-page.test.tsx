// @vitest-environment jsdom
/**
 * 编辑试验页：三篇可切换，警告可见，写入不碰到正式存储钥匙。
 * 编辑器换成替身——jsdom 跑不了真的 CodeMirror，切换本身不依赖它。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_LAB_STORAGE_KEY } from "../src/features/editor-lab/store";
import { EditorLabPage } from "../src/features/editor-lab/ui/EditorLabPage";

vi.mock("../src/app/editor/Editor", () => ({
  Editor: (props: { initialValue: string; ariaLabel?: string }) => (
    <textarea aria-label={props.ariaLabel} defaultValue={props.initialValue} readOnly />
  ),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("编辑试验页", () => {
  it("警告可见，三篇都能切，且只写试验钥匙", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("menote:notes", "正式笔记");
    render(<EditorLabPage />);

    expect(screen.getByRole("status").textContent).toContain("不写入笔记");
    const list = screen.getByRole("complementary", { name: "试验笔记列表" });
    expect(list.className).toContain("listpane");
    expect(screen.getByRole("button", { name: "短文" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "代码块" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "稍长" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "代码块" }));
    expect(screen.getByRole("button", { name: "代码块" }).getAttribute("aria-current")).toBe("true");
    await waitFor(() => {
      expect((screen.getByLabelText("代码块的试验正文") as HTMLTextAreaElement).value).toContain(
        "function greet",
      );
    });

    await waitFor(() => {
      expect(window.localStorage.getItem(EDITOR_LAB_STORAGE_KEY)).toContain("lab-2");
    });
    expect(window.localStorage.getItem("menote:notes")).toBe("正式笔记");
    expect(Object.keys(window.localStorage).filter((key) => key !== "menote:notes")).toEqual([
      EDITOR_LAB_STORAGE_KEY,
    ]);
  });
});
