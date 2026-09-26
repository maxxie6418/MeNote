/**
 * 顶栏搜索框（components.md §五 `SearchBox`；M2-6 启用）。
 *
 * 位置在 M1 就固定好了（避免 M2 再动顶栏结构），这里只是把占位换成真实输入：
 * - 受控输入，值由 `App` 持有（清空即回到进入搜索前的视图）；
 * - `Ctrl/Cmd+K` 聚焦由 `App` 的全局快捷键处理（输入框用固定 id `search-input` 定位）；
 * - `Esc` 清空（与"浮层 Esc 关闭"的既有习惯一致，`DESIGN.md` §6.4）。
 */
import { Icon } from "../ui/Icon";

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBox({ value, onChange }: SearchBoxProps) {
  return (
    <div className="topbar__search">
      <div className="searchbox">
        <Icon name="search" size={13} />
        <input
          id="search-input"
          className="searchbox__input"
          type="search"
          aria-label="搜索"
          placeholder="搜索标题、正文、标签"
          title="搜索（Ctrl/Cmd+K 聚焦）"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && value !== "") {
              event.preventDefault();
              onChange("");
            }
          }}
        />
        <kbd className="searchbox__kbd" aria-hidden="true">
          Ctrl K
        </kbd>
      </div>
    </div>
  );
}
