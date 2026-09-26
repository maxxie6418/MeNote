/**
 * 数据层入口（架构 §2.3.2：SQL 常量、batch 组装、迁移与自愈都归 `db/`）。
 *
 * 依赖方向：`routes → services → db`。middleware 层的表结构守卫是唯一的例外调用方
 * （属基础设施，不读业务数据）。
 */
export { EXPECTED_SCHEMA_VERSION, ensureSchema, type EnsureSchemaResult } from "./selfheal";
