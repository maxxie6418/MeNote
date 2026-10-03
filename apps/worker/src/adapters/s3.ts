/**
 * S3 适配器（最小实现：PUT / DELETE / HEAD 探测，AWS SigV4 签名）。
 *
 * ## 为什么不引 AWS SDK
 *
 * 同 `webdav.ts` 的理由：只需要三个动作，而 SigV4 本身就是一段有数的 HMAC 链。
 * 引 SDK 的代价是包体与"默认重试策略不由我们定"——外部子请求 50 个/invocation 的
 * 上限摆在那儿，SDK 自带重试反而容易把额度吃掉。
 *
 * ## 签名范围最小化
 *
 * 只签 `host` + `x-amz-date` + `x-amz-content-sha256`。不发 `x-amz-date` 之外的自定义头，
 * 不做分片上传（单次 PUT 上限 5 GB，而本项目单条笔记硬上限 1.9 MB、附件 20 MB，
 * **最大的情况是整包快照，也不会超过单次 PUT 的能力**）。
 */
import {
  BackupAdapterError,
  fetchWithTimeout,
  type BackupAdapter,
  type BackupAdapterTarget,
} from "./backup-adapter";

/** AWS SigV4 的固定字面量（协议规定，不是我方命名） */
const ALGORITHM = "AWS4-HMAC-SHA256";

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as Uint8Array<ArrayBuffer>,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data)));
}

function sha256Hex(text: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(toHex);
}

interface SignedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

/** SigV4 签名（`us-east-1` 之外的真实 region 走同一个签名算法，只是 scope 里的 region 变） */
async function sign(target: BackupAdapterTarget, request: SignedRequest, now: Date): Promise<Headers> {
  const region = target.region ?? "auto";
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const url = new URL(request.url);

  const payloadHash: string = request.body
    ? toHex(await crypto.subtle.digest("SHA-256", request.body as Uint8Array<ArrayBuffer>))
    : await sha256Hex("");

  const headers: Record<string, string> = {
    ...request.headers,
    host: url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  if (target.username) headers["x-amz-access-key-id"] = target.username;

  // **只签这几个头**：多签一个就要多维护一条，漏签则整个请求 403
  const signedKeys = ["host", "x-amz-content-sha256", "x-amz-date"].sort();
  const canonicalHeaders = signedKeys.map((key) => `${key}:${(headers[key] ?? "").trim()}\n`).join("");
  const signedHeaders = signedKeys.join(";");

  const canonicalRequest = [
    request.method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  let key = await hmac(new TextEncoder().encode(`AWS4${target.secret}`), dateStamp);
  key = await hmac(key, region);
  key = await hmac(key, "s3");
  key = await hmac(key, "aws4_request");
  const signature = toHex(await hmac(key, stringToSign));

  return new Headers({
    ...headers,
    Authorization: `${ALGORITHM} Credential=${headers["x-amz-access-key-id"] ?? ""}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  });
}

export function createS3Adapter(target: BackupAdapterTarget): BackupAdapter {
  const bucket = target.bucket ?? "";
  const base = target.endpoint.replace(/\/+$/, "");

  const url = (relativePath: string): string => `${base}/${bucket}/${relativePath}`;

  return {
    kind: "s3",
    objectPath: (relativePath) => relativePath,

    async put(relativePath, bytes) {
      const now = new Date();
      const headers = await sign(
        target,
        { method: "PUT", url: url(relativePath), headers: {}, body: bytes },
        now,
      );
      const response = await fetchWithTimeout(url(relativePath), {
        method: "PUT",
        headers,
        body: bytes as unknown as BodyInit,
      });
      if (response.status === 412) return false; // 幂等重推
      if (response.status === 401 || response.status === 403) {
        throw new BackupAdapterError("unauthorized", "认证失败：请检查 access key 与 secret key");
      }
      if (!response.ok) {
        throw new BackupAdapterError("rejected", `上传失败（HTTP ${response.status}）`);
      }
      return true;
    },

    async remove(relativePath) {
      const headers = await sign(target, { method: "DELETE", url: url(relativePath), headers: {} }, new Date());
      const response = await fetchWithTimeout(url(relativePath), { method: "DELETE", headers });
      if (!response.ok && response.status !== 404) {
        if (response.status === 401 || response.status === 403) {
          throw new BackupAdapterError("unauthorized", "认证失败：请检查 access key 与 secret key");
        }
        throw new BackupAdapterError("rejected", `删除失败（HTTP ${response.status}）`);
      }
    },

    async probe() {
      // HEAD 桶：不花钱、不写对象，最省的一次"通不通 + 凭据对不对"
      const headers = await sign(
        target,
        { method: "HEAD", url: `${base}/${bucket}`, headers: {} },
        new Date(),
      );
      const response = await fetchWithTimeout(`${base}/${bucket}`, { method: "HEAD", headers });
      if (response.status === 401 || response.status === 403) {
        throw new BackupAdapterError("unauthorized", "认证失败：请检查 access key 与 secret key");
      }
      if (response.status === 404) {
        throw new BackupAdapterError("rejected", "找不到这个桶：请检查桶名与 region");
      }
      if (!response.ok) {
        throw new BackupAdapterError("rejected", `远端返回 HTTP ${response.status}`);
      }
      return { ok: true as const, message: "连接正常，可以写入" };
    },
  };
}
