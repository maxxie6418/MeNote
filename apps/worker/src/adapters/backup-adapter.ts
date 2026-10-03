/**
 * 外部备份目标的**适配器接口**（M7 第 4 项）。
 *
 * ## 为什么不引 SDK
 *
 * WebDAV 与 S3 的官方 SDK 各带一堆依赖，而本项目只需要**三个动作**（PUT / DELETE /
 * 探测连通性）。为了三个动作拖进两套 SDK 不划算——而且 SDK 的默认重试、超时、
 * 并发策略都不该由我们控制（外部子请求 50 个的上限摆在那儿）。
 *
 * 所以：**接口定义在这里，实现是两个各不到 150 行的文件**。真到了 SDK 更好用的时候，
 * 换实现不动调用方。
 *
 * ## 一条纪律：错误消息**不含凭据**
 *
 * `BackupAdapterError` 统一收口，构造时**只传一句不含凭据的中文**。
 * 适配器内部拿到的是 `Authorization` 头或签名字段，任何把请求整个序列化进 message
 * 的写法都会把口令带出去——所以 `message` 是必填的纯文本参数，不是随手拼的。
 */
import type { BackupDeletePolicy } from "@menote/shared";

/** 目标在库里的那一行（`services/backup-targets.ts` 的 `BackupTargetRow`） */
export interface BackupAdapterTarget {
  id: string;
  kind: string;
  endpoint: string;
  bucket: string | null;
  region: string | null;
  username: string | null;
  /** 明文凭据。**用完即弃，不要拼进任何字符串** */
  secret: string;
  delete_policy: BackupDeletePolicy;
}

export interface BackupAdapter {
  readonly kind: string;
  /** 远端上放一个文件的完整路径（不含 scheme 与 host） */
  objectPath(relativePath: string): string;
  /** 写一个文件。**返回 false = 远端已存在且内容相同**（幂等重推不算失败） */
  put(objectPath: string, bytes: Uint8Array): Promise<boolean>;
  /** 删一个文件。不存在时按成功处理（幂等） */
  remove(objectPath: string): Promise<void>;
  /** 探测连通性：返回一句给用户看的中文；抛 `BackupAdapterError` 表示不通 */
  probe(): Promise<{ ok: true; message: string }>;
}

/** 适配器错误。`message` **保证不含凭据**（构造点只有适配器内部，那里拿得到 `target.secret`） */
export class BackupAdapterError extends Error {
  constructor(
    readonly reason: "unreachable" | "unauthorized" | "rejected" | "too_large" | "unknown",
    message: string,
  ) {
    super(message);
  }
}

/** Worker 里 `fetch` 对自建目标的统一超时（外部存储可能很慢，10 ms CPU 之外还有墙钟） */
export const ADAPTER_TIMEOUT_MS = 20_000;

/** 带超时的 fetch。**超时要转成 `BackupAdapterError`**，不能把原始异常抛出去 */
export async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADAPTER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new BackupAdapterError(
      "unreachable",
      aborted ? "连接超时，请检查地址与网络" : "连不上远端，请检查地址、网络与证书",
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 把 HTTP 状态翻成不含凭据的中文。`201` / `204` / `412`（已存在）都算成功 */
export function assertWriteOk(response: Response, what: string): boolean {
  if (response.ok) return true;
  if (response.status === 412) return false; // 远端已有：幂等重推
  if (response.status === 401 || response.status === 403) {
    throw new BackupAdapterError("unauthorized", `${what}被拒绝：请检查用户名与凭据`);
  }
  throw new BackupAdapterError("rejected", `${what}失败（HTTP ${response.status}）`);
}
