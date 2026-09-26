# Menote M1 瀹炴柦璁″垝锛堟牳蹇冮棴鐜級

| 椤?| 鍊?|
|---|---|
| 鏂囨。鐗堟湰 | v1.1 |
| 鏂囨。鐘舵€?| **瀹屾垚锛堝凡褰掓。锛?*鈥斺€擬1 浜?2026-09-26 鏀跺彛锛堝簲鐢ㄧ増鏈?v0.2.0锛夈€傛湭鍋氶」宸查泦涓鍏?`docs/todo/Menote-M2-瀹炴柦璁″垝-v1.md` 搂1.3銆孧1 閬楃暀娓呭崟銆?|
| 鐩殑鍜岄€傜敤鑼冨洿 | M1銆屾牳蹇冮棴鐜€嶇殑鍙墽琛屾媶姝ワ細娉ㄥ唽鐧诲綍 鈫?寤虹瑪璁?鈫?缂栬緫淇濆瓨 鈫?绗簩鍙拌澶囧悓姝ョ湅鍒般€傛瘡姝ョ粰鍑烘秹鍙婃枃浠躲€侀獙鏀剁偣涓庨獙璇佸懡浠?|
| 鏉冨▉绾у埆 | 妯″潡瑙勫垯锛堟墽琛屼緷鎹級銆備笌 `wiki/` 鍐茬獊鏃朵互 wiki 涓哄噯骞跺仠涓嬬‘璁?|
| 鏈€鍚庢洿鏂版棩鏈?| 2026-09-26 |

淇敼璁板綍锛?
| 鏂囨。鐗堟湰 | 搴旂敤鐗堟湰 | 鏃ユ湡 | 淇敼鎽樿 | 淇敼妯″瀷 |
|---|---|---|---|---|
| v1 | v0.1.2 | 2026-09-26 | 鍒濈锛歁1 鍗佷笁涓楠ゃ€佹秹鍙婃枃浠躲€侀獙鏀剁偣銆侀獙璇佸懡浠や笌鏀跺彛鍙ｅ緞 | deepseek-v4.1-flash |
| v1.1 | v0.2.0 | 2026-09-26 | 鏍囪瀹屾垚骞跺綊妗ｏ細M1 鍗佷簩姝ュ叏閮ㄦ墽琛岋紙M1-12 鐨勫彲閫夐」鎸夊垽瀹氱Щ鍏?M2锛岃 M2 璁″垝 搂1.3銆孧1 閬楃暀娓呭崟銆嶏級锛涜ˉ璁板疄娴嬬粨璁猴紙dev 閾捐矾 17 椤规柇瑷€銆佹祻瑙堝櫒鍏ㄩ摼璺蛋鏌ャ€佹柇缃戣ˉ浼犮€佷簯绔笁椤规牳瀵癸級 | deepseek-v4.1-flash |

**涓婃父渚濇嵁**锛歚docs/todo/Menote-寮€鍙戣鍒?v1.md`锛坴1.2锛壜т笁 M1锛沗docs/modules/Menote-鏁版嵁妯″瀷涓庤縼绉昏璁?v1.md`锛沗docs/modules/Menote-鍚屾寮曟搸璁捐-v1.md`锛沗docs/modules/Menote-璁よ瘉涓庝細璇濊璁?v1.md`銆?
**鑼冨洿杈圭晫**锛歁1 涓嶅仛琛ㄦ牸銆侀檮浠朵笌鍥剧墖銆佺増鏈巻鍙层€佸洖鏀剁珯鐣岄潰銆侀殣绉侀攣銆佸垎浜€佸浠姐€佹悳绱㈢晫闈€丮emo 涓庡緟鍔炪€侀椤点€侻1 鐨勭晫闈㈡槸**鍙敤鐨勬渶绠€闂幆**锛屼絾楠ㄦ灦锛堥《鏍?6 鍧?+ 宸﹀彸涓ゆ爮 + 鍒楄〃/姝ｆ枃鍙屾爮锛夋寜 DESIGN.md 涓€娆℃垚鍨嬶紝M2 鍙～鍐呭銆?
---

## 涓€銆佹楠ゆ€昏

| 姝?| 涓婚 | 渚濊禆 | 鍙苟琛?|
|---|---|---|---|
| M1-0 | 涓変唤璁捐绋胯瘎瀹￠€氳繃 | 鈥?| 鈥?|
| M1-1 | 杩佺Щ鑷剤鎵ц鍣?+ 绗竴鏉¤縼绉伙紙8 寮犺〃锛?| M1-0 | 涓?M1-2 骞惰 |
| M1-2 | `packages/shared` 绫诲瀷涓?Valibot schema | M1-0 | 涓?M1-1 骞惰 |
| M1-3 | 璁よ瘉鏈嶅姟涓庤矾鐢憋紙M01-01~05锛?| M1-1銆丮1-2 | 鈥?|
| M1-4 | 浼氳瘽涓棿浠?+ CSRF + 鍝嶅簲澶?| M1-3 | 鈥?|
| M1-5 | items / folders 鏈嶅姟涓庤矾鐢?| M1-4 | 涓?M1-6 骞惰 |
| M1-6 | sync 璺敱鏈€灏忕増 | M1-4銆丮1-5 | 鈥?|
| M1-7 | 鍓嶇鏁版嵁灞傦紙Dexie + 浠撳偍锛?| M1-2 | 涓?M1-3~6 骞惰 |
| M1-8 | 鍚屾寮曟搸锛坥utbox / 鎺ㄦ媺 / 閫変富 / 鍐茬獊鍓湰锛?| M1-6銆丮1-7 | 鈥?|
| M1-9 | 缂栬緫鍣紙CodeMirror 6 + 鑷姩淇濆瓨锛?| M1-8 | 鈥?|
| M1-10 | 鐣岄潰楠ㄦ灦 + 鐧诲綍娉ㄥ唽 + 鍒楄〃 + 鏈€灏忚缃?| M1-3銆丮1-9 | 鈥?|
| M1-11 | 绾夸笂閮ㄧ讲涓庝袱璁惧楠岃瘉 | M1-10 | 鈥?|
| M1-12 | 鏀跺熬锛堣ˉ涓佷繚瀛?/ batch / trash-restore / BroadcastChannel锛?| M1-11 | 鍙Щ鍏?M2 |

---

## 浜屻€侀€愭鎷嗚В

### M1-0 鍓嶇疆璇勫

- 璇勫 `docs/modules/` 涓変唤璁捐绋匡紱**鐢ㄦ埛鐐瑰ご鍚庢墠鍔ㄤ唬鐮?*銆?- 璇勫閫氳繃鍚庢妸璁捐缁撹鍥炲啓 `wiki/`锛堥渶鐢ㄦ埛鍚屾剰锛屾竻鍗曡涓変唤璁捐绋跨殑鏈珷锛夈€?- **楠屾敹鐐?*锛氫笁浠界鐘舵€佺敱"璇勫涓?鏀逛负"鐢熸晥"锛沗wiki/` 鍚屾椤硅幏寰楁壒鍑嗐€?
### M1-1 杩佺Щ鑷剤鎵ц鍣?+ 绗竴鏉¤縼绉?
**娑夊強鏂囦欢**
- `apps/worker/src/db/migrations/0001_init.ts`锛?*18 鏉¤鍙?*锛? 寮?`CREATE TABLE` + 10 鏉?`CREATE INDEX`锛屽唴瀹圭収鎶勩€婃暟鎹ā鍨嬩笌杩佺Щ璁捐銆嬄?.2锛?- `apps/worker/src/db/selfheal.ts`锛堟墽琛屽櫒锛氱増鏈鏌?鈫?鎶㈤攣 鈫?鎵ц 鈫?鏍￠獙 鈫?鍐欑増鏈級
- `apps/worker/src/db/index.ts`锛堝鍑?`ensureSchema`锛?- `apps/worker/src/index.ts`锛堝湪鏈€澶栧眰璋冪敤涓€娆?`ensureSchema`锛屽叆鍙ｄ粛 鈮?00 琛岋級
- `apps/worker/test/schema.test.ts`
- `apps/worker/src/db/migrations/.gitkeep`锛堣鏄庢敼涓?鍙€夋墜宸ラ€氶亾"锛?
**楠屾敹鐐?*
- 绌哄簱棣栦釜璇锋眰鍚庯紝8 寮犺〃涓庡叏閮ㄧ储寮曢綈澶囷紙`sqlite_master` 鏂█锛夈€?- `ensureSchema` 杩炴墦涓ゆ骞傜瓑锛涘苟鍙戜袱璇锋眰鍙墽琛屼竴杞紱涓€斿け璐ヨ繑鍥?503 涓?`schema_version` 涓嶅墠绉汇€?- `items` 鐨?CHECK 鐢熸晥锛堢┖鏍囬绗旇琚嫆銆佹棤鏍囬 Memo 閫氳繃銆丮emo 甯?`folder_id` 琚嫆銆乣size_bytes` 瓒呴檺琚嫆锛夈€?- 鍏ュ彛鏂囦欢浠?鈮?00 琛岋紙ESLint `max-lines` 閫氳繃锛夈€?- **娉?*锛欴DL 涓庣害鏉熻涓哄凡鍦?SQLite锛坄node:sqlite`锛変笂棰勬紨閫氳繃锛堛€婃暟鎹ā鍨嬩笌杩佺Щ璁捐銆嬄?.2 鏈敞锛夛紝杩欓噷瑕佺殑鏄湪鐪熷疄 workerd + D1 涓婂楠屼竴閬嶃€?
**楠岃瘉**锛歚pnpm test`銆乣pnpm lint`銆?
### M1-2 鍏变韩绫诲瀷涓?schema

**娑夊強鏂囦欢**
- `packages/shared/src/`锛歚SyncResponse`銆乣ItemMeta`銆乣FolderMeta`銆乣X-Menote-Meta` 鐨?Valibot schema銆佽璇佽姹?鍝嶅簲绫诲瀷銆佷笂闄?闃堝€煎父閲忥紙娌跨敤鏋舵瀯 搂2.3"甯搁噺锛堜笂闄愩€侀槇鍊硷級"鐨勬棦鏈夊彛寰勶紝**涓嶆柊澧?`API_VERSION` 杩欑被 wiki 閲屾病鏈夌殑鍛藉悕**锛?- `packages/shared/package.json`锛堟柊澧?`valibot` 渚濊禆 鈥斺€?**寮曞叆鐢熶骇渚濊禆锛屽紑宸ュ墠闇€鐢ㄦ埛鐐瑰ご**锛?- `packages/shared/test/`锛坰chema 寰€杩斾笌闈炴硶杈撳叆鐢ㄤ緥锛?- `apps/web/package.json` / `apps/worker/package.json` 涓嶉渶鏀癸紙workspace 渚濊禆宸插湪锛?
**楠屾敹鐐?*锛氫袱绔?`import` 鍚屼竴浠界被鍨嬶紱闈炴硶 `X-Menote-Meta` 琚?schema 鎷掔粷锛沗pnpm typecheck` 閫氳繃銆?
### M1-3 璁よ瘉鏈嶅姟涓庤矾鐢憋紙M01-01~05锛?
**娑夊強鏂囦欢**
- `apps/worker/src/routes/auth.ts`銆乣apps/worker/src/services/auth.ts`銆乣apps/worker/src/services/sessions.ts`銆乣apps/worker/src/services/tokens.ts`
- `apps/worker/src/routes/settings.ts`锛坄/api/admin/registration`锛屼粎 owner锛?- `apps/worker/test/auth.test.ts`銆乣apps/worker/test/isolation.test.ts`
- `.dev.vars.example`锛坄AUTH_PEPPER`锛夆€斺€?*鍏堟敼鏍?`.gitignore` 鎵嶈兘鎻愪氦**锛堢幇鐘?`.dev.vars*` 鎶婂畠涓€骞跺睆钄斤紝瑙併€婅璇佷笌浼氳瘽璁捐銆嬄?锛?- `wrangler.jsonc`锛堝姞 `secrets.required`锛?
**楠屾敹鐐?*锛堢収銆婅璇佷笌浼氳瘽璁捐銆嬄?锛?- prelogin 瀵瑰瓨鍦?涓嶅瓨鍦ㄧ殑鐢ㄦ埛鍚嶈繑鍥?*鍚屽舰鐘?*鍝嶅簲锛涜繛缁袱娆＄浉鍚屼笉瀛樺湪鐢ㄦ埛鍚嶈繑鍥炲悓涓€鍋囩洂銆?- **娉ㄥ唽閲嶅鐢ㄦ埛鍚嶈鎹曡幏鍞竴绾︽潫寮傚父骞舵槧灏勪负 422 `invalid`**锛堝疄娴?`UNIQUE COLLATE NOCASE` 鎶涘紓甯歌€岄潪"0 琛?锛夈€?- 鏀瑰瘑璇锋眰浣撲负 `{ loginKey, newLoginKey, newKdf? }`锛屾柊鐩愮敱鏈嶅姟绔敓鎴愩€乿erifier 鐢辨湇鍔＄绠楋紙娴忚鍣ㄦ嬁涓嶅埌 `AUTH_PEPPER`锛夈€?- 棣栦綅娉ㄥ唽鑰?`role='owner'`锛涘苟鍙戜袱涓娆℃敞鍐屽彧鏈変竴涓垚涓?owner锛涙敞鍐屽紑鍏冲叧闂椂闈為浣嶆敞鍐岃繑鍥?403銆?- 鐧诲綍閿欒缁熶竴 401 鏂囨锛涚 5 娆″け璐ヨ捣 429 涓斿甫鍓╀綑绉掓暟銆?- 鏀瑰瘑鍚庡綋鍓嶈澶囦細璇濅粛鏈夋晥銆佸叾浠栬澶囦細璇濆け鏁堛€?- 涓ょ敤鎴烽殧绂伙細A 鐨?token 璇?B 鐨勮祫婧愯繑鍥?404銆?
**楠岃瘉**锛歚pnpm test`銆?
### M1-4 浼氳瘽涓棿浠?+ CSRF + 鍝嶅簲澶?
**娑夊強鏂囦欢**
- `apps/worker/src/middleware/session.ts`锛堟柊寤虹洰褰曪紱鏋舵瀯鐩綍鏍戠己澶憋紝闇€鍚屾琛?`wiki/`锛?- `apps/worker/src/middleware/csrf.ts`銆乣apps/worker/src/middleware/security-headers.ts`
- `apps/worker/src/index.ts`锛堟寕涓棿浠讹級
- `apps/worker/test/csrf.test.ts`

**楠屾敹鐐?*
- 鏃?Cookie / 杩囨湡浼氳瘽 鈫?401 `unauthenticated`锛岃繃鏈熻琚垹闄ゃ€?- 闈?GET 缂?`X-Menote: 1` 鎴?Origin 涓嶅尮閰?鈫?403 `csrf`銆?- `/api/health` 涓嶅彈 CSRF 绾︽潫銆?- **dev 瀹炴祴**锛歏ite 鎻掍欢涓?Origin 涓?`URL.origin` 涓€鑷达紱`Secure` Cookie 鍦?`http://localhost` 琚帴鍙楋紙Chrome / Firefox 鍚勯獙涓€娆★級銆備笉涓€鑷存椂鍙姞 dev 鍒嗘敮锛屼笉鏀圭敓浜ч€昏緫銆?- 浼氳瘽 `last_seen_at` / `expires_at` 24 灏忔椂鍐呭彧鍐欎竴娆★紙鍙敤璇锋眰璁℃暟鏂█锛夈€?
### M1-5 items / folders 鏈嶅姟涓庤矾鐢?
**娑夊強鏂囦欢**
- `apps/worker/src/routes/items.ts`銆乣apps/worker/src/routes/folders.ts`
- `apps/worker/src/services/items.ts`銆乣apps/worker/src/services/folders.ts`
- `apps/worker/src/db/tables.ts`锛圫QL 甯搁噺锛?- `apps/worker/test/items.test.ts`

**楠屾敹鐐?*锛堝崗璁銆婂悓姝ュ紩鎿庤璁°€嬄?锛?- `PUT /api/items/:id`锛氬鎴风鐢熸垚 ULID锛涢噸澶嶆彁浜ゅ箓绛夛紙1 琛屻€乣rev` 涓嶅銆佺浜屾 200锛夈€?- `GET /api/items/:id/body`锛歚ETag=content_hash`锛宍If-None-Match` 鍛戒腑 304銆?- `PUT /api/items/:id/body`锛?*鍏堝仛棰勬璇?*锛坄rev != base_rev` 涓斿搱甯岀浉鍚?鈫?鐩存帴 200 涓嶅啓搴擄紱鍝堝笇涓嶅悓 鈫?鐩存帴 409 涓嶅啓搴擄級锛屽啀璧?3 璇彞 batch锛涘垽瀹氳 `results[0].meta.changes`锛涙鏂囩敤甯?`rev + content_hash` 鍙屽畧鍗殑 `INSERT ... ON CONFLICT(item_id) DO UPDATE`锛?*涓嶈兘鐢ㄨ８ `INSERT` 鎴栬８ `UPDATE`**锛夛紱**骞跺彂鍚?`base_rev` 鐨勮鐩栫珵鎬佺敤渚嬪繀娴?*鈥斺€斿け璐ヨ€呬笉寰楄鐩栬儨鑰呭凡鎻愪氦鐨勬鏂囷紙瑙併€婂悓姝ュ紩鎿庤璁°€嬄?.4銆伮? 鐢ㄤ緥 11/13/14锛夈€?- `PATCH /api/items/:id/meta` 鐙珛鍒ゅ畾 `meta_rev`銆?- 鏂板缓鏂囦欢澶?+ 鏉＄洰褰掑睘锛沗folder_id` 闈炴硶锛堜笉瀛樺湪 / 灞炰簬浠栦汉锛夆啋 422銆?
### M1-6 sync 璺敱鏈€灏忕増

**娑夊強鏂囦欢**
- `apps/worker/src/routes/sync.ts`銆乣apps/worker/src/services/sync.ts`
- `apps/worker/test/sync.test.ts`

**楠屾敹鐐?*锛堛€婂悓姝ュ紩鎿庤璁°€嬄?.2銆伮?.3銆伮?锛?- `GET /api/sync?cursor=N` 鍙洖鍏冩暟鎹紱items/folders 鍚?鈮?00 琛岋紱`next_cursor` / `has_more` 姝ｇ‘銆?- **鍚屼竴 `sync_seq` 缁勪笉琚垏寮€**锛涗笖 `next_cursor = min(items 鏈, folders 鏈)`锛堜袱绫荤嫭绔嬫煡璇㈢殑鎴柇鐐逛笉鍚岋紝鍙栧ぇ鍊间細姘镐箙婕忔媺锛夈€?- 娓告爣涓嶆紡鎷夛細鍐欏叆 N 鏉″悗鍒嗛〉鎷夊彇锛屽鎴风闆嗗悎涓庢湇鍔＄閫愪竴鐩哥瓑銆?- `sync_seq`锛氫富鍐欏叆鐢ㄥ瓙鏌ヨ鍙?灏嗚鍐欏叆鐨勫€?锛岃鏁板櫒鐢辨潯浠惰鍙ユ帹杩涳紱**涓嶇敤 `RETURNING`銆佷笉鎷嗘垚涓ゆ璇锋眰**銆?- 杞垹琛岄殢澧為噺涓嬪彂锛堝惈 `deleted_at`锛夈€?- 澶氱敤鎴烽殧绂汇€?
### M1-7 鍓嶇鏁版嵁灞?
**娑夊強鏂囦欢**
- `apps/web/src/data/db/`锛圖exie schema銆佷粨鍌ㄥ嚱鏁帮細`items` / `bodies` / `drafts` / `folders` / `outbox` / `syncState`锛?- `apps/web/src/data/api/`锛坒etch 灏佽锛歚X-Menote: 1`銆?5s 瓒呮椂銆侀敊璇爜 鈫?棰嗗煙閿欒鏄犲皠锛?- `apps/web/test/`锛圴itest + `fake-indexeddb`锛?- `apps/web/package.json`锛坄dexie`銆乣fake-indexeddb`锛?
**楠屾敹鐐?*锛氫粨鍌?CRUD 涓?`liveQuery` 璁㈤槄鍙敤锛沷utbox 鍚堝苟瑙勫垯锛堟渶鏂版鏂?+ 鏈€鏃?`baseRev`锛夋湁鍗曟祴锛汥exie 鐗堟湰鍗囩骇鍙竻搴撻噸寤恒€?
### M1-8 鍚屾寮曟搸

**娑夊強鏂囦欢**
- `apps/web/src/data/sync/engine.ts`銆乣push.ts`銆乣pull.ts`銆乣conflict.ts`銆乣leader.ts`锛圵eb Locks锛?- `apps/web/test/sync-*.test.ts`

**楠屾敹鐐?*锛堛€婂悓姝ュ紩鎿庤璁°€嬄?銆伮?锛?- 绂荤嚎缂栬緫 鈫?鍏?outbox锛沗online` 鍚庤嚜鍔ㄨˉ浼犮€?- 409 + `content_hash` 鐩稿悓 鈫?瑙嗕负鎴愬姛銆乷utbox 娓呯┖锛堝搷搴斾涪澶卞満鏅級銆?- 409 + 鍐呭涓嶅悓 鈫?鐢熸垚鍐茬獊鍓湰鏉＄洰锛堟柊 ULID銆佹爣棰樺惈"鍐茬獊鍓湰"锛夛紝鍘熸潯鐩繚鐣欐湇鍔＄鐗堟湰銆?- 閫€閬垮簭鍒?1/2/4/8鈥︹墹60s锛坒ake timers 鏂█锛夛紱瓒呮椂 15s銆?- 涓ゆ爣绛鹃〉鍙湁涓€涓湪鎺ㄦ媺锛圵eb Locks锛夈€?- `full_resync: true` 鍒嗘敮锛氭竻绌烘湰鍦伴噸寤猴紝鏈笂浼犳敼鍔ㄥ厛瀵煎嚭銆?
### M1-9 缂栬緫鍣?
**娑夊強鏂囦欢**
- `apps/web/src/app/editor/Editor.tsx`锛圕odeMirror 6 灏佽锛夈€乣markdown.ts`锛坢arkdown-it + DOMPurify锛?- `apps/web/src/features/notes/model.ts`銆乣ui/`锛坄DocHead` / `DocModeSwitch` / `DocStatusBar`锛?- 鍔ㄦ€?`import()` 缂栬緫鍣ㄥ垎鍖咃紙棣栧睆 鈮?00 KB gzip锛宍pnpm check:size` 浼氬崱锛?
**楠屾敹鐐?*锛?*涓夌缂栬緫妯″紡鍙敤**锛堝弻鏍忓疄鏃堕瑙堜负榛樿銆佷粎缂栬緫 / 浠呴瑙堬紱鍗虫椂娓叉煋妯″紡鐨勭粏鍒欍€愬悗缁畾銆戯紝M1 涓嶅仛锛夛紱鍋滄杈撳叆 2s 淇濆瓨銆佹寔缁緭鍏?30s 涓€娆°€?256KB 鏀惧 5s/60s锛涙湰鍦拌崏绋挎亽 2s 钀界洏锛涚姸鎬佹爮鏄剧ず澶у皬涓庝笁鎬侊紙宸插悓姝?寰呬笂浼?涓婁紶澶辫触锛夛紱杈?1,900,000 瀛楄妭闃绘淇濆瓨骞舵彁绀猴紱棰勮涓嶆敼鍐?DOM锛圖OMPurify锛夛紱GFM 鍙敤銆?
> M04-03 鐨?榛樿缂栬緫妯″紡"璁剧疆椤硅惤鍦?M2-7 鐨勩€岀紪杈戝櫒銆嶅垎绫伙紙M1 璁剧疆澹充笉鍚鍒嗙被锛夛紱妯″紡鍦ㄧ紪杈戝櫒椤堕儴鍙复鏃跺垏鎹€?
### M1-10 鐣岄潰楠ㄦ灦 + 鐧诲綍娉ㄥ唽 + 鍒楄〃 + 鏈€灏忚缃?
**娑夊強鏂囦欢**
- `apps/web/src/app/`锛歚AppShell`銆乣app/topbar/`锛? 鍧楋細`BrandLogo` / `Breadcrumb` / `SearchBox`锛圡1 鍙仛鍗犱綅涓嶅彲鐢級/ `SyncPill` / `PrivacyCapsule`锛圡1 涓嶆樉绀猴級/ `AccountEntry`锛夈€乣app/fnbar/`锛坄NewNoteButton` + 鏈€绠€瀵艰埅锛?- `apps/web/src/features/auth/`锛坄LoginPage` / `RegisterPage` / `AuthGate`锛?- `apps/web/src/features/notes/ui/`锛坄ListPane` / `ItemRow` / `DocPane`锛?- `apps/web/src/features/settings/`锛堝乏鍒?184px 鍒嗙被瀵艰埅 + 銆岄€氱敤銆?銆岃处鎴蜂笌瀹夊叏銆?銆屽疄渚嬬鐞嗐€嶏紱榛樿钀?*閫氱敤**锛屽彧鏀句富棰樹笁妗ｏ級
- `apps/web/src/main.tsx`锛堣矾鐢辫〃 + Provider锛屸墹100 琛岋級
- `apps/web/src/app/theme.css`锛堜护鐗屽眰锛涢鑹?瀛楀彿/鍦嗚/闂磋窛**浠庡師鍨嬪彇鍊煎苟鏍囨敞"涓存椂鍊硷紝寰?DESIGN 搂3 瀹氬瀷鍚庢浛鎹?**锛?
**楠屾敹鐐?*
- 椤舵爮鎭掍负 6 鍧椾笖椤哄簭涓嶅彲鍙橈紱`body` 涓嶆粴鍔紝姣忓眰涓€涓粴鍔ㄥ鍣紙DESIGN.md 搂2.7锛夈€?- 绌虹姸鎬佺粰鍑?涓轰粈涔堢┖ + 涓嬩竴姝ュ仛浠€涔?锛沗InfoHint` 涓嶆壙杞借鍛?閿欒/璁℃暟锛堢姝㈤」 #8锛夈€?- 鎵€鏈夊彲鐐瑰厓绱犻敭鐩樺彲杈?+ `focus-visible`锛涘浘鏍囨寜閽甫 `aria-label`锛圖ESIGN.md 搂6.2锛夈€?- 鏈櫥褰曡闂换鎰忚矾鐢?鈫?鐧诲綍椤碉紱娉ㄥ唽寮€鍏冲叧闂椂鐧诲綍椤典笉鏄剧ず娉ㄥ唽鍏ュ彛銆?- 鏂板缓绗旇 鈫?钀芥牴鐩綍銆佹爣棰樸€屾湭鍛藉悕绗旇銆嶃€佹鏂囦笉棰勫～锛圦24 寤鸿妗堬級銆?- 绉诲姩绔吋瀹瑰簳绾匡細寮规€у竷灞€銆侀潪浠呮偓鍋滃彲鎿嶄綔銆乣viewport` 鍏佽缂╂斁锛堢姝㈤」 #16/#17锛夈€?
### M1-11 閮ㄧ讲涓庝袱璁惧楠岃瘉

- `pnpm build && npx wrangler deploy`锛堥娆￠儴缃茶嚜鍔ㄤ緵缁?D1锛涢涓姹傝Е鍙戣嚜鎰堝缓琛級銆?- **涓嶈鎻愪氦** wrangler 鍥炲啓鐨?`database_id`銆?- 鐪熸満楠岃瘉锛氭闈㈡祻瑙堝櫒 + 鎵嬫満锛堟垨涓や釜娴忚鍣?profile锛夋敞鍐岀櫥褰?鈫?寤虹瑪璁?鈫?涓ゅ彴浜掕 鈫?鏂綉缂栬緫 鈫?鑱旂綉琛ヤ紶銆?- **楠屾敹鐐?*锛氱嚎涓?`/api/health` 姝ｅ父锛涗袱璁惧鏁版嵁涓€鑷达紱鏂綉鎭㈠鍚庢棤涓㈠け锛涙棤 `console.error` 鏈鐞嗗紓甯搞€?
### M1-12 鏀跺熬锛堝彲绉诲叆 M2锛?
- `PATCH /api/items/:id/body` 澧為噺琛ヤ竵锛堚墺64KB 涓旀敼鍔?<25% 涓?鈮?0 鎿嶄綔锛夈€?- `POST /api/batch`锛沗POST /api/items/:id/trash` + `/restore`銆?- BroadcastChannel 骞挎挱涓?宸插湪鍏朵粬鏍囩椤典慨鏀?鎻愮ず銆?- 涓婁紶澶辫触鍒楄〃鐣岄潰銆?- `/api/health?deep=1` 杩斿洖 `schema_version`锛堝彲閫夛級銆?
---

## 涓夈€丮1 鏀跺彛鍙ｅ緞

| 椤?| 瑕佹眰 |
|---|---|
| 鍔熻兘 | 鎷嗚В M01-01~05銆丮04-01/04/05锛? M04-03 鐨勪笁绉嶅熀纭€妯″紡锛夈€丮13-01/02/03/**04锛圡1 鍙蛋"鏈嶅姟绔増鏈繚鐣?+ 鏈湴鍐呭鍙﹀瓨鍐茬獊鍓湰 + 鎻愮ず"鍒嗘敮锛?瀵规瘮涓よ€?/ 淇濈暀鏌愪竴浠?鐨勫畬鏁寸晫闈㈠睘 M2锛?* 鐨勯獙鏀跺彛寰勯€愭潯璧伴€?|
| 璐ㄩ噺 | `pnpm lint` / `pnpm typecheck` / `pnpm test` 鍏ㄧ豢锛沗pnpm check:size` 閫氳繃 |
| 绾夸笂 | 鐢熶骇鍙闂紝涓よ澶囩湡瀹炰竴鑷?|
| 鏂囨。 | 涓変唤璁捐绋跨姸鎬佹敼涓?鐢熸晥"锛沗wiki/` 鍚屾椤规墽琛屽畬姣曪紱`CHANGELOG.md` 璁版潯鐩?|
| 鐗堟湰 | 寮€鍙戞湡鏀瑰姩鍙姩淇鍙凤紙0.1.3銆?.1.4鈥︼級锛?*鏀跺彛鏃朵竴娆℃€?`version` 鈫?`0.2.0`** |

---

## 鍥涖€侀闄╀笌瀵圭瓥

| # | 椋庨櫓 | 瀵圭瓥 |
|---|---|---|
| 1 | 鍚屾鏉′欢 batch 鍐欒剰锛堝啿绐佹椂姝ｆ枃浠嶈瑕嗙洊锛?| M1-5 鐨勯泦鎴愭祴璇曞繀椤诲厛鍐欍€佸厛绾㈠悗缁匡紱鍐茬獊鐢ㄤ緥鏂█ `item_bodies` 鏈彉 |
| 2 | WebCrypto PBKDF2 600k 鍦ㄤ綆绔満瓒呮椂 | M1-3 鐢ㄧ湡鏈哄疄娴嬩竴娆★紱瓒?2s 鍒欓檷鍒?310k 骞跺啓鍥炶璁＄ 搂2.1 |
| 3 | dev 涓?`Secure` Cookie / Origin 鏍￠獙鎶婃湰鍦版墍鏈夊啓鎿嶄綔鎷︽ | M1-4 绗竴澶╁崟鐙獙杩欎袱鏉★紝澶辫触鍐嶅姞 dev 鍒嗘敮 |
| 4 | 棣栧睆浣撶Н鍥?CodeMirror 瓒?200 KB | 缂栬緫鍣ㄤ笌 markdown 娓叉煋鍔ㄦ€?`import()` 鍒嗗寘锛沗check:size` 鍙粺璁?`index.html` 鐩存帴寮曠敤鐨勮剼鏈?|
| 5 | 楠ㄦ灦鍦?M1 鍋氭垚"涓存椂澹?锛孧2 鎺ㄥ€掗噸鎼?| M1 灏辩敤 `AppShell`/`Topbar`/`ListPane`/`DocPane` 鍘熻锛圖ESIGN.md 绂佹椤?#5锛?|
| 6 | 璁捐绋胯瘎瀹℃嫋鏈熷鑷?M1 绌鸿浆 | M1-1锛堣縼绉?DDL锛変笌 M1-2锛堢被鍨嬶級涓嶄緷璧栧悓姝ョ粏鑺傦紝鍙厛骞惰 |
