# Clipplane Chrome Web Store 上架前实施计划

## 结论

Clipplane 继续采用“浏览器扩展 + 本地 Native Messaging Host”的架构。Chrome Web Store 只分发扩展，Windows 和 macOS 的 Native Host 通过签名安装包单独分发。首个商店版本定为 `0.6.0`；当前未发布的多策略捕获改动先作为 `0.5.0` 基线收口，避免把捕获功能、商店身份迁移、凭据安全和安装器混进同一个提交。

这项工作预计涉及 20 个以上文件、Chrome Web Store、Windows 安装器、macOS 安装器和 GitHub Actions。下面每个阶段都必须独立可合并；后续阶段停滞时，前一阶段仍保持可用。

## 实施状态（2026-07-10）

- 阶段 1 已完成代码收口并提交为 `76ae184`；真实 Chrome/Edge 验收仍由用户执行。
- 阶段 2 已完成并提交为 `f743b6b`：命令边界、flomo 校验、来源 URL 脱敏和原生凭据存储均已有测试。
- 阶段 3 已完成代码实施：公开隐私政策、逐 sink 显式同意、最低 Chrome 版本、最终 ZIP 审计与 CI 已落地。提交和真实 CI 结果在本轮实施结束时补记。
- 人工关口 A 尚未完成，因此阶段 4 的 canonical Store ID 切换被明确阻塞；不得猜测或临时生成生产 ID。
- 阶段 5 至 7 中不依赖 Store ID 和签名凭据的部分继续实施；签名、公证、真实商店素材和 Dashboard 提交保留为人工事项。

## 目标与成功标准

完成后必须同时满足：

1. 商店安装的扩展使用 Chrome Web Store 分配的固定 ID，Native Host 只允许明确列出的 Store ID 和迁移期 legacy ID。
2. 扩展仍只请求 `activeTab`、`contextMenus`、`nativeMessaging`、`scripting` 和 `storage`，不新增全站 `host_permissions`。
3. 网页内容默认只保存到本机；只有用户点击 `Save + sync` 才发送到已启用的 Notion 或 flomo。
4. Notion token 和 flomo webhook 不再明文写入 JSON，而是进入 Windows Credential Manager 或 macOS Keychain。
5. flomo 只接受 HTTPS 官方 webhook；来源 URL 在保存和同步前移除 credentials、fragment、追踪参数和敏感 query 值。
6. Windows 和 macOS 用户安装 Native Host 时不需要自行安装 Node.js、下载源码或运行 `npm install`。
7. 新用户可以从首次安装页完成 Host 安装、状态检查和第一条本地剪藏。
8. Chrome Web Store 的隐私政策、数据声明、权限解释、商店文案和截图与真实行为一致。
9. CI 可以重建并检查扩展 ZIP 和两端 Host 包；真实 Chrome 验收覆盖 Selection、Page、Element、History 和显式同步。

## 责任分类

| 标记 | 责任 | 含义 |
| --- | --- | --- |
| `AGENT` | 可直接实施 | 可以在当前仓库中完成代码、测试、文档、CI、未签名安装包和商店素材。 |
| `USER` | 必须人工完成 | 涉及付费账号、浏览器商店后台、证书购买、法律确认、系统钥匙串授权或最终提交。 |
| `USER -> AGENT` | 人工产生结果后继续实施 | 用户只返回非秘密标识或确认结果；Agent 根据结果更新仓库。不得传递私钥、证书密码、token 或 webhook。 |

## 范围与非范围

实施范围：当前 Chrome/Edge 扩展、Native Host、安全存储、Windows/macOS 安装器、首次安装体验、CI、隐私和商店提交材料。

不在本轮范围：Firefox、Safari、Linux 公共安装器、云端 Clipplane 服务、账号系统、遥测、付费功能、自动 AI 摘要、Chrome Web Store API 自动发布。第一版商店提交仍由用户在 Developer Dashboard 手动完成。

## 阶段 1：收口当前 `0.5.0` 捕获基线

责任：`AGENT` 实施，`USER` 完成真实浏览器验收。

### AGENT

1. 保持当前 Selection、Readability Page、DOM fallback 和 Element picker 的实现边界不变。
2. 运行 `npm test`、两个 smoke、doctor、扩展打包和 ZIP 内容检查。
3. 将 `package.json`、`package-lock.json` 和 `extension/manifest.json` 同步为 `0.5.0`。
4. 更新 README 和 HANDOFF，使其只描述已经实现的行为。
5. 提交时排除既有的 `native-host/clipplane-host.cmd` 行尾变化，提交边界为 `feat: add multi-strategy page capture`。

### USER

1. 在真实 Chrome 中注册当前 Native Host。
2. 验收 Selection 精确文本、Readability 文章、短页面 fallback、Element 确认、`Escape` 取消和超时不写入。
3. 在 Edge 至少重复 Selection、Page 和 Element 三条主路径。

### 完成门槛

真实浏览器验收通过后才能发布 GitHub `v0.5.0`。如果用户暂时不发布，代码仍可作为独立提交进入 `main`，但不得把它描述成已上架版本。

## 阶段 2：关闭隐私与安全缺口

责任：`AGENT`，可立即开始，不依赖商店账号。

### 2.1 Windows 命令边界

1. 修改 `native-host/settings-core.mjs`，Windows 直接启动 `explorer.exe` 并把目标路径作为独立参数传入，不再经过 `cmd.exe /c start`。
2. 为包含空格、`&`、`|`、圆括号和非 ASCII 字符的路径增加回归测试。

### 2.2 flomo 传输边界

1. 在 `native-host/sinks/flomo-api.mjs` 增加结构化 URL 校验。
2. 仅允许 `https:`、hostname `flomoapp.com`、默认 HTTPS 端口和 `/iwh/` 路径。
3. 拒绝 URL credentials、fragment、localhost、IP 地址和其他域名。
4. 设置页保存 webhook 时先校验，Native Host 发送前再次校验；错误码统一为 `invalid_webhook_url`。

### 2.3 来源 URL 脱敏

1. 新增 `native-host/url-sanitizer.mjs`，成为持久化和同步前的唯一 URL 入口。
2. 移除 username、password 和 fragment。
3. 删除 `utm_*`、`fbclid`、`gclid` 等追踪参数。
4. 将参数名匹配 `token`、`access_token`、`code`、`key`、`auth`、`signature`、`session`、`secret` 的值替换为 `[redacted]`，保留参数名以说明 URL 发生过脱敏。
5. 对普通语义 query 保持原样，避免破坏文章和搜索页面来源。

### 2.4 系统凭据库

1. 添加固定版本的 `cross-keychain` 生产依赖，封装为 `native-host/secret-store.mjs`。
2. service 固定为 `Clipplane`，account 固定为 `notion-token` 和 `flomo-webhook`。
3. 生产环境只接受 Windows Credential Manager 和 macOS Keychain 原生后端；禁止 file backend、null backend 和 shell fallback。原生后端不可用时禁用对应 sink，并返回可操作错误，不退回明文存储。
4. `config.json` 只保留 sink 是否启用、page ID、tags 等非秘密字段。
5. 兼容已发布的明文配置：读取到旧 token/webhook 时，先写入系统凭据库并回读确认，成功后再原子重写 JSON 删除明文。任何一步失败都不得删除旧值，并在设置页显示迁移失败。
6. 环境变量保留为开发覆盖路径，但不写回配置、不出现在日志和 Native Messaging 响应中。
7. 卸载器提供“保留本地笔记”和“删除 Clipplane 凭据”两个独立选择，默认保留笔记、删除应用凭据。

依赖失效策略：系统凭据库不可用时，本地剪藏继续工作，外部同步保持关闭。这保证外部依赖故障不会破坏 local-first 主路径。

### 阶段验证

```powershell
npm test
npm run smoke
npm run smoke:sync:local
```

测试必须覆盖恶意路径字符、HTTP webhook、非 flomo 域名、敏感 URL 参数、凭据迁移成功、迁移失败不删旧值，以及凭据从不出现在 public config、错误和日志中。

## 阶段 3：补齐商店合规材料和自动门禁

责任：`AGENT`，可立即开始，不依赖商店账号。

### 3.1 隐私与显式告知

1. 新增根目录 `PRIVACY.md`，披露 Website content、Web history 和 Authentication information。
2. 明确默认本地存储位置、可选 Notion/flomo 传输、保留和删除方式、无遥测、无广告、无出售、无人为读取，以及 Chrome Web Store Limited Use 承诺。
3. README 中加入一跳可达的 Privacy 链接。
4. Sync 设置页在启用开关之前显示：启用后，只有点击 `Save + sync` 才会把剪藏正文、标题和脱敏后的来源 URL 发给对应服务。
5. 第一次启用每个外部 sink 时要求用户勾选确认；确认状态只记录 sink 名称、政策版本和时间，不记录内容。

### 3.2 Manifest 和包验证

1. 添加 `minimum_chrome_version: "102"`，与 `chrome.storage.session` 的最低版本一致。
2. 新增 `scripts/verify-store-package.mjs` 和 `npm run verify:store`。
3. 门禁检查 package/manifest 版本一致、必需文件存在、Readability license 存在、无远程代码、无 `host_permissions`、权限集合未扩张、无私钥、`.env`、Native Host manifest、launcher 和本地配置。
4. ZIP 中出现未允许的可执行文件、远程脚本 URL 或新增权限时直接失败。

### 3.3 CI

新增 `.github/workflows/ci.yml`，固定 Node 20，依次运行：

```powershell
npm ci
npm test
npm run smoke
npm run smoke:sync:local
npm run package:extension
npm run verify:store
```

### 完成门槛

隐私政策与 UI 告知必须和实际数据流逐项对应；CI 生成的扩展 ZIP 必须能通过 `verify:store`。这一阶段完成后仍不提交商店，因为 Store ID 尚未锁定。

## 人工关口 A：创建 Chrome Web Store 草稿并取得身份

责任：`USER`。

1. 注册 Chrome Web Store Developer 账号、完成一次性费用、开启 Google 账号两步验证。
2. 创建 Clipplane 新条目，仅保存草稿，不提交审核、不公开发布。
3. 上传阶段 3 产出的合规 ZIP。
4. 在 Package 页面读取 Store Item ID 和 public key。
5. 把 Store Item ID 与 public key 作为普通文本交回 Agent。它们是公开身份信息，不是秘密。

禁止提供：Google 登录凭据、OAuth token、Chrome Web Store API token、任何 `.pem` 私钥、Windows 证书、Apple 证书或证书密码。

回滚：草稿上传不会发布扩展；方向变化时可以删除未发布条目。Store Item ID 一旦用于 Native Host 和公开材料后，不再创建第二个生产条目。

## 阶段 4：切换到 Store ID 并保留迁移通道

责任：`USER -> AGENT`，依赖人工关口 A 的公开 ID 和 public key。

1. 用 Store public key 替换 `extension/manifest.json` 的开发 public key。
2. `scripts/extension-identity.mjs` 将新 Store ID 作为 canonical ID，并保留 `mhgcfphfcgbgabhbegdonadkedfaddhc` 为 legacy ID。
3. Windows/macOS Native Host manifest 同时列出两个精确 origin，不使用 wildcard。
4. doctor、setup、check 脚本和 README 默认显示 Store ID，并能识别 legacy 安装。
5. 增加测试：manifest key 推导 Store ID、两个 origin 均存在、未知 origin 不存在。
6. 重新加载 unpacked 扩展，确认其 ID 与 Developer Dashboard Item ID 完全一致。

迁移策略：旧 GitHub 用户可继续使用 legacy extension；重新安装 `0.6.0` 后切换到 Store ID。Native Host 在至少两个稳定版本内同时允许两个 ID，之后再单独评估是否移除 legacy origin。

## 阶段 5：构建无需 Node.js 的 Native Host 安装包

责任：`AGENT` 实现未签名包和工作流，`USER` 提供签名环境并执行最终信任验证。

选择方案：安装包内携带固定版本的官方 Node 20 LTS runtime、Native Host 代码和生产依赖。Windows 使用 Inno Setup 6；macOS 使用 `pkgbuild`/`productbuild`。不采用 Node SEA，因为当前 ESM 多模块结构和系统凭据库原生模块会显著提高构建与诊断复杂度。

### AGENT

1. 新增 `scripts/package-native-host.mjs`，只收集 Host 运行必需文件和生产依赖。
2. 新增 `npm run package:host:windows` 和 `npm run package:host:macos`。
3. Windows 安装到 `%LOCALAPPDATA%\Programs\Clipplane Host`，写 HKCU Chrome/Edge Native Messaging 注册项并提供卸载入口。
4. macOS 安装到 `/Library/Application Support/Clipplane Host`，写入 Chrome 和 Edge 的系统级 Native Messaging manifest，并提供签名卸载脚本。
5. 两个平台都只注册阶段 4 中的 canonical 和 legacy origin。
6. Host `status` 响应增加 `host_version` 和 `protocol_version: 1`，扩展可以识别未安装、过旧和可用三种状态。
7. 安装器升级必须保留用户笔记和非秘密配置；卸载默认保留笔记。
8. CI 检查 Host 包中没有开发依赖、测试 fixture、用户配置、token、webhook、`.env` 或私钥。

### USER

1. 获取 Windows Authenticode 代码签名证书。
2. 加入 Apple Developer Program，创建 Developer ID Installer 证书和 notarization 凭据。
3. 只把证书与密码添加到 GitHub Actions Secrets，不发到聊天、不写进仓库：
   - `WINDOWS_SIGNING_CERT_PFX_BASE64`
   - `WINDOWS_SIGNING_CERT_PASSWORD`
   - `APPLE_DEVELOPER_ID_INSTALLER_P12_BASE64`
   - `APPLE_CERT_PASSWORD`
   - `APPLE_ID`
   - `APPLE_TEAM_ID`
   - `APPLE_APP_PASSWORD`
4. 在干净 Windows 11 和当前支持的 macOS 上人工安装、升级和卸载签名包，确认系统不显示未知发布者或未公证警告。

### 完成门槛

全新用户不安装 Node.js、不克隆仓库即可让 `npm run doctor` 等价的 Host 自检通过；签名和 notarization 均可从发布产物回读验证。

## 阶段 6：首次安装、真实浏览器 E2E 和商店素材

责任：`AGENT` 实施和生成素材，`USER` 完成两平台最终观察验收。

### 首次安装体验

1. 新增 `extension/onboarding.html`、`onboarding.css` 和 `onboarding.js`。
2. `chrome.runtime.onInstalled` 仅在首次安装时打开 onboarding，更新时不重复打扰。
3. 页面显示 Host 状态、当前平台的签名安装包下载入口、重新检测按钮和第一条本地剪藏入口。
4. 下载链接固定到版本化 GitHub Release asset，不执行远程代码。
5. popup 在 Host 缺失或协议过旧时给出同一安装入口，不只显示错误文字。

### 真实浏览器 E2E

新增 `npm run test:e2e:chrome`，使用真实 Chromium 和隔离 profile 验证：首次安装、Host 缺失、Host 可用、Selection、Readability、fallback、Element、Service Worker 重启、History、打开 body、显式 Notion/flomo mock 同步。CI 跑无签名测试包；签名安装器仍由人工在真实系统验收。

### 商店素材

生成并纳入 `assets/store/`：

1. `screenshot-popup-1280x800.png`：真实浏览器中的 Selection/Page/Element 与 Save local。
2. `screenshot-element-1280x800.png`：页面区域高亮和确认状态。
3. `screenshot-history-1280x800.png`：本地 History 与 capture method。
4. `screenshot-sync-1280x800.png`：外部 sink 默认关闭和显式配置。
5. `screenshot-notion-1280x800.png`：用户主动同步后的 Notion 结果。
6. `promo-small-440x280.png`：Clipplane 品牌和 local-first clipping，不使用排名、推荐或性能承诺。

所有截图必须来自 `0.6.0` 实际 UI，不能继续使用缺少 Element 模式的旧 popup 截图。

## 人工关口 B：签名发布候选与双平台验收

责任：`USER`。

1. 在 GitHub Actions 中触发 `0.6.0-rc.1` 构建。
2. 下载扩展 ZIP、Windows installer 和 macOS pkg，核对签名、notarization 和 SHA256。
3. 在干净 Windows/macOS 上完成安装、升级、卸载和浏览器重启。
4. 验证默认只写本地；未点击 `Save + sync` 时 Notion/flomo 不收到请求。
5. 验证删除 Clipplane 凭据后同步关闭，但本地笔记仍存在。
6. 将通过/失败结果和系统版本交回 Agent；不提供任何真实 token 或 webhook。

失败时不更新 Store 草稿。修复后使用更高的 patch 版本重新构建，不能尝试降级已上传的 manifest version。

## 阶段 7：生成最终提交材料

责任：`AGENT` 生成，`USER` 在 Dashboard 填写并提交。

### AGENT

新增 `CHROME_WEB_STORE_LISTING.md`，包含可以直接粘贴的：

1. Single purpose：把用户主动选择的网页内容保存到本机 org-mode inbox，并可由用户主动同步到配置的笔记服务。
2. 132 字符以内 summary 和完整 description，明确需要 Clipplane Native Host。
3. `activeTab`、`contextMenus`、`nativeMessaging`、`scripting`、`storage` 的逐项权限解释。
4. Website content、Web history、Authentication information 的数据声明。
5. Limited Use 声明和公开 Privacy Policy URL。
6. Reviewer instructions：安装签名 Host、检查 Store ID、执行 Selection/Page/Element、验证默认无外发、使用 mock/test sink 验证显式同步。
7. 支持 URL、项目主页 URL、版本和安装器下载 URL。

### USER

1. 对 `PRIVACY.md` 做最终法律和事实确认，并确保公开 URL 可匿名访问。
2. 在 Developer Dashboard 填写 Listing、Privacy 和 Distribution。
3. 上传 128x128 icon、至少一张 1280x800 screenshot 和 440x280 promo tile。
4. 将第一个审核版本设为 Private trusted testers，完成一次商店安装验收后再切 Public。
5. 填入公开支持联系方式、官方主页和 reviewer instructions。
6. 提交审核并处理 Google 发来的身份或政策邮件。

## 最终发布门禁

Agent 在用户明确要求发布后执行：

```powershell
npm ci
npm test
npm run smoke
npm run smoke:sync:local
npm run test:e2e:chrome
npm run package:extension
npm run verify:store
npm run package:host:windows
npm run package:host:macos
npm run doctor
git diff --check
```

随后检查：

1. `package.json`、lockfile、manifest、Host 和安装器版本均为 `0.6.0`。
2. 扩展 ZIP 的 manifest key 推导结果等于 Store Item ID。
3. ZIP 不包含私钥、Host launcher、用户配置、token、webhook 或远程代码。
4. 两个 Host 安装包签名有效，macOS notarization 成功。
5. Privacy、Listing、权限解释、截图和实际 UI 一致。
6. GitHub Release assets、SHA256 和 Dashboard 上传包来自同一次构建。

只有以上门禁和人工关口 B 全部通过，才提交 Chrome Web Store Public 审核。

## 回滚与故障处理

1. Store ID 迁移失败：保留 legacy origin，恢复 canonical manifest key 前的提交；不删除旧 Host 注册。
2. 凭据迁移失败：不删除明文旧值，禁用外部同步并提示用户修复系统凭据库；本地剪藏继续可用。
3. 安装器失败：撤下对应 GitHub asset，不提交 Store 更新；用户可继续使用 `v0.5.0` 源码安装路径。
4. Store 审核拒绝：保持条目 Private，按具体 violation 修复并提升 patch 版本；不新建重复条目。
5. 新版回归：Chrome Web Store 不能上传更低版本，必须修复后发布更高 patch；Native Host 安装器应支持回装上一稳定 Host，但不得降级用户数据格式。

## 最脆弱的前提

本计划假设 Clipplane 愿意长期维护 Windows 和 macOS 两套签名 Native Host 安装包。如果不愿承担证书、notarization、安装器升级和双平台支持成本，就不应该继续这条商店路线，而应改成纯扩展导出文件的产品。后者实现更轻，但会失去自动追加 `inbox.org`、本地 History、系统凭据和当前同步架构，因此本计划不采用。

## 当前即可开始与人工事项总览

### 当前即可由 Agent 实施

- 收口并提交 `0.5.0` 代码边界。
- 修复 Windows 打开目录命令边界。
- 校验 flomo HTTPS webhook。
- 来源 URL 脱敏。
- 接入系统凭据库和安全迁移。
- 编写 Privacy Policy、UI 显式告知和 Limited Use 文案。
- 添加最低 Chrome 版本、商店包验证、CI 和测试。
- 构建未签名 Native Host 安装包和 onboarding。
- 编写商店 listing、权限解释、reviewer instructions 并生成规范素材。

### 必须由用户人工完成

- 当前 `0.5.0` 的 Chrome/Edge 真实浏览器验收。
- Chrome Web Store Developer 注册费、两步验证和条目创建。
- 从 Dashboard 取得 Store Item ID/public key。
- Windows 与 Apple 签名身份申请，以及把证书放进 GitHub Actions Secrets。
- Windows/macOS 干净机器上的签名安装、升级和卸载验收。
- Privacy Policy 最终法律确认。
- Dashboard 字段填写、素材上传、trusted tester 测试、提交审核和处理 Google 邮件。

### 用户提供结果后由 Agent 继续

- 收到 Store Item ID/public key后切换 canonical identity 并更新 Host origins。
- GitHub Actions 中签名 secrets 就绪后完成签名工作流和产物回读检查。
- 收到双平台验收结果后修复平台问题并生成最终 `0.6.0` 候选。
- 收到 Chrome Web Store violation/reviewer 反馈后定位、修复并准备重新提交材料。

## 参考政策

- Chrome Web Store user data FAQ: <https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/>
- Privacy practices: <https://developer.chrome.com/docs/webstore/cws-dashboard-privacy>
- Store identity key: <https://developer.chrome.com/docs/extensions/reference/manifest/key>
- Native Messaging: <https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>
- Store image requirements: <https://developer.chrome.com/docs/webstore/images>
- Minimum Chrome version: <https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version>
