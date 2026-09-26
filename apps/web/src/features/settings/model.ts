/**
 * 设置相关的动作（与界面分离，便于复用与测试）。
 * 改密必须**先 prelogin 取盐**再派生两个登录密钥：服务端存的就是同一个盐（见 services/auth.ts）。
 */
import { authApi } from "../../data/api/endpoints";
import { deriveLoginKey } from "../auth/kdf";

export async function changeLoginPassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ invalidatedSessions: number }> {
  const prelogin = await authApi.prelogin(username);
  const loginKey = await deriveLoginKey(currentPassword, prelogin.auth_salt, prelogin.auth_kdf);
  const newLoginKey = await deriveLoginKey(newPassword, prelogin.auth_salt, prelogin.auth_kdf);

  const result = await authApi.changePassword(loginKey, newLoginKey);
  return { invalidatedSessions: result.invalidated_sessions };
}
