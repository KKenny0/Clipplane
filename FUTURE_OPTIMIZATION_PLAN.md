# Clipplane 未来优化与跨平台首次剪藏方案

> **2026-08-12 决策更新：** Clipplane 改为 macOS-first。公开分发只提供签名、公证的 macOS arm64 `.pkg`；Windows 保留 Host、PowerShell setup 与 CI，但仅提供源码安装和 best-effort 支持，不再以 Authenticode 安装器作为发布门槛。本文中“双平台签名安装器同时公开”的段落保留为 2026-07-30 的历史决策快照，不再执行。
>
> 状态：2026-07-30 的决策快照；后续实施状态不在本文持续更新。
>
> 当前基线：`main` at `d9707a2`，产品版本 `0.7.5`。
>
> 本文档用于收拢本轮产品审计建议与 macOS / Windows 安装方案。它不代表安装器、商店条目或公开 Release 已经可用，也不包含任何签名凭据。

## 结论

Clipplane 已经不是缺少核心功能的原型。它当前最需要解决的不是更多剪藏模式、AI 摘要或更多同步目标，而是让真实用户完成并信任这一条路径：

> 不打开终端安装 Clipplane，在五分钟内可靠完成第一次本地剪藏，并立即把结果用于笔记或 Agent。

建设顺序锁定为：

1. **可安装**：交付 macOS arm64 `.pkg` 与 Windows x64 `.exe`，保留同一套扩展、Native Host 和协议。
2. **状态可信**：剪藏创建过程可恢复；同步发生截断时明确显示部分成功。
3. **Agent 连续动作**：保存后直接提供 `Copy for Agent`，不再要求先进入 History。
4. **真实反馈**：在无账号、无遥测前提下提供安全诊断，并把真实失败沉淀为脱敏回归样例。
5. **证据后决策**：通过私测决定 Org 还是 Markdown 应成为主要产品表面。

当前不建设 Hostless 双后端、桌面伴侣应用、MCP、云账号、向量库、自动摘要、更多同步 sink、复杂 History 搜索或全平台同时发布。

## 一、产品目标与边界

### 用户真正要完成的任务

Clipplane 的任务不是保存一份网页副本，而是把用户明确选中的网页内容变成：

- 本地可检查、可移动、可长期保留的普通文件；
- 带来源、捕获方式和状态记录的可追溯笔记；
- 可以继续进入 Org、Markdown 或 Agent 工作流的材料；
- 只有在用户明确配置和触发后才发送到外部服务的内容。

它的核心价值是**边界清楚、本地优先、结果可复查**，不是用更多自动化替代用户判断。

### 当前系统链路

```text
网页 / 选区 / 页面元素
          |
          v
Browser Extension ---- onboarding ---- GitHub Release 安装资产
          |
          | Chrome Native Messaging
          v
共享 Native Host
          |
          +----> inbox.org
          +----> capture Markdown body
          +----> captures.jsonl
          |
          +---- 用户显式 Save + sync ----> Notion / flomo
```

Chrome Native Messaging 要求操作系统注册 Host。扩展自身不能静默完成这一步，因此“不打开终端”应通过原生安装器解决；除非主动放弃部分现有能力，否则“完全无本地安装”不是同一个产品承诺。

## 二、当前状态快照

### 已实现

- `Selection`、`Page`、`Element` 三种明确的捕获边界。
- 本地 Markdown body、`inbox.org`、`captures.jsonl` 与可检查 History。
- 本地先成功、外部同步后执行的保存顺序。
- Windows / macOS 共用的 Node Native Host 与协议版本检查。
- Host 缺失、Host 过期、同步失败等分离的 UI 状态。
- `Copy for Agent` 与 `Copy content`，但入口目前主要位于 History。
- Windows 和 macOS 的自包含 Host bundle；用户无需自行安装 Node。
- Windows `HKCU` Chrome / Edge 注册脚本，以及 macOS 安装、签名、公证脚本。
- Onboarding 已能按操作系统、架构和扩展版本生成固定 Release 资产名。

### 已验证

- 当前源码版本为 `0.7.5`。
- 本轮产品审计时 `npm test` 为 121/121 通过，核心 smoke、local sync smoke、Pages 校验和 Store 包审计通过。
- Windows CI 能在 Windows runner 构建并启动自包含 Host bundle。
- macOS CI 能在 macOS runner 构建并启动自包含 Host bundle。
- `Copy for Agent` 的 Host-side clipboard 路径已存在，不需要新协议或 Agent 服务。

### 尚未完成或尚未验证

- `extension/src/host-distribution.js` 的公开 Host 版本集合仍为空，当前 Onboarding 不会向普通用户展示安装器下载。
- `docs/setup/index.html` 仍明确说明没有公开的双平台签名安装器。
- Windows 只有 Host bundle 和 PowerShell 注册逻辑，没有面向用户的已签名 `.exe` 安装器。
- 用户提供的历史记录表明一个 `v0.6.0` macOS 包曾获 Apple notarization `Accepted`；它与当前 `0.7.5` 不匹配。
- 仓库中的同名 `v0.6.0` 本地副本本轮未通过 `pkgutil` / `stapler` 本地验证。原因可能是副本不一致、未 staple、文件变化或本机验证环境，不能把这份本地文件视为当前可发布资产。
- 尚未在干净 macOS 与 Windows 设备完成安装、首次剪藏、覆盖升级和卸载矩阵。
- Chrome Web Store 尚未公开发布，公开 Issues 为空；这不能证明真实用户没有问题。

### 当前静态风险

1. 新剪藏依次写 capture body、`inbox.org`、`captures.jsonl`。进程在中间退出时，可能留下部分写入。
2. Notion 首次同步最多生成 80 个 blocks，flomo 内容最多发送 5000 字符；当前结果仍可能显示为普通 `synced`。
3. 保存成功后的主要动作仍是 `Open note`；Agent 用户需要进入 History 才能使用 `Copy for Agent`。
4. 当前 Host 发布开关按**版本**生效，而不是按单个系统资产生效。只发布 macOS 包就开放 `0.7.5`，会让 Windows Onboarding 生成一个不存在的 `.exe` 链接，反之亦然。

## 三、优先优化建议

### P0：双平台无终端安装

保留同一个扩展和 Native Host，只增加两种平台安装入口：

- macOS arm64：签名、notarize、staple 的 `.pkg`。
- Windows x64：按当前用户安装并经过 Authenticode 签名的 `.exe`。

公开激活完成标准：

- 一台干净 macOS arm64 设备和一台干净 Windows x64 设备通过完整技术矩阵。
- 5 名非开发者测试者覆盖两个平台，每个平台至少 2 人。
- 至少 4/5 能在五分钟内、不打开终端完成第一次本地剪藏。
- 任一失败都能明确区分下载、安装、浏览器重启、Host 检测和剪藏错误。

### P0：让“已保存、已同步”绝对可信

#### 创建过程

复用现有 capture lock、capture store 与 lifecycle recovery，不引入数据库：

1. 新 capture 先写入 `lifecycle_status: "creating"` 的记录。
2. 写入 capture body。
3. 以 `CAPTURE_ID` 幂等地补入 `inbox.org`。
4. 两项存在后再清除 `creating`，成为正常 active capture。
5. Host 启动或 History 读取时恢复中断的 `creating`：
   - 有 body、缺 Org entry：从记录和 body 补写 Org entry。
   - body 与 Org entry 都存在：完成状态。
   - body 不存在：移除未完成记录，不报告保存成功。

`creating` 可能在崩溃后持久存在，因此实施时应提升 capture schema，并继续让旧 Host 对新 schema fail closed，避免降级后误把未完成记录当作 active。

最小验证是在每个写入边界注入一次失败，检查重启后不会出现“界面说已保存，但三份本地事实互相矛盾”。

#### 外部同步

不立即建设自动分片同步，只先诚实表达现状：

- sink 返回普通 `synced` 时可附加 `partial: true` 与 `warning_code: "content_truncated"`。
- capture 总状态在任一 sink 截断时为 `synced_partial`。
- Popup 与 History 显示 `Synced partially` / `Content truncated`，本地副本仍明确安全。
- 保存截断原因与限制值，但不保存或暴露凭据。

### P1：把 Agent 交接接到保存成功的下一步

直接复用现有 `copy_capture`：

- 新剪藏、重复剪藏和重新激活成功后，结果卡主动作改为 `Copy for Agent`。
- `Open note` 保留为次要动作或继续留在 History。
- 复制失败必须显示失败，不能提前报告成功。
- 不新增 MCP、Agent SDK、协议层或浏览器 `clipboardWrite` 权限。

目标路径为：**网页 → Save local → Copy for Agent → 粘贴到 Agent**。

### P1：建立无遥测反馈闭环

增加用户主动触发的 `Copy diagnostics`，只复制：

- 操作系统与架构；
- 浏览器名称与版本；
- 扩展版本；
- Host 版本；
- Native Messaging 协议版本；
- 当前错误码。

明确禁止包含正文、URL、用户名、notes 路径、配置、token、webhook 或其他凭据。每个经过确认的真实网页捕获失败，应转成一份脱敏 HTML fixture 和一个最小回归测试。

### P2：用私测证据决定 Org 或 Markdown

当前继续保留 Markdown body 与 `inbox.org`，不先建设通用多格式抽象。

在 5–10 名真实用户完成至少一周使用后，根据实际消费路径做一次选择：

- 多数用户在 Emacs / Org 中处理 inbox：继续把 Org 作为主要产品表面。
- 多数用户从 History、Markdown 或 Agent 消费内容：把 Markdown 提升为主要产品表面，Org 作为兼容输出。

没有足够使用证据时维持现状，不扩展更多格式。

## 四、跨平台安装推荐方案

### 选定方案

使用两种原生安装器交付同一个 Native Host：

| 平台 | 首发架构 | 用户资产 | 安装范围 | 浏览器注册 |
| --- | --- | --- | --- | --- |
| macOS | arm64 | `clipplane-host-v0.7.5-macos-arm64.pkg` | 当前脚本的系统级安装 | Chrome + Edge manifests |
| Windows | x64 | `clipplane-host-v0.7.5-windows-x64.exe` | 当前用户，无管理员权限 | Chrome + Edge `HKCU` |

Edge Add-ons 暂不公开上架，但 Host 安装器继续注册 Edge，避免以后重新设计安装格式。

### macOS 交付契约

复用：

- `scripts/package-native-host.mjs`
- `scripts/package-native-host-macos-pkg.sh`
- `scripts/notarize-native-host-macos-pkg.sh`
- `scripts/install-bundled-host-macos.sh`
- `scripts/uninstall-native-host-macos.sh`

发布前必须依次确认：

1. 从当前 `0.7.5` 源码重新生成 arm64 Host bundle。
2. 对 bundle 内所有 Mach-O 使用 Developer ID Application 签名。
3. 使用 Developer ID Installer 签名 `.pkg`。
4. 向 Apple notarization 提交**当前生成的同一文件**。
5. `xcrun stapler staple` 与 `xcrun stapler validate` 通过。
6. `pkgutil --check-signature` 与 `spctl --assess --type install` 通过。
7. 在干净 macOS arm64 设备完成安装、浏览器重启、Host 回检、首次剪藏、覆盖升级和卸载。

历史 `v0.6.0 Accepted` 只能证明当时提交的某个文件被 Apple 接受，不能替代上述 `v0.7.5` 验证。

### Windows 交付契约

选择 Inno Setup 生成 per-user `.exe`，不引入桌面应用框架：

1. 在 Windows x64 上运行现有 `npm run package:host:windows`。
2. 安装器把 bundle 复制到 `%LOCALAPPDATA%\Clipplane Host`。
3. 安装结束时隐藏执行 bundle 内现有的 `install-host.ps1 -Browser all`。
4. 使用 `PrivilegesRequired=lowest`，不要求 UAC 管理员权限。
5. 卸载前运行现有 `uninstall-host.ps1 -Browser all`：
   - 移除 Chrome / Edge `HKCU` 注册；
   - 默认删除 Clipplane 的 Notion / flomo 凭据；
   - 保留 notes 目录、`inbox.org`、capture body 和 `captures.jsonl`。
6. 使用 Authenticode 对安装器和卸载器签名并加可信时间戳。
7. 在干净 Windows x64 设备完成安装、浏览器重启、Host 回检、首次剪藏、覆盖升级和卸载。

首个版本不建设自动更新器。新版本继续通过 Onboarding 下载匹配版本安装器并覆盖安装。

Windows 签名只能证明发布者和文件完整性；新证书或低下载量版本仍可能出现 SmartScreen 提示。不得把“已签名”写成“保证无 SmartScreen 提示”。

### 版本与发布契约

- 扩展版本、Host 版本、Git tag、Release 名称和资产文件名必须一致。
- 不复用 `v0.6.0` 二进制服务 `0.7.5` 扩展。
- Release 资产一经公开不得用同名文件覆盖；修复后发布新版本。
- 为 `.pkg` 和 `.exe` 记录 SHA-256，并从公开 Release 下载后重新计算一次。
- 公开前把当前版本级 `PUBLISHED_HOST_RELEASES` 改为精确资产白名单，只允许：
  - `clipplane-host-v0.7.5-macos-arm64.pkg`
  - `clipplane-host-v0.7.5-windows-x64.exe`
- `getHostAsset` 先根据 `os + arch + version` 生成候选文件名，再检查它是否位于精确白名单；macOS x64、Windows ARM64 和其他未发布组合必须返回 `null`。
- 两个首发资产都存在、签名验证通过并完成远端下载回读后，才同时加入精确白名单并公开激活。
- 公布下载前保持 Setup 页的保守文案，不提供未签名 ZIP 作为公开 fallback。

### 最终用户路径

1. 从 Chrome Web Store 或 private trusted tester 安装扩展。
2. Onboarding 读取系统、架构与当前扩展版本。
3. 用户点击 `Download Host`。
4. 用户双击 `.pkg` 或 `.exe` 完成图形化安装。
5. 用户关闭全部浏览器窗口并重新打开。
6. 用户点击 `Check again`。
7. Host 版本与协议匹配后解锁第一次本地剪藏。

## 五、未选方案

### ZIP + `Install.cmd`

可作为 Windows 私测应急路径：双击脚本即可，不要求用户手工输入命令。但控制台、Execution Policy、SmartScreen 与解压路径会继续制造摩擦，不作为公开质量标准。

### Hostless Lite

可使用 File System Access API 让用户授权目录，达到跨平台免安装。但它会形成第二套存储实现，并弱化或重新设计：

- OS 凭据库；
- Host-side 大内容 clipboard；
- 后台生命周期与锁；
- 打开本地路径；
- 现有同步与错误恢复契约。

只有当私测证明 Native Host 安装是主要流失原因，并且用户愿意接受能力差异时再重新评估。

### 完整桌面伴侣应用

托盘、自动更新和诊断 UI 可能带来更完整体验，但需要新的桌面运行时、签名、更新、安全和支持面。只有 Clipplane 明确转为桌面产品时再建设。

### Microsoft Store / MSIX

它可能改善 Windows 分发信誉，但会增加打包、审核和 Native Messaging 注册兼容工作。首发用签名 per-user `.exe` 足够验证真实需求。

## 六、实施阶段

每个阶段都可以单独合并；后续阶段不发生时，已完成阶段仍保持产品可用。

### 阶段一：双平台安装与公开激活

这是一个发布原子单元：macOS 与 Windows 构建工作可以分别完成，但只有两端都通过后才开放两个精确资产。

预计涉及：

- `installer/windows/clipplane-host.iss`：最小 Inno Setup 定义。
- `scripts/package-native-host-windows-installer.ps1`：编译、签名与验证入口。
- `package.json`：增加 Windows installer 命令。
- `test/host-distribution.test.mjs`：保持未发布与未支持架构 fail closed，并验证两个精确资产名。
- `extension/src/host-distribution.js`：改用精确资产白名单，并在远端资产验证后开放两个首发资产。
- `docs/setup/index.html` 与对应 release 文档：只在真实资产可下载后更新。

不在首版增加 release service、自动更新服务或新的桌面 runtime。签名暂时沿用本机 / Windows 构建环境的受保护身份；只有流程需要重复或多人维护时再迁移到专用 release workflow。

验收和回滚：

- 两端自动构建与 bundle smoke 通过。
- 两端签名、安装、回检、剪藏、升级、卸载通过。
- 远端回读 SHA-256 一致后才开放版本。
- 任一端失败时保持精确资产白名单为空；现有源码安装方式和本地数据不受影响。

### 阶段二：保存与同步状态可信

预计涉及：

- `native-host/clip-core.mjs`
- `native-host/capture-record.mjs`
- `native-host/capture-store.mjs`
- `native-host/history-core.mjs`
- `native-host/sync-core.mjs`
- `native-host/sinks/notion-api.mjs`
- `native-host/sinks/flomo-api.mjs`
- `extension/src/ui-state.js`
- 对应的最小故障注入与 UI 状态测试

本阶段预计超过 8 个文件，因为它跨越本地持久化契约和用户可见状态；不得用只改文案的方式掩盖底层不一致。

验收和回滚：

- 每个创建写入边界中断后均可恢复或安全清理。
- 部分同步不会显示完整同步成功。
- 本地正文始终优先保留。
- schema 提升后旧 Host 对新记录 fail closed；回滚代码前必须先确认没有遗留 `creating` 记录。

### 阶段三：Agent 连续动作与安全诊断

预计涉及：

- `extension/popup.html`
- `extension/popup.js`
- `extension/src/ui-state.js`
- 现有 `copy_capture` 调用路径
- Extension DOM 与 UI state 测试

诊断数据直接由扩展已有 platform、manifest 与 Host status 组成，不新增 Host 协议。

验收和回滚：

- 保存成功后一次点击即可复制 Agent 引用。
- 大内容继续走 Host clipboard，不受 Native Messaging 1 MiB 返回限制。
- 不安全、缺失、删除或 symlink body 继续拒绝复制。
- `Copy diagnostics` 不包含正文、URL、路径或凭据。
- 回滚 UI 不影响 History 中既有 `Copy for Agent`。

### 私测后的格式决策门

这不是预先承诺的代码阶段。只有取得 5–10 名用户一周使用证据后，才决定 Org / Markdown 主次；若证据不足，保持现状。

## 七、验证矩阵

### 通用自动验证

```bash
npm test
npm run smoke
npm run smoke:sync:local
npm run package:extension
npm run package:store
npm run verify:store
npm run verify:pages
```

### macOS 安装资产

```bash
npm run package:host:macos:pkg
npm run notarize:host:macos
pkgutil --check-signature dist/clipplane-host-v0.7.5-macos-arm64.pkg
xcrun stapler validate dist/clipplane-host-v0.7.5-macos-arm64.pkg
spctl --assess --type install --verbose=2 dist/clipplane-host-v0.7.5-macos-arm64.pkg
```

### Windows 安装资产

在 Windows x64 上：

```powershell
npm run package:host:windows
npm run package:host:windows:installer
signtool verify /pa /v .\dist\clipplane-host-v0.7.5-windows-x64.exe
```

### 两个平台的人工路径

| 路径 | 通过标准 |
| --- | --- |
| 全新安装 | 不打开终端；Host 检测成功 |
| Selection / Page / Element | 三种模式各成功保存一条 |
| 保存事实 | body、Org entry、capture record 使用同一 `CAPTURE_ID` |
| Agent 交接 | 复制引用可直接粘贴并定位当前设备正文 |
| Host 缺失 | 显示真实安装入口，不显示 Ready |
| Host 过期 | 要求匹配版本覆盖安装 |
| 覆盖升级 | 旧注册被正确替换，notes 不变 |
| 卸载 | Host 注册与默认凭据删除，notes 保留 |
| Windows SmartScreen | 如实记录提示，不声称签名可保证消除提示 |
| macOS Gatekeeper | 在线与离线安装均验证 stapled ticket |

真实 Notion / flomo 网络写入需要用户自有测试目标和凭据；源码测试与 mock 不能替代这项验证，凭据不得进入日志、fixture、文档或仓库。

## 八、依赖、假设与停止条件

### 外部依赖

- Apple Developer ID Application、Developer ID Installer 与 notarization 权限。
- Windows Authenticode 代码签名身份与可信时间戳服务。
- Windows x64 与 macOS arm64 干净测试环境。
- GitHub Release 发布权限。
- Chrome Web Store private trusted tester 能力。
- Inno Setup，仅作为 Windows 构建工具，不进入 Clipplane 运行时。

### 最脆弱假设

本方案假设用户愿意为了完整本地能力安装一次 Native Host。如果 5 名测试者中有 2 名或更多因安装本身放弃，且问题不能通过签名安装器和清晰 Onboarding 修复，应暂停公开 Store，重新评估 Hostless Lite 的能力边界。

本方案还假设首批 Windows 设备为 x64。若实际设备是 Windows on ARM，在实施前把 Windows arm64 作为单独支持判断；不能仅凭 x64 模拟运行就宣称原生支持。

### 当前需要维护者确认的实施前条件

- Windows Authenticode 签名身份是否已经可用；负责人：维护者。缺失时只允许构建私测安装器，不开放公开 Host 版本。
- 实际 Windows 测试设备架构；负责人：维护者。未确认前按 x64 规划。
- 5 名跨平台非开发者测试者；负责人：维护者。没有测试者时可以完成技术候选，但不能宣布首次使用目标已验证。

### 停止条件

- 任一平台只有 unsigned bundle：不开放公开下载。
- macOS 只有历史 `Accepted` 记录、没有当前文件 staple / Gatekeeper 验证：重新构建，不复用旧包。
- 远端资产名、版本或 SHA-256 不一致：不修改发布 allowlist。
- 安装器卸载会删除 notes：阻止发布。
- 部分同步仍显示完整成功：不宣布状态可信阶段完成。

## 九、明确暂缓

- Windows ARM64、macOS x64、Linux、Firefox、Safari。
- Edge Add-ons 公开上架。
- 自动更新服务。
- Microsoft Store / MSIX。
- Hostless Lite 与第二套本地存储后端。
- 桌面托盘应用。
- 更多同步 sink。
- MCP、向量检索、AI 摘要或自动分析。
- 云账号、Clipplane 云同步、遥测。
- History 搜索、分页、复杂筛选。
- 通用多格式插件系统。

## 十、后续决策入口

下一步不直接同时实施全部建议。应先确认：

1. Windows 测试设备是否为 x64。
2. 是否已有可用于公开分发的 Windows Authenticode 签名身份。
3. 第一轮选择“先完成双平台安装阶段”，还是先完成不依赖外部证书的“状态可信阶段”。

一旦选定阶段，只执行该阶段的范围、验证和回滚，不顺带建设暂缓项。

## 官方依据

- Chrome Native Messaging：
  <https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>
- Apple notarization workflow：
  <https://developer.apple.com/documentation/security/customizing-the-notarization-workflow>
- Microsoft SignTool：
  <https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool>
- Microsoft SmartScreen reputation：
  <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation>
- Inno Setup per-user privileges：
  <https://jrsoftware.org/ishelp/topic_setup_privilegesrequired.htm>
- File System Access API：
  <https://developer.chrome.com/docs/capabilities/web-apis/file-system-access>
