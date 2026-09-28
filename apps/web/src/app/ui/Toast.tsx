/**
 * 轻提示（DESIGN.md §6.6）：右下角 Toast，自动消失。
 * 规则：不承载"必须行动"的信息；同一操作不叠加多个提示。
 *
 * 2026-09-28 追加（用户要求）：**可带一个"快速跳转"动作**——快捷输入发布后给
 * 「打开这一篇 / 去 Memo / 去待办」。界定写在这里，免得后来人以为它变成了操作入口：
 * - 跳转是**便利入口，不是必须动作**：内容已经存好了，提示错过也不丢东西、不影响任何流程；
 * - 带动作的提示**停留更久**（6s），否则来不及点；
 * - 一条提示最多一个动作（多了就退回"面板提示"那一档，见 `DESIGN.md` §6.6 的分工）。
 *
 * 极简实现：模块级列表 + 订阅，避免为一个提示引入状态管理依赖。
 */
import { useEffect, useState } from "react";

export type ToastTone = "info" | "success" | "warn" | "error";

/** 快速跳转：`label` 是按钮文字，`onClick` 由调用方给（通常是"切视图 + 打开那一条"） */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

const TOAST_TTL_MS = 2_800;
/** 带动作的提示要留够点击时间 */
const TOAST_ACTION_TTL_MS = 6_000;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(list: ToastItem[]) => void>();

function emit(): void {
  for (const listener of listeners) listener(items);
}

export function pushToast(message: string, tone: ToastTone = "info", action?: ToastAction): void {
  const item: ToastItem = { id: nextId, message, tone, action };
  nextId += 1;
  items = [...items, item];
  emit();

  setTimeout(
    () => {
      items = items.filter((entry) => entry.id !== item.id);
      emit();
    },
    action ? TOAST_ACTION_TTL_MS : TOAST_TTL_MS,
  );
}

/** 手动关掉一条（点了动作之后立即收掉，别让同一条提示留在屏上） */
function dismiss(id: number): void {
  items = items.filter((entry) => entry.id !== id);
  emit();
}

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((item) => (
        <div key={item.id} className={`toast toast--${item.tone}`}>
          <span className="toast__text">{item.message}</span>
          {item.action ? (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                dismiss(item.id);
                item.action?.onClick();
              }}
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
