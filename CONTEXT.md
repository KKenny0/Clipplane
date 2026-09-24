# CONTEXT — Clipplane 领域词汇表

领域术语的唯一权威。代码、测试、评审讨论都使用这里的词。

## Capture（剪藏）

一次网页剪藏的完整持久状态，由**三重表示**构成，三者必须保持一致：

- **Capture record** — `captures.jsonl` 中的一行 JSON 记录（schema v3），含 `lifecycle_status`、`sync_status`、tags 等元数据。
- **Capture body** — `.clipplane/captures/<id>.md`，自包含的 Markdown 剪藏正文（capture document，带 frontmatter）。
- **Inbox entry** — `inbox.md` 中被 `<!-- clipplane:capture:start/end -->` 标记包裹的条目，等待用户处理。

## Lifecycle（生命周期）

Capture record 上的状态机：`creating → active`、`reactivating → active`、`processing → processed`、`deleting → （删除）`。
未完成转移（pending）的 capture 必须先**恢复（recover）**才能继续操作。

## Capture ledger（剪藏账本）`native-host/capture-ledger.mjs`

三重表示的唯一权威模块：所有对 record / body / inbox entry 的读写都经过它的动词，
变更前的四步不变量（解析路径 → 取变更锁 → 准备存储/迁移 → 恢复 pending）全部是它的 implementation。

Interface（领域数据进出，不含 wire envelope）：

```
openCaptureLedger(options) → ledger   // 解析 notesDir/configDir 覆盖，每条 host 消息开一个
ledger.create(normalized)  → { capture, duplicate, reactivated }  // normalized 由 clip-core 的 normalizePayload 产出
ledger.markProcessed(id)      → { capture }
ledger.remove(id)             → { deletedAt }
ledger.list({lifecycle,limit}) → { summaries, warnings, lifecycle }
ledger.get(id, {withBody})     → { capture, bodyPath, body? }   // withBody 读取含尺寸守卫
ledger.applySyncResults(id, results) → { capture }       // 统一执行 lifecycle 拒绝规则
```

错误模式：`ClipplaneError`（含 code）由 ledger 抛出，`MAX_CAPTURE_CONTENT_BYTES` 是 interface 事实。

## 内部 seam（只允许 ledger import）

`capture-store.mjs`（JSONL）、`capture-record.mjs`（body + managed-path 校验）、
`inbox-markdown.mjs`（inbox 格式）、`inbox-migration.mjs`（迁移）、`capture-lock.mjs`（变更锁）。
它们的测试是模块自有测试（内部 seam 测试），其中构造损坏态的手术仅限恢复场景。

## Host message vocabulary（主机消息词汇表）`native-host/host-protocol.mjs`

跨越扩展↔host seam 的消息类型的唯一权威定义：每个 type 一条
`{ forwarded, gated }` 标志（两者独立，如 process_capture 同时属于两类），
加 `MIN_HOST_PROTOCOL`。`FORWARDED_MESSAGE_TYPES` 与门控集均从词汇派生，不手写。

- 正本在 native-host；`prepare-extension-vendor.mjs` 同步副本到
  `extension/src/host-protocol.js`（入 git），测试断言两份一致。
- `host.mjs` 的分发表（Map）运行时不依赖词汇表，键集一致性由测试断言。
- background.js 的转发列表与 host-protocol 的门控集从副本派生。
- 新增消息类型只改词汇表一处（host 分发表加 handler 是新增能力，非定义同步）。

## 扩展页面模块（extension/src/）

- **Host link（主机链接）** `host-link.js` —— `createHostLink({ sendMessage }).send(message) → { response, problem }`；
  problem = null | host-outdated | host-unavailable | unsupported | failed，失败分类的唯一权威。
- **History view（历史视图）** `history-view.js` —— 捕获轨迹的全部 UX（加载、渲染、六种行内动作、
  confirm 对话框、管理菜单、过滤模式）在一个 interface 后面；hostLink/confirm/notify/
  onHostUnavailable/hostAvailable 全部注入，jsdom 可直接驱动。
- **Settings form（设置表单）** `settings-form.js` —— 字段渲染、存储/同步保存流、consent 状态；
  失败抛出，由页面统一呈现。
- `settings.js` —— 剩余为组合层：Tab 骨架、反馈原语、主机面板、诊断。

## 相邻模块

- `clip-core.mjs` — payload 纯函数（normalizePayload / cleanCapturedMarkdown）+ 响应组装；classifyTags 与 contentHash 是 ledger 的 implementation（classifyTags 导出供测试）。
- `history-core.mjs` — History 视图的 wire 组装、open/copy 便利操作。
- `sync-core.mjs` — sink 编排（notion-api / flomo-api / local-export）与 secrets，结果经 `applySyncResults` 落账。

## 架构词汇

module / interface / implementation / seam / adapter / depth(deep, shallow) / leverage / locality
沿用 codebase-design 词表，不作同义替换。
