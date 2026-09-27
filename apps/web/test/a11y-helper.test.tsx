// @vitest-environment jsdom
/**
 * `assertLabelledControls` 自己的自证（2026-09-27）。
 *
 * 规矩（被三次翻车逼出来的）：**下"全部合规"这类结论前，先喂已知坏例与已知好例给工具**。
 * 所以这条用例不断言业务，只断言"工具真的能分辨好坏"。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { assertLabelledControls } from "./helpers/a11y";

afterEach(cleanup);

describe("可访问性断言工具的自证", () => {
  it("图标按钮没有名字 → 被拒（坏例必须抓得到）", () => {
    const { container } = render(
      <button type="button">
        <svg aria-hidden="true" />
      </button>,
    );
    expect(() => assertLabelledControls(container)).toThrow();
  });

  it("输入框没有名字（只有 placeholder）→ 被拒", () => {
    const { container } = render(<input placeholder="搜索" />);
    expect(() => assertLabelledControls(container)).toThrow();
  });

  it("有名字的按钮、有关联 label 的输入框 → 通过（好例不误报）", () => {
    const { container } = render(
      <div>
        <button type="button" aria-label="新建" />
        <label htmlFor="q">搜索</label>
        <input id="q" />
      </div>,
    );
    expect(() => assertLabelledControls(container, { buttons: 1, fields: 1 })).not.toThrow();
  });

  it("数量下限也真的在起作用（零个控件不能算通过）", () => {
    const { container } = render(<div>没有控件</div>);
    expect(() => assertLabelledControls(container, { buttons: 1 })).toThrow();
  });
});
