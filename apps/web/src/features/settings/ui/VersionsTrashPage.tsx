/**
 * 设置页「版本与回收站」分类（M4-11；界面稿 §五）。
 *
 * 六块（顺序即操作顺序）：
 * ① 卡片头 + 「打开回收站」+ **条目数实时计数**（计数必须可见，`DESIGN.md` §5.4-2）；
 * ② 自动封存（分钟）；③ 保留密度（**只读**：那是定稿规则，不开放改）；
 * ④ 每条最多保留（20–500，越界就地报错）；⑤ 最长保留时长 + 「不限」开关；
 * ⑥ 回收站保留天数（到期由每日维护永久删除）。
 *
 * 两条纪律：**没有「保存」按钮**（改动即时生效并入队同步，与 M2/M3 设置页一致）；
 * **禁止原生 `alert` / `confirm`**，校验错误走 `Field` 的错误态（就地、可见）。
 *
 * 版本列表 / diff / 恢复**不在本页**：那是 `VersionHistoryPanel`（条目「更多」菜单进入），
 * 且要等版本服务端（M4-5，需要 R2）。本页只放策略 + 回收站入口。
 */
import { useState } from "react";
import {
  VERSIONS_KEEP_MAX,
  VERSIONS_KEEP_MIN,
  VERSION_KEEP_DENSITY_HINT,
  type VersionTrashSettings,
} from "@menote/shared";
import { Button } from "../../../app/ui/Controls";

export interface VersionsTrashPageProps {
  settings: VersionTrashSettings;
  onPatchSettings: (partial: { version_trash: VersionTrashSettings }) => void;
  /** 回收站当前条目数（本地读，实时计数） */
  trashCount: number;
  /** 打开回收站独立页 */
  onOpenTrash: () => void;
}

/** 只接受非负整数输入；非法时返回 `null` 让调用方报错而不是写进设置 */
function parseIntOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

export function VersionsTrashPage({
  settings,
  onPatchSettings,
  trashCount,
  onOpenTrash,
}: VersionsTrashPageProps) {
  // 输入框用字符串草稿：用户打到一半（比如空串）不该立刻写进设置并报错
  const [keepDraft, setKeepDraft] = useState(String(settings.versions_keep));
  const [sealDraft, setSealDraft] = useState(String(settings.seal_idle_minutes));
  const [ageDraft, setAgeDraft] = useState(
    settings.versions_max_age_days === 0 ? "" : String(settings.versions_max_age_days),
  );
  const [trashDraft, setTrashDraft] = useState(String(settings.trash_retention_days));

  const keepInvalid =
    keepDraft.trim() !== "" &&
    (parseIntOrNull(keepDraft) === null ||
      (parseIntOrNull(keepDraft) ?? 0) < VERSIONS_KEEP_MIN ||
      (parseIntOrNull(keepDraft) ?? 0) > VERSIONS_KEEP_MAX);
  const unlimitedAge = settings.versions_max_age_days === 0;

  return (
    <>
      <section className="setcard" aria-label="版本与回收站">
        <h3 className="setcard__title">版本与回收站</h3>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">回收站</span>
            <span className="setrow__desc">删除的内容在这里保留，到期后自动永久删除</span>
          </div>
          <div className="setrow__control">
            <span className="nav-item__count" role="status">
              {trashCount} 条
            </span>
            <Button variant="secondary" size="sm" onClick={onOpenTrash}>
              打开回收站
            </Button>
          </div>
        </div>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">自动封存</span>
            <span className="setrow__desc">停止编辑这么多分钟后自动封存一个版本</span>
          </div>
          <div className="setrow__control">
            <input
              className="field__input"
              aria-label="自动封存（分钟）"
              inputMode="numeric"
              value={sealDraft}
              onChange={(event) => {
                setSealDraft(event.target.value);
                const parsed = parseIntOrNull(event.target.value);
                if (parsed !== null && parsed >= 1) {
                  onPatchSettings({
                    version_trash: { ...settings, seal_idle_minutes: parsed },
                  });
                }
              }}
            />
            <span className="setrow__unit">分钟</span>
          </div>
        </div>

        {/* 保留密度是**定稿规则**（设计 §4.3），M4 只读展示——不给假的"可改"入口 */}
        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">保留密度</span>
            <span className="setrow__desc" title="这是既定规则，暂不开放修改">
              {VERSION_KEEP_DENSITY_HINT}
            </span>
          </div>
        </div>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">每条最多保留</span>
            <span className="setrow__desc">超出后自动稀疏化，最旧的先删</span>
          </div>
          <div className="setrow__control">
            <input
              className="field__input"
              aria-label="每条最多保留（版本数）"
              inputMode="numeric"
              value={keepDraft}
              aria-invalid={keepInvalid}
              onChange={(event) => {
                setKeepDraft(event.target.value);
                const parsed = parseIntOrNull(event.target.value);
                if (parsed !== null && parsed >= VERSIONS_KEEP_MIN && parsed <= VERSIONS_KEEP_MAX) {
                  onPatchSettings({ version_trash: { ...settings, versions_keep: parsed } });
                }
              }}
            />
          </div>
        </div>
        {keepInvalid ? (
          <p className="field__error" role="alert">
            请填 {VERSIONS_KEEP_MIN}–{VERSIONS_KEEP_MAX}
          </p>
        ) : null}

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">最长保留时长</span>
            <span className="setrow__desc">
              {unlimitedAge ? "不限：只按条数稀疏化，不按时间删" : "超过这个天数的版本会被删掉"}
            </span>
          </div>
          <div className="setrow__control">
            <input
              className="field__input"
              aria-label="最长保留时长（天）"
              inputMode="numeric"
              value={ageDraft}
              disabled={unlimitedAge}
              title={unlimitedAge ? "当前是「不限」" : undefined}
              onChange={(event) => {
                setAgeDraft(event.target.value);
                const parsed = parseIntOrNull(event.target.value);
                if (parsed !== null && parsed >= 1) {
                  onPatchSettings({ version_trash: { ...settings, versions_max_age_days: parsed } });
                }
              }}
            />
            <span className="setrow__unit">天</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={unlimitedAge}
                aria-label="不限（最长保留时长）"
                onChange={(event) => {
                  if (event.target.checked) {
                    setAgeDraft("");
                    onPatchSettings({ version_trash: { ...settings, versions_max_age_days: 0 } });
                  } else {
                    // 取消「不限」给一个可用的起点（30 天），而不是留空让用户猜
                    setAgeDraft("30");
                    onPatchSettings({ version_trash: { ...settings, versions_max_age_days: 30 } });
                  }
                }}
              />
              不限
            </label>
          </div>
        </div>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">回收站保留天数</span>
            <span className="setrow__desc">到期由每日维护永久删除</span>
          </div>
          <div className="setrow__control">
            <input
              className="field__input"
              aria-label="回收站保留天数"
              inputMode="numeric"
              value={trashDraft}
              onChange={(event) => {
                setTrashDraft(event.target.value);
                const parsed = parseIntOrNull(event.target.value);
                if (parsed !== null && parsed >= 1) {
                  onPatchSettings({ version_trash: { ...settings, trash_retention_days: parsed } });
                }
              }}
            />
            <span className="setrow__unit">天</span>
          </div>
        </div>

        <p className="hint-line">修改即时生效并同步到其他设备。</p>
      </section>
    </>
  );
}
