// 分享查看器入口（架构 §2.3.1：只挂载，≤50 行）。
// 与主应用共用视觉源（tokens.css + app.css），但**不引入编辑器与同步代码**——
// 这一页访客没有登录态，只做只读呈现（架构 §十）。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../app/theme/tokens.css";
import "../../app/theme/app.css";
import { ShareViewerApp } from "./ui/ShareViewerApp";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("挂载点 #root 不存在");
}

createRoot(rootEl).render(
  <StrictMode>
    <ShareViewerApp />
  </StrictMode>,
);
