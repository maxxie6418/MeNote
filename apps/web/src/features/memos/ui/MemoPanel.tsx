/**
 * Memo 视图（components.md §七 `MemoPanel`；需求 §8.4、功能拆解 M06-10）。
 *
 * 组成：顶部操作条（标题 + 计数、「添加」按钮 M07-01 入口二、标签筛选、日期范围筛选）
 * + 时间轴。**不含"清单" tab**（待办是独立视图，M2-5），也**不提供收藏**（Q8）。
 *
 * 状态都留在本组件内（筛选只影响显示，不进数据库）；数据与写入由 `App` 传进来。
 */
import { useState } from "react";
import type { LocalItem, MemoContent } from "../../../data/db";
import { isMemoVisible, type PrivacyGate } from "@menote/shared";
import { LockedPlaceholder } from "../../../app/ui/LockedPlaceholder";
import { Button } from "../../../app/ui/Controls";
import { Chip } from "../../../app/ui/Chip";
import { Icon } from "../../../app/ui/Icon";
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import {
  collectMemoTags,
  EMPTY_FILTER,
  filterMemos,
  MEMO_RANGES,
  type MemoRange,
} from "../model";
import { MemoTimeline } from "./MemoTimeline";

export interface MemoPanelProps {
  memos: readonly LocalItem[];
  /** 已剥掉 front matter 的正文 + 已转笔记关联 */
  contents: Readonly<Record<string, MemoContent>>;
  /**
   * 隐私门禁（M3-5）：Memo 在范围内且锁定时**整体占位**（不显示内容、标签与图片）。
   * 判定走共享包的 `isMemoVisible`，界面不自己拼条件。
   */
  gate: PrivacyGate;
  /** 占位上的「解锁」出口（打开解锁框） */
  onUnlock: () => void;
  onSave: (itemId: string, text: string) => void;
  onTogglePinned: (itemId: string) => void;
  /** Memo 转笔记（Q10） */
  onConvert: (itemId: string) => void;
  /** 打开已转出的那篇笔记 */
  onOpenConverted: (noteId: string) => void;
  /** 「添加」按钮：把焦点送回功能栏的录入框（M07-01 入口二） */
  onAdd: () => void;
  timeZone?: string;
  /** 便于测试固定"现在" */
  now?: number;
}

export function MemoPanel({
  memos,
  contents,
  gate,
  onUnlock,
  onSave,
  onTogglePinned,
  onConvert,
  onOpenConverted,
  onAdd,
  timeZone,
  now,
}: MemoPanelProps) {
  const [tag, setTag] = useState<string | null>(null);
  const [range, setRange] = useState<MemoRange>(EMPTY_FILTER.range);
  /**
   * "现在"只在挂载时取一次（渲染期调 `Date.now()` 不纯，且会让每次渲染结果不稳定）。
   * 代价：跨零点时"今天"的范围要等下次进入视图才刷新——对个人笔记够用，M2-7 设置页再谈定时刷新。
   */
  const [nowMs] = useState(() => now ?? Date.now());

  const memoVisible = isMemoVisible(gate);
  const tags = collectMemoTags(memos);
  const visible = filterMemos(memos, { tag, range }, nowMs, timeZone);

  if (!memoVisible) {
    // 锁定时整屏占位：**保留标题与计数**（计数属于统计口径，一律计入），
    // 但标签、筛选与时间轴一律不渲染（设计 §9.2）
    return (
      <section className="memopanel" aria-label="Memo">
        <header className="memopanel__head">
          <h2 className="memopanel__title">Memo</h2>
          <span className="listpane__count">{memos.length} 条</span>
        </header>
        <div className="memopanel__body">
          <LockedPlaceholder
            title="Memo 已锁定"
            hint="隐私锁已锁定，内容、标签与图片都不显示。解锁后即可查看。"
            onUnlock={onUnlock}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="memopanel" aria-label="Memo">
      <header className="memopanel__head">
        <h2 className="memopanel__title">Memo</h2>
        <span className="listpane__count">{visible.length} 条</span>
        <Button size="sm" variant="secondary" onClick={onAdd} title="回到功能栏的录入框记一条">
          <Icon name="plus" size={13} />
          添加
        </Button>
      </header>

      <div className="memopanel__filters">
        <div className="memopanel__tags">
          <Chip
            variant="tag"
            active={tag === null}
            onClick={() => setTag(null)}
            title="不按标签筛选"
          >
            全部
          </Chip>
          {tags.map((entry) => (
            <Chip
              key={entry.tag}
              variant="tag"
              active={tag === entry.tag}
              title={`${entry.count} 条`}
              onClick={() => setTag(tag === entry.tag ? null : entry.tag)}
            >
              # {entry.tag}
            </Chip>
          ))}
        </div>

        <SegmentedControl
          ariaLabel="日期范围"
          size="compact"
          value={range}
          onChange={setRange}
          options={MEMO_RANGES.map((item) => ({ value: item.value, label: item.label }))}
        />
      </div>

      <div className="memopanel__body">
        <MemoTimeline
          memos={visible}
          contents={contents}
          onSave={onSave}
          onTogglePinned={onTogglePinned}
          onConvert={onConvert}
          onOpenConverted={onOpenConverted}
          onSelectTag={(next) => setTag(next)}
          timeZone={timeZone}
        />
      </div>
    </section>
  );
}
