/**
 * 快捷方式**动作带**（M7 首页重做；原型 `homeActs`「页内一条横排动作带」）。
 *
 * 【M7 2026-10-03】由原先的**一张独立卡片**（`.home-card`，占一整块高度）收成页内一条横排。
 * 原型原话「三块都只给出口、不铺满内容」——所以这里就五个出口，
 * **不加"最近用过的模板"之类会越长越满的东西**。
 *
 * ## 「打开加密空间」接上了真动作
 *
 * 此前它是 M2 时期留下的 `disabled` + `title="加密空间将在 M3 启用"`，而 M3 早已落地，
 * 于是这颗入口**一直点不动**。现在由 `onOpenVault` 接真动作，三态（未启用 / 锁定 / 已解锁）
 * 在 `App` 里分发，口径与功能栏那个贴底节点一致，不发明第二套进入方式。
 *
 * **没启用时仍然置灰，但必须说明原因**（`DESIGN.md` §6.1：禁用必须说明为何，不可只置灰）。
 */
import { Icon } from "../../../app/ui/Icon";

export interface ShortcutActionsProps {
  onNewNote: () => void;
  onFocusComposer: (mode: "memo" | "task") => void;
  onFocusSearch: () => void;
  onOpenVault: () => void;
  vaultEntry: { enabled: boolean; locked: boolean; reason: string | null };
}

export function ShortcutActions({
  onNewNote,
  onFocusComposer,
  onFocusSearch,
  onOpenVault,
  vaultEntry,
}: ShortcutActionsProps) {
  return (
    <section className="home-acts-bar" aria-label="快捷方式">
      <h2 className="home-acts-bar__t">快捷方式</h2>
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
        {/*
          不用 `title` 承载禁用原因：那属于悬停提示，触屏够不到。`aria-disabled` + 可见的
          文字说明一起给——既让读屏念出来，也让不用鼠标的人看得见。
        */}
        <button
          type="button"
          className="home-act"
          aria-disabled={!vaultEntry.enabled}
          data-disabled={!vaultEntry.enabled ? "true" : undefined}
          onClick={vaultEntry.enabled ? onOpenVault : undefined}
        >
          <Icon name="lock" size={13} />
          打开加密空间
        </button>
        <button type="button" className="home-act" onClick={onFocusSearch}>
          <Icon name="search" size={13} />
          搜索（Ctrl+K）
        </button>
      </div>
      {!vaultEntry.enabled && vaultEntry.reason !== null ? (
        <p className="home-acts-bar__note">{vaultEntry.reason}</p>
      ) : null}
    </section>
  );
}
