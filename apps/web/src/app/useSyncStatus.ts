/**
 * 顶栏同步胶囊的状态映射（拆解 M02-06）。
 *
 * 文案规则：**有队列时显示项数**；队列为空时不显示计数；离线时明确说明"改动会在联网后上传"。
 * 语义靠文字表达，颜色只是辅助（DESIGN.md 禁止项 #4）。
 */
import type { IconName } from "./ui/Icon";

export type SyncEngineStatus = "idle" | "syncing" | "offline" | "error";

export interface SyncIndicator {
  tone: "neutral" | "ok" | "busy" | "err";
  icon?: IconName;
  label: string;
  title?: string;
}

export function toIndicator(status: SyncEngineStatus, pendingCount: number): SyncIndicator {
  if (status === "offline") {
    return {
      tone: "busy",
      icon: "cloud-off",
      label: "离线，改动会在联网后上传",
      title: "网络恢复后会自动同步",
    };
  }
  if (status === "error") {
    return { tone: "err", icon: "alert", label: "同步失败", title: "稍后会自动重试" };
  }
  if (pendingCount > 0) {
    return {
      tone: "busy",
      icon: "cloud-ok",
      label: `${pendingCount} 项待上传`,
      title: status === "syncing" ? "正在同步" : "等待上传",
    };
  }
  return { tone: "ok", icon: "cloud-ok", label: "已同步" };
}
