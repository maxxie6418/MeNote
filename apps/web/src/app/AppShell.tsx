/**
 * 应用骨架（DESIGN.md §2.1）：顶栏 + 左右两栏；高度 100vh，`body` 不滚动。
 * 只负责插槽与结构，不关心具体内容。
 */
import type { ReactNode } from "react";

export interface AppShellProps {
  topbar: ReactNode;
  fnbar: ReactNode;
  children: ReactNode;
  banner?: ReactNode;
}

export function AppShell({ topbar, fnbar, children, banner }: AppShellProps) {
  return (
    <div className="shell">
      {topbar}
      {banner}
      <div className="shell__body">
        {fnbar}
        <main className="workarea">{children}</main>
      </div>
    </div>
  );
}
