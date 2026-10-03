/**
 * 快速导航（components.md §三 `QuickNav`；需求 §7.4）。
 *
 * 三组：**文件夹 / 标签 / 常用视图**。文件夹与标签只列实际存在的（空的不占位）。
 *
 * 【M7 2026-10-03】「加密空间」那颗此前是 M2 时期留下的 `disabled` + `title="…将在 M3 启用"`，
 * 而 M3 早已落地，于是**一直点不动**。现在接上真动作 `onOpenVault`，与动作带那颗同一口径。
 */
import { Chip } from "../../../app/ui/Chip";

export interface QuickNavProps {
  folders: ReadonlyArray<{ id: string; name: string }>;
  tags: ReadonlyArray<{ tag: string; count: number }>;
  onOpenFolder: (folderId: string) => void;
  onOpenTag: (tag: string) => void;
  onOpenView: (view: "recent" | "starred" | "memo" | "task" | "notebook") => void;
  onOpenVault: () => void;
  vaultEntry: { enabled: boolean; locked: boolean; reason: string | null };
}

export function QuickNav({
  folders,
  tags,
  onOpenFolder,
  onOpenTag,
  onOpenView,
  onOpenVault,
  vaultEntry,
}: QuickNavProps) {
  return (
    <div className="home-nav">
      {folders.length > 0 ? (
        <div className="home-nav__grp">
          <div className="home-nav__title">文件夹</div>
          <div className="home-acts">
            {folders.map((folder) => (
              <Chip key={folder.id} icon="folder" onClick={() => onOpenFolder(folder.id)}>
                {folder.name}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      {tags.length > 0 ? (
        <div className="home-nav__grp">
          <div className="home-nav__title">标签</div>
          <div className="home-acts">
            {tags.map((entry) => (
              <Chip
                key={entry.tag}
                variant="tag"
                title={`${entry.count} 条`}
                onClick={() => onOpenTag(entry.tag)}
              >
                # {entry.tag}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      <div className="home-nav__grp">
        <div className="home-nav__title">常用视图</div>
        <div className="home-acts">
          <Chip icon="refresh" onClick={() => onOpenView("recent")}>
            最近编辑
          </Chip>
          <Chip icon="star" onClick={() => onOpenView("starred")}>
            收藏
          </Chip>
          <Chip icon="clock" onClick={() => onOpenView("memo")}>
            Memo
          </Chip>
          <Chip icon="check-square" onClick={() => onOpenView("task")}>
            待办
          </Chip>
          <Chip icon="folder" onClick={() => onOpenView("notebook")}>
            笔记本
          </Chip>
          {/*
            没启用隐私锁时置灰，`title` 写明原因（触屏够不到悬停，所以动作带那边另有一条
            可见的旁注；这里只做不可点的视觉标记）。
          */}
          <Chip
            icon="lock"
            disabled={!vaultEntry.enabled}
            title={vaultEntry.reason ?? "加密空间"}
            onClick={vaultEntry.enabled ? onOpenVault : undefined}
          >
            加密空间
          </Chip>
        </div>
      </div>
    </div>
  );
}
