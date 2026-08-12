# Clipplane 产品方向与 Markdown Inbox 迁移方案

> 状态：已批准，实施完成，待发布
> 日期：2026-08-12
> 实施版本：`0.8.0`
> 范围：竞品判断、产品定位、Markdown Inbox 存储契约、迁移、验证与发布顺序

## 结论

Clipplane 不应沿着 Obsidian Web Clipper 的功能清单继续扩张。两者处理的不是同一个核心任务：

- Obsidian Web Clipper 把浏览器变成 Obsidian 的可编程采集前端；
- Clipplane 应把网页材料变成一个本地、可复查、可处理、可直接交给 Agent 的 capture。

因此，Clipplane 的主方向确定为：

> **Local Capture Inbox for Humans and Agents**
> 网页材料先成为可追溯的本地 capture，再由人或 Agent 处理，外部服务只是可选目标。

为使存储格式与这一方向一致，活动 Inbox 从 `inbox.org` 迁移到 `inbox.md`。现有 `.clipplane/captures/<capture-id>.md` 继续作为 Clipplane 管理的原始 Markdown 快照和 Agent 读取对象。Org 不再作为运行时输出，只作为旧版本迁移输入和备份存在。

这不是把文件扩展名从 `.org` 改成 `.md`，而是一次存储契约升级：移除 Markdown → Org 的二次转换，改写 Inbox 条目边界、History 生命周期操作、升级迁移和故障恢复。

## 用户真正要完成什么？

已确认的核心使用路径是：

```text
网页 / 选区 / 页面元素
          ↓
      保存到本地
          ↓
    得到可复查的 capture
          ↓
      Copy for Agent
          ↓
       Agent 处理
```

这里有四项不可交换的约束：

1. **原始材料先落本地。** Agent、Notion 或 flomo 失败，不影响本地保存。
2. **捕获边界由用户决定。** Selection、Page、Element 分别对应精确文本、正文和页面区域。
3. **保存结果可以复查。** capture 必须保留来源、捕获方式、时间、正文快照和生命周期状态。
4. **后续处理可以更换。** Agent 和外部 sink 是消费者，不是存储所有者。

这四项约束共同决定：Clipplane 的核心对象不是“笔记应用中的一篇笔记”，而是一个带来源和状态的本地 capture。

## 与 Obsidian Web Clipper 相比，我们在哪里？

截至 2026-08-12，Obsidian Web Clipper 的 Chrome 商店页面显示约 90 万用户、4.8 分和 540 条评分，已经覆盖 Chrome、Firefox、Safari 和 Edge。它提供模板、变量、过滤器、条件与循环、持久高亮、Reader 和 Interpreter。

官方资料：

- [Chrome Web Store](https://chromewebstore.google.com/detail/obsidian-web-clipper/cnjifjpddelmedmihgijeibhnjfabmlf)
- [Web Clipper 介绍](https://obsidian.md/help/web-clipper)
- [Templates](https://obsidian.md/help/web-clipper/templates)
- [Variables](https://obsidian.md/help/web-clipper/variables)
- [Highlighter](https://obsidian.md/help/web-clipper/highlight)
- [Reader](https://obsidian.md/help/web-clipper/reader)
- [Interpreter](https://obsidian.md/help/web-clipper/interpreter)
- [开源仓库](https://github.com/obsidianmd/obsidian-clipper)

| 维度 | 当前判断 | 依据 |
| --- | --- | --- |
| 安装与分发 | Obsidian 明显领先 | 多浏览器、多平台、成熟商店分发；Clipplane 尚未公开上架，仍依赖 Native Host 安装 |
| 捕获可塑性 | Obsidian 明显领先 | 模板能读取 meta、Schema.org、CSS selector，并执行过滤、条件与循环 |
| 阅读与标注 | Obsidian 明显领先 | Reader、持久高亮、回到网页恢复高亮已经形成完整子产品 |
| AI 处理 | Obsidian 功能更多 | Interpreter 可在模板中调用语言模型做提取、总结、解释和翻译 |
| 浏览器权限边界 | Clipplane 更克制 | Clipplane 使用 `activeTab`，只在用户明确操作后捕获；没有全站常驻 content script |
| 本地保存顺序 | Clipplane 方向更明确 | 完整内容先写本地，再尝试任何外部同步 |
| Capture 生命周期 | Clipplane 更完整 | Active、Processed、删除、重新激活、去重、同步重试都围绕同一 capture |
| Agent 交接 | Clipplane 有明确差异 | `Copy for Agent` 提供标题、来源和本地正文路径，Agent 直接读取原始 Markdown 快照 |
| 产品成熟度 | Obsidian 明显领先 | 用户规模、文档、社区模板、公开问题和跨浏览器发布形成持续反馈循环 |

结论不是 Clipplane 整体优于 Obsidian，而是两者的优势分布不同：Obsidian 在采集体验和知识库集成上领先；Clipplane 已经建立了本地 capture 的审计与生命周期基础，但安装、首次使用和优势呈现仍未达到公开产品水平。

## 哪些经验值得借鉴？

### 默认路径要立即可用

Obsidian 的高级功能很多，但第一次使用仍然是打开、预览、保存。Clipplane 的默认路径也必须保持短：安装扩展、安装 Host、保存、看到本地结果、交给 Agent。

Native Host 可以保留，但普通用户不应理解 Native Messaging、扩展 ID、注册表或 launcher。公开发布前必须提供签名安装器和明确的版本回检。

### 所有能力围绕同一个对象

Obsidian 的模板、变量、高亮和 Reader 最终都生成 Obsidian 笔记。Clipplane 的保存、History、同步、处理、删除和 Agent 交接也应全部围绕 capture 展开。

Org、Markdown、History、Agent、Notion 和 flomo 不能表现为六套互不相关的功能。它们的关系应始终是：

```text
Capture
  ├─ 原始正文快照
  ├─ Inbox 中的活动副本
  ├─ 生命周期与同步记录
  └─ Agent / Notion / flomo 等消费者
```

### 捕获失败要给出下一条路

Obsidian 在正文提取不完整时，建议用户改用选择、高亮或自定义模板。Clipplane 已经拥有更简单的三级退路：

```text
Page 提取失败或结果过短
        ↓
提示改用 Element
        ↓
仍不适合时使用 Selection
```

这些模式不应只是三个并列按钮。失败结果应说明哪一层失败，并直接提示下一种捕获边界。

### 让用户看见保存事实

Clipplane 的架构优势目前主要隐藏在实现中。保存结果卡应明确显示：

- 本地保存成功或失败；
- 捕获范围和正文长度；
- capture body 是否存在；
- 同步是完整成功、部分成功还是失败；
- `Copy for Agent` 主动作。

用户不需要理解 `captures.jsonl`，但必须能判断材料是否已经安全落地。

### 公开文案先讲结果

商店页和产品页优先展示三个具体工作流：

1. 剪一段网页材料，直接交给 Agent 分析；
2. 剪一篇文章，进入本地 Markdown Inbox；
3. 外部同步失败，本地 capture 仍在并可重试。

Native Host、协议版本和文件结构用于证明这些承诺，不作为用户第一次理解产品的入口。

## 哪些能力不应跟进？

### 不建设模板语言

变量、过滤器、条件、循环和 selector 会建立一门新的配置语言。它适合高度定制的知识库采集，但会扩大解析、安全、兼容、文档和支持成本，不能强化当前的 Agent Inbox 方向。

### 不内置 Interpreter

Clipplane 应可靠保存原始材料，并交给用户选择的 Agent。若在保存前自动总结或改写，系统必须额外管理模型提供商、凭据、提示词、原文与生成结果的来源关系、失败与重试。这会削弱“原始材料可复查”的承诺。

### 不建设 Reader 和持久网页高亮

这两项需要全站常驻脚本、动态页面兼容、锚点恢复、浏览器存储和跨设备同步，会把产品扩大成阅读器。Selection 与 Element 已经覆盖“明确保存哪一部分”的需求。

### 暂不增加更多 sink

每增加一个 sink，都会增加凭据、隐私声明、API 限额、截断、部分成功、重试和客服矩阵。先把 Notion 与 flomo 的状态表达和失败恢复做可信。

## 为什么 Inbox 要改成 Markdown？

当前实现继承自 [ljg-skill-clip](https://github.com/lijigang/ljg-skill-clip)。原项目把 URL 或文本转换成 Org-mode，并统一追加到 `inbox.org`；这符合它的 Emacs/Org 工作流。

Clipplane 目前已经先产生规范化 Markdown，再执行一次 Markdown → Org 转换，同时把原始 Markdown 写入 `.clipplane/captures/<capture-id>.md`。结果是 Inbox 与 Agent 读取不同格式：

```text
规范化 Markdown
  ├─→ Markdown body：Agent 使用
  └─→ 转换为 Org：用户 Inbox 使用
```

这次转换没有增加 Agent 需要的信息，却会带来格式损失和格式专属状态：

- 链接、标题、表格和代码块可能在转换中变化；
- capture record 保存 `org_heading`、`org_timestamp`；
- History 依赖 Org property drawer 定位条目；
- 文档和支持需要解释用户未必使用的 Org；
- Inbox 与 capture body 的内容难以逐字比较。

改成 Markdown 后，捕获正文从浏览器到 Inbox、body 和 Agent 保持同一种表示。`inbox.md` 是用户可浏览、可处理的工作区；capture body 是 Clipplane 管理的原始来源快照。二者保留的原因不同，因此不合并。

## Markdown Inbox 的格式契约是什么？

不使用 YAML frontmatter。一个 Markdown 文件只有一份规范的文档级 frontmatter，不适合容纳多条 capture。

每条 capture 使用成对 HTML 注释作为机器边界，正文保持普通 Markdown：

```markdown
# Inbox

Clipplane captures waiting to be processed.

<!-- clipplane:capture:start id="20260812T143000-8e12ab3c4d" -->
## Agent memory architecture

- Source: <https://example.com/article>
- Clipped: `2026-08-12T14:30:00+08:00`
- Method: `readability`
- Tags: `ai`, `tech`

这里开始是规范化后的原始 Markdown。

### 小标题

正文、表格、代码块和链接保持 Markdown，不再转换。
<!-- clipplane:capture:end id="20260812T143000-8e12ab3c4d" -->
```

选择成对控制标记，而不是按 Markdown 标题切分，原因是被剪正文可以合法包含任意层级标题。控制标记在渲染器中不可见，同时允许 History 精确删除一个 capture 区间。

解析规则必须 fail closed：

- start/end ID 不一致：拒绝修改并报告 `malformed_inbox_capture`；
- 只有 start 或只有 end：拒绝修改；
- 同一个 ID 出现两次：报告 `duplicate_inbox_capture`；
- 读取后、原子替换前文件发生变化：报告 `inbox_changed`；
- 正文出现与当前 capture ID 完全相同的控制标记：写入前转义该行；
- 未找到目标 ID：保留现有 missing 语义，不猜测用户意图。

## 哪些数据结构会改变？

**Entity delta: +3 / -3**

新增：

- `inbox.md`：新的公开活动工作区；
- capture schema version 3：阻止旧 Host 修改新格式记录；
- `.clipplane/backups/inbox-v2.org`：已有安装迁移时的一次性原文件备份。

移除：

- `inbox.org` 作为活动工作区；
- 新 capture record 中的 `org_heading`；
- 新 capture record 中的 `org_timestamp`。

保持不变：

- `capture_id`；
- `clipped_at` ISO 时间；
- `source_url`、`title`、`tags`、`extraction_method`；
- `.clipplane/captures/<capture-id>.md`；
- `captures.jsonl` 作为生命周期、去重和同步状态记录；
- Native Messaging 的 `clip`、History、同步和 `copy_capture` 对外动作；
- Notion、flomo 和 local-export 的输入正文；
- 浏览器权限。

不增加 `outputFormat` 设置或 Org/Markdown 双模式。双模式会让所有保存、删除、处理、恢复、迁移、测试和文档永久维护两套行为。现在已经有明确的产品决策，旧格式只需要安全迁移。

## 旧 Inbox 怎么迁移？

迁移必须持有现有 capture mutation lock，并遵循“备份、生成、验证、切换”的顺序。

1. 检查 `inbox.md`、`inbox.org`、capture records 和 body 目录。
2. 全新安装直接创建 `inbox.md`。
3. 旧安装先解析 `inbox.org`，收集每个 Clipplane 条目的 `CAPTURE_ID`。
4. 如果出现没有 `CAPTURE_ID` 的用户自建一级标题，中止并报告 `legacy_inbox_contains_unmanaged_entries`。
5. 将原始 `inbox.org` 原子复制到 `.clipplane/backups/inbox-v2.org`；已存在不同内容的备份时不得覆盖，原文件也保留为只读迁移证据。
6. 根据 capture record 与对应 Markdown body，在同目录生成临时 `inbox.md`。
7. 只重建旧 Inbox 中实际存在的 ID。若用户此前手动删除了某条，不应在迁移时把它恢复出来。
8. 重新解析临时文件，核对 ID 集合、条目数量、正文快照和控制标记。
9. 验证 future schema、源文件未变化且目标不存在后，排他发布 `inbox.md`，再把相关记录升级到 schema 3。
10. 迁移成功后，运行时只写 `inbox.md`；原 `inbox.org` 与备份继续保留，但历史备份绝不作为 Inbox 恢复日志重放。

任一步失败都必须删除临时文件，保留旧 Inbox 和旧 schema，不能留下半迁移状态。

以下情况不得自动处理：

- `inbox.md` 与 `inbox.org` 同时存在；
- 旧 Inbox 有未归属 Clipplane 的一级条目；
- 一个 ID 在旧 Inbox 中重复；
- capture record 或 body 缺失，无法验证内容；
- backup 路径已存在且内容不同；
- 文件位于符号链接或 notes 目录之外。

这些情况需要显示具体错误和安全的人工处理说明，不能覆盖任何文件。

## 保存与生命周期如何工作？

Markdown 迁移应与“保存状态可信”一起完成，因为两者修改同一存储契约。

新 capture 的写入顺序：

1. 在 capture store 写入 `lifecycle_status: "creating"` 的 schema 3 记录；
2. 原子写入 capture body；
3. 以 `CAPTURE_ID` 幂等地追加 Markdown Inbox 条目；
4. body 与 Inbox 条目都验证存在后，清除 `creating`；
5. 只有此时才向扩展报告本地保存成功；
6. 用户明确选择 `Save + sync` 时，再执行外部 sink。

Host 启动或 History 读取时恢复中断的 `creating` 与 `reactivating`：

- body 存在、Inbox 条目缺失：从 record 与 body 重建条目；
- body 与 Inbox 条目都存在：完成创建状态；
- body 不存在：移除未完成记录，不报告成功；
- Inbox 条目重复或损坏：停止恢复并显示完整性错误。

`Mark processed` 删除 `inbox.md` 中对应的完整控制区间，但保留 record 和 body。重新剪藏相同内容时，将同一个 capture 重新加入 Inbox，并恢复为 Active。

`Delete local copy` 删除 Inbox 条目、capture record、body 和 Clipplane 管理的 local-export；已经发送到 Notion 或 flomo 的副本不受影响。

## Agent 路径怎么呈现？

保存成功后的结果卡以 `Copy for Agent` 为主动作，`Open note` 为次要动作。新建、重复和重新激活三种成功状态使用同一条连续路径：

```text
Save local
    ↓
本地保存收据
    ↓
Copy for Agent
    ↓
粘贴到本地 Agent session
```

Agent reference 继续包含：

- capture 标题；
- 来源 URL；
- 当前设备上的 capture body 路径。

不把整个 `inbox.md` 交给 Agent，也不让 Agent 默认读取所有未处理材料。用户每次明确选择一个 capture，保持边界清楚。

同时新增 `Copy diagnostics`，只复制：

- 操作系统与架构；
- 浏览器名称与版本；
- 扩展版本；
- Host 版本；
- Native Messaging 协议版本；
- 当前错误码。

诊断中禁止包含正文、URL、用户名、notes 路径、配置、token、webhook 或其他凭据。不新增遥测、账号或远程日志服务。

## 实施范围是什么？

Markdown 存储迁移预计超过 8 个文件。它跨越路径、格式、schema、生命周期、测试和公开文档，不能拆成“先写 Markdown，以后再支持删除”的不完整阶段。

核心文件目标：

- `native-host/paths.mjs`：活动、legacy 与 backup 路径；
- `native-host/clip-core.mjs`：移除 Org 转换，接入 Markdown Inbox renderer；
- `native-host/history-core.mjs`：按控制标记检查、处理和删除；
- `native-host/capture-record.mjs`：schema 3 与格式专属字段清理；
- `native-host/capture-store.mjs`：创建状态与迁移期间的 schema 写入；
- 新增 `native-host/inbox-markdown.mjs`：创建、渲染、解析、追加、删除和完整性检查；
- 新增 `native-host/inbox-migration.mjs`：v2 Org → v3 Markdown 的一次性迁移；
- `extension/popup.js` 与 UI state：保存收据和 `Copy for Agent` 主动作；
- `extension/settings.js`：History 错误、Inbox 路径和诊断操作；
- clip、history、并发、迁移、路径安全和 UI 测试；
- README、英文 README、隐私政策、产品页、帮助页、安装页和未来计划。

不修改：

- Notion 和 flomo API 契约；
- 浏览器捕获算法；
- Readability 依赖；
- 浏览器权限；
- Native Host 之外的新运行时；
- 自动更新、云账号、MCP 或 Agent SDK。

## 发布顺序是什么？

每个阶段必须可以独立发布，并在后续阶段永远不发生时仍然可用。

### 阶段一：Markdown Inbox 与保存可信

作为一个原子版本完成 schema 3、迁移、Markdown Inbox、创建恢复和全部生命周期操作。该阶段完成后，Clipplane 即使没有新的 Agent UI，也已经能稳定使用 Markdown Inbox 和现有 History 中的 `Copy for Agent`。

### 阶段二：Agent 连续动作与安全诊断

把 `Copy for Agent` 移到保存成功卡，增加保存收据和 `Copy diagnostics`。该阶段不改变存储 schema，也不依赖新的外部服务。

### 阶段三：macOS 签名安装与商店首发

完成 macOS arm64 签名并公证的 `.pkg`、Host 版本精确资产白名单和 Chrome Web Store 发布。Windows 保留源码安装与 best-effort 支持，不以 Authenticode 安装器作为发布门槛。商店首发直接使用 Markdown Inbox，不再公开一版 Org 格式后立刻迁移。

### 阶段四：真实使用验证

邀请至少 5 名非开发者完成安装、首次剪藏、Agent 交接、处理和同步失败恢复。把每个确认的网页捕获问题转成脱敏 fixture 与回归测试。验证结果只决定交互和可靠性优化，不重新开放 Org 双模式。

## 怎么验证？

### 自动验证

```powershell
npm test
npm run smoke
npm run smoke:sync:local
npm run package:extension
npm run package:store
npm run verify:store
npm run verify:pages
```

新增测试至少覆盖：

- Selection、Page、Element 写入 `inbox.md`；
- Markdown 标题、链接、表格、代码块和 Unicode 原样保留；
- 正文包含任意 H1/H2/H3 不影响条目解析；
- 控制标记注入被转义；
- duplicate 不产生第二个条目；
- processed capture 重新剪藏后只恢复一个条目；
- Mark processed 只删除目标区间；
- Delete local copy 同时删除受管本地数据；
- start/end 不匹配和重复 ID 时 fail closed；
- Inbox 被外部编辑时报告 `inbox_changed`；
- 创建过程在每个写入边界中断后可恢复或安全清理；
- 标准 v2 Inbox 无损迁移；
- unmanaged legacy entry 导致安全中止；
- 两个 Inbox 同时存在时不覆盖；
- backup 已存在且不同内容时不覆盖；
- schema 3 对旧 Host fail closed；
- CRLF、只读文件、符号链接和目录逃逸继续受保护。

### 人工验收

| 路径 | 通过标准 |
| --- | --- |
| 全新安装 | 第一次保存后只创建 `inbox.md`，不创建 `inbox.org` |
| 旧版本升级 | 原 Org 文件有备份，活动 Inbox 变为 Markdown，条目与正文一致 |
| Markdown 阅读 | 常见编辑器、GitHub 和 Agent 都能直接阅读 |
| 保存收据 | UI 只有在 record、body 和 Inbox 条目一致后显示成功 |
| Agent 交接 | 保存后一次点击复制引用，Agent 能读取对应 body |
| Mark processed | 条目从 Inbox 消失，Processed 历史与 body 保留 |
| 重新剪藏 | 原 capture 回到 Active，不产生重复 ID |
| 同步失败 | 本地保存仍显示安全，外部失败可重试 |
| 损坏 Inbox | 不猜测、不覆盖，显示具体完整性错误 |
| 卸载 | Host 与凭据按既有策略删除，notes、Inbox、body、records 和 backup 保留 |

## 成功标准是什么？

首轮发布用以下结果判断，而不是用新增功能数量判断：

- 5 名非开发者中至少 4 名在 5 分钟内完成首次剪藏；
- 所有显示“保存成功”的 capture 都同时拥有 record、body 和唯一 Inbox 条目；
- 至少一半新 capture 在保存后触发 `Copy for Agent`；
- 测试者能准确解释 Active、Processed、Local saved 和 Synced；
- Markdown 迁移没有覆盖或丢失任何原 `inbox.org`；
- 真实捕获失败能够通过脱敏诊断和 fixture 重现。

## 最脆弱的假设是什么？

本方案假设用户愿意为了可靠本地文件、OS 凭据库、生命周期恢复和大内容 clipboard 安装一次 Native Host。

如果 5 名测试者中有 2 名或更多因为 Host 安装本身放弃，并且签名安装器与清晰 Onboarding 无法解决，就应暂停公开扩张，重新评估 Hostless Lite。Hostless Lite 必须明确能力差异，不能悄悄形成第二套等价存储后端。

迁移方案还假设旧 `inbox.org` 的一级标题主要由 Clipplane 管理。若检测到无 `CAPTURE_ID` 的用户内容，自动迁移必须停止，保留原文件并要求人工拆分。

会改变本方向的证据只有两类：

1. 用户实际上不需要 Agent 交接，只想把内容直接生成到某个笔记应用；
2. Native Host 安装成本持续高于本地可靠性带来的价值。

在这些证据出现前，不以 Obsidian 的模板、Reader、高亮或 Interpreter 功能数量重新定义 Clipplane。

## 已实施的设计摘要

- **Building**：以 Markdown 为唯一活动 Inbox 格式，以 capture body 为 Agent 与审计的原始快照，以 `captures.jsonl` 管理生命周期和同步状态；保存后直接进入 Agent 交接。
- **Not building**：Org 双模式、模板 DSL、Reader、持久网页高亮、内置 AI、更多 sink、云账号、遥测、MCP 和新的桌面运行时。
- **Approach**：先完成 schema 3、可恢复写入和安全迁移，再改善 Agent 连续动作，最后公开商店与签名 Host。
- **Key decisions**：Markdown 全链路一致；Inbox 与 body 各自保留；成对注释定义机器边界；旧 Org 先备份再迁移；损坏或归属不明时 fail closed。
- **Unknowns**：Windows 签名身份、实际 Windows 测试架构和首批测试者名单仍由维护者确认；它们不阻塞 Markdown 实现，但阻塞公开发布声明。

批准后，实现者不需要重新决定产品方向，只需按本文的文件范围、存储契约、迁移顺序、验证矩阵和停止条件执行。
