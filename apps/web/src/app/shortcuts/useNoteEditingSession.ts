/**
 * 把当前打开的笔记登记成一个编辑会话。
 *
 * 控制器还在（打开过一篇、且没有被更晚的 `open` 清掉）就算活跃：
 * 人已经点到别的视图时，未入队的正文仍该能被 `Ctrl/Cmd+S` 推上去。
 * `flush` 在没有改动时自己返回，不会制造一次空上传。
 */
import { useEffect, type RefObject } from "react";
import { registerEditingSession } from "./shortcuts";

export function useNoteEditingSession(
  editorRef: RefObject<{ flush: () => Promise<void> } | null>,
): void {
  useEffect(() => {
    return registerEditingSession({
      id: "note-body",
      isActive: () => editorRef.current !== null,
      flush: () => editorRef.current?.flush() ?? Promise.resolve(),
    });
  }, [editorRef]);
}
