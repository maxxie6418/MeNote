/**
 * 认证与会话的线上形态与常量（口径见 `docs/modules/Menote-认证与会话设计-v1.md`）。
 *
 * 关键约束：慢哈希（PBKDF2）只在浏览器执行，服务端只做一次 HMAC 比对
 * （免费版 Worker 每请求 10 ms CPU，跑不动 PBKDF2 / Argon2）。
 */
import * as v from "valibot";

/** 会话 Cookie 名（HttpOnly / Secure / SameSite=Lax；需求 §5.4） */
export const SESSION_COOKIE_NAME = "menote_session";

/** 自定义请求头：所有非 GET 的 `/api/*` 必须携带（架构 §13.2，CSRF 第一层） */
export const CSRF_HEADER_NAME = "X-Menote";
export const CSRF_HEADER_VALUE = "1";

/** 会话令牌字节数（需求 §5.4：随机 256 位） */
export const SESSION_TOKEN_BYTES = 32;

/** KDF 参数（架构 §7.2 / 需求 §5.4 修订：统一 PBKDF2-SHA-256，前端零 wasm） */
export const AuthKdfParamsSchema = v.object({
  alg: v.literal("PBKDF2-SHA256"),
  iterations: v.pipe(v.number(), v.integer(), v.minValue(100_000)),
  saltBytes: v.pipe(v.number(), v.integer(), v.minValue(16)),
  dkLen: v.pipe(v.number(), v.integer(), v.minValue(32)),
});
export type AuthKdfParams = v.InferOutput<typeof AuthKdfParamsSchema>;

/** 默认 KDF 参数（600,000 次；上线前须在真机实测，超 2 秒则下调并写回设计稿 §2.1） */
export const LOGIN_KDF_DEFAULT: AuthKdfParams = {
  alg: "PBKDF2-SHA256",
  iterations: 600_000,
  saltBytes: 16,
  dkLen: 32,
};

/** 用户名：1–32 位，只允许字母数字与 `_ - .`；不区分大小写由 DB 的 `COLLATE NOCASE` 保证 */
export const UsernameSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.-]{1,32}$/));

/** 用户角色：首位注册者即 owner（需求 §5.3） */
export const UserRoleSchema = v.picklist(["owner", "member"]);
export type UserRole = v.InferOutput<typeof UserRoleSchema>;

/** `POST /api/auth/prelogin`：取盐与 KDF 参数（不存在的用户名返回确定性假盐） */
export const PreloginRequestSchema = v.object({ username: UsernameSchema });
export const PreloginResponseSchema = v.object({
  /** base64url */
  auth_salt: v.string(),
  auth_kdf: AuthKdfParamsSchema,
});
export type PreloginResponse = v.InferOutput<typeof PreloginResponseSchema>;

/** `POST /api/auth/login` 与 `/register`：提交浏览器派生的登录密钥（base64url） */
export const LoginRequestSchema = v.object({
  username: UsernameSchema,
  login_key: v.string(),
});
export const RegisterRequestSchema = v.object({
  username: UsernameSchema,
  login_key: v.string(),
});

/** `GET /api/auth/me` */
export const MeResponseSchema = v.object({
  id: v.string(),
  username: v.string(),
  role: UserRoleSchema,
});
export type MeResponse = v.InferOutput<typeof MeResponseSchema>;

/** 注册（201）与登录（200）成功后的响应：自动登录，用户信息直接可用 */
export const AuthSessionResponseSchema = v.object({ user: MeResponseSchema });
export type AuthSessionResponse = v.InferOutput<typeof AuthSessionResponseSchema>;

/** `POST /api/auth/password`：新盐由服务端生成，verifier 由服务端算（浏览器拿不到 pepper） */
export const ChangePasswordRequestSchema = v.object({
  login_key: v.string(),
  new_login_key: v.string(),
  new_kdf: v.optional(AuthKdfParamsSchema),
});
export const ChangePasswordResponseSchema = v.object({
  /** 被失效的其他设备会话数（当前设备保留） */
  invalidated_sessions: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type ChangePasswordResponse = v.InferOutput<typeof ChangePasswordResponseSchema>;

/** `GET/PUT /api/admin/registration`（仅 owner；状态存 `app_meta` 的键） */
export const RegistrationStateSchema = v.object({
  open: v.boolean(),
  /** 到期自动关闭的时间戳；0 = 不自动到期 */
  close_at: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type RegistrationState = v.InferOutput<typeof RegistrationStateSchema>;

export const RegistrationUpdateSchema = v.object({
  open: v.boolean(),
  close_at: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
});

/**
 * `GET /api/auth/registration-state`（**公开、无需登录**）：登录页据此决定是否显示注册入口；
 * 库中无任何用户时（`has_users: false`）必须直接进注册页（拆解 M01-01）。
 * 只回两个布尔量，不泄露账号列表等任何用户数据。
 */
export const PublicRegistrationStateSchema = v.object({
  open: v.boolean(),
  has_users: v.boolean(),
});
export type PublicRegistrationState = v.InferOutput<typeof PublicRegistrationStateSchema>;
