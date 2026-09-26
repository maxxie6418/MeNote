/**
 * 快捷方式（components.md §三 `ShortcutGrid`；需求 §7.4）。
 *
 * 这里给的是**操作入口**（新建 / 记录 / 搜索）；"常用内容的快捷入口随使用频率产生"的细则【后续定】，
 * 所以不做假数据驱动的"常用"格子。
 *
 * 「打开加密空间」在 M2 禁用并说明原因（M3 提供）——与功能栏的加密空间节点同一口径。
 */
import { Icon } from "../../../app/ui/Icon";

export interface ShortcutGridProps {
  onNewNote: () => void;
  onFocusComposer: (mode: "memo" | "task") => void;
  onFocusSearch: () => void;
}

export function ShortcutGrid({ onNewNote, onFocusComposer, onFocusSearch }: ShortcutGridProps) {
  return (
    <div className="home-card">
      <div className="home-card__hd">
        <h3>快捷方式</h3>
        <span className="home-card__note">操作入口</span>
      </div>
      <div className="home-card__bd">
        <div className="home-acts">
          <button type="button" className="home-act" onClick={onNewNote}>
            <Icon name="plus" size={13} />
            新建笔记
          </button>
          <button type="button" className="home-act" onClick={() => onFocusComposer("memo")}>
            <Icon name="clock" size={13} />
            记录 Memo
          </button>
          <button type="button" className="home-act" onClick={() => onFocusComposer("task")}>
            <Icon name="check-square" size={13} />
            新建待办
          </button>
          <button
            type="button"
            className="home-act"
            disabled
            title="加密空间将在 M3 启用"
          >
            <Icon name="lock" size={13} />
            打开加密空间
          </button>
          <button type="button" className="home-act" onClick={onFocusSearch}>
            <Icon name="search" size={13} />
            搜索（Ctrl+K）
          </button>
        </div>
      </div>
    </div>
  );
}
