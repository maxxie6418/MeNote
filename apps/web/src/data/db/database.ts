/** 本地库单例（浏览器里只有一个 IndexedDB 库；测试通过 `db.delete()` 重置） */
import { MenoteDatabase } from "./schema";

export const db = new MenoteDatabase();
