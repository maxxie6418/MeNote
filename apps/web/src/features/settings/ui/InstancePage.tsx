/**
 * 设置页「实例管理」分类（仅 owner；M19-02/M19-04）。
 *
 * 从 `SettingsPanel.tsx` 抽出（2026-09-28）：一是那里已接近 500 行预算，二是"注册开关 + 到期"
 * 有自身的草稿状态与日期换算，混在设置壳里读起来两件事。
 *
 * 三条口径：
 * 1. **到期自动关闭**（`功能拆解` M19-02：注册开关含到期自动关闭）——服务端读路径按 `close_at`
 *    判过期（不依赖 Cron），`0` 表示不自动到期；所以"清空日期"要**显式传 0**，不能省略字段。
 * 2. 到期日按**当天结束**换算（次日零点前一直有效），免得"填了今天却立刻注册不了"。
 * 3. 未实现的项（成员账户管理）**保持可见的里程碑标记**（`DESIGN.md` §6.1：禁用要说明原因，
 *    且不能只靠悬停），详细背景收进 `InfoHint`。
 */
import { useState } from "react";
import { Button } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { toDeadlineValue, toDeadlineTimestamp } from "../deadline";

export interface InstancePageProps {
  registrationOpen: boolean;
  /** 到期时间戳；`0` = 不自动到期 */
  registrationCloseAt: number;
  /** 改注册开关：`closeAt = 0` 表示不自动关闭 */
  onChangeRegistration: (open: boolean, closeAt: number) => Promise<void>;
}

export function InstancePage({
  registrationOpen,
  registrationCloseAt,
  onChangeRegistration,
}: InstancePageProps) {
  /**
   * 日期输入用字符串草稿：用户正在改（比如清空）时不该立刻把每个中间态写进服务端。
   * 初值取当前到期日；改开关或外部值变化由 `key` 重置整块（见下面的 `key`）。
   */
  const [deadlineDraft, setDeadlineDraft] = useState(toDeadlineValue(registrationCloseAt));

  return (
    <section className="setcard" aria-label="实例管理">
      <h3 className="setcard__title">
        注册开关
        <InfoHint label="注册开关说明">
          关闭后登录页不再显示注册入口；已登录用户与已有数据都不受影响。
          到期自动关闭由服务端读路径判定，不需要定时任务。
        </InfoHint>
      </h3>

      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__name">允许新用户注册</span>
          <span className="setrow__desc">关闭后登录页不再显示注册入口</span>
        </div>
        <button
          type="button"
          role="switch"
          className="toggle"
          aria-checked={registrationOpen}
          aria-label="允许新用户注册"
          onClick={() => void onChangeRegistration(!registrationOpen, registrationCloseAt)}
        />
      </div>

      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__name">到期自动关闭</span>
          <span className="setrow__desc">留空表示不自动关闭；填了就在这一天结束时关闭</span>
        </div>
        <div className="setrow__control">
          <input
            type="date"
            className="field__input"
            aria-label="注册到期日"
            value={deadlineDraft}
            disabled={!registrationOpen}
            title={registrationOpen ? undefined : "先打开注册开关再设到期时间"}
            onChange={(event) => {
              const value = event.target.value;
              setDeadlineDraft(value);
              if (!registrationOpen) return;
              // 清空 = 不自动关闭 → 显式写 0（省略字段会被服务端当成"不更新"）
              void onChangeRegistration(true, value === "" ? 0 : toDeadlineTimestamp(value));
            }}
          />
          {registrationCloseAt > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDeadlineDraft("");
                void onChangeRegistration(true, 0);
              }}
            >
              不限
            </Button>
          ) : null}
        </div>
      </div>

      <div className="setrow">
        <div className="setrow__label">
          <span className="setrow__name">成员账户管理</span>
          <InfoHint label="成员账户管理说明">
            成员列表、停用与删除、以及各成员的数据清理会在 M6 提供；在此之前新增成员只能靠
            开放注册让对方自己注册。
          </InfoHint>
        </div>
        {/* 未实现的原因保持可见（不能只靠悬停）：这里是里程碑标记 */}
        <span className="setrow__desc">M6</span>
      </div>
    </section>
  );
}
