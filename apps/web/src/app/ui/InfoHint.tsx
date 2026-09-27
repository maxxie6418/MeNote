/**
 * 说明提示（ⓘ + 悬停 / 键盘聚焦 / 点击展开）。用户 2026-09-27 拍板新建的公共组件。
 *
 * `DESIGN.md` §5.4-1：**界面辅助文案默认不写**，确需的说明性文字（用途、口径、背景）一律收进这里，
 * 不得平铺。所以它是"说明"的唯一出口，而不是随手加一个提示的方式。
 *
 * 三条底线（都要守住，否则它比不写还糟）：
 * 1. **不承载必须可见的内容**——警告、破坏性后果、错误与校验、实时计数一律留在界面上
 *    （§5.4-2 / 禁止项 #8）。这条由使用方负责：别把该看见的东西塞进来。
 * 2. **键盘可达 + 焦点可见**（§6.2）：按钮本身可聚焦，聚焦即展开（`:focus-within` 那条规则）。
 * 3. **触屏不能只能靠悬停**（§2.4-2 / 禁止项 #17）：按钮可点，点开 / 再点收起，`aria-expanded`
 *    如实反映当前状态；触屏下的命中区由 `@media (hover: none)` 补足（视觉尺寸不变）。
 *
 * 读屏：按钮用 `aria-describedby` 指向那段文字（`role="tooltip"`），聚焦即能念出，
 * 不必依赖"看得见那个气泡"。
 */
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export interface InfoHintProps {
  /**
   * 按钮的可访问名字（例：「待办说明」）。**必填**——它是个只有图标的按钮，
   * 而"悬停提示"不能当名字（§6.2-4）。
   */
  label: string;
  /** 要收起来的那段说明性文字 */
  children: ReactNode;
}

export function InfoHint({ label, children }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="infohint">
      <button
        type="button"
        className="infohint__btn"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={id}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
      >
        <Icon name="info" size={13} />
      </button>
      <span className="infohint__pop" id={id} role="tooltip">
        {children}
      </span>
    </span>
  );
}
