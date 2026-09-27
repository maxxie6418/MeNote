/**
 * 笔记列表的**一行**（M4 原型 `.docrow`：26px 图标块 + 主块（标题/摘要）+ 右侧时间 + 行菜单）。
 *
 * 为什么单独一个文件、还要 `memo`：列表是**整表铺开**的（没有虚拟化），
 * 而它重渲染得非常频繁——选中项一变、摘要表一变、编辑器每敲一个字（`setSnapshot` → `workspace` 换身份
 * → App 重渲染）都会走到列表。不加 memo 时，2000 篇的库里**每一次都是一次 130–230ms 的主线程长任务**
 * （用户反馈的"切换笔记很卡"，2026-09-27 真实 Chrome 实测）。
 *
 * **`memo` 生效的前提是 props 稳定**，所以这里的 props 一律是原始值或稳定引用：
 * `selected` / `summary` / `unlocked` 是原始值，`folders` / `vault` / 各回调由 `NotesPane` 与
 * `NotesSlot` 用 `useMemo` / `useCallback` 保证跨渲染同一身份（`useNotesWorkspace` 也为此把
 * `refresh` / `open` 等回调做了身份稳定化）。任何一处退回"每次渲染新建"，整表重渲染就会回来——
 * `test/notes-list-memo.test.tsx` 专门盯这一点（用字段 getter 计数）。
 */
import { memo } from "react";
import type { LocalItem } from "../../../data/db";
import { Icon } from "../../../app/ui/Icon";
import { DropdownMenu, type MenuItemSpec } from "../../../app/ui/Menu";

const PENDING_LABEL: Record<string, string> = {
  create: "待上传",
  save_body: "待上传",
  patch_meta: "待上传",
};

function formatTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 行的标题文字（也是行菜单的无障碍名字）；标题为空时给一个可读占位 */
export function rowTitleOf(item: LocalItem): string {
  return item.title ?? "（无标题）";
}

export interface NoteRowProps {
  item: LocalItem;
  selected: boolean;
  /** 已缓存正文的第一行（没有就不渲染摘要那一行） */
  summary: string | undefined;
  /** 这一篇在本次浏览器会话里是否已解密（单篇门禁与隐私锁态无关，故单独传） */
  unlocked: boolean;
  /** 移动目标（两层，扁平列出即可）——**必须是稳定引用** */
  folders: ReadonlyArray<{ id: string; name: string }>;
  onSelect: (id: string) => void;
  onMove?: (id: string, folderId: string | null) => void;
  onTogglePinned?: (id: string) => void;
  onToggleStarred?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** 加密空间的移入/移出（M3-8）——**整个对象必须是稳定引用** */
  vault?: {
    enabled: boolean;
    locked: boolean;
    /** 空间根 id；还没同步下来时给 `null`（此时不给移入入口） */
    id: string | null;
    folders: ReadonlyArray<{ id: string; name: string }>;
    onMoveIn: (itemId: string, folderId: string | null) => void;
    onMoveOut: (itemId: string) => void;
  };
}

function NoteRowView({
  item,
  selected,
  summary,
  unlocked,
  folders,
  onSelect,
  onMove,
  onTogglePinned,
  onToggleStarred,
  onDelete,
  vault,
}: NoteRowProps) {
  const title = rowTitleOf(item);

  return (
    <li className="itemrow__wrap">
      <button
        type="button"
        className="itemrow"
        aria-current={selected}
        onClick={() => onSelect(item.id)}
      >
        {/*
          行结构照原型 `.docrow`：**26px 图标块 + 主块（标题/摘要两行）+ 右侧时间**。
          图标按条目类型给（笔记 / 表格），它是**辅助**——标题文字才是主要信息。
        */}
        <span className="itemrow__ico" aria-hidden="true">
          <Icon name={item.type === "table" ? "table" : "note"} size={13} />
        </span>
        <span className="itemrow__main">
          <span className="itemrow__title">
            {item.pinned === 1 ? (
              <span className="itemrow__mark" title="已置顶">
                置顶
              </span>
            ) : null}
            {item.starred === 1 ? (
              <span className="itemrow__mark" title="已收藏">
                收藏
              </span>
            ) : null}
            {/*
              M3-10 的两套标识（设计 §9.2-③）必须能分辨、也可同时出现：
              - **单篇加密态**：未解密 → 锁 + "已加密"；本次已解密 → "已解密"；
              - **空间归属**：解锁期间出现在三视图里 → 锁 + "加密空间"。
              标题本身是明文，所以标识与标题并存不冲突。
            */}
            {item.enc_self === 1 ? (
              <span
                className="itemrow__mark"
                title={unlocked ? "单篇加密：本次会话已解密" : "单篇加密：正文需逐篇解锁"}
              >
                <Icon name="lock" size={13} />
                {unlocked ? "已解密" : "已加密"}
              </span>
            ) : null}
            {item.in_enc_space === 1 ? (
              <span className="itemrow__mark" title="这一条在加密空间里">
                <Icon name="lock" size={13} />
                加密空间
              </span>
            ) : null}
            {title}
          </span>
          {/*
            摘要在锁定时换成"已加密"：正文没解密就不该露内容面的任何线索
            （连摘要也不给——摘要就是从正文里取的）
          */}
          {item.enc_self === 1 && !unlocked ? (
            <span className="itemrow__excerpt">已加密</span>
          ) : summary ? (
            <span className="itemrow__excerpt">{summary}</span>
          ) : null}
        </span>
        <span className="itemrow__meta">
          <span>{formatTime(item.updated_at)}</span>
          {item.pending ? <span>{PENDING_LABEL[item.pending] ?? "待上传"}</span> : null}
        </span>
      </button>

      <div className="itemrow__menu">
        <DropdownMenu
          label={`${title} 的更多操作`}
          showChevron={false}
          trigger={<Icon name="more" size={13} />}
          items={[
            {
              id: "move-root",
              label: "移动到 根目录",
              icon: "note",
              disabled: (item.folder_id ?? null) === null,
              title: (item.folder_id ?? null) === null ? "已经在根目录" : "移到根目录",
              onSelect: () => onMove?.(item.id, null),
            },
            ...folders.map((folder) => ({
              id: `move-${folder.id}`,
              label: `移动到 ${folder.name}`,
              icon: "folder" as const,
              disabled: (item.folder_id ?? null) === folder.id,
              title: (item.folder_id ?? null) === folder.id ? "已经在这个文件夹里" : undefined,
              onSelect: () => onMove?.(item.id, folder.id),
            })),
            {
              id: "pin",
              label: item.pinned === 1 ? "取消置顶" : "置顶",
              icon: "note",
              onSelect: () => onTogglePinned?.(item.id),
            },
            {
              id: "star",
              label: item.starred === 1 ? "取消收藏" : "收藏",
              icon: "star",
              onSelect: () => onToggleStarred?.(item.id),
            },
            ...(vault
              ? item.in_enc_space === 1
                ? ([
                    {
                      id: "vault-out",
                      label: "移出加密空间",
                      icon: "lock" as const,
                      // 移出意味着要处理面明文：必须先解锁（走查表第 16 行）
                      disabled: vault.locked,
                      title: vault.locked
                        ? "先解锁隐私锁，才能把内容移出加密空间"
                        : "移到根目录，之后按普通内容对待",
                      onSelect: () => vault.onMoveOut(item.id),
                    },
                  ] satisfies MenuItemSpec[])
                : ([
                    {
                      id: "vault-in",
                      label: "移入加密空间",
                      icon: "lock" as const,
                      disabled: !vault.enabled || vault.id === null,
                      title: !vault.enabled
                        ? "先在「设置 › 隐私锁」启用隐私锁"
                        : vault.id === null
                          ? "加密空间还没同步下来，请稍后重试"
                          : undefined,
                      onSelect: () => vault.onMoveIn(item.id, null),
                    },
                    // 锁定时 `folders` 为空 → 只给"入根"这一条（设计 §6.3 与走查第 15 行）
                    ...vault.folders.map((folder) => ({
                      id: `vault-in-${folder.id}`,
                      label: `移入 加密空间/${folder.name}`,
                      icon: "folder" as const,
                      onSelect: () => vault.onMoveIn(item.id, folder.id),
                    })),
                  ] satisfies MenuItemSpec[])
              : []),
            // 删除（M4-12）：破坏性操作 → 危险色，执行前必须二次确认（确认框在 NotesPane 里）
            ...(onDelete
              ? ([
                  {
                    id: "delete",
                    label: "删除",
                    icon: "logout" as const,
                    danger: true,
                    onSelect: () => onDelete(item.id),
                  },
                ] satisfies MenuItemSpec[])
              : []),
          ]}
        />
      </div>
    </li>
  );
}

/**
 * 导出的行组件（`memo`）。props 的比较是浅比较，因此**上表里每个对象/函数都必须是稳定引用**；
 * `item` 直接来自 `workspace.items`（`useMemo` 过的数组，内容不变就不换身份）。
 */
export const NoteRow = memo(NoteRowView);
