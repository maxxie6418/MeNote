// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNotesWorkspace, type NotesWorkspace } from "../src/features/notes/useNotesWorkspace";

/**
 * 回归：hook 的返回值引用必须稳定。
 *
 * M1-11 浏览器走查实测到过请求风暴：`useNotesWorkspace` 每次渲染返回新对象 → App 里
 * `refreshAll` 的依赖身份每次变化 → 启动同步引擎的 effect 反复 stop/create/start，
 * 10 秒内发了 35 次 `GET /api/sync`。
 */
function Harness({ capture }: { capture: (value: NotesWorkspace) => void }) {
  const workspace = useNotesWorkspace({});
  capture(workspace);
  return <div data-testid="count">{workspace.items.length}</div>;
}

describe("useNotesWorkspace 引用稳定性", () => {
  it("状态未变时，连续两次渲染返回同一个对象", async () => {
    const seen: NotesWorkspace[] = [];
    const capture = (value: NotesWorkspace): void => {
      seen.push(value);
    };

    const { rerender, getByTestId } = render(<Harness capture={capture} />);

    // 等首次异步加载落定（loading 由 true 变 false）
    await waitFor(() => expect(seen.at(-1)?.loading).toBe(false));
    const before = seen.length - 1;

    rerender(<Harness capture={capture} />);

    expect(getByTestId("count").textContent).toBe("0");
    expect(seen.length).toBeGreaterThan(before + 1);
    expect(seen.at(-1)).toBe(seen[before]);
  });
});
