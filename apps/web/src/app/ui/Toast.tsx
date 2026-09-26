/**
 * 轻提示（DESIGN.md §6.6）：右下角 Toast，约 2.8 秒自动消失。
 * 规则：不承载"需要用户行动"的信息；同一操作不叠加多个提示。
 *
 * 极简实现：模块级列表 + 订阅，避免为一个提示引入状态管理依赖。
 */
import { useEffect, useState } from "react";

export type ToastTone = "info" | "success" | "warn" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const TOAST_TTL_MS = 2_800;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(list: ToastItem[]) => void>();

function emit(): void {
  for (const listener of listeners) listener(items);
}

export function pushToast(message: string, tone: ToastTone = "info"): void {
  const item: ToastItem = { id: nextId, message, tone };
  nextId += 1;
  items = [...items, item];
  emit();

  setTimeout(() => {
    items = items.filter((entry) => entry.id !== item.id);
    emit();
  }, TOAST_TTL_MS);
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
          {item.message}
        </div>
      ))}
    </div>
  );
}
