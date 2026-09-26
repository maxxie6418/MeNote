/**
 * 非安全连接的常驻警告。
 *
 * 为什么必须有：浏览器只在**安全上下文**（https 或 localhost）提供 WebCrypto。
 * 用 `http://` 打开部署好的站点时，`crypto.subtle` 不存在，登录/注册/保存全都会失败，
 * 而用户看到的是一句 "Cannot read properties of undefined (reading 'importKey')"（M1 实测踩到）。
 *
 * 按 DESIGN.md：**破坏性后果必须保持可见**，所以这里用常驻横幅而不是 InfoHint。
 */
export function InsecureContextBanner({ secure }: { secure: boolean }) {
  if (secure) return null;

  return (
    <div className="banner banner--danger" role="alert">
      当前页面不是安全连接（http），浏览器不提供加密能力，无法登录、注册或保存笔记。请改用
      https 打开本应用。
    </div>
  );
}

/** 当前是否处于安全上下文（非浏览器环境按安全处理，避免误报） */
export function isSecureContextNow(): boolean {
  if (typeof window === "undefined") return true;
  return window.isSecureContext !== false;
}
