/**
 * 单篇加密的锁定占位（M3-7；《隐私锁设计》§9.2）。
 *
 * 只替换**正文区**：标题是明文，所以标题栏照常显示、也照常可改；
 * 正文、预览、状态栏里的实时大小一概不出现——没解锁就不该有任何内容面。
 *
 * 与 Memo/待办的整屏占位不同，这里**必须**给出「解锁此篇」出口：否则用户看着一个
 * 打不开的标题，不知道该怎么办（DESIGN.md §5.4-3）。
 */
import { Button } from "../../../app/ui/Controls";

export interface LockedDocPanelProps {
  onUnlock: () => void;
}

export function LockedDocPanel({ onUnlock }: LockedDocPanelProps) {
  return (
    <div className="docpane__center">
      <div className="empty">
        <p className="empty__title">这一篇已加密</p>
        <p className="empty__hint">
          正文需要逐篇解锁后才能查看与编辑；解锁只在本次浏览器会话内有效。
        </p>
        <Button variant="primary" size="sm" onClick={onUnlock}>
          解锁此篇
        </Button>
      </div>
    </div>
  );
}
