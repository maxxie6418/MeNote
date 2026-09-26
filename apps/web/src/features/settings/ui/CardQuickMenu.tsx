/**
 * 账户快捷菜单的配置卡片（components.md §五 的 `cardQuickMenu`；功能拆解 M18-03）。
 *
 * 5 个候选功能一行一个开关，**即时生效**；清单来自 `@menote/shared` 的 `QUICK_MENU_FEATURES`——
 * 菜单与设置页**同一份数据驱动**（规格要求），所以这里不另抄一份名单。
 *
 * 未实现的候选（立即锁定 M3 / 回收站 M4 / 立即备份 M5）照常可配置，但带 `pendingStep` 说明——
 * 让用户先配好，到那个里程碑就自然生效；比"现在禁用、以后再来配"更省事。
 */
import { QUICK_MENU_FEATURES, type QuickMenuFeature } from "@menote/shared";

export interface CardQuickMenuProps {
  selected: readonly QuickMenuFeature[];
  onChange: (next: QuickMenuFeature[]) => void;
}

export function CardQuickMenu({ selected, onChange }: CardQuickMenuProps) {
  function toggle(id: QuickMenuFeature, on: boolean): void {
    // 保持清单顺序（= 菜单里的显示顺序），所以按候选顺序重建而不是字符串拼接
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(QUICK_MENU_FEATURES.filter((feature) => next.has(feature.id)).map((f) => f.id));
  }

  return (
    <section className="setcard" aria-label="账户快捷菜单">
      <h3 className="setcard__title">账户快捷菜单</h3>
      <p className="setrow__desc">
        点头像弹出菜单里显示哪些功能；「设置」与「退出登录」固定在底部，不在此列。
      </p>
      {QUICK_MENU_FEATURES.map((feature) => (
        <div className="setrow" key={feature.id}>
          <div className="setrow__label">
            <span className="setrow__name">{feature.label}</span>
            {feature.pendingStep ? (
              <span className="setrow__desc">将在 {feature.pendingStep} 生效</span>
            ) : null}
          </div>
          <button
            type="button"
            role="switch"
            className="toggle"
            aria-checked={selected.includes(feature.id)}
            aria-label={feature.label}
            onClick={() => toggle(feature.id, !selected.includes(feature.id))}
          />
        </div>
      ))}
    </section>
  );
}
