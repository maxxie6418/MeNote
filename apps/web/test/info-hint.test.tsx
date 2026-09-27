// @vitest-environment jsdom
/**
 * `InfoHint`（v0.5.2 新建的公共组件；`DESIGN.md` §5.4-1 的说明文字唯一出口）。
 *
 * 这里断言的是**语义与交互**，不是"气泡看不看得见"——jsdom 不加载 `app.css`，
 * 默认隐藏与悬停显示都由 CSS 负责（那部分靠 `style-coverage` 守卫"类名有规则"兜住）。
 *
 * 三条不能退的底线：
 * 1. 它是**只有图标的按钮**，必须有可访问名字（§6.2-4：悬停提示不能当名字）；
 * 2. `aria-describedby` 指向那段说明——读屏聚焦就念得到，不依赖"看见气泡"；
 * 3. 点击能开能关、`aria-expanded` 如实反映（§2.4-2 / 禁止项 #17：触屏不能只靠悬停）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { InfoHint } from "../src/app/ui/InfoHint";

afterEach(cleanup);

describe("InfoHint", () => {
  it("按钮有可访问名字，并用 `aria-describedby` 指着那段说明", () => {
    const { container } = render(
      <InfoHint label="待办说明">待办是清单 Memo 派生的视图，不改变数据模型。</InfoHint>,
    );

    const button = screen.getByRole("button", { name: "待办说明" });
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    // 用 getElementById 而不是 CSS 选择器：`useId()` 生成的 id 含 `:` / `«»` 这类字符，
    // 直接拼进 `#…` 选择器会炸（这也是它必须走属性的原因）
    const pop = document.getElementById(describedBy as string);
    expect(pop).not.toBeNull();
    expect(pop?.getAttribute("role")).toBe("tooltip");
    expect(pop?.textContent).toContain("待办是清单 Memo 派生的视图");

    // 装饰图标对辅助技术隐藏（§6.2-5）
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it("点击可开可关，`aria-expanded` 如实反映（触屏那条路）", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="待办说明">说明文字</InfoHint>);

    const button = screen.getByRole("button", { name: "待办说明" });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("焦点离开后收起（不留下一个没人管的开着的气泡）", async () => {
    const user = userEvent.setup();
    render(
      <>
        <InfoHint label="待办说明">说明文字</InfoHint>
        <button type="button">别处</button>
      </>,
    );

    const button = screen.getByRole("button", { name: "待办说明" });
    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("button", { name: "别处" }));
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});
