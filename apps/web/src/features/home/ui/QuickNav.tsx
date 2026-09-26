/**
 * 快速导航（components.md §三 `QuickNav`；需求 §7.4）。
 *
 * 三组：**文件夹 / 标签 / 常用视图**。文件夹与标签只列实际存在的（空的不占位），
 * 视图组里「加密空间」在 M2 禁用并说明（M3 提供）——与功能栏同一口径。
 */
import { Chip } from "../../../app/ui/Chip";

export interface QuickNavProps {
  folders: ReadonlyArray<{ id: string; name: string }>;
  tags: ReadonlyArray<{ tag: string; count: number }>;
  onOpenFolder: (folderId: string) => void;
  onOpenTag: (tag: string) => void;
  onOpenView: (view: "recent" | "starred" | "memo" | "task" | "notebook") => void;
}

export function QuickNav({ folders, tags, onOpenFolder, onOpenTag, onOpenView }: QuickNavProps) {
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
          <Chip icon="lock" disabled title="加密空间将在 M3 启用">
            加密空间
          </Chip>
        </div>
      </div>
    </div>
  );
}
