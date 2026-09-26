import { useEffect, useState } from "react";
import { APP_NAME, type HealthResponse } from "@menote/shared";
import "./app.css";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; time: string }
  | { status: "error"; message: string };

function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    fetch("/api/health")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as HealthResponse;
      })
      .then((body) => setHealth({ status: "ok", time: body.time }))
      .catch((err: unknown) =>
        setHealth({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  }, []);

  return (
    <main>
      <h1>Hello {APP_NAME}</h1>
      <p>M0 骨架：前端静态资源 + Worker API + D1 绑定占位。</p>
      <p>
        /api/health：
        {health.status === "loading" && "检查中…"}
        {health.status === "ok" && `已连通（${health.time}）`}
        {health.status === "error" && `失败（${health.message}）`}
      </p>
    </main>
  );
}

export default App;
