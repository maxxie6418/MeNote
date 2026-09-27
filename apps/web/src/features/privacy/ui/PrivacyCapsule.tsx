/**
 * 顶栏隐私锁胶囊（`components.md` §十四 `PrivacyCapsule`；界面稿 §一、设计 §9.1）。
 *
 * 三态与视觉（DESIGN.md §5：颜色 + 文字 + 图标三重表意，**图标不作唯一手段**）：
 * - **未启用**：整个不渲染（`lock_state === "disabled"`）；
 * - **已锁定**：[已锁定] 中性色 → 点开解锁框；
 * - **已解锁**：[已解锁 · 4:32] 琥珀色；`本次会话` 档显示文字；**当前设备长期** 用危险色提醒"这台设备一直开着"。
 *
 * 菜单里给的是"当下能做的事"：立即锁定、改档位、锁定此设备。倒计时由本组件自己每秒刷新——
 * 状态机只在**到期那一刻**变化，平时不重渲染，所以界面层要自己 tick。
 *
 * **图标**：sprite 目前只有 `lock`（没有开锁字形），所以两态共用它，靠**颜色 + 文字**区分——
 * 符合"图标不作唯一表意手段"。补齐开锁字形需要动 `Icon.tsx` 与 `DESIGN.md §5.5`，另行确认。
 */
import { Icon } from "../../../app/ui/Icon";
import { useTicker } from "../../../app/ui/useTicker";
import { DropdownMenu, type MenuItemSpec } from "../../../app/ui/Menu";
import type { PrivacyLockState } from "@menote/shared";
import { formatCountdown, TIER_LABELS, type PrivacyTier } from "../model";

export interface PrivacyCapsuleProps {
  lockState: PrivacyLockState;
  tier: PrivacyTier;
  /** `minutes` 档的到期时刻；其它档为 null */
  expiresAt: number | null;
  onRequestUnlock: () => void;
  onLockAll: () => void;
  onChangeTier: (tier: PrivacyTier) => void;
  /** 设备长期档专用：把这台设备锁上（清设备标记） */
  onLockDevice: () => void;
}

/** 胶囊里可点的部分：与 `Pill` 同一套类名，但整体是一个按钮 / 菜单触发器 */
function CapsuleTrigger({
  tone,
  label,
  title,
}: {
  tone: "neutral" | "busy" | "err";
  label: string;
  title: string;
}) {
  return (
    <span className={`pill pill--${tone} pill--action`} title={title}>
      <Icon name="lock" size={13} />
      {label}
    </span>
  );
}

export function PrivacyCapsule({
  lockState,
  tier,
  expiresAt,
  onRequestUnlock,
  onLockAll,
  onChangeTier,
  onLockDevice,
}: PrivacyCapsuleProps) {
  const now = useTicker(lockState === "unlocked" && expiresAt !== null);

  // 未启用 = 整个不显示（拆解 M02-05；M2 验收点也要求"未启用时不渲染"）
  if (lockState === "disabled") return null;

  if (lockState === "locked") {
    return (
      <button
        type="button"
        className="pill pill--neutral pill--action"
        onClick={onRequestUnlock}
        title="隐私锁已锁定；点这里输入隐私密码解锁"
      >
        <Icon name="lock" size={13} />
        已锁定
      </button>
    );
  }

  const device = tier === "device";
  const label = device
    ? "本设备始终解锁"
    : tier === "minutes" && expiresAt !== null
      ? `已解锁 · ${formatCountdown(expiresAt - now)}`
      : "已解锁 · 本次会话";

  const items: MenuItemSpec[] = [
    { id: "lock", label: "立即锁定", icon: "lock", onSelect: onLockAll },
    ...(["minutes", "session", "device"] as PrivacyTier[])
      .filter((option) => option !== tier)
      .map<MenuItemSpec>((option) => ({
        id: `tier:${option}`,
        label: `改为「${TIER_LABELS[option]}」`,
        icon: "clock",
        onSelect: () => onChangeTier(option),
      })),
    ...(device
      ? ([
          { id: "lock-device", label: "锁定此设备", icon: "logout", onSelect: onLockDevice },
        ] satisfies MenuItemSpec[])
      : []),
  ];

  return (
    <DropdownMenu
      label="隐私锁"
      align="right"
      trigger={
        <CapsuleTrigger
          tone={device ? "err" : "busy"}
          label={label}
          title={
            device
              ? "隐私锁在这台设备上长期解锁；点这里可锁定此设备"
              : "隐私锁已解锁；点这里可立即锁定或改档位"
          }
        />
      }
      header={<span className="menu__note">单篇加密的条目仍需各自解密</span>}
      items={items}
    />
  );
}
