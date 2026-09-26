// 入口只做装配（架构 §2.3.1，≤100 行）：挂载根组件。
// 路由表与 Provider（主题/查询/同步）随 M1/M2 接入；SW 注册在 M6。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("挂载点 #root 不存在");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
