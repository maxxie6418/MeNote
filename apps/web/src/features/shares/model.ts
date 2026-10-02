/**
 * 分享的前端模型（M5-S2；《M5 分享设计》§二 / §四）。
 *
 * 纯函数与派生逻辑都在这，界面（ShareDialog / MySharesPage）只做展示与调用：
 * - **密码派生**：与认证同一思路——明文密码不出浏览器，只交盐 + KDF 参数 + 校验值；
 * - **链接拼装**：优先用实例配置的分享子域（独立子域，用户 2026-10-02 拍板），
 *   未配置退回当前站点 origin（同域 `/s/<id>` 同样可用，架构 §十）；
 * - **过期档位**：1 天 / 7 天 / 30 天 / 自定义 / 永不过期（M14-01 定稿）。
 */
import {
  SHARE_KDF_DEFAULT,
  type SharePasswordMaterial,
} from "@menote/shared";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type ShareExpiryChoice = "never" | "1d" | "7d" | "30d" | "custom";

export const SHARE_EXPIRY_CHOICES: ReadonlyArray<{ id: ShareExpiryChoice; label: string }> = [
  { id: "never", label: "永不过期" },
  { id: "1d", label: "1 天" },
  { id: "7d", label: "7 天" },
  { id: "30d", label: "30 天" },
  { id: "custom", label: "自定义" },
];

/** 自定义日期取当天 23:59:59.999（本地时区）：选「10-08」含义就是 10 月 8 日全天可看 */
export function expiryTimestamp(choice: ShareExpiryChoice, now: number, customDate?: string): number | null {
  switch (choice) {
    case "never":
      return null;
    case "1d":
      return now + DAY_MS;
    case "7d":
      return now + 7 * DAY_MS;
    case "30d":
      return now + 30 * DAY_MS;
    case "custom": {
      if (!customDate) return null;
      const end = new Date(`${customDate}T23:59:59.999`);
      const ms = end.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
  }
}

/** 派生分享密码材料：明文不出浏览器（服务端只存盐 + 校验值，两侧各算 HMAC 比对） */
export async function deriveSharePasswordMaterial(password: string): Promise<SharePasswordMaterial> {
  const salt = crypto.getRandomValues(new Uint8Array(SHARE_KDF_DEFAULT.saltBytes));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: SHARE_KDF_DEFAULT.iterations },
    key,
    SHARE_KDF_DEFAULT.dkLen * 8,
  );
  return {
    kdf: { alg: "PBKDF2-SHA256", iterations: SHARE_KDF_DEFAULT.iterations },
    salt: bytesToBase64Url(salt),
    verifier: bytesToBase64Url(new Uint8Array(bits)),
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 分享链接：子域优先，未配置退回当前站点 origin（架构 §十的 `/s/<分享ID>` 形态） */
export function buildShareLink(shareId: string, shareOrigin: string | null): string {
  const base = (shareOrigin ?? "").replace(/\/+$/, "") || window.location.origin;
  return `${base}/s/${shareId}`;
}

export function formatExpiry(expiresAt: number | null): string {
  if (expiresAt === null) return "永不过期";
  const date = new Date(expiresAt);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 撤销某一条目的全部分享（M14-04 的自动失效接线）。
 *
 * 服务端的实时有效性检查本身就能让链接立即死掉（加密 / 移入回收站后访客立刻看到
 * 「链接已失效」）；这里做的是**行清理**——把这些分享从「我的分享」里清掉，
 * 并返回条数供提示「相关分享已自动撤销」。单个撤销失败不打断其余。
 */
export async function revokeItemShares(itemId: string): Promise<number> {
  const { sharesApi } = await import("../../data/api/endpoints");
  const { shares } = await sharesApi.list();
  const mine = shares.filter((share) => share.kind === "item" && share.item_id === itemId);
  let revoked = 0;
  for (const share of mine) {
    try {
      await sharesApi.revoke(share.id);
      revoked += 1;
    } catch {
      // 留给实时失效兜底：链接反正已经打不开了
    }
  }
  return revoked;
}
