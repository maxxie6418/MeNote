// 入口只做装配（架构 §2.3.1）。除挂载外的唯一逻辑：**http 兜底升级到 https**。
//
// 为什么必须在这里做：http 下浏览器不提供 WebCrypto，登录/保存全不可用（真实故障：Cloudflare 的
// 「Always Use HTTPS」默认关闭，直接敲域名会落在 http 上）。放在挂载之前，用户不会先看到一屏
// "无法登录"再被跳走。判断规则（含"本地与局域网不跳"）见 `app/ui/cryptoEnvironment.ts`。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { httpsUpgradeUrl } from "./app/ui/cryptoEnvironment";
import "./app/theme/tokens.css";
import "./app/theme/app.css";

const upgradeUrl = httpsUpgradeUrl();
if (upgradeUrl !== null) {
  // replace：不往历史里塞一条 http 记录，用户按返回键不会又回到不能用的页面
  location.replace(upgradeUrl);
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("挂载点 #root 不存在");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
