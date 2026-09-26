/**
 * 加密能力环境自检（DESIGN.md §6.1：说明为什么不能用）。
 *
 * 起因是一次真实误判：云端用 https 打开却看到"当前页面不是安全连接（http）"——提示写死了 http，
 * 而浏览器的实际状态可能完全不同（证书警告被跳过、页面被嵌在 http 的 iframe 里、内置浏览器、
 * 浏览器过旧导致没有 WebCrypto……）。与其猜，不如**把观测到的事实显示出来**：
 * 地址、协议、安全上下文、WebCrypto 是否可用，用户一眼就能抄给我们定位。
 *
 * 注意：WebCrypto 没有可替代实现（PBKDF2 必须由它提供），所以这里只做诊断，不做降级。
 */

export interface CryptoEnvironment {
  /** 浏览器是否认为这是安全上下文 */
  secure: boolean;
  /** `location.protocol`，如 `https:` */
  protocol: string;
  /** 当前地址 */
  href: string;
  /** `crypto.subtle` 是否可用 */
  hasSubtle: boolean;
  /** 人话原因 + 该怎么办 */
  reason: string;
}

export function isSecureContextNow(): boolean {
  if (typeof window === "undefined") return true;
  return window.isSecureContext !== false;
}

export function hasWebCrypto(): boolean {
  return typeof crypto !== "undefined" && Boolean(crypto.subtle);
}

export function inspectCryptoEnvironment(): CryptoEnvironment {
  const protocol = typeof location === "undefined" ? "" : location.protocol;
  const secure = isSecureContextNow();
  const hasSubtle = hasWebCrypto();
  const href = typeof location === "undefined" ? "(未知)" : location.href;

  let reason: string;
  if (!secure && protocol === "http:") {
    reason =
      "页面是用 http 打开的。请改用 https 访问；线上建议在 Cloudflare 打开「SSL/TLS → Edge Certificates → Always Use HTTPS」。";
  } else if (!secure) {
    reason =
      "浏览器把这个页面判为非安全上下文（即使协议是 https）。常见原因：证书警告被跳过、页面被嵌在 http 的 iframe 里、或经由代理 / 应用内置浏览器打开。请确认地址栏没有证书警告。";
  } else {
    reason = "浏览器未提供 WebCrypto。请升级浏览器，或改用较新的 Chrome / Edge / Safari。";
  }

  return { secure, protocol, href, hasSubtle, reason };
}

/** 一句话诊断串（提示里直接显示，便于用户原样反馈） */
export function describeCryptoEnvironment(env: CryptoEnvironment = inspectCryptoEnvironment()): string {
  return `地址 ${env.href} · 协议 ${env.protocol || "未知"} · 安全上下文 ${env.secure ? "是" : "否"} · WebCrypto ${env.hasSubtle ? "可用" : "缺失"}`;
}

/**
 * 该不该把当前页面升级到 https，返回目标地址（不需要升级则 null）。
 *
 * 起因是一次真实故障：Cloudflare 的「Always Use HTTPS」默认**关闭**，用户直接敲域名就落在
 * `http://` 上，而 http 下浏览器不提供 WebCrypto，登录/保存全部不可用。云端开关是治本手段，
 * 这里再加一道**客户端兜底**，让"忘了开开关"或"用 http 链接打开"都不会把用户堵死。
 *
 * 保守起见只升级"明确的公网域名"：
 * - 已经是 https → 不动；
 * - `localhost` / `127.0.0.1` / `[::1]` / `*.local` / 纯 IP（含局域网地址）→ **不升级**
 *   （本地开发与局域网调试都没有 TLS，跳过去会更糟）；
 * - 其余（形如 `example.com`、`sub.example.com`）→ 保留路径与查询串，换成 https。
 */
export function httpsUpgradeUrl(env: CryptoEnvironment = inspectCryptoEnvironment()): string | null {
  if (env.protocol !== "http:") return null;
  if (typeof location === "undefined") return null;
  if (env.secure && env.hasSubtle) return null; // localhost 下 http 也是安全上下文，能用就别跳

  const host = location.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "[::1]" ||
    host === "::1" ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host); // IPv4（含 127.0.0.1 与局域网地址）

  if (isLocal) return null;
  if (!host.includes(".")) return null; // 单标签主机名（内网常见）

  return `https://${location.host}${location.pathname}${location.search}${location.hash}`;
}

