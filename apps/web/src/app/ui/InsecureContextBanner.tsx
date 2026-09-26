/**
 * 加密能力不可用时的常驻警告（DESIGN.md：破坏性后果必须保持可见，不进 InfoHint）。
 *
 * 文案不再写死"是 http"——改为**显示观测到的事实**（地址 / 协议 / 安全上下文 / WebCrypto），
 * 因为"https 下却报非安全上下文"是真实发生过的情况（证书警告被跳过、页面被嵌在 http iframe 里、
 * 或经由代理与内置浏览器打开）。见 `cryptoEnvironment.ts` 的起因说明。
 */
import {
  describeCryptoEnvironment,
  inspectCryptoEnvironment,
  type CryptoEnvironment,
} from "./cryptoEnvironment";

export interface InsecureContextBannerProps {
  /** 调用方已探好的环境（App 用）；不传则自行探测 */
  environment?: CryptoEnvironment;
  /**
   * 显式指定可用性，跳过自检：
   * - `true` → 确定可用，不渲染
   * - `false` → 确定不可用，**必定渲染**（测试与"已知不可用"的场景用）
   * - 不传 → 按自检结果决定
   */
  secure?: boolean;
}

export function InsecureContextBanner({ environment, secure }: InsecureContextBannerProps) {
  if (secure === true) return null;

  const env = environment ?? inspectCryptoEnvironment();
  if (secure === undefined && env.secure && env.hasSubtle) return null;

  return (
    <div className="banner banner--danger" role="alert">
      <span>浏览器不提供加密能力，无法登录、注册或保存笔记。{env.reason}</span>
      <code className="banner__facts">{describeCryptoEnvironment(env)}</code>
    </div>
  );
}
