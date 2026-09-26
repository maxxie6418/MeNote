// 入口只做装配（架构 §2.3.1，≤100 行）：引入全局样式、挂载根组件。
// 路由表、Provider 与同步引擎的装配在 app/App.tsx；Service Worker 注册在 M6。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/theme/tokens.css";
import "./app/theme/app.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("挂载点 #root 不存在");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
