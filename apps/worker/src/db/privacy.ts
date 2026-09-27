/**
 * 服务端的**隐私过滤条件**（唯一一处；《隐私锁设计》§3.4 的 I3）。
 *
 * 哪些地方必须用它：面向 MCP（M6）、分享（M5）、导出/备份（M5）以及**服务端兜底搜索**的
 * 一切查询——即"不该看到隐私内容"的通道。**界面门禁在前端**，这里只负责"通道级不可见"。
 *
 * 为什么是字符串常量而不是纯函数：服务端过滤靠 SQL，客户端判定靠 `@menote/shared` 的
 * `privacy.ts` 纯函数，两边无法共享一段代码；所以这里把条件收敛成**一个字面量**，
 * 并配一条断言测试（组出来的 SQL 里必须出现它），防止有人手写而漂移。
 *
 * 注意：`user_crypto` 那条路径（隐私材料）**不在**此列——它是用户自己的门禁材料，
 * 有会话即可读，不需要排除。
 */

/** 拼给定别名下的排除条件（`items` 表查询默认别名 `i`） */
export function privacyExcludeSql(alias = "i"): string {
  return `${alias}.enc_self = 0 AND ${alias}.in_enc_space = 0`;
}

/** 默认别名（`i`）下的排除条件——服务端各查询直接引用它 */
export const PRIVACY_EXCLUDE_SQL = privacyExcludeSql("i");
