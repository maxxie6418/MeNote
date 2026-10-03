/**
 * WebDAV 适配器（最小实现：PUT / DELETE / PROPFIND 探测）。
 *
 * ## 三个动作够干什么
 *
 * 自动备份只需要"把一个文件放到远端某个路径"、"把它删掉"、"看看通不通"。WebDAV 的
 * MKCOL / MOVE / LOCK / PROPPATCH 那一整套**一律不做**——目录靠**逐级建 MKCOL**，
 * 而 MKCOL 失败就当"已经存在"（409），这是幂等的。
 *
 * ## 认证
 *
 * 用户名 + 口令走 HTTP Basic。Worker 里没有别的选择，也不需要别的——
 * 这是把文件推到**用户自己控制的存储**，协议本身没有更强的选项。
 * TLS 由远端负责；我们只接受 `https://`（契约里已经收窄）。
 */
import {
  BackupAdapterError,
  assertWriteOk,
  fetchWithTimeout,
  type BackupAdapter,
  type BackupAdapterTarget,
} from "./backup-adapter";

/**
 * Basic 认证头。
 *
 * **必须先 UTF-8 编码再 base64**：`btoa()` 只吃 Latin1，用户口令里有一个中文就直接抛
 * `InvalidCharacterError`。而且它是**每次请求现算**、不是创建适配器时算好——
 * 否则构造 `createWebdavAdapter` 就会抛，绕过了路由层的 `catch`，变成一个 500/503
 * 而不是"这个目标连不上"。
 */
function basicAuth(username: string, secret: string): string {
  const raw = new TextEncoder().encode(`${username}:${secret}`);
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export function createWebdavAdapter(target: BackupAdapterTarget): BackupAdapter {
  const base = target.endpoint.replace(/\/+$/, "");
  const auth = (): string => basicAuth(target.username ?? "", target.secret);

  const url = (relativePath: string): string => `${base}/${relativePath}`;

  /** 逐级建目录；409 / 405（已存在）当成功 */
  async function ensureDirs(relativePath: string): Promise<void> {
    const parts = relativePath.split("/").slice(0, -1);
    let acc = base;
    for (const part of parts) {
      acc += `/${part}`;
      const response = await fetchWithTimeout(acc, { method: "MKCOL", headers: { Authorization: auth() } });
      if (!response.ok && response.status !== 409 && response.status !== 405) {
        throw new BackupAdapterError("rejected", `创建远端目录失败（HTTP ${response.status}）`);
      }
    }
  }

  return {
    kind: "webdav",
    objectPath: (relativePath) => relativePath,

    async put(relativePath, bytes) {
      await ensureDirs(relativePath);
      const response = await fetchWithTimeout(url(relativePath), {
        method: "PUT",
        headers: { Authorization: auth(), "Content-Type": "application/octet-stream" },
        body: bytes as unknown as BodyInit,
      });
      return assertWriteOk(response, "上传");
    },

    async remove(relativePath) {
      const response = await fetchWithTimeout(url(relativePath), {
        method: "DELETE",
        headers: { Authorization: auth() },
      });
      // 404 = 已经不在了，幂等删除当成功
      if (!response.ok && response.status !== 404) {
        throw new BackupAdapterError("rejected", `删除失败（HTTP ${response.status}）`);
      }
    },

    async probe() {
      // PROPFIND 根目录（Depth: 0）最省：一次往返就知道地址对不对、凭据对不对
      const response = await fetchWithTimeout(base, {
        method: "PROPFIND",
        headers: { Authorization: auth(), Depth: "0" },
      });
      if (response.status === 401 || response.status === 403) {
        throw new BackupAdapterError("unauthorized", "认证失败：请检查用户名与口令");
      }
      if (!response.ok && response.status !== 207) {
        throw new BackupAdapterError("rejected", `远端返回 HTTP ${response.status}`);
      }
      return { ok: true as const, message: "连接正常，可以写入" };
    },
  };
}
