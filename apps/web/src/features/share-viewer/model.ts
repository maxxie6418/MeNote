/**
 * 分享查看器的数据层（M5-S3；架构 §十）。
 *
 * 访客没有登录态，所以这里**不走 `data/api/client.ts`**（那一层带会话与全局错误映射），
 * 而是直接 `fetch` 公开接口：令牌走 `X-Menote-Share` 头，unlock 走 POST 并带 CSRF 头
 * （查看器与 Worker 同源，与主应用同一层守卫，无特例）。
 *
 * 附件**不能**靠 `<img src>` 直接打公开接口（浏览器发不了自定义头），所以这里
 * 先用令牌把字节取回来做成 object URL，再把正文里的链接改写过去；组件卸载时统一 revoke。
 */
import {
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  SHARE_TOKEN_HEADER,
  extractAttachmentRefs,
  type ShareContent,
  type PublicShareStatus,
  type UnlockResponse,
} from "@menote/shared";

/** 路径形态 `/s/<分享ID>`（架构 §十） */
export function parseShareId(pathname: string): string | null {
  const matched = /^\/s\/([A-Za-z0-9_-]{22})\/?$/.exec(pathname);
  return matched?.[1] ?? null;
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!response.ok) {
    let message = fallbackMessage;
    try {
      const body = text ? (JSON.parse(text) as { message?: string }) : null;
      if (body?.message) message = body.message;
    } catch {
      // 非 JSON 错误体：就用兜底文案
    }
    throw new Error(message);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export function fetchShareStatus(sid: string): Promise<PublicShareStatus> {
  return fetch(`/api/public/shares/${sid}`).then((response) =>
    readJson<PublicShareStatus>(response, "无法读取分享状态"),
  );
}

export function unlockShare(
  sid: string,
  verifier?: string,
): Promise<UnlockResponse> {
  return fetch(`/api/public/shares/${sid}/unlock`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
    },
    body: JSON.stringify(verifier === undefined ? {} : { verifier }),
  }).then((response) => readJson<UnlockResponse>(response, "无法验证访问密码"));
}

export function fetchShareContent(sid: string, token: string): Promise<ShareContent> {
  return fetch(`/api/public/shares/${sid}/content`, {
    headers: { [SHARE_TOKEN_HEADER]: token },
  }).then((response) => readJson<ShareContent>(response, "无法读取分享内容"));
}

export interface AttachmentBlobs {
  /** sha256 -> object URL（取不到的附件不进表，图片位会缺图——如实缺，不编造） */
  urls: Map<string, string>;
  /** 组件卸载时调用：撤销所有 object URL */
  dispose: () => void;
}

/** 取正文引用的全部附件并改写链接；单个失败不阻断其余 */
export async function loadAttachmentBlobs(
  sid: string,
  token: string,
  body: string,
): Promise<{ body: string; blobs: AttachmentBlobs }> {
  const refs = extractAttachmentRefs(body);
  const urls = new Map<string, string>();
  for (const sha of refs) {
    try {
      const response = await fetch(`/api/public/shares/${sid}/att/${sha}`, {
        headers: { [SHARE_TOKEN_HEADER]: token },
      });
      if (!response.ok) continue;
      urls.set(sha, URL.createObjectURL(await response.blob()));
    } catch {
      // 缺图就缺图
    }
  }
  let rewritten = body;
  for (const [sha, url] of urls) {
    rewritten = rewritten.split(`/api/attachments/h/${sha}`).join(url);
  }
  return {
    body: rewritten,
    blobs: {
      urls,
      dispose: () => {
        for (const url of urls.values()) URL.revokeObjectURL(url);
        urls.clear();
      },
    },
  };
}
