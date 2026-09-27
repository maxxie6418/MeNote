/**
 * 隐私门禁的**判定契约**（唯一一处；见 `docs/modules/Menote-隐私锁设计-v1.md` §3）。
 *
 * 三条前提【已定·用户确认 2026-09-26】：
 * 1. 内容是**明文存储**的（服务端与本机都是），锁定只影响前端渲染与检索可见性；
 * 2. 隐私范围 = 加密空间（恒在内）＋ Memo 及其衍生的待办（可配置）；**单篇加密与范围正交**，
 *    解锁隐私锁不解开单篇，锁定也不清掉单篇的已解密状态；
 * 3. **统计计数不参与门禁**（一律计入全部内容）——因此本模块**故意不提供**"计数用"的判定函数，
 *    以后也不要加：需要计数的地方直接数，不要把 gate 传进去。
 *
 * 前端判定用本模块；服务端 SQL 过滤用 `apps/worker/src/db/privacy.ts` 的
 * `PRIVACY_EXCLUDE_SQL` 常量，两边必须同源（有断言测试盯住）。
 */

/** 隐私锁状态：未启用 / 已锁定 / 已解锁（档位只决定"已解锁"保持多久，不进入判定） */
export type PrivacyLockState = "disabled" | "locked" | "unlocked";

/** 隐私范围成员配置；加密空间恒在范围内，不在这里出现 */
export interface PrivacyScope {
  /** Memo（含由它衍生的待办清单）是否属于隐私范围 */
  memo: boolean;
}

/** 运行时门禁：状态 + 范围 + 本次浏览器会话已解密的单篇集合 + 正文可搜开关 */
export interface PrivacyGate {
  lockState: PrivacyLockState;
  scope: PrivacyScope;
  /** 本次浏览器会话内**已逐篇解密**的条目 id（单篇加密） */
  unlockedItems: ReadonlySet<string>;
  /** 设置项「解锁时可搜索加密内容」——**只作用于正文命中** */
  searchBodiesWhenUnlocked: boolean;
}

/** 判定所需的最小条目形状（结构化，避免与 ItemMeta 耦合、便于测试） */
export interface PrivacyItemFlags {
  id: string;
  type: "note" | "table" | "memo";
  enc_self: 0 | 1;
  in_enc_space: 0 | 1;
  deleted_at: number | null;
}

export const DEFAULT_PRIVACY_SCOPE: PrivacyScope = { memo: true };

/** 带隐私标记的条目（空间内或单篇） */
export function isPrivacyItem(item: {
  enc_self: 0 | 1;
  in_enc_space: 0 | 1;
}): boolean {
  return item.enc_self === 1 || item.in_enc_space === 1;
}

/** 该类内容是否属于隐私范围（`space` 恒真；`memo` 看配置） */
export function isInPrivacyScope(kind: "space" | "memo", scope: PrivacyScope): boolean {
  return kind === "space" ? true : scope.memo;
}

/** 范围门禁此刻是否打开（未启用与已解锁都算打开） */
export function isScopeGateOpen(gate: PrivacyGate): boolean {
  return gate.lockState !== "locked";
}

/** 加密空间此刻是否可以展开浏览（空间恒在范围内） */
export function isSpaceUnlocked(gate: PrivacyGate): boolean {
  return isScopeGateOpen(gate);
}

/** Memo 与待办视图此刻是否可见（账户级；不在范围内时恒可见） */
export function isMemoVisible(gate: PrivacyGate): boolean {
  return isScopeGateOpen(gate) || !isInPrivacyScope("memo", gate.scope);
}

/** 按设置与运行时状态组装 gate（UI 层用；`unlockedItems` 缺省为空集） */
export function privacyGateFrom(
  config: { scope: PrivacyScope; search_bodies_when_unlocked: boolean },
  lockState: PrivacyLockState,
  unlockedItems: ReadonlySet<string> = new Set<string>(),
): PrivacyGate {
  return {
    lockState,
    scope: config.scope,
    unlockedItems,
    searchBodiesWhenUnlocked: config.search_bodies_when_unlocked,
  };
}

/**
 * 问题 1：这条能不能出现在**列表与筛选结果**里。
 *
 * - 回收站里的条目不进普通列表（列表层另有自己的"显示回收站"入口）；
 * - 未启用隐私锁 = 无门禁；
 * - Memo 由"是否属于范围"决定；
 * - 空间内条目只在解锁期间出现（**解锁期间会进入最近编辑/收藏/标签**）；
 * - 单篇加密条目**留在原位**（标题明文），任何状态都列出，只是正文要另判。
 */
export function canShowInList(item: PrivacyItemFlags, gate: PrivacyGate): boolean {
  if (item.deleted_at !== null) return false;
  if (gate.lockState === "disabled") return true;
  if (item.type === "memo") return isMemoVisible(gate);
  if (item.in_enc_space === 1) return isSpaceUnlocked(gate);
  return true;
}

/**
 * 问题 2：这条的**正文**能不能渲染。
 *
 * 空间内条目看隐私锁；单篇加密看**该篇是否已解密**；两者兼有时（空间内 + 单篇标记）
 * 两个条件都要满足——先过隐私锁、再进单篇门（设计 §2.2 不变式 2）。
 */
export function canReadBody(item: PrivacyItemFlags, gate: PrivacyGate): boolean {
  if (item.deleted_at !== null) return false;
  if (gate.lockState === "disabled") return true;
  if (item.type === "memo") return isMemoVisible(gate);

  const spaceOk = item.in_enc_space === 1 ? isSpaceUnlocked(gate) : true;
  const selfOk = item.enc_self === 1 ? gate.unlockedItems.has(item.id) : true;
  return spaceOk && selfOk;
}

/**
 * 问题 3：这条按**哪些字段**参与搜索命中。
 *
 * - 标题（含标签）：空间内条目的标题在锁定时也不可见 → 需要解锁；单篇条目的标题**任何状态可搜**；
 * - 正文：隐私条目一律要求"该篇可读"**且**「解锁时可搜索加密内容」开关打开；普通内容的正文不受该开关影响
 *   （开关只管隐私条目的正文）。
 */
export function searchFields(
  item: PrivacyItemFlags,
  gate: PrivacyGate,
): { title: boolean; body: boolean } {
  if (item.deleted_at !== null) return { title: false, body: false };
  if (gate.lockState === "disabled") return { title: true, body: true };

  if (item.type === "memo") {
    const visible = isMemoVisible(gate);
    return { title: visible, body: visible && gate.searchBodiesWhenUnlocked };
  }

  if (!isPrivacyItem(item)) return { title: true, body: true };

  const spaceOk = item.in_enc_space === 1 ? isSpaceUnlocked(gate) : true;
  const selfOk = item.enc_self === 1 ? gate.unlockedItems.has(item.id) : true;
  return { title: spaceOk, body: spaceOk && selfOk && gate.searchBodiesWhenUnlocked };
}

/** 便利：这条能不能被搜到（标题或正文任一可命中） */
export function isSearchVisible(item: PrivacyItemFlags, gate: PrivacyGate): boolean {
  const fields = searchFields(item, gate);
  return fields.title || fields.body;
}
