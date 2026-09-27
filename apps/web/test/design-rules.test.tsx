// @vitest-environment jsdom
/**
 * `assertSinglePrimaryAction` 自己的自证（2026-09-27）。
 *
 * 规矩（被三次审计工具翻车逼出来的）：**下"全部合规"这类结论前，先喂已知坏例与已知好例**。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { assertSinglePrimaryAction } from "./helpers/design";

afterEach(cleanup);

describe("「每区域最多一个主操作」断言的自证", () => {
  it("两个并列主色按钮 → 被拒（坏例必须抓得到）", () => {
    const { container } = render(
      <div>
        <button type="button" className="btn btn--primary">
          启用隐私锁
        </button>
        <button type="button" className="btn btn--primary">
          启用
        </button>
      </div>,
    );
    expect(() => assertSinglePrimaryAction(container)).toThrow();
  });

  it("一个主色 + 若干次操作/危险操作 → 通过（好例不误报）", () => {
    const { container } = render(
      <div>
        <button type="button" className="btn btn--primary">
          存为版本
        </button>
        <button type="button" className="btn btn--secondary">
          取消
        </button>
        <button type="button" className="btn btn--danger">
          删除
        </button>
      </div>,
    );
    expect(() => assertSinglePrimaryAction(container, { min: 1 })).not.toThrow();
  });

  it("`min` 真的在起作用（零个主操作不能算通过）", () => {
    const { container } = render(
      <button type="button" className="btn btn--secondary">
        只有次操作
      </button>,
    );
    expect(() => assertSinglePrimaryAction(container, { min: 1 })).toThrow();
  });
});
