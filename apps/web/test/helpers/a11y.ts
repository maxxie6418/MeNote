/**
 * 渲染层的可访问性不变量（只读断言；2026-09-27 建）。
 *
 * **为什么在渲染层做**：源码级扫描被自证证伪过——扫 `<button>` 的脚本把
 * `onClick={() => undefined}` 里的 `=>` 当成标签结束，坏例都不报；改好后扫出的唯一一处
 * 又是误报（名字来自 `{entry.title}` 表达式）。**能渲染的断言就不要靠字符串匹配。**
 *
 * 用法（在已有的屏测试里加一行，复用那份测试的夹具）：
 *
 * ```ts
 * const { container } = render(<SomePanel ... />);
 * assertLabelledControls(container);
 * ```
 *
 * 断的是两件事：
 * 1. 每个 `button` 都有可访问名字（可见文字 → `aria-label` → `title`）；
 * 2. 每个 `input` / `select` / `textarea` 都有可访问名字（`aria-label` / `title` /
 *    关联的 `<label>`（`htmlFor` 或包裹））。占位符 `placeholder` **不算名字**——
 *    读屏不保证念它，而且输入后就没内容了。
 *
 * `min` 是"至少要查到几个控件"的下限，防止"零个控件也算通过"的假绿。
 */
import { expect } from "vitest";

function hasVisibleText(element: Element): boolean {
  return (element.textContent ?? "").replace(/\s+/g, "") !== "";
}

function labelTextOf(container: HTMLElement, element: Element): string {
  const id = element.getAttribute("id");
  if (!id) return "";
  const label = container.querySelector(`label[for="${id}"]`);
  return label?.textContent?.replace(/\s+/g, "") ?? "";
}

/** 断言容器里所有可交互控件都有可访问名字；返回各自数量便于确认"真的查了东西" */
export function assertLabelledControls(
  container: HTMLElement,
  min: { buttons?: number; fields?: number } = {},
): { buttons: number; fields: number } {
  const buttons = [...container.querySelectorAll("button")];
  const unlabelledButtons = buttons.filter(
    (button) =>
      !hasVisibleText(button) &&
      (button.getAttribute("aria-label") ?? "") === "" &&
      (button.getAttribute("title") ?? "") === "",
  );

  const fields = [...container.querySelectorAll("input, select, textarea")];
  const unlabelledFields = fields.filter((field) => {
    if (field.getAttribute("type") === "hidden") return false;
    if ((field.getAttribute("aria-label") ?? "") !== "") return false;
    if ((field.getAttribute("title") ?? "") !== "") return false;
    if (labelTextOf(container, field) !== "") return false;
    // 被 <label> 包裹也算有关联
    return field.closest("label") === null;
  });

  expect(
    unlabelledButtons.map((button) => button.outerHTML.slice(0, 120)),
    "有按钮没有可访问名字",
  ).toEqual([]);
  expect(
    unlabelledFields.map((field) => field.outerHTML.slice(0, 120)),
    "有表单控件没有可访问名字",
  ).toEqual([]);

  if (min.buttons !== undefined) expect(buttons.length).toBeGreaterThanOrEqual(min.buttons);
  if (min.fields !== undefined) expect(fields.length).toBeGreaterThanOrEqual(min.fields);
  return { buttons: buttons.length, fields: fields.length };
}
