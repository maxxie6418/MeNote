/**
 * 添加内容窗口的装配（`App.tsx` 组合根）。设计见 `docs/modules/Menote-添加内容窗口-设计-v1.md`。
 *
 * 从 `App.tsx` 抽出的原因：组合根已顶到 500 行预算（`AGENTS.md` / 架构 §2.3.3 的
 * `max-lines` 护栏），把窗口的**开关状态 + JSX**收进这个 hook，组合根只留一行 hook 调用、
 * 一行渲染，外加两个 `onAdd` 指到 `open`。
 *
 * 发布回调由调用方从 `fnbarWiring` 的**同一套**传下来（`onPublishMemo` / `onPublishTask`），
 * 与左侧录入框一个口径——不抄第二遍发布逻辑。
 *
 * 关窗：窗口自己经 `onClose` 把 `kind` 置回 `null`（点「发布 / 取消 / Esc / 点遮罩」都走它的
 * `close()`，顺带清空字段），组合根不需要另管关闭。
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  AddEntryDialog,
  type AddEntryDialogProps,
  type AddEntryKind,
} from "./fnbar/AddEntryDialog";

type PublishMemo = AddEntryDialogProps["onPublishMemo"];
type PublishTask = AddEntryDialogProps["onPublishTask"];

export interface AddEntrySlot {
  /** 打开添加窗口（Memo / 待办页头与空状态的「添加」都指到它） */
  open: (kind: AddEntryKind) => void;
  /** 装配好的窗口：挂在浮层位（`<ToastHost />` 之前）渲染 */
  dialog: ReactNode;
}

export function useAddEntrySlot(
  onPublishMemo: PublishMemo,
  onPublishTask: PublishTask,
): AddEntrySlot {
  const [kind, setKind] = useState<AddEntryKind | null>(null);
  return useMemo(
    () => ({
      open: setKind,
      dialog: (
        <AddEntryDialog
          open={kind !== null}
          kind={kind ?? "memo"}
          onClose={() => setKind(null)}
          onPublishMemo={onPublishMemo}
          onPublishTask={onPublishTask}
        />
      ),
    }),
    [kind, onPublishMemo, onPublishTask],
  );
}
