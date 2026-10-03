/**
 * 正文头「更多」菜单的条目（M1 起；M6 批 2b 起含「移除附件引用」）。
 *
 * **为什么单独成文件**：`NoteWorkspace.tsx` 已经贴着 500 行预算（ESLint `max-lines`），
 * 菜单条目又是随里程碑一条条加的——留在原处只会让每加一项都要重新搬家。条目与它们
 * 各自的"为什么这样禁用"集中在这里，组件只负责把状态递进来。
 */
import { extractAttachmentRefs } from "@menote/shared";
import type { MenuItemSpec } from "../../../app/ui/Menu";
// 只取类型，运行时不会形成环（`import type` 被完全擦掉）：加密那一组的形状仍由
// `NoteWorkspaceProps` 单点定义，不在这里抄第二份。
import type { NoteWorkspaceProps } from "./NoteWorkspace";

export interface MoreMenuItemsOptions {
  /** 加密那一组（**不传就没有「更多」菜单**——它是隐私锁的入口集合） */
  encryption?: NoteWorkspaceProps["encryption"];
  /** 正文的**当前文本**：既判"有没有引用"，移除时也照它算（不是打开时的快照） */
  body: string;
  /** 这一篇已加密但本次没解锁 */
  bodyLocked: boolean;
  /** 表格条目：附件走表格结构（`## 附件` 章节 + 单元格里的名字），没有可删的正文引用 */
  isTable: boolean;
  /** 正文当前可改（仅编辑 / 即时渲染）。预览档没有编辑器句柄，移除无处落地 */
  bodyEditable: boolean;
  /** 单篇加密 / 在加密空间内——这两类内容不能分享（创建接口也有同语句硬校验） */
  privacyBlocked: boolean;
  /** 有生效中的分享链接（决定菜单项文案与「公开」标记） */
  shared: boolean;
  onExportMarkdown?: (includeAttachments: boolean) => void;
  /** 移除附件引用（M10-新 · M6 批 2b）：宿主拿着当前正文去开弹窗 */
  onRemoveAttachmentRef?: (body: string) => void;
  onShare?: () => void;
  onOpenVersions?: () => void;
  versionsDisabledReason?: string;
  onDelete?: () => void;
}

/** 「移除附件引用」为什么不可用（`DESIGN.md` §6.1：禁用必须给 `title` 说明原因） */
function removeRefDisabledReason(options: MoreMenuItemsOptions): string | undefined {
  if (options.bodyLocked) return "解锁后才能移除附件引用";
  if (options.isTable) return "表格条目的附件引用跟着表格结构走，这里移除不了";
  if (extractAttachmentRefs(options.body).length === 0) return "这一篇没有附件引用";
  // 预览档编辑器没挂载，没有句柄能落这一段——与其点了没反应，不如说清怎么才能做
  if (!options.bodyEditable) return "切到「仅编辑」才能移除附件引用";
  return undefined;
}

export function buildMoreMenuItems(options: MoreMenuItemsOptions): MenuItemSpec[] {
  const { encryption } = options;
  if (!encryption) return [];

  const bodyLocked = options.bodyLocked;
  const shared = options.shared;
  const removeRefReason = removeRefDisabledReason(options);

  return [
    {
      id: "encrypt",
      label: "加密此篇",
      icon: "lock",
      disabled: !encryption.enabled || encryption.encrypted,
      title: !encryption.enabled
        ? "先在「设置 › 隐私锁」启用隐私锁"
        : encryption.encrypted
          ? "这一篇已经加密"
          : undefined,
      onSelect: () => encryption.onToggle(true),
    },
    {
      id: "decrypt",
      label: "取消加密",
      icon: "lock",
      disabled: !encryption.encrypted || !encryption.unlocked,
      title: !encryption.encrypted
        ? "这一篇没有加密"
        : !encryption.unlocked
          ? "先解锁这一篇，才能取消加密"
          : undefined,
      onSelect: () => encryption.onToggle(false),
    },
    {
      id: "lock-item",
      label: "锁上此篇",
      icon: "lock",
      disabled: !encryption.encrypted || !encryption.unlocked,
      title: encryption.unlocked ? undefined : "这一篇当前是锁着的",
      onSelect: () => encryption.onLock(),
    },
    {
      id: "lock-all",
      label: "锁上全部单篇",
      icon: "lock",
      disabled: encryption.unlockedCount === 0,
      title: encryption.unlockedCount === 0 ? "当前没有已解密的单篇" : undefined,
      onSelect: () => encryption.onLockAll(),
    },
    // 单篇导出（M15）：锁定态不可用并说明原因（与切换条同一口径）
    ...(options.onExportMarkdown
      ? ([
          {
            id: "export-md",
            label: "导出 Markdown",
            icon: "note" as const,
            disabled: bodyLocked,
            title: bodyLocked ? "解锁后才能导出这一篇" : undefined,
            onSelect: () => options.onExportMarkdown?.(false),
          },
          {
            id: "export-md-zip",
            label: "导出 Markdown（含附件）",
            icon: "image" as const,
            disabled: bodyLocked,
            title: bodyLocked ? "解锁后才能导出这一篇" : undefined,
            onSelect: () => options.onExportMarkdown?.(true),
          },
        ] satisfies MenuItemSpec[])
      : []),
    /*
      移除附件引用（M10-新 · M6 批 2b）：入口是"更多菜单为主"，**不靠悬停**。
      动作只删正文里那一条引用，**不删文件**（语义写在弹窗里，不塞进这个菜单项）——
      真正删文件属附件管理页（批 2c）。
    */
    ...(options.onRemoveAttachmentRef
      ? ([
          {
            id: "remove-attachment-ref",
            label: "移除附件引用…",
            icon: "image" as const,
            disabled: removeRefReason !== undefined,
            title: removeRefReason,
            onSelect: () => options.onRemoveAttachmentRef?.(options.body),
          },
        ] satisfies MenuItemSpec[])
      : []),
    // 分享（M14）：隐私条目不可分享（创建接口也有同语句硬校验，双保险）
    ...(options.onShare
      ? ([
          {
            id: "share",
            label: shared ? "分享（生效中）" : "分享",
            icon: "plus" as const,
            disabled: bodyLocked || options.privacyBlocked,
            title: bodyLocked
              ? "解锁后才能分享"
              : options.privacyBlocked
                ? "单篇加密与加密空间内的内容不能分享"
                : undefined,
            onSelect: () => options.onShare?.(),
          },
        ] satisfies MenuItemSpec[])
      : []),
    // 版本历史（M4-11）：锁定态整体不可用，并说明原因
    ...(options.onOpenVersions
      ? ([
          {
            id: "versions",
            label: "版本历史",
            icon: "clock" as const,
            disabled: options.versionsDisabledReason !== undefined,
            title: options.versionsDisabledReason,
            onSelect: options.onOpenVersions,
          },
        ] satisfies MenuItemSpec[])
      : []),
    // 删除（M4-12）：破坏性操作 → 危险色；二次确认由工作区外层做
    // （同一套确认逻辑还要给列表行用，不在这里各写一份）
    ...(options.onDelete
      ? ([
          {
            id: "delete",
            label: "删除",
            icon: "logout" as const,
            danger: true,
            onSelect: options.onDelete,
          },
        ] satisfies MenuItemSpec[])
      : []),
  ];
}
