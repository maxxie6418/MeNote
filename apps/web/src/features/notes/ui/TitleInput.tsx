/**
 * 正文区标题输入框（2026-09-28 从 `NoteWorkspace` 抽出）。
 *
 * **为什么要单独一个组件**：标题原先直接受控在"本地库里那份标题"上，而每敲一个字都要
 * `await refresh()`（6 张表 + 全量正文摘要 + 搜索索引重扫）——异步回来时把输入框按回旧值，
 * 晚到的按键就被吃掉。实测（808 条笔记、60ms/字）：输入 10 个字**只剩 1 个**，
 * 并伴随一条 294ms 的主线程长任务。
 *
 * 所以这里把"**显示**"和"**提交**"分开：
 * - `onChange` 只更新**本地** state（输入永远是即时的，不等任何 await）；
 * - 空闲 `COMMIT_IDLE_MS` / 失焦 / **卸载前（切换条目、关掉这一篇）** 提交一次；
 * - 外部值变化（别的设备同步下来、"按最新内容重新载入"）在**没有待提交内容时**才采纳，
 *   绝不把用户正在敲的字顶掉。
 *
 * 提交仍然走 `patch_meta`（离线优先、幂等），数据口径与之前一致。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { registerEditingSession } from "../../../app/shortcuts/shortcuts";

/** 空闲多久提交一次（期间继续敲字就顺延） */
export const COMMIT_IDLE_MS = 400;

export interface TitleInputProps {
  /** 已提交的标题（来自本地库那条记录） */
  value: string;
  /** 提交：调用方负责写本地库 + 入队（不可在这里发网络请求） */
  onCommit: (title: string) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export function TitleInput({
  value,
  onCommit,
  className,
  ariaLabel = "标题",
  disabled = false,
}: TitleInputProps) {
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef(value);
  /** 已经交出去的那份值（用来判断"有没有待提交的内容"） */
  const committedRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  /** 立刻提交（失焦 / 卸载 / 防抖到点） */
  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = textRef.current;
    if (next === committedRef.current) return;
    // 先记账再交出去：`onCommit` 会让外部值回灌，账已经平了就不会被当成"外部改动"
    committedRef.current = next;
    onCommitRef.current(next);
  }, []);

  // 卸载前提交：切换条目会重挂正文区，不提交就等于**丢掉刚敲的标题**
  useEffect(() => () => flush(), [flush]);

  /*
    `Ctrl/Cmd+S` 走全局编辑会话：焦点在标题上，或还有没提交的字，都算正在编辑。
    没改动时 `flush` 自己返回，不会多写一次。
  */
  useEffect(() => {
    return registerEditingSession({
      id: "note-title",
      isActive: () =>
        document.activeElement === inputRef.current || textRef.current !== committedRef.current,
      flush,
    });
  }, [flush]);

  /*
    外部值变化（同步下来 / 冲突处理改了这一篇）：
    - 与"已交出去的那份"相同 → 是我们自己提交后的回灌，什么都不做；
    - 本地还有待提交内容 → 不采纳，用户的输入优先（提交后自然会覆盖）；
    - 否则采纳（例如另一台设备改了标题）。
  */
  useEffect(() => {
    if (value === committedRef.current) return;
    if (textRef.current !== committedRef.current) return;
    committedRef.current = value;
    textRef.current = value;
    setText(value);
  }, [value]);

  function handleChange(next: string): void {
    textRef.current = next;
    setText(next);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, COMMIT_IDLE_MS);
  }

  return (
    <input
      ref={inputRef}
      className={className}
      aria-label={ariaLabel}
      value={text}
      disabled={disabled}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={flush}
      // 回车立刻提交（与失焦同一条路径），但**不阻止换行/提交表单**之外的行为
      onKeyDown={(event) => {
        if (event.key === "Enter") flush();
      }}
    />
  );
}
