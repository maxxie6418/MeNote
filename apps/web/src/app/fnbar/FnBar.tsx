/**
 * 功能栏（DESIGN.md §2.2：宽 294px；§2.7：只有导航区滚动）。
 *
 * 结构与间距**照抄原型**，以保住「新建按钮 38px + 录入框 136px → 导航区顶部 y = 252」的
 * 结构不变量（DESIGN.md §2.5-2）：
 *   54(顶栏) + 12(padding) + 38(按钮) + 12(录入框上边距) + 136(录入框) = 252
 *
 * M1 的内容取舍：新建笔记按钮 + 快速录入框（**占位**：可输入与切模式，发布禁用）+ 最简导航。
 */
import { useState } from "react";
import { Button } from "../ui/Controls";
import { Icon } from "../ui/Icon";

export const COMPOSER_MODES = [
  { id: "memo", label: "Memo" },
  { id: "task", label: "待办" },
  { id: "note", label: "笔记" },
] as const;

export type ComposerMode = (typeof COMPOSER_MODES)[number]["id"];

/** 模式附加项：内容随模式变，**容器高度不变**（26px 固定、单排不换行） */
function ModeExtras({ mode }: { mode: ComposerMode }) {
  if (mode === "task") {
    return (
      <>
        <span className="sw" title="截止日期选择将在 M2 提供">
          截止 未设置
        </span>
        <span className="sw" title="优先级选择将在 M2 提供">
          优先级 中
        </span>
      </>
    );
  }
  if (mode === "note") {
    return (
      <>
        <span className="sw">首行作标题</span>
        <span className="sw">根目录</span>
      </>
    );
  }
  // memo：保持空容器占位，**不能用 display:none 让容器塌陷**（DESIGN.md §2.5-2）
  return null;
}

export interface ComposerProps {
  onRequestPublish?: (mode: ComposerMode, text: string) => void;
}

export function Composer({ onRequestPublish }: ComposerProps) {
  const [mode, setMode] = useState<ComposerMode>("memo");
  const [text, setText] = useState("");

  return (
    <div className="composer">
      <textarea
        className="composer__input"
        aria-label="快速录入"
        placeholder="记点什么……"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />

      <div className="composer__extras" data-testid="composer-extras">
        <ModeExtras mode={mode} />
      </div>

      <div className="composer__modes">
        <div className="segmented" role="group" aria-label="录入模式">
          {COMPOSER_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="segmented__item"
              aria-pressed={mode === item.id}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* M1 占位：发布不可用，但**必须说明为何禁用**（DESIGN.md §6.1） */}
        <Button
          variant="primary"
          size="sm"
          disabled
          title="发布功能将在 M2 提供"
          onClick={() => onRequestPublish?.(mode, text)}
        >
          发布
        </Button>
      </div>
    </div>
  );
}

export interface FnBarProps {
  onNewNote: () => void;
}

export function FnBar({ onNewNote }: FnBarProps) {
  return (
    <aside className="fnbar">
      <div className="fnbar__top">
        <button type="button" className="btn-new" onClick={onNewNote}>
          <Icon name="plus" size={16} />
          新建笔记
        </button>
        <Composer />
      </div>

      <div className="fnbar__scroll">
        <nav className="nav" aria-label="导航">
          <button type="button" className="nav-item" aria-current="true">
            <Icon name="note" size={16} />
            全部笔记
          </button>
        </nav>
      </div>
    </aside>
  );
}
