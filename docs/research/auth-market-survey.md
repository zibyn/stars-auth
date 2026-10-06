# 统一认证 / IdP 现状调研：Go 自建能复用什么，缺口在哪

- 调研日期：2026-10-06
- 问题：现有 unified-auth / identity-provider 系统里，一个 Go 自建方案能复用什么？有没有足以支撑"自建而不是采用"的缺口？
- 目标场景（来自项目意图）：自托管；主要客户端是 native app 与微信小程序，国内优先；手机号 + 短信验证码、账号密码、邮箱、微信登录、2FA、passkey；对外是 OIDC / OAuth2 provider；Web 只是管理台。

## 0. 怎么读这份文档

- **第 1–5 节是综合结论**，其中"事实"均可在附录找到出处；凡是我自己的判断，都标了 **【推断】**。
- **附录 A / B 是逐系统的取证记录**，每条非显然结论带一手来源链接（官方文档、GitHub 源码 / issue / advisory、openid.net 认证列表、IETF datatracker、微信官方文档）。取不到一手来源的标 **未验证**，没有用记忆补。
- 取证方式：四路并行调查，各自用 `gh api` 与抓取官方页面；我另外用 `gh api` 抽查了十几项关键事实（各仓库 license / stars / 最新 release、fosite 停滞与并入 hydra、Casdoor #1835、Logto #3013 / #3787、Zitadel #7900、Hydra #1218 均为 open），与附录一致。附录其余内容未逐条复核。
- OpenID 认证结论都基于对 [openid.net 认证列表](https://openid.net/certification/) 单页的检索，没有交叉核对其他列表页。

## 1. 结论速览

**已验证的事实**

1. **没有任何一个开源系统同时满足三件事**：(a) 不经浏览器重定向、由自有 UI 直接调用并拿到标准 OAuth2 / OIDC token 的 first-party 登录 API；(b) 小程序 `code2session` + 开放平台移动应用 + 公众号，并按 `unionid` 合并账号；(c) 进程内的插件式扩展。逐项见第 2 节表格。
2. 功能上唯一全覆盖的是 **Authing**（`/api/v3/signin-by-mobile` 直接支持 `wechat_mini_program_code` 等并返回 token），但它是闭源 SaaS，私有化部署只在企业版，SDK 也已明显停更。
3. Go 写的三个候选各缺一块：**Casdoor** 国内能力最全但没有正式的"手机号 + 验证码换 token"接口（[#1835](https://github.com/casdoor/casdoor/issues/1835) 2023 年至今 open），2026-05 一次披露 5 个 critical 漏洞；**Zitadel** 有 Session API 但 session 不能直接换 OIDC token（[#7900](https://github.com/zitadel/zitadel/issues/7900) open），完全没有微信；**Ory Kratos** 有 native API flow 但拿到的是 Kratos session token，无法换成 Hydra 的 OAuth2 token，也没有微信。
4. **Logto** 结构性不支持直连登录（维护者在 [#3787](https://github.com/logto-io/logto/issues/3787) 明确说仍需重定向和 cookie），小程序 connector 缺失三年多（[#3013](https://github.com/logto-io/logto/issues/3013)）。
5. **Better Auth** 是嵌入式 TS 库，不是独立服务；旧 `oidcProvider` 已在 v1.7.0 移除，由 `@better-auth/oauth-provider` 取代，未获 OpenID 认证；内置微信只有网站扫码登录；仓库已有 37 条 security advisory。
6. Go 的 OAuth2 / OIDC 库没有干净的赢家：**ory/fosite 独立仓库已停滞**（最后 release v0.49.0，2024-12；代码 2025-10 并入 ory/hydra 的 `fosite/` 目录），下游各自 fork；**zitadel/oidc** 最活跃但 OP 端未认证、grant 分发是写死的 switch；**luikyv/go-oidc** 是唯一 OP 获认证的 Go 库，但只有 115 stars、v0.x、单人维护。
7. **没有任何 Go 库实现 IETF 的 first-party apps 草案**（`draft-ietf-oauth-first-party-apps-04`，`authorization_challenge_endpoint`）；ROPC 在 OAuth 2.1 草案中已被移除。

**【推断】我的判断**

- 缺口正好落在这个项目的主路径上（native app / 小程序直连登录 + 微信 + 手机号），而不是边角功能。采用任何一个候选都意味着要改它的核心登录链路，等于长期维护一个 fork。所以"自建"是站得住的，但理由是**这个具体缺口**，不是"现有系统都不好"。
- 反方证据同样真实：Casdoor、Better Auth、Logto 在 2026 年都有成批高危漏洞，其中不少正出在 token exchange、授权码 / refresh token 并发复用这类自建时也必须写对的地方。自建的前提是**范围收得很窄**，协议层站在库上，不自己写 OAuth2 状态机。
- 最大的未决技术风险是 OIDC 库选型（见第 4 节），建议先做一个一两天的 spike 再定，不要凭这份调研直接选。

## 2. 对比表

表中"是 / 否 / 部分"均为附录取证结果的压缩；"未验证"表示没找到一手来源。

### 2.1 基本面与协议

| 系统 | 技术栈 / License | 形态 | 活跃度（2026-10） | OpenID Certified | PKCE | Device flow | Token exchange | Refresh rotation |
|---|---|---|---|---|---|---|---|---|
| Casdoor | Go + React / Apache-2.0 | 独立服务 | v4.15.0（10-04），1–3 天一个 minor | 否 | 是（仅 S256） | 是 | 是（2026-05 两个 critical 出在这里） | 是 |
| Zitadel | Go / AGPL-3.0（v3 起） | 独立服务，仅 Postgres | v4.19.4（10-01） | 列表中无（仅 `zitadel/oidc` 库的 RP） | 是 | 是 | 是 | 未验证 |
| Ory Hydra + Kratos | Go / Apache-2.0，企业功能在 OEL | 两个独立服务 | v26.2.0（03-20），公开提交放缓 | README 自称认证，列表中未找到 | 是 | 是（v25.4.0 起） | 否（[#1218](https://github.com/ory/hydra/issues/1218) 自 2018 open） | 是（单次使用） |
| Logto | TS / MPL-2.0 | 独立服务，需 Postgres | v1.44.0（09-30） | 否 | 是 | 是（2026-03） | 是（impersonation，无 refresh token） | 是 |
| Keycloak | Java / Apache-2.0 | 独立服务 | 26.8.0（10-01） | 列表仅有 18.0.0 / 15.0.2 旧条目 | 是 | 是 | V2（26.2 起，仅内部到内部） | 未验证 |
| Authentik | Python + TS + Rust / MIT + enterprise | server + worker + Postgres | 2026.8.3（09-17） | **是**（2026.8.0） | 是 | 是 | 是 | 可选 |
| SuperTokens | Java core + SDK / Apache-2.0 + `ee/` | core + 后端 SDK + DB | core v12.2.0（09-04） | 否 | OAuth2 provider 为付费功能，代理到 Ory Hydra | 未验证 | 未验证 | 未验证 |
| Authing | 闭源 SaaS（SDK 为 MIT） | SaaS；私有化仅企业版 | SDK 多已停更 | 否 | 是 | 文档未提 | 文档未提 | 未验证 |
| Better Auth | TS / MIT | **嵌入式库** | v1.7.7（09-30），每个 minor 都有 breaking change | 否 | 是 | 可选 | 未验证 | 是 |

### 2.2 本项目最看重的能力

| 系统 | 无重定向的 native 直连登录 | 手机号 + 短信作为第一因子 | Aliyun / Tencent 短信 | 微信：移动应用 / 公众号 / 小程序 / unionid 合并 | 2FA / passkey | 扩展模型 | 多租户 |
|---|---|---|---|---|---|---|---|
| Casdoor | 部分：密码走 ROPC；小程序用 token 端点 `tag=wechat_miniprogram`；手机验证码只有内部 cookie 接口 | 是 | 是（内置） | 文档称不支持移动应用 SDK 登录 / 是 / 是 / 部分（单字段，openid 或 unionid 匹配） | TOTP、SMS 等 / WebAuthn | provider + webhook，无插件 | organization |
| Zitadel | 部分：Session API v2 只给 session token，换 OIDC token 仍要走 authorize → finalize | 文档只写了第二因子，第一因子未验证 | Twilio + 通用 HTTP provider | 全无，需自建 | 是 / 是 | Actions v2 = 外部 HTTP target | instance → org → project |
| Ory | Kratos 是（`/self-service/login/api`），但换不成 Hydra token | 是（`code` strategy） | 通用 HTTP courier + Jsonnet | 全无（有 dingtalk / lark），需 fork | 是 / 是 | webhook + Jsonnet | 仅商业版 |
| Logto | 否（Experience API 依赖 interaction cookie） | 是 | 是（connector） | 是 / 否（推断自源码） / 否 / 部分 | 是 / Web 端是，文档称 native 不支持 | connector、webhook、JWT customizer | organization；多租户控制台仅云版 |
| Keycloak | 否（仅已不推荐的 direct grant，且不支持社交登录） | 非内置，靠社区插件 | 社区插件有，但已陈旧 | 社区插件覆盖扫码 + 公众号；无小程序 | 是 / 是（26.4 起） | Java SPI + theme | realm + Organizations |
| Authentik | 部分：flow executor 是绑 cookie 的 challenge 循环，产出 session 而非 token | 否（SMS 仅 MFA） | Twilio + 通用 HTTP | 仅网站扫码 | 是 / 是 | flow / stage / policy；新登录方式要 fork Python | alpha 且仅企业版 |
| SuperTokens | **是**（FDI，first-party REST） | 是（passwordless recipe） | 需自写 `sendSms` override | 非内置，靠 override 自写 | MFA、账号关联付费；passkey 似乎免费 | recipe + override | 付费 |
| Authing | **是**（`/api/v3/signin`、`/signin-by-mobile` 直接返回 token） | 是 | 是 | 全部支持；unionid 合并未验证 | 是 / 是（文档仅浏览器） | Pipeline、Webhook、workflow | 用户池；"多租户"为内测 |
| Better Auth | 是，但只有 Expo（cookie 存 SecureStore 或 bearer 插件） | 是（`sendOTP` 回调，注册需临时邮箱） | 回调自己接，很简单 | 仅网站扫码 | 是，但 2FA 只在三条写死的登录路径上强制 / 是 | **进程内插件** | organization 插件 |

## 3. 最可信的"采用"候选，以及各自败在哪

**候选 1：Casdoor（采用或 fork）**——功能上离目标最近，且是 Go。

- 已具备：Aliyun / Tencent 短信、小程序登录、公众号、扫码、TOTP / WebAuthn、管理台、device flow、token exchange。
- 败在：
  - 没有正式的"手机号 + 验证码 → token"接口，只有内部 cookie session 的 `/api/login`（#1835）。
  - 文档称不支持开放平台移动应用 SDK 登录；unionid 合并只是单字段匹配；小程序登录固定用应用上的第一个微信 provider。
  - 扩展只有 provider 和 webhook，没有插件机制，和"Better Auth 式架构"的意图不合。
  - 安全与发布：2026-05-28 一次披露 7 条 advisory，5 条 critical（含认证绕过 CVE-2026-9090）；版本号基本是 master 快照，没有稳定性语义。
- 【推断】如果目标只是"尽快有一个能用的"，它是最短路径；但要补的正是核心登录链路，而它的发布节奏让长期跟 upstream 的 fork 很难维护。

**候选 2：Ory Kratos（+ Hydra）**——headless、API-first，和"自有 UI 直连"的形态最契合。

- 已具备：native API flow、短信验证码第一因子、通用 HTTP 短信通道、TOTP / WebAuthn / passkey、Apache-2.0。
- 败在：
  - 完全没有微信，要加只能 fork Kratos。
  - native flow 的 session token 换不成 Hydra 的 OAuth2 token（API flow 没有 `login_challenge` 参数）；Hydra 也没有 token exchange。
  - 多租户、SAML、CAPTCHA 等在商业版；README 直言 OSS 面向"unimportant workloads"；公开仓库提交在放缓。
  - 要自己把两个服务粘起来并自建全部 UI。

**候选 3：Zitadel**——Go 里最完整的 OIDC IdP，自带管理台和 passkey。

- 已具备：auth code + PKCE、device flow、token exchange、Session API v2、通用 HTTP 短信 provider、instance / org / project 多租户。
- 败在：
  - 没有微信（四种场景都要自建），短信作为第一因子未验证。
  - session 不能直接换 token，native 端仍要程序化走一遍 authorize → finalize。
  - Actions v2 是外部 HTTP 回调，不是进程内插件；AGPL-3.0 对"改了再对外提供服务"有开源义务。
  - 【推断】可行的折中是"Zitadel 发 token + 自写一个 Go 登录服务处理微信 / 短信并创建 session"，但"没有第一因子校验的后端 session 能否 finalize auth request"未验证，这是该路线的前置问题。

**不入选但值得对照**：Authing 是功能基准（所有场景都有现成 API），败在不能自托管；SuperTokens 的 FDI 是 API 形态的好参考，败在 MFA / 账号关联 / 多租户 / OAuth2 provider 都付费，且 Go SDK 缺这些 recipe。

## 4. 若用 Go 自建：站在哪些库上，哪些必须手写

### 4.1 建议站上去的库

| 关注点 | 建议 | 依据 |
|---|---|---|
| OAuth2 / OIDC 协议层 | **未定，先 spike**：`zitadel/oidc` vs `luikyv/go-oidc` vs `authelia/oauth2-provider` | 见 4.3 |
| Passkey | `go-webauthn/webauthn`（v0.18.2） | 有 discoverable login API；Authelia、pocket-id 在用 |
| TOTP | `pquerna/otp`（v1.5.0） | 活跃度低但算法已冻结 |
| JOSE / JWT | 跟随 OP 库（`zitadel/oidc` 用 `go-jose` v4） | 避免两套 JOSE |
| 密码哈希 | `alexedwards/argon2id` 或 `x/crypto` | — |
| 手机号解析 | `nyaruka/phonenumbers` | E.164 |
| 限流 | `sethvargo/go-limiter` | `ulule/limiter` 自 2023 无 release |
| 微信 | `silenceper/wechat` 的 `miniprogram/auth` 与 `officialaccount/oauth`，或手写四个 HTTP 调用 | 覆盖 `Code2Session`、`GetPhoneNumber` |
| 短信 | 官方 `alibabacloud-go/dysmsapi-20170525` 与 `tencentcloud-sdk-go` 的 `sms/v20210111`，外面包一层自己的小接口 | `casdoor/go-sms-sender` 不够成熟 |
| 插件机制 | Caddy 式编译期 `RegisterModule` | 【推断】比 `hashicorp/go-plugin` 的子进程 RPC 更贴合 Better Auth 的进程内模型 |

不适用：`markbates/goth` 的 wechat provider 只有网页重定向；`dexidp/dex` 没有微信 connector；`go-oauth2/oauth2` 没有 OIDC。

### 4.2 没有库覆盖、必须手写的部分

- **first-party 直连登录 API**：没有 Go 库实现 first-party apps 草案；这是整个项目的核心差异点。
- 把微信 code、小程序 code、`getPhoneNumber` code、短信验证码换成 token 的 grant 或 token-exchange handler。
- 以 `unionid` 为跨端主键、`(appid, openid)` 为次键的账号关联，含"未绑定开放平台时只有 openid"的情形。
- 短信验证码生命周期：生成、存储、多维度限流与配额、通道故障切换。
- TOTP 防重放、恢复码、secret 加密存储。
- session 层、登录 UI、全部存储实现、插件注册表与 hook。
- 微信 `access_token` 缓存；为每个接入 app 托管 `apple-app-site-association` 与 `assetlinks.json`。

### 4.3 协议库选型的取舍（未决）

- **`zitadel/oidc`**（Apache-2.0，v3.51.12 于 2026-10-06 发布）：最活跃，有 device flow 和 token exchange；但 OP 端未认证，grant 分发是写死的 switch、没有自定义 grant 的 API，`op.Storage` 约 25 个方法。
- **fosite 系**：自定义 grant 模型最好，但上游独立仓库已停滞且有未关闭的安全 issue（#875），实际要用就是采用 fork（`authelia/oauth2-provider` 或 `pocket-id/fosite`）；两份 fosite 都没有 RFC 8693 handler。
- **`luikyv/go-oidc`**（MIT，v0.25.0）：唯一 OP 获认证的 Go 库，规范覆盖最广；但 115 stars、v0.x、单一作者。
- 【推断】有一种设计可以绕开"库不支持自定义 grant"：自己实现草案里的 `authorization_challenge_endpoint`，认证完成后**签发一个 authorization code**，再交给库的标准 token 端点兑换。存储在自己手里，理论上可以直接写入 code，但这一点没有在任何库上验证过，正是 spike 要回答的问题。

### 4.4 设计必须遵守的外部约束（已验证，详见附录 B）

- 小程序没有系统浏览器；`web-view` 个人主体不可用、企业主体需业务域名白名单——小程序端只能走自有 API 直连。
- `code2Session` 只有在小程序绑定了开放平台账号时才返回 `unionid`；三端 openid 互不相同。
- 小程序手机号快速验证组件仅限已认证的非个人主体，每次成功调用 0.03 元。
- 小程序内 WebAuthn 没有官方说明，应按"不可用"设计；无 Google Play 服务的国内 Android 机型上 Credential Manager 是否可用**未验证**，是 passkey 路线的高风险项。
- iOS / Android 的 passkey 都要求认证域名与 app 做关联；RP ID 选定后不能换域名。

## 5. 值得借鉴的架构思路

**Better Auth**

1. 每种登录方式一行 `account`（`providerId` + `accountId`），密码也只是一种 account——但要把 email 改成可选，Better Auth 以 email 为中心导致手机号注册要造临时邮箱。
2. 通用的 `verification` 表承载所有一次性凭据，原子消费。
3. 插件是一个声明式结构：ID、endpoints、schema 片段、before / after hook、middleware、限流规则、错误码。
4. hook 带 matcher，插件可以拦截别的端点——但 2FA 要在核心里做成显式的"session 签发前检查点"，不要学它用路径白名单（它的 OAuth、magic link、passkey 登录默认绕过 2FA）。
5. 插件自带 schema 片段，由 CLI 合并进 migration。
6. user / session / account 上的 database hook 作为业务侧扩展点。
7. 外部服务用回调接口（`sendOTP`、`sendEmail`），短信厂商不进核心。
8. OAuth provider 和 JWT / JWKS 是叠在 session 核心之上的一层，session 同时支持 cookie 与 bearer。

搬不过来的：靠 TS 类型推导把服务端 endpoint 映射成客户端 API（Go 里用 OpenAPI + codegen 代替）、schema 驱动的静态类型、多 ORM adapter 层。

**其他系统**

- **Authing**：一个 `signin-by-mobile` 端点用 `connection` 枚举区分微信 app / 小程序 code / 小程序手机号 / Apple，统一返回 token——first-party API 的形状参考。
- **Casdoor**：在标准 token 端点上用小程序 code 换 token；短信、微信等都抽象成可按应用挂载的 provider。
- **Zitadel**：session 是一个逐步累积"检查项"（用户、密码、OTP、WebAuthn）的对象，与 OIDC auth request 分离；发送验证码支持 `returnCode` 让调用方自己发；instance → org → project 的层级。
- **Ory Kratos**：browser flow 与 API flow 显式分开；AAL 等级；identity 用 JSON Schema 描述；courier 用通用 HTTP 通道 + 模板对接任意短信厂商。Hydra 把登录 / 同意完全委托给外部应用的 challenge 模型。
- **SuperTokens**：FDI——把前端与后端之间的接口做成带版本号的规范；recipe + override。
- **Logto**：connector 作为独立包；JWT customizer；用 token exchange 做 impersonation。
- **Keycloak / Authentik**：认证流程是可配置的步骤编排（execution / stage + policy），required actions。
- **IETF first-party apps 草案**：用 `auth_session` + `insufficient_authorization` 驱动多步认证，最终产出 authorization code——直连登录的标准化形态，值得直接照着实现。

## 6. 关键未验证事项与建议的下一步

未验证（会影响决策的那几条）：

- Zitadel：短信验证码能否作为唯一第一因子；后端创建的、未经第一因子校验的 session 能否 finalize auth request。
- Ory Hydra 当前的 OpenID 认证状态；Kratos 用 admin API 为自定义微信登录建 session 的路径。
- Casdoor 是否有商业版 / LTS 分支；refresh token 复用检测；unionid 合并的完整行为。
- Authing 的定价档位数字（经页面摘要读取，使用前需复核）、unionid 合并、公共客户端调用 v3 API 是否需要 app secret。
- Better Auth 与 SuperTokens 的 token exchange 支持。
- 各 Go 库的自定义 grant 机制细节（fosite `TokenEndpointHandler` 签名、`luikyv/go-oidc` 的扩展点）；并入 hydra 的 fosite 能否单独 import（推断不能，未实际构建）。
- 公众号 `snsapi_base` 与 `snsapi_userinfo` 的差异及 unionid 返回条件（官方页面只取到 stub）。
- 国内 Android 无 GMS 机型上的 passkey 可用性；小程序 web-view 能否完成 authorize 重定向并把 code 传回。
- IETF 草案编号与日期来自 datatracker 页面摘要，未读原文。

建议的下一步【推断】：

1. 做协议库 spike：用三个候选库各实现一次"自有端点认证后签发 code / token"，看哪一个不需要改库。
2. 在真机上验证国内 Android 的 passkey 可用性，再决定 passkey 的优先级。
3. 若 spike 结果都不理想，再回头评估"Zitadel 或 Hydra 发 token + 自写登录服务"的折中路线。

---

## 附录 A：各系统取证记录

### Casdoor

- **技术栈 / 许可**：后端 Go + Beego + XORM，前端 React（[server-installation 文档](https://github.com/casdoor/casdoor-website/blob/master/docs/basic/server-installation.md)）。仓库许可 Apache-2.0（[GitHub API](https://api.github.com/repos/casdoor/casdoor)）。README 中未见 enterprise-only 功能划分；是否存在独立的商业版/托管版：未验证 (unverified)。
- **维护活跃度（2026-10-06 查询）**：14,518 stars；最新 release `v4.15.0`（2026-10-04）；最后 commit 2026-10-05（[repo](https://github.com/casdoor/casdoor)）。
- **发布节奏**：`v4.8.0`(09-23) → `v4.15.0`(10-04)，12 天 8 个 minor 版本，约 1–3 天一个 release（[releases](https://github.com/casdoor/casdoor/releases)）；CI 用 goreleaser + docker-release（[build.yml](https://github.com/casdoor/casdoor/blob/master/.github/workflows/build.yml)）。版本号基本等于 master 快照，不携带稳定性语义；是否有 LTS 分支：未验证。
- **部署形态**：独立服务（非嵌入式库）。DB 支持 MySQL（默认）/MariaDB/PostgreSQL/SQLite3/SQL Server/Oracle/CockroachDB/TiDB（同上 server-installation 文档）；多副本时 device flow 需要 Redis（[OAuth 文档](https://casdoor.ai/docs/how-to-connect/oauth/)）。文档站已从 casdoor.org 301 到 casdoor.ai。
- **OpenID Certified**：否。[openid.net 认证列表](https://openid.net/developers/certified-openid-connect-implementations/)（2026-10-06 全页检索）无 Casdoor。
- **OAuth/OIDC flows**（以源码 [`object/token_oauth.go`](https://github.com/casdoor/casdoor/blob/master/object/token_oauth.go) 和 [`wellknown_oidc_discovery.go`](https://github.com/casdoor/casdoor/blob/master/object/wellknown_oidc_discovery.go) 为准）：
  - `authorization_code` + PKCE（仅 `S256`）：有。
  - device flow (RFC 8628)：有，`/api/device-auth`。
  - token exchange (RFC 8693)：有，`GetTokenExchangeToken`。但 2026-05 有两个 critical CVE 正是该路径（见下）。
  - 另有 `implicit`、`password` (ROPC)、`client_credentials`、`jwt-bearer`、DPoP。
  - refresh token rotation：有。`RefreshToken()` 签发新 refresh token 并 `DeleteToken(旧)`（[`token_oauth_util.go`](https://github.com/casdoor/casdoor/blob/master/object/token_oauth_util.go)）。是否有 reuse detection / 是否可配置：未验证。
- **原生 App / 小程序内无浏览器跳转登录**：部分支持，三条路径各有限制。
  - 密码：ROPC，`POST /api/login/oauth/access_token`，`grant_type=password`（[OAuth 文档](https://casdoor.ai/docs/how-to-connect/oauth/)）。只覆盖 username+password。
  - 小程序：同一 token endpoint，`tag=wechat_miniprogram` + `client_id` + `wx.login()` 的 `code`，服务端调 `code2session` 后直接返回 token，用户不存在则自动注册（[小程序文档](https://github.com/casdoor/casdoor-website/blob/master/docs/integration/javascript/wechat_miniprogram.md)、源码 `GetWechatMiniProgramToken`）。
  - 手机号+验证码：没有文档化的「phone+code → token」grant。只能调 Casdoor 自家 SPA 使用的内部接口 `POST /api/send-verification-code` + `POST /api/login`（[`routers/router.go`](https://github.com/casdoor/casdoor/blob/master/routers/router.go)，验证码分支见 [`controllers/auth.go`](https://github.com/casdoor/casdoor/blob/master/controllers/auth.go) 的 `CheckSigninCode`）。该接口基于 session cookie，`type=code` 时返回 authorization code 再换 token。发送验证码是否强制 captcha：未验证。
  - 相关诉求 [#1835 "Want to add a quick login interface within the app"](https://github.com/casdoor/casdoor/issues/1835) 自 2023-05 起 open。
  - 官方移动端 SDK 仓库存在且 2026-10 仍有 push：`casdoor-ios-sdk`、`casdoor-android-sdk`、`casdoor-flutter-sdk`、`casdoor-react-native-sdk`、`casdoor-uniapp-sdk`（[org](https://github.com/casdoor)）。它们是否走 WebView/浏览器跳转：未验证。
- **手机号 + SMS OTP**：登录页支持 email/SMS code 登录（[README](https://github.com/casdoor/casdoor#readme)）。SMS provider 通过 [`casdoor/go-sms-sender`](https://github.com/casdoor/go-sms-sender#readme) 可插拔：Alibaba Cloud、Tencent Cloud、Huawei Cloud、Baidu Cloud、VolcEngine、UCloud、SmsBao、SUBMAIL、Twilio、Amazon SNS、Azure ACS、Infobip 等；另有 Custom HTTP SMS provider（[docs/provider/sms](https://github.com/casdoor/casdoor-website/tree/master/docs/provider/sms)）。
- **WeChat**（[WeChat provider 文档](https://github.com/casdoor/casdoor-website/blob/master/docs/provider/oauth/Wechat.md)）：
  - 开放平台网站扫码（SubType `Web`）：有。
  - 公众号 / 微信内置浏览器网页授权（SubType `Mobile`，`snsapi_userinfo`，[`idp/wechat_mobile.go`](https://github.com/casdoor/casdoor/blob/master/idp/wechat_mobile.go)）：有。
  - 开放平台**移动应用**（原生 App 拉起微信 SDK）：无文档支持。文档原文："WeChat does not support sign-in from third-party mobile apps ... In-app login must happen inside WeChat."
  - 小程序 `code2session`：有（见上）。限制：Casdoor 取 application 中**第一个** WeChat 类型 provider 作为小程序 IdP，文档建议用小程序时每个 app 只配一个 WeChat provider，与同一 application 同时挂扫码/公众号 provider 冲突。
  - unionid 合并：部分。`getUserByWechatId` 在同一 organization 内按 `wechat = openid OR wechat = unionid` 查用户（[`object/user.go`](https://github.com/casdoor/casdoor/blob/master/object/user.go)），用户表只有单个 `wechat` 字段；跨 provider 的完整合并行为未实测。
- **2FA**：`app`(TOTP)、`sms`、`email`、`radius`、`push` + recovery codes（[`object/mfa.go`](https://github.com/casdoor/casdoor/blob/master/object/mfa.go)）；按 organization 配置 Optional / Prompt / Required（[MFA items 文档](https://github.com/casdoor/casdoor-website/blob/master/docs/organization/mfa-items.md)）。
- **Passkeys / WebAuthn**：有，`/api/webauthn/signup|signin/begin|finish`（router.go、[WebAuthn 文档](https://github.com/casdoor/casdoor-website/blob/master/docs/how-to-connect/webauthn.md)）。原生 App 内 passkey 支持：未验证。
- **扩展模型**：以「provider」配置为主（OAuth/SMS/Email/Storage/MFA/Face ID 等类别）+ [Webhooks](https://github.com/casdoor/casdoor-website/blob/master/docs/webhooks/overview.md)（事件 HTTP POST）。未发现代码级 plugin / hook / action 机制（未验证其不存在），深度定制意味着 fork。
- **Admin UI**：内置 React 管理后台，与登录页同一前端。
- **多租户**：`organization` 是用户、application、provider 的归属单元，同一 organization 内 SSO（[organization 文档](https://github.com/casdoor/casdoor-website/blob/master/docs/organization/overview.md)）。
- **安全公告历史**（[GitHub Advisory DB](https://github.com/advisories?query=casdoor)，共 20 条）：
  - 2026-05-28 一次披露 7 条，其中 5 条 critical：认证绕过 [CVE-2026-9090](https://github.com/advisories/GHSA-fwgq-j9r9-qjgr)；token exchange 两条 [CVE-2026-9094](https://github.com/advisories/GHSA-c9w5-qp6m-m395)（跨 organization 不校验 JWT 签名）、[CVE-2026-9097](https://github.com/advisories/GHSA-339w-3hqm-9pjc)；SAML 三条（CVE-2026-9093/9096/9098，不校验 Audience、时间窗、`/api/acs` 接受任意 SAMLResponse）；MFA 绕过 CVE-2026-9091。
  - 2026-04/05：SSRF（CVE-2026-5469）、存储型 XSS（CVE-2026-5468）、open redirect（CVE-2026-5467）、任意文件写（CVE-2026-6815）。
  - 更早：越权 CVE-2025-61524、SCIM 授权 CVE-2025-4210、CORS 配置 CVE-2024-41657、CSRF CVE-2023-34927、任意文件写 CVE-2022-38638 (critical)、SQL 注入 CVE-2022-24124。
  - 仓库自身的 repo-level security advisories 接口返回为空，公告只出现在全局 Advisory DB。
- **痛点**：
  - 核心认证路径（认证绕过、token exchange、SAML 校验）反复出现高危漏洞，是 fork/采用的主要风险。
  - 原生 App 手机验证码直登缺少正式 API（#1835）；App 扫码登录网页的需求 [#367](https://github.com/casdoor/casdoor/issues/367) 自 2021 起 open；微信内登录直到 [#2894](https://github.com/casdoor/casdoor/issues/2894)（2024）才补。
  - 「代码质量」类投诉未找到可引用的具体 issue：未验证。

### Logto

- **技术栈 / 许可**：TypeScript / Node.js，必须 PostgreSQL（[README](https://github.com/logto-io/logto#readme)）。许可 MPL-2.0（[GitHub API](https://api.github.com/repos/logto-io/logto)）。是否需要 Redis：未验证。
- **维护活跃度（2026-10-06 查询）**：14,654 stars；最新 release `v1.44.0`（2026-09-30）；master 最后 commit 2026-09-30，仓库最近 push 2026-10-06（[repo](https://github.com/logto-io/logto)）。
- **部署形态**：独立服务（core + Console + sign-in experience SPA），非嵌入式库。
- **Cloud-only vs OSS**（[Logto OSS 文档](https://docs.logto.io/logto-oss)）：
  - 仅 Cloud：多 tenant 管理、Console 成员协作与 Console MFA、Protected App、内置 email 服务、Bring your UI（上传自定义登录 UI）、IdP-initiated SSO、去除 "Powered by Logto"。
  - OSS 限制：SAML app 最多 3 个。
  - 面向终端用户的 organizations / MFA / SSO 在 OSS 可用。
  - 差距在变化：2026-09-30 的 commit [c814034](https://github.com/logto-io/logto/commit/c814034) 为 self-hosted 增加 Console members/invitations。
- **OpenID Certified**：否。[openid.net 认证列表](https://openid.net/developers/certified-openid-connect-implementations/)（2026-10-06 全页检索）无 Logto / Silverhand。OIDC 层基于 node `oidc-provider`（[`packages/core/src/oidc/init.ts`](https://github.com/logto-io/logto/blob/master/packages/core/src/oidc/init.ts)）。
- **OAuth/OIDC flows**（init.ts 与 [`oidc/grants/`](https://github.com/logto-io/logto/tree/master/packages/core/src/oidc/grants)）：
  - authorization code + PKCE：有。
  - device flow：有，`deviceFlow.enabled: true`（[`device-flow.ts`](https://github.com/logto-io/logto/blob/master/packages/core/src/oidc/device-flow.ts)）；2026-03 才合入（[#8447](https://github.com/logto-io/logto/pull/8447)、[#8468](https://github.com/logto-io/logto/pull/8468)）。
  - token exchange (RFC 8693)：有，定位是 impersonation（见下）。
  - refresh token rotation：有，按 client 的 `rotateRefreshToken` metadata 控制。
  - `client_credentials`：有。ROPC：grants 目录中没有 password grant。DPoP：`enabled: false`。
- **原生 App / 小程序内无浏览器跳转登录**：无第一方直连 API。
  - [Experience API](https://openapi.logto.io/group/endpoint-experience)（`PUT /api/experience`、各类 verification、`POST /api/experience/submit`）覆盖 password / verification code / social / TOTP / WebAuthn / passkey sign-in / backup code，但必须运行在 OIDC authorization request 建立的 interaction session（cookie）内。
  - 长期诉求 [#3787 "API-based custom sign-up and sign-in"](https://github.com/logto-io/logto/issues/3787)（2023-04 起 open，28 评论）。维护者原话（2024-08）："the new API still requires redirection and cookies to function properly"；对原生 App 的建议是 in-app browser，或自行保存 `set-cookie` 并在每个请求带回。
  - 变通：后端自行校验身份 → Management API `POST /api/subject-tokens` → 客户端用 `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` 换 access token（[impersonation 文档](https://docs.logto.io/developers/user-impersonation)）。代价：这是 impersonation 语义，文档明确 "doesn't come with a refresh token"，短信校验、注册、MFA 全部要自己在 Logto 之外实现。
  - Bring your UI 只是把自定义 SPA（zip，≤20MB / ≤200 文件）托管到 Logto，仍是浏览器跳转，且属 Cloud 功能；OSS 需 fork experience 包（[文档](https://docs.logto.io/customization/bring-your-ui)）。
  - 官方原生 SDK 的登录方式（系统浏览器 / WebView）：未验证。
- **手机号 + SMS OTP**：支持，verification code 既是登录方式也是 MFA 因子。SMS connector 可插拔：`connector-aliyun-sms`、`connector-tencent-sms`、`connector-smsbao-sms`、`connector-yunpian-sms`、`connector-twilio-sms`、`connector-vonage-sms`，以及通用 `connector-http-sms`（[connectors 目录](https://github.com/logto-io/logto/tree/master/packages/connectors)）。
- **WeChat**：
  - 开放平台网站扫码：`connector-wechat-web`，固定 `qrconnect` endpoint + `snsapi_login`（[constant.ts](https://github.com/logto-io/logto/blob/master/packages/connectors/connector-wechat-web/src/constant.ts)）。
  - 开放平台移动应用（iOS/Android 拉起微信 SDK）：`connector-wechat-native`（[README](https://github.com/logto-io/logto/blob/master/packages/connectors/connector-wechat-native/README.md)）。
  - 公众号（微信内置浏览器网页授权）：无专用 connector；web connector 的 authorization endpoint 写死为 `qrconnect`，按源码推断不可用（未实测）。
  - 小程序 `code2session`：无。[#3013](https://github.com/logto-io/logto/issues/3013) 自 2023-01 起 open，维护者回复 "An upgrade on Logto's core connector architecture is required"；社区 PR [#3880](https://github.com/logto-io/logto/pull/3880) 已 closed，当前 connectors 目录无小程序 connector。
  - unionid：部分。web 与 native 两个 connector 的 `target` 都是 `wechat`，identity id 取 `unionid ?? openid`（[native index.ts](https://github.com/logto-io/logto/blob/master/packages/connectors/connector-wechat-native/src/index.ts)），因此扫码与 App 在同一开放平台账号下可落到同一 identity；公众号/小程序不在覆盖范围内。
- **2FA**：TOTP、SMS、email、passkeys (WebAuthn)、backup codes，另有 trusted devices（[MFA 文档](https://docs.logto.io/end-user-flows/mfa)）。
- **Passkeys**：可作 MFA 也可作首因子 passkey sign-in；绑定当前页面域名。文档原文："Logto does not currently offer WebAuthn support for native applications."（[WebAuthn 文档](https://docs.logto.io/end-user-flows/mfa/webauthn)）。
- **扩展模型**：connector（SMS / email / social；含通用 `http-sms`、`http-email`、`oauth2`、`oidc`、`saml`）、Webhooks、JWT customizer（自定义 token claims，`node:vm` 执行）。后两者的存在由 2026-09 安全公告 [GHSA-3556-624q-c5w3](https://github.com/logto-io/logto/security/advisories/GHSA-3556-624q-c5w3)、[GHSA-5wr4-942j-h43m](https://github.com/logto-io/logto/security/advisories/GHSA-5wr4-942j-h43m) 旁证，未读其功能文档。无登录流程级 plugin / action 机制（未验证其不存在）。
- **Admin UI**：内置 Console。
- **多租户**：面向终端用户的 organizations（organization RBAC、成员邀请、JIT provisioning，见 README）；实例级多 tenant 仅 Cloud。
- **痛点**：
  - 无 headless / 直连登录 API（#3787），对原生 App + 小程序优先的场景是结构性缺口；小程序 connector 缺失 3 年以上（#3013）。
  - 自托管部署问题：[#4279](https://github.com/logto-io/logto/issues/4279) docker 部署一直跳 `/unknown-session`（46 评论）；[#8548](https://github.com/logto-io/logto/issues/8548) self-hosted 全新启动创建 admin 超时。
  - 安全公告：repo 2026-07 ~ 2026-09 发布 13 条（[列表](https://github.com/logto-io/logto/security/advisories)），多为 high，包括 token exchange 把 ID token 当 subject token 接受、仅 `openid` scope 的第三方应用可设置初始密码、authorization code 外泄导致账号接管、Account Center MFA step-up 绕过（CVE-2026-55377）、TOTP 重放（CVE-2026-55370）、Webhook/OAuth2 connector SSRF。
  - MFA 强制绑定死循环 bug [#9123](https://github.com/logto-io/logto/issues/9123)（2026-07，已关闭）。

### Authing

- **性质 / 技术栈 / 许可**：闭源商业 IDaaS（authing.cn）。服务端技术栈：未验证。GitHub [Authing org](https://github.com/Authing) 上只有 SDK 与前端组件，均为 MIT。
- **维护活跃度（2026-10-06 查询，按 SDK 仓库 push 时间）**：
  - 活跃：`Guard`（Web 登录组件，1,361 stars，2026-09-18）、`authing-java-sdk`（2026-09-08）、`authing-node-sdk`（2026-03）、`authing-js-sdk`（2026-02）。
  - 停滞：`guard-ios`（2025-10）、`guard-android`（2025-05）、`authing-golang-sdk`（2025-01）、`authing-flutter-sdk`（2023-12）、`authing-wxapp-sdk`（2023-02-26）。移动端与小程序 SDK 明显落后于 Web/Java。
- **部署形态与定价**（[pricing 页](https://www.authing.cn/pricing)，经摘要工具读取，具体数字签约前需复核）：
  - 默认多租户 SaaS。免费版 ¥0（约 8,000 MAU、1 个 social 连接、1 个自建应用、10 条短信/月）；基础版 ¥139/月；高级版 ¥1,299/月；企业版议价。
  - MFA 与自定义域名从高级版起；短信额度随档位（300 / 1,500 / 12,000 条每月）。
  - 私有化部署：仅企业版，且为加购项（"私有云部署（可加购）"，需联系销售）。文档有 bare-metal / Docker Compose / Kubernetes 三种部署模式说明（[guides 导航](https://docs.authing.cn/v2/guides/)）。
- **OpenID Certified**：否。[openid.net 认证列表](https://openid.net/developers/certified-openid-connect-implementations/)（2026-10-06 全页检索）无 Authing。
- **OAuth/OIDC flows**（[成为 OIDC 身份源文档](https://docs.authing.cn/v2/guides/federation/oidc.html)）：
  - 授权码、授权码 + PKCE、隐式、混合、Client Credentials、密码模式（标注 "不推荐使用此模式"）、refresh token（需 `offline_access`）：有。
  - device flow、token exchange：文档未提及。
  - refresh token rotation：未验证。
  - SDK 暴露 `/oidc/auth`、`/oidc/token`、`/oidc/token/introspection`、`/oidc/token/revocation`（[`AuthenticationClient.java`](https://github.com/Authing/authing-java-sdk/blob/master/src/main/java/cn/authing/sdk/java/client/AuthenticationClient.java)）。
- **原生 App / 小程序内无浏览器跳转登录**：有，三者中最完整。V3 Authentication API（同上 `AuthenticationClient.java`）：
  - `POST /api/v3/send-sms`、`POST /api/v3/send-email`。
  - `POST /api/v3/signin`，`connection` 取 `PASSWORD` / `PASSCODE`（手机或邮箱验证码）/ `LDAP` / `AD`（[`SigninByCredentialsDto`](https://github.com/Authing/authing-java-sdk/blob/master/src/main/java/cn/authing/sdk/java/dto/SigninByCredentialsDto.java)）。
  - `POST /api/v3/signin-by-mobile`，`connection` 取值含 `wechat`、`wechat_mini_program_code`、`wechat_mini_program_phone`、`wechat_mini_program_code_and_phone`、`apple`、`alipay`、`wechatwork`、`douyin`、`huawei`、`xiaomi`、`oppo` 等（[`SigninByMobileDto`](https://github.com/Authing/authing-java-sdk/blob/master/src/main/java/cn/authing/sdk/java/dto/SigninByMobileDto.java)）。
  - 响应直接含 `access_token` / `id_token` / `refresh_token`（[`LoginTokenResponseDataDto`](https://github.com/Authing/authing-java-sdk/blob/master/src/main/java/cn/authing/sdk/java/dto/LoginTokenResponseDataDto.java)）。
  - 另有 `/api/v3/signup`、`/api/v3/signin-by-push`、App 扫码登录系列（`gene-qrcode`、`exchange-tokenset-with-qrcode-ticket`）。
  - 限制：私有 API 而非标准 OAuth grant，客户端与 Authing 协议强绑定；public client 调用是否需要 app secret、限流策略：未验证。
- **手机号 + SMS OTP**：三种接入方式——托管登录页、嵌入式 Guard 组件、API/SDK（`sendSmsCode` / `loginByPhoneCode` / `registerByPhoneCode`，[文档](https://docs.authing.cn/v2/guides/authentication/basic/sms/)）。
- **SMS provider**：默认使用 Authing 平台内置短信通道（验证码 5 分钟有效）；可改配自有通道：阿里云短信、腾讯云短信、创蓝 253（[配置短信服务](https://docs.authing.cn/v2/guides/userpool-config/sms/)）。仅这三家，未见通用 HTTP provider。
- **WeChat**（[社会化身份源列表](https://docs.authing.cn/v2/guides/connections/social.html)）：
  - PC 微信扫码、微信移动端（原生 App，[文档](https://docs.authing.cn/v2/guides/connections/social/wechat-mobile/)）、微信网页授权（公众号）、微信公众号关注、微信小程序、PC 小程序扫码、App 拉起小程序：均有。
  - 小程序 `code2session` 走 `signin-by-mobile` 的 `wechat_mini_program_*` 或小程序 SDK。
  - unionid 跨端账号合并：未验证。所查文档页未说明；有独立的「绑定账号」文档 `/v2/guides/user/bind-social-account.html`，未读取。
- **小程序 SDK**：[`authing-wxapp-sdk`](https://docs.authing.cn/v2/reference/sdk-for-wxapp.html)，方法 `loginByCode()`、`loginByPhone()`、`getPhone()`（返回 `openid` / `unionid`），token 写入微信 Storage；需把 `core.authing.cn` 加入 request 合法域名并在控制台配置小程序 AppId/AppSecret。
  - 仅微信小程序，[仓库](https://github.com/Authing/authing-wxapp-sdk)最后 push 2023-02-26（49 stars）。
  - `authing-miniapp` 不是 SDK（README：扫码登录 Authing Console 的小程序）。跨端框架 `AuthingMove`（2023-04）的 Taro / uni-app 覆盖：未验证。
- **2FA**：短信验证码 MFA（[文档](https://docs.authing.cn/v2/guides/security/mfa/sms.html)）、TOTP（`/api/v3/mfa-totp-verify`、`enroll-factor` 系列）；按定价页属高级版及以上。
- **Passkeys**：基于 FIDO2/WebAuthn，既可首因子登录也可作 MFA；文档只描述浏览器场景（[Passkey 文档](https://docs.authing.cn/v2/guides/passkey/end-user.html)）。iOS / Android SDK 与小程序内的 passkey 支持：未验证。
- **扩展模型**（[guides 导航](https://docs.authing.cn/v2/guides/)）：Pipeline 函数（"使用 Pipeline 对认证流程进行扩展"）、Webhook、自定义数据库连接、身份自动化 workflow（基础版 5 个、高级版 10 个）。
- **Admin UI**：SaaS 控制台。
- **多租户**：以用户池为隔离单元；另有组织机构管理；文档中「多租户」标注为 "内测版"。
- **痛点**：
  - 闭源 + 私有 API，迁出成本高；自托管只在企业版加购，价格不公开。
  - 移动端 / 小程序 SDK 维护滞后（见上），近期 issue 无人回复：[guard-android#4](https://github.com/Authing/guard-android/issues/4)（2026-06，`UserInfo` 字段解析错位，0 评论）、[guard-android#3](https://github.com/Authing/guard-android/issues/3)（编译失败，0 评论）、[guard-ios#5](https://github.com/Authing/guard-ios/issues/5)（版本号导致 App Store 提交失败）、[docs#413](https://github.com/Authing/docs/issues/413)（refresh token 换 access token 报授权码无效）。整个 org 当前 55 个 open issue。
  - 非 OpenID Certified，device flow / token exchange 无文档。

### Zitadel

- **技术栈 / 许可 / 活跃度**
  - Go 单体服务（内含 Console 管理台与 Login V2 前端），GitHub 15.2k stars；最新 release `v4.19.4`（2026-10-01），最近 commit 2026-10-02，仓库未归档（[repo](https://github.com/zitadel/zitadel)，[releases](https://github.com/zitadel/zitadel/releases)，`gh api` 于 2026-10-06 查询）。
  - 许可：主体为 **AGPL-3.0-only**；`proto/`、`apps/docs/` 为 Apache-2.0；`apps/login/`、`packages/zitadel-client/`、`packages/zitadel-proto/` 为 MIT；不想承担 AGPL 义务需购买商业许可（[LICENSING.md](https://github.com/zitadel/zitadel/blob/main/LICENSING.md)）。Apache→AGPL 的变更随 v3 引入：PR [#9597 "change from Apache to AGPL"](https://github.com/zitadel/zitadel/pull/9597)（2025-03-20），LICENSE 文件最后一次改动为 2025-04-02 的 "Introduce ZITADEL v3 (#9645)"；`v3.0.0` 发布于 2025-05-02。**对"fork 后闭源改造"的方案，AGPL 是硬约束**。
  - 部署形态：独立服务，不是可嵌入的库。数据库仅 PostgreSQL（文档写明支持 14–18），启动前必须 `zitadel init` 建 `eventstore.events` 等表（[database 文档](https://zitadel.com/docs/self-hosting/manage/database)）；CockroachDB 支持已移除（[#9444 "chore!: remove CockroachDB Support"](https://github.com/zitadel/zitadel/pull/9444)，2025-03-03；[#9480](https://github.com/zitadel/zitadel/pull/9480)）。缓存连接器为可选的 Beta 功能（同上文档）。
  - 版本节奏：`v3.0.0`（2025-05-02）→ `v4.0.0`（2025-07-31），三个月内两个大版本；v4 把 Login V2 设为默认并附带一批 deprecated endpoint 清单（[v4.0.0 release notes](https://github.com/zitadel/zitadel/releases/tag/v4.0.0)）；原独立仓库 `zitadel/typescript`（Login V2）已归档并入 monorepo（[repo](https://github.com/zitadel/typescript)，archived，最后 push 2025-10-27）。
- **OIDC / OAuth2**
  - OpenID 认证：在 openid.net 认证列表页中，**"Certified OpenID Provider Servers and Services" 一节没有 ZITADEL 条目**；唯一相关条目是 Go 库 `zitadel/oidc` v0.15.7，列在 *Relying Party Libraries* 下（Basic RP、Config RP，Certified by CAOS）（[openid.net 列表](https://openid.net/developers/certified-openid-connect-implementations/)，2026-10-06 抓取后本地 grep）。即 OP 服务端认证 **未在该页查到**。
  - 支持的 grant：Authorization Code、PKCE、Client Credentials、Device Authorization、Implicit、JWT Profile、Refresh Token、Token Exchange；**明确不支持 ROPC**（"Due to growing security concerns we do not support this grant type"）（[grant-types](https://zitadel.com/docs/apis/openidoauth/grant-types)）。
  - Token Exchange：文档称是"first iteration"；subject token 可为 access token（JWT/opaque）、ID token、自签 JWT、user ID（后两者需 actor token）；支持 impersonation（[token-exchange 指南](https://zitadel.com/docs/guides/integrate/token-exchange)）。
  - Refresh token rotation：未验证 (unverified)。
- **原生应用内登录（不经浏览器跳转）**
  - 有第一方直连 API：Session API v2。自建登录 UI 调 `POST /v2/sessions` 创建会话、`PATCH` 追加 checks（password / webAuthN / TOTP / otpSms / otpEmail / IdP intent），拿到 **session token**（[oidc-standard](https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard)，[mfa](https://zitadel.com/docs/guides/integrate/login-ui/mfa)）。
  - **session token ≠ OIDC token**。要换成 access/ID token，官方路径仍是：先请求 `/oauth/v2/authorize` → Zitadel 重定向到 `/login?authRequest=<ID>` → UI 调 `GET /v2/oidc/auth_requests/{id}` → 建 session → `POST /v2/oidc/auth_requests/{id}` finalize（需 `IAM_LOGIN_CLIENT` 角色的服务账号）→ 得到 callback URL（带 code）→ `/token`（[oidc-standard](https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard)）。文档原意是"UI 代理这些端点"；**推断**：由自家 BFF 用 HTTP client 走完这串 redirect 可以做到 App 内无浏览器，但这是自己拼的流程而非现成能力，小程序端必须有自建后端中转。
  - "session token 直接换 OIDC token"是长期未实现的需求：[#7900 "Allow Token Exchange with Session Token"](https://github.com/zitadel/zitadel/issues/7900)（2024-05-03 创建，27 reactions，至 2026-07 仍 open）。
- **手机号 + 短信验证码登录**
  - 文档中 OTP SMS / OTP Email 的定位是**第二因子**：流程图均为先完成首因子（密码或外部 IdP）再做 OTP（[mfa 指南](https://zitadel.com/docs/guides/integrate/login-ui/mfa)，[default-settings](https://zitadel.com/docs/guides/manage/console/default-settings)）。仅凭手机号+短信码作为**首因子**的免密登录：未在官方文档找到，未验证 (unverified)；相关讨论只有 [#7409 "Login with email or phone number"](https://github.com/zitadel/zitadel/issues/7409)（指用手机号作 login name）与 [#8996 "Allow only passwordless authentication"](https://github.com/zitadel/zitadel/issues/8996)（均已 closed）。
  - 可绕行的点：`otpSms` challenge 支持 `returnCode: true`，即 Zitadel 只生成验证码、由你自己的服务发送（[mfa 指南](https://zitadel.com/docs/guides/integrate/login-ui/mfa)）。
  - SMS provider：Console 文档仍写"At the moment Twilio is available as SMS provider"（[default-settings](https://zitadel.com/docs/guides/manage/console/default-settings)），但通用 HTTP provider 已合入（PR [#8540 "feat: add http as sms provider"](https://github.com/zitadel/zitadel/pull/8540)，merged 2024-09-06；仍有相关 bug [#12117](https://github.com/zitadel/zitadel/issues/12117) open）。**推断**：阿里云/腾讯云短信需要请求签名，HTTP provider 只能打到你自己的转发服务，再由它调云厂商 SDK。
- **WeChat**
  - 无内置：IdP 模板为 Google、GitHub、GitLab、Apple、Entra ID、Okta、Keycloak(generic OIDC)、LDAP、JWT、SAML，**没有 WeChat**（[IdP 介绍](https://zitadel.com/docs/guides/integrate/identity-providers/introduction)）。仓库 issue 搜 "wechat" 无功能请求命中，GitHub 搜 "zitadel wechat" 无社区扩展仓库（`gh api search`，2026-10-06）。
  - 开放平台 App 登录 / 公众号网页登录 / 小程序 `code2session` / unionid 合并：全部需自建。generic OIDC 模板要求 IdP "fully compliant with OpenID Connect"（同上文档），WeChat 不满足；可行扩展点是自建后端完成微信换码后，用 User API + Session API 落账号与会话——该路径的具体可行性（无首因子 check 的 session 能否 finalize auth request）未验证 (unverified)。
  - 账号关联仅有按 username / email 的自动 linking 选项（同上文档），无 unionid 概念。
- **2FA / Passkeys**：TOTP、OTP SMS、OTP Email、U2F、Passkeys（WebAuthn，Session API 中为 `webAuthN` challenge/check）均内置（[mfa 指南](https://zitadel.com/docs/guides/integrate/login-ui/mfa)，[default-settings](https://zitadel.com/docs/guides/manage/console/default-settings)）。原生 App 内的 passkey 体验仍在打磨，见 2026-10-06 新开的 [#12885](https://github.com/zitadel/zitadel/issues/12885)。
- **扩展模型 / 管理台 / 多租户**
  - Actions v2：**不是进程内插件**，而是"target（外部 HTTP 端点）+ execution（触发条件）"，触发点四类：request、response、function、event；function 用于替代 Actions v1，文档写两者目前并存执行（[actions_v2](https://zitadel.com/docs/concepts/features/actions_v2)）。v1 的移除时间表：未验证 (unverified)。
  - 管理台：内置 Console（[default-settings](https://zitadel.com/docs/guides/manage/console/default-settings)）；登录页为 MIT 的 Next.js 应用 `apps/login`，可自行改造（[LICENSING.md](https://github.com/zitadel/zitadel/blob/main/LICENSING.md)）。
  - 多租户：instance（最顶层，可通过 system API 创建多个虚拟 instance）→ organization → project（[instance 概念](https://zitadel.com/docs/concepts/structure/instance)）。文档未说明虚拟 instance 是否限于托管版，自托管可用性未验证 (unverified)。
- **已知痛点**
  - 授权模型缺口：[#5822 "User group authorizations"](https://github.com/zitadel/zitadel/issues/5822)（2023-05 起 open，134 reactions，仓库最高票）；[#5219 token lifetime 按 org/app 配置](https://github.com/zitadel/zitadel/issues/5219)（49）。
  - 用户模型僵硬：[#6433 "User Schema"](https://github.com/zitadel/zitadel/issues/6433)（2023-08 起 open）、[#4386 "Remove required fields from user"](https://github.com/zitadel/zitadel/issues/4386)（2022-09 起 open）——对"只有手机号的用户"场景不友好。
  - 会话与 token 语义仍有洞：[#12637 "Stop terminated sessions from minting access tokens via refresh grants"](https://github.com/zitadel/zitadel/issues/12637)（2026-08 open）。
  - 基础设施与升级：CockroachDB 被砍需迁移（[#7586](https://github.com/zitadel/zitadel/issues/7586)、[#9444](https://github.com/zitadel/zitadel/pull/9444)）；Postgres 18 兼容性曾是高票问题（[#10712](https://github.com/zitadel/zitadel/issues/10712)，44 reactions）；v2→v3（改许可）→v4（换默认登录 UI、废弃一批 v1 API）连续破坏性变更（见上）。
  - event sourcing 带来的 projection 性能/运维复杂度：本次未找到可引用的具体高票 issue，未验证 (unverified)。

### Ory（Hydra + Kratos）

- **技术栈 / 许可 / 活跃度**
  - 两个独立的 Go 服务：**Kratos**（身份/登录注册/会话，13.9k stars）与 **Hydra**（纯 OAuth2/OIDC server，17.6k stars），均 Apache-2.0（[kratos](https://github.com/ory/kratos)，[hydra](https://github.com/ory/hydra)）。
  - 最新 OSS release 两者都是 `v26.2.0`（2026-03-20）；公开仓库最近 commit 均为 **2026-07-29**，至 2026-10-06 已两个多月无新 commit（`gh api`）。Hydra 版本号从 `v2.3.0`（2025-01-17）直接跳到 `v25.4.0`（2025-11-07），OSS release 间隔 4–10 个月（[hydra releases](https://github.com/ory/hydra/releases)）。
  - OSS 与商业版的切分（Kratos README 原文）：OSS 面向"experiment, prototype, or run unimportant workloads without SLAs"；**Ory Enterprise License (OEL)** 才有 "SCIM, SAML, organization login (SSO), CAPTCHAs and more"、带 SLA 的 CVE 修复、"advanced scaling, multi-tenancy"、私有 Docker registry 的 enterprise builds（[kratos README](https://github.com/ory/kratos/blob/master/README.md)；Hydra README 同样把 multi-tenancy 列在 OEL 下，[hydra README](https://github.com/ory/hydra/blob/master/README.md)）。即 **OSS 版不保证及时安全补丁**。
  - 部署形态：独立服务 ×2（不是库），各自需要 SQL 数据库。Hydra v25.4 release notes 提到 CockroachDB v25+ 迁移修复（[v25.4.0](https://github.com/ory/hydra/releases/tag/v25.4.0)）；完整的支持数据库列表本次未验证 (unverified)。
- **OIDC / OAuth2（Hydra）**
  - OpenID 认证：Hydra README 自称 "OpenID Certified"，列出 Basic / Implicit / Hybrid / Config / Dynamic OP 五个 profile（[hydra README](https://github.com/ory/hydra/blob/master/README.md)）；但 **2026-10-06 抓取的 openid.net 列表页中 grep 不到任何 Ory / Hydra 条目**（[openid.net 列表](https://openid.net/developers/certified-openid-connect-implementations/)）。两者不一致，当前认证状态应视为未验证 (unverified)。
  - Device flow（RFC 8628）：OSS 自 `v25.4.0` 起支持（[release notes](https://github.com/ory/hydra/releases/tag/v25.4.0)）。
  - Token Exchange（RFC 8693）：**不支持**，[hydra#1218 "Support RFC8693: Token Exchange"](https://github.com/ory/hydra/issues/1218) 自 2018-12 起 open。
  - Refresh token rotation：有，"Refresh tokens are single-use only"（[refresh-token-grant](https://www.ory.com/docs/oauth2-oidc/refresh-token-grant)）；grace period / reuse detection 细节未验证。
  - Auth code + PKCE：属于认证 profile 的基础能力；PKCE 配置细节本次未单独验证。
  - Hydra 本身**不存用户**："doesn't contain a database with end users but instead uses HTTP redirection to delegate the login flow"，登录靠带 `login_challenge` 的浏览器重定向 + admin API accept（[login/consent flow](https://www.ory.com/docs/oauth2-oidc/custom-login-consent/flow)）。
- **原生应用内登录（不经浏览器跳转）**
  - Kratos 有一等公民的 native/API flow：`GET /self-service/login/api` 初始化 → `POST` 提交凭据 → 返回 JSON，含 `session_token`、`session`、`identity`；之后用 `Authorization: Bearer <session_token>` 调 `/sessions/whoami` 校验（[user-login 文档](https://www.ory.com/docs/kratos/self-service/flows/user-login)）。可提交的 method：`password, code, passkey, webauthn, totp, lookup_secret, oidc, saml, identifier_first`（[spec/api.json](https://github.com/ory/kratos/blob/master/spec/api.json) 的 `updateLoginFlowBody`）。
  - 限制：文档明确 "Never use API flows to implement Browser applications"（CSRF 风险）（同上）——小程序属非浏览器客户端，适用 API flow，但要自己管 token 存储。
  - **Kratos session token 是不透明会话凭据，不是 OAuth2/OIDC token**。Kratos↔Hydra 的集成只存在于 browser flow：`/self-service/login/browser` 接受 `login_challenge` 参数，而 `/self-service/login/api` **没有该参数**（参数列表为 `refresh, aal, X-Session-Token, return_session_token_exchange_code, return_to, organization, via, identity_schema`，见 [spec/api.json](https://github.com/ory/kratos/blob/master/spec/api.json)）。结论：**native flow 拿不到 Hydra 的 access/ID token**；要 OIDC token 就得走浏览器重定向，或自己写 token 网关。原生 App + 小程序为主的场景下，Hydra 基本用不上，实际只用 Kratos session。
  - 社交登录在 native flow：通用路径仍要开浏览器（`return_session_token_exchange_code=true`，回跳后用两段 code 换 session token；api flow 直接做社交登录会得到 `422`）（[native-apps 文档](https://www.ory.com/docs/kratos/social-signin/native-apps)）。另有 `id_token` + `id_token_nonce` 直接提交方式（[spec/api.json](https://github.com/ory/kratos/blob/master/spec/api.json) 的 `updateLoginFlowWithOidcMethod`），文档只提到 Apple / Google。
- **手机号 + 短信验证码登录**
  - 支持作为**首因子**：`code` 策略开启 `selfservice.methods.code.passwordless_enabled=true`，验证码经 SMS 下发（[one-time-code 文档](https://www.ory.com/docs/kratos/passwordless/one-time-code)）。官方同时警告 "SMS OTP is considered insecure"。
  - SMS provider 可插拔：`courier.channels` 里 `type: http` + `request_config`（url / method / headers / auth / Jsonnet body），"any service that supports sending SMS via HTTP API, such as Twilio, Plivo, AWS SNS, or your own microservice"；有 SMS 模板的只有 `verification_code`、`login_code`、`recovery_code`（[sending-sms 文档](https://www.ory.com/docs/kratos/emails-sms/sending-sms)）。**推断**：阿里云/腾讯云短信需签名，Jsonnet 模板做不了，需指向自建转发服务。
  - 文档以 Ory Network 的 CLI 为例，未区分自托管差异（同上）；SMS recovery 在自托管上有未解决的报错 issue [kratos#4262](https://github.com/ory/kratos/issues/4262)（2025-01 起 open）。
- **WeChat**
  - 无内置：Kratos 的社交 provider 源码有 `dingtalk`、`lark`、`line`、`apple`、`google` 等 26 个，**没有 wechat / weixin**（[selfservice/strategy/oidc](https://github.com/ory/kratos/tree/master/selfservice/strategy/oidc)）；issue 搜 "wechat" 无功能请求命中；GitHub 搜 "kratos wechat" 无可用社区扩展（`gh api search`，2026-10-06）。
  - 开放平台 App / 公众号 / 小程序 `code2session` / unionid 合并：全部自建。可选扩展点：(a) fork Kratos 仿 `provider_dingtalk.go` 加 provider（需维护 fork）；(b) 自建后端完成微信换码后经 Kratos admin API 建 identity/session——(b) 的具体接口本次未验证 (unverified)。小程序没有 OAuth 重定向，(a) 不适用。
- **2FA / Passkeys**：TOTP、WebAuthn/FIDO2、Lookup Secrets（备用码）、SMS/email code 作 MFA 均支持；Passkeys / WebAuthn passwordless 是首因子，不算第二因子（[MFA overview](https://www.ory.com/docs/kratos/mfa/overview)）。native flow 可提交 `passkey` method（[spec/api.json](https://github.com/ory/kratos/blob/master/spec/api.json)）；在原生 App 中的实际接入方式未验证。
- **扩展模型 / 管理台 / 多租户**
  - 扩展靠配置 + 外部 HTTP：flow hooks / webhook + Jsonnet 模板（Jsonnet 用法见 [sending-sms](https://www.ory.com/docs/kratos/emails-sms/sending-sms)；webhook 配置的混乱是已知问题 [kratos#3352 "Clean up webhook configuration"](https://github.com/ory/kratos/issues/3352)，2023-06 起 open）。**没有进程内插件机制**，改行为只能 fork。hooks 的完整清单本次未验证。
  - 管理台 / 登录 UI：OSS 为 headless，需自建 UI 与管理后台——本次未从一手来源直接验证 (unverified)；Ory Console 属于 Ory Network。
  - 多租户：OSS 无；multi-tenancy 与 organization login 列在 OEL / Ory Network 下（[kratos README](https://github.com/ory/kratos/blob/master/README.md)）。
- **已知痛点**
  - Kratos + Hydra 的拼接成本与认知负担：[kratos#3108 "Hydra + Kratos login flow"](https://github.com/ory/kratos/issues/3108)、[discussion #3339](https://github.com/ory/kratos/discussions/3339)、[discussion #3408 "2FA is bypassed when combined with Hydra and JSON login"](https://github.com/ory/kratos/discussions/3408)（仅见标题，内容未读）。
  - 基础功能长期缺失：[kratos#2892 "Resend Verification Email"](https://github.com/ory/kratos/issues/2892)（2022-11 起 open，仓库最高票 18）、[#2525 "User invites flow"](https://github.com/ory/kratos/issues/2525)（2022-06 起）、[#2794 "Webauthn and AAL2"](https://github.com/ory/kratos/issues/2794)（2022-10 起）。
  - 功能与安全补丁向 OEL 倾斜、OSS 仓库更新变慢（见上"许可/活跃度"）。

### Keycloak

- **技术栈 / 许可 / 活跃度**
  - Java（Quarkus 发行版），Apache-2.0，37.2k stars；最新 release `26.8.0`（2026-10-01），最近 commit 2026-10-06，三者中最活跃（[repo](https://github.com/keycloak/keycloak)，`gh api`）。无 OSS / 商业功能切分的迹象（本次未专门核查 Red Hat build 的差异）。
  - 部署形态：独立服务，不可嵌入 Go 进程；需外部关系型数据库（具体支持列表本次未验证）。资源占用：官方 sizing 文档写 "The base memory usage for a Pod including caches of Realm data and 10,000 cached sessions is 1250 MB of RAM"，每 15 次/秒密码登录配 1 vCPU（[memory & CPU sizing](https://www.keycloak.org/high-availability/multi-cluster/concepts-memory-and-cpu-sizing)）。
- **OIDC / OAuth2**
  - OpenID 认证：openid.net 列表页有 **Keycloak 18.0.0**（Red Hat）列在 *Logout Profiles*（RP-Initiated / Session / Front-Channel / Back-Channel OP），以及 **Keycloak 15.0.2** 列在 FAPI Advanced 与 FAPI-CIBA OP；该页 "OpenID Provider Servers and Services" 一节 grep 不到 Red Hat / Keycloak 条目（[openid.net 列表](https://openid.net/developers/certified-openid-connect-implementations/)，2026-10-06）。认证版本均很旧。
  - Flow：Authorization Code（含 PKCE）、Device Authorization Grant、Client Credentials、CIBA、Implicit / Hybrid（带安全警告）（[oidc-layers](https://www.keycloak.org/securing-apps/oidc-layers)）。
  - Token Exchange：Standard Token Exchange V2（RFC 8693）自 26.2 起正式支持且默认开启，但**仅 internal-to-internal**；external token 交换与 impersonation 只在 deprecated 的 legacy V1 preview 里（[token-exchange](https://www.keycloak.org/securing-apps/token-exchange)，[26.2.0 release notes](https://github.com/keycloak/keycloak/releases/tag/26.2.0)）。——"拿微信 code / 外部凭据换本系统 token"恰好落在不受支持的那一侧。
  - 26.4 起 DPoP 完全支持、FAPI 2 Final（[26.4.0 release notes](https://github.com/keycloak/keycloak/releases/tag/26.4.0)）。Refresh token rotation（Revoke Refresh Token 选项）：未验证 (unverified)。
- **原生应用内登录（不经浏览器跳转）**
  - 唯一的第一方直连方式是 Direct Access Grants（ROPC）。官方文档定性：按 RFC 9700 "MUST NOT be used"，凭据暴露给应用，"no support for identity brokering or social login"，且已从 OAuth 2.1 移除（[oidc-layers](https://www.keycloak.org/securing-apps/oidc-layers)）。默认是否关闭：未验证。
  - 没有等价于 Zitadel Session API / Kratos native flow 的"自建 UI 驱动登录"的 REST API；官方推荐原生 App 用 Authorization Code + 系统浏览器（同上）。CIBA 可免跳转但需另一条认证通道（同上），不适合作为主登录方式。
  - 社区做法是通过 SPI 自定义 direct grant flow：如 `cooperlyt/keycloak-phone-provider` 提供 "Authenticate everybody by phone, auto create user on Grant (Rest API)"（[README](https://github.com/cooperlyt/keycloak-phone-provider)）——本质仍是 ROPC 变体。
- **手机号 + 短信验证码登录**
  - 无内置：官方只列 "passkey, recovery codes and TOTP/HOTP"（[server admin guide](https://www.keycloak.org/docs/latest/server_admin/index.html)，仅读取前 10 万字符）；官方 issue [#34129 "Login and Registration via OTP (SMS) in Single Form"](https://github.com/keycloak/keycloak/issues/34129)（2024-10 起 open）。
  - 社区 SPI 扩展：
    - [`netzbegruenung/keycloak-mfa-plugins`](https://github.com/netzbegruenung/keycloak-mfa-plugins)：297 stars，最后 push 2026-10-05，维护活跃；"SMS authenticator: Provides SMS as authentication step. SMS are sent via HTTP API, which can be configured (production ready)"；定位是 2FA 步骤，能否作为首因子未验证。
    - [`cooperlyt/keycloak-phone-provider`](https://github.com/cooperlyt/keycloak-phone-provider)：359 stars，**最后 push 2025-03-04**，CI 徽章仅到 Keycloak 20/21；支持 phone 登录（browser flow 与 REST grant）、OTP by phone，**内置 Aliyun、Tencent、Twilio 等 SMS 模块**。活跃 fork：[`hyperzlib/keycloak-phone-provider`](https://github.com/hyperzlib/keycloak-phone-provider)（10 stars，2026-04）。对 Keycloak 26.x 的兼容性未验证。
- **WeChat**
  - 无内置：内置 social provider 为 Bitbucket、Facebook、GitHub、GitLab、Google、Instagram、LinkedIn、Microsoft、OpenShift 4、PayPal、Stack Overflow、Twitter（[server admin guide](https://www.keycloak.org/docs/latest/server_admin/index.html)）。
  - 社区扩展：[`jyqq163/keycloak-services-social-weixin`](https://github.com/jyqq163/keycloak-services-social-weixin)（62 stars，最后 push 2025-11-18，无 release，自述"适配了 quay.io/keycloak 26.0 版本"）；原作者仓库 `Jeff-Tian/keycloak-services-social-weixin` 现已 404。README 说明：支持 PC 扫码（开放平台）与微信内公众号登录，"账号关联默认使用微信 unionid，如 unionid 不存在则使用 openId"，且 PC 与公众号须绑定同一开放平台。另有 fork [`z5882852/...`](https://github.com/z5882852/keycloak-services-social-weixin)（12 stars，2025-05）。
  - **小程序 `code2session`：该插件 README 中无任何小程序相关内容**（grep 无命中）；官方 issue [#27690 "redirect to WeChat applet"](https://github.com/keycloak/keycloak/issues/27690) 已 closed。开放平台移动 App SDK 登录同样未见覆盖。两者需自写 SPI（自定义 direct grant authenticator 或自定义 grant type），具体工作量未验证。
- **2FA / Passkeys**：TOTP / HOTP、recovery codes 内置（[server admin guide](https://www.keycloak.org/docs/latest/server_admin/index.html)）；Passkeys 自 26.4.0（2025-09-30）起为正式支持，集成进登录表单（conditional 与 modal UI）（[26.4.0 release notes](https://github.com/keycloak/keycloak/releases/tag/26.4.0)）。SMS 2FA 靠上述社区插件。
- **扩展模型 / 管理台 / 多租户**
  - 扩展：Java SPI（以 jar 部署，如 `netzbegruenung.keycloak-2fa-sms-authenticator.jar`，[README](https://github.com/netzbegruenung/keycloak-mfa-plugins)）+ themes（社区工具 [keycloakify](https://github.com/keycloakify/keycloakify)，2.6k stars）。三者中唯一有**进程内插件**机制，但语言是 Java，与 Go 技术栈不通。
  - 管理台：内置 Admin Console，功能最全（[server admin guide](https://www.keycloak.org/docs/latest/server_admin/index.html)）。
  - 多租户：realm 级隔离 + Organizations（realm 内的 B2B 组织，"Starting with Keycloak 26, the Organizations feature is fully supported"，[26.0.0 release notes](https://github.com/keycloak/keycloak/releases/tag/26.0.0)，2024-10-04；总 epic [#30180](https://github.com/keycloak/keycloak/issues/30180) 仍 open，165 reactions）。
- **已知痛点**
  - SPI 随大版本漂移，插件要逐版本适配：微信插件 README 为 Keycloak 16 / 18 / 21 / 22 / 26 分别维护分支或版本（[README](https://github.com/jyqq163/keycloak-services-social-weixin)）；phone provider 的 CI 停在 20/21（[README](https://github.com/cooperlyt/keycloak-phone-provider)）。中国场景的核心能力（短信、微信）全部压在这类小型社区插件上。
  - JVM 资源占用：单 Pod 基线 1250 MB RAM（[sizing 文档](https://www.keycloak.org/high-availability/multi-cluster/concepts-memory-and-cpu-sizing)）。
  - 长期高票未决需求：[#13484 "SCIM support"](https://github.com/keycloak/keycloak/issues/13484)（2022-08 起 open，311 reactions）、[#8742 "Trusted Device two factor authenticator"](https://github.com/keycloak/keycloak/issues/8742)（2021-11 起，132）。
  - 浏览器重定向 + 服务端渲染主题的登录模型与"原生 App / 小程序自绘 UI"的需求根本不契合（见"原生应用内登录"）。

### Better Auth

> 核对日期 2026-10-06。标注"未验证"的条目表示未能在一手来源中确认；标注"推断"的条目是基于已核实事实的推理。

**基本面**
- 技术栈 TypeScript，MIT 许可，GitHub 30,178 stars，open issues 376；最新 release `v1.7.7`（2026-09-30），仓库当日仍有 push（[repo](https://github.com/better-auth/better-auth)、[releases](https://github.com/better-auth/better-auth/releases)）。
- 形态：嵌入宿主应用的 TS 库（不是独立服务），以一个 handler 挂在宿主框架路由下，数据直接写入宿主自己的数据库（[database 文档](https://www.better-auth.com/docs/concepts/database)）。
- 背后公司：2025-06-24 宣布 500 万美元 seed，Peak XV 领投，Y Combinator、Chapter One、P1 Ventures 参投；路线图含统一 dashboard、安全特性、email/SMS 服务、分布式 session 存储（[seed-round 博客](https://www.better-auth.com/blog/seed-round)）。
- monorepo 包划分（`packages/`）：`core`、`better-auth`、各 adapter（`drizzle-adapter` `prisma-adapter` `kysely-adapter` `mongo-adapter` `memory-adapter`）、`redis-storage`，以及独立发布的重型插件 `oauth-provider` `passkey` `sso` `scim` `mcp` `cimd` `api-key` `stripe` `expo` `electron` `i18n`（[packages 目录](https://github.com/better-auth/better-auth/tree/main/packages)）。
- 内置插件目录（`packages/better-auth/src/plugins`）：access、additional-fields、admin、anonymous、bearer、captcha、custom-session、device-authorization、email-otp、generic-oauth、haveibeenpwned、jwt、last-login-method、magic-link、multi-session、oauth-popup、oauth-proxy、one-tap、one-time-token、open-api、organization、phone-number、siwe、two-factor、username（[plugins 目录](https://github.com/better-auth/better-auth/tree/main/packages/better-auth/src/plugins)）。

**核心数据模型**（[get-tables.ts](https://github.com/better-auth/better-auth/blob/main/packages/core/src/db/get-tables.ts)）
- `user`：name、email、emailVerified、image、createdAt、updatedAt。
- `session`：token、expiresAt、ipAddress、userAgent、userId、createdAt、updatedAt。
- `account`：accountId、providerId、userId、accessToken、refreshToken、idToken、accessTokenExpiresAt、refreshTokenExpiresAt、scope、password、createdAt、updatedAt。
- `verification`：identifier、value、expiresAt、createdAt、updatedAt（通用的一次性凭证表，OTP、邮箱验证、重置密码都落这里）；另有 `rateLimit`（key、count、lastRequest）。
- 多 provider 建模：一行 `account` = 一个用户的一种登录方式，`providerId`（如 google）+ `accountId`（provider 侧 ID）；密码登录也是一行 account，`providerId = "credential"`，密码 hash 存在 `account.password` 而不是 `user` 表（[database 文档](https://www.better-auth.com/docs/concepts/database)）。
- Account linking：OAuth 登录邮箱已验证且与现有用户相同则默认自动合并；选项 `trustedProviders`、`allowDifferentEmails`、`updateUserInfoOnLink`、`disableImplicitLinking`、`allowUnlinkingAll`；默认禁止解绑最后一个 account；API 为 `linkSocial` / `unlinkAccount` / `listAccounts`（[users-accounts 文档](https://www.better-auth.com/docs/concepts/users-accounts)）。
- 模型以 email 为中心：phone-number 插件注册时要 `getTempEmail`，WeChat provider 用 `createPlaceholderEmail` 造占位邮箱（[wechat.ts](https://github.com/better-auth/better-auth/blob/main/packages/core/src/social-providers/wechat.ts)）；"让 `name` 可选"的 issue 自 2024-11 仍 open（[#424](https://github.com/better-auth/better-auth/issues/424)）。对手机号优先的场景这是结构性不适配。
- v1.7.0 起 account 需要 `Account.issuer`（SSO 相关 breaking change，[v1.7.0 notes](https://github.com/better-auth/better-auth/releases/tag/v1.7.0)）。

**Server plugin 能声明什么**（类型定义 [plugin.ts](https://github.com/better-auth/better-auth/blob/main/packages/core/src/types/plugin.ts)，文档 [plugins](https://www.better-auth.com/docs/concepts/plugins)）
- `id`（必填）、`version`。
- `init(ctx)`：启动时执行，可返回对 `context` 与 `options` 的局部覆盖，即插件可以改写全局配置（例如注入 databaseHooks）。
- `endpoints`：`{ key: Endpoint }`，用 better-call 的 `createAuthEndpoint(path, { method, body schema, use: [middleware] }, handler)` 定义；文档要求 path 用 kebab-case，只用 GET/POST。
- `middlewares`：`[{ path, middleware }]`，按路径匹配，仅对 HTTP 调用生效（服务端直接调用 `auth.api.*` 时不触发）。
- `hooks.before` / `hooks.after`：`[{ matcher(ctx) => bool, handler }]`，可拦截任意端点（包括其他插件的），after 能读到 `context.returned` 和 `responseHeaders`。two-factor 就是这样实现的：hook 的 matcher 写死 `/sign-in/email`、`/sign-in/username`、`/sign-in/phone-number` 三个 path，并在凭证登录已下发 session cookie 之后再把它撤掉（[two-factor/index.ts](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/two-factor/index.ts)）。这种"先建 session 再撤销、按 path 白名单拦截"的做法是新登录方式默认绕过 2FA 的根源，Go 版应改为核心内的显式"登录完成前检查点"。
- `onRequest(request, ctx)`：可返回 `{ response }` 短路或 `{ request }` 改写；`onResponse(response, ctx)`：可替换响应。
- `schema`：新增表，或向 `user` / `session` 等核心表追加字段；字段有 `type` / `required` / `unique` / `references`（含 `onDelete`，默认 cascade）/ `fieldName`（列名别名），可设 `disableMigration`。
- `migrations`、`options`、`$Infer`（仅类型用途）、`$ERROR_CODES`（插件自带错误码表）。
- `rateLimit`：`[{ window, max, pathMatcher }]`，插件自带限流规则。
- `adapter`：插件可暴露一组自定义数据访问函数。
- 文档另列 `trustedOrigins`（[plugins 文档](https://www.better-auth.com/docs/concepts/plugins)）。

**Client plugin 能声明什么**（[plugin-client.ts](https://github.com/better-auth/better-auth/blob/main/packages/core/src/types/plugin-client.ts)）
- `id`、`$InferServerPlugin`（纯类型：把 server 端点推导成 client 方法，kebab-case path 转 camelCase）、`getActions($fetch)`（手写方法）、`getAtoms`（nanostores 状态，支撑 `useSession` 这类 hook）、`pathMethods`（覆盖 GET/POST 推断）、`fetchPlugins`（better-fetch 拦截器）、`atomListeners`（哪些请求成功后刷新哪些 atom）、`$ERROR_CODES`。

**Schema / migration / adapter**
- CLI `migrate` 直接改库，仅 Kysely（内置）adapter 支持；`generate` 为 Prisma / Drizzle 生成 schema 文件或输出 SQL；CLI 会把所有已启用插件的 `schema` 合并后生成（[database 文档](https://www.better-auth.com/docs/concepts/database)）。
- 表名、列名可通过 `modelName` / `fields` 重映射；`additionalFields` 带 `input` / `returned` 开关控制字段可写、可回显；ID 策略可选 DB 自增、uuid、自定义函数。
- `databaseHooks`：user / session / account 的 create / update before / after，before 可中止或改写 payload。
- `secondaryStorage`（Redis 等 KV）可承接 session 与 verification；`advanced.database.joins` 为实验特性。
- adapter 抽象是窄接口的通用 CRUD，插件只面向它写一次即可跨库；代价是 2026-09 曝出 drizzle adapter 在 PostgreSQL 上并发可突破限流（[GHSA-44jh-23m7-hpcf](https://github.com/better-auth/better-auth/security/advisories/GHSA-44jh-23m7-hpcf)），通用 adapter 难以表达原子操作。

**OIDC Provider → OAuth Provider**
- 旧 `oidcProvider` 插件已弃用并删除：PR [#10031](https://github.com/better-auth/better-auth/pull/10031)（2026-06-12 合并）在 v1.7.0（2026-08-18）移除，迁移目标是 `@better-auth/oauth-provider`（[v1.7.0 notes](https://github.com/better-auth/better-auth/releases/tag/v1.7.0)）；旧文档页已 404。
- 旧插件遗留的安全问题：允许 plain PKCE 并声明支持 unsigned token（[GHSA-9h47-pqcx-hjr4](https://github.com/better-auth/better-auth/security/advisories/GHSA-9h47-pqcx-hjr4)）、refresh 不校验 client secret（CVE-2026-53512）、接受 `javascript:` redirect URI（[GHSA-86j7-9j95-vpqj](https://github.com/better-auth/better-auth/security/advisories/GHSA-86j7-9j95-vpqj)）。
- 新 `@better-auth/oauth-provider`（[文档](https://www.better-auth.com/docs/plugins/oauth-provider)）：OAuth 2.1 授权服务器，兼容 OIDC（ID token、UserInfo、RP-initiated logout、discovery）。
  - grant：authorization code（public client 强制 PKCE）、refresh token（可配置 rotation reuse interval）、client credentials；device flow 为可选（内置 `device-authorization` 插件，表 `deviceCode`）。
  - 另有 introspection、revocation、RFC 7591 dynamic client registration（可选）、DPoP、private_key_jwt、RFC 9207 `iss` 参数、consent 页与 `skip_consent`；v1.7.0 新增 back-channel logout 与 `at_hash`。
  - 默认依赖 `jwt` 插件签名（表 `jwks`：publicKey、privateKey、alg、crv、createdAt、expiresAt）；`disableJwtPlugin` 时退化为 opaque access token 加 HS256 ID token。
  - 表：oauthClient、oauthResource、oauthClientResource、oauthRefreshToken、oauthAccessToken、oauthConsent、oauthClientAssertion（[schema.ts](https://github.com/better-auth/better-auth/blob/main/packages/oauth-provider/src/schema.ts)）。
  - `mcp` 与 `cimd` 在 v1.7.0 拆成独立包 `@better-auth/mcp`、`@better-auth/cimd`，并要求启用 `jwt()` 插件；文档称 oauth-provider 与 MCP 插件集成，用于保护 MCP 资源。
- token exchange（RFC 8693）：文档未提及，未验证。
- OpenID Certified：否。openid.net 的 OP 认证列表中搜不到 Better Auth（[列表](https://openid.net/certification/certified-openid-providers-profiles/)），文档也未声称认证。
- 成熟度：2026 年该包已有多条 advisory，其中并发 refresh 可产生多个有效 refresh token（CVE-2026-53517）、并行请求可复用同一 authorization code（CVE-2026-53518）、access token 可指向未授权的 API（[GHSA-p2fr-6hmx-4528](https://github.com/better-auth/better-auth/security/advisories/GHSA-p2fr-6hmx-4528)）。

**各插件要点**
- phone-number（[文档](https://www.better-auth.com/docs/plugins/phone-number)）
  - 加字段 `user.phoneNumber`、`user.phoneNumberVerified`。
  - 端点 `/phone-number/send-otp`、`/phone-number/verify`（验证并建 session）、`/sign-in/phone-number`（手机号 + 密码）、`/phone-number/request-password-reset`、`/phone-number/reset-password`。
  - `sendOTP` 是用户自己实现的回调，阿里云 / 腾讯云 SMS 直接在回调里调即可；可用 `verifyOTP` 把校验外包给第三方。
  - `signUpOnVerification { getTempEmail, getTempName }`：验证即注册，但必须造临时邮箱。
  - 默认 otpLength 6、expiresIn 300s、allowedAttempts 3（超限删码）；文档建议不要 await `sendOTP`（防 timing）。
- anonymous（[文档](https://www.better-auth.com/docs/plugins/anonymous)）：加 `user.isAnonymous`；端点 `/sign-in/anonymous`、`/delete-anonymous-user`；匿名用户用其他方式登录时触发 `onLinkAccount`（供迁移购物车等数据），随后默认删除匿名用户；已是匿名 session 时再次匿名登录报错。
- two-factor（[文档](https://www.better-auth.com/docs/plugins/2fa)、[schema](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/two-factor/schema.ts)）
  - 加 `user.twoFactorEnabled`；表 `twoFactor`（secret、backupCodes、userId、verified、failedVerificationCount、lockedUntil）。
  - 方式：TOTP（容忍前后各一个周期）、OTP（自定义 `sendOTP`，可走 SMS / email）、backup codes；trusted device 30 天，每次登录续期；失败锁定默认开启。
  - 登录被拦截后返回 `twoFactorRedirect: true`，不建 session。
  - 限制：只有凭证类登录（email / username / phone）强制 2FA，OAuth、magic link、passkey 默认绕过；启用 2FA 需要密码（除非 `allowPasswordless`），social-only 用户的 2FA 是高票 issue（[#1279](https://github.com/better-auth/better-auth/issues/1279)）。
  - backup codes 的加密存储方式：未验证。
- passkey（[文档](https://www.better-auth.com/docs/plugins/passkey)）
  - 独立包 `@better-auth/passkey`，底层 `@simplewebauthn/server` 与 `@simplewebauthn/browser` v13（[package.json](https://github.com/better-auth/better-auth/blob/main/packages/passkey/package.json)）。
  - 表 `passkey`（name、publicKey、userId、credentialID、counter、deviceType、backedUp、transports、aaguid、createdAt）。
  - 端点 `/passkey/add-passkey`、`/sign-in/passkey`、`/passkey/list-user-passkeys`、`/passkey/delete-passkey`、`/passkey/update-passkey`。
  - 支持 conditional UI；`registration.requireSession: false` 加 `resolveUser` 可做 passkey-first 注册；challenge 存在 cookie。
  - 原生 iOS / Android 的 passkey 支持：文档只提到 Expo 的 cookie 前缀配置，未验证。
- 其余（简）
  - generic-oauth：v1.7.0 起并入 social 流程，`signIn.oauth2` 改为 `signIn.social`，`genericOAuthClient()` 删除（[v1.7.0 notes](https://github.com/better-auth/better-auth/releases/tag/v1.7.0)）。
  - bearer：把 session token 通过 `set-auth-token` 响应头下发，请求走 `Authorization: Bearer`，有 `requireSignature` 选项（[源码](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/bearer/index.ts)）。
  - jwt：`jwks` 表加 JWKS 端点。
  - one-time-token：`/one-time-token/generate`、`/one-time-token/verify`。
  - admin：加 `user.role`、`banned`、`banReason`、`banExpires` 和 `session.impersonatedBy`（[schema](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/admin/schema.ts)）。
  - organization：organization、member、invitation、team、teamMember、organizationRole 等模型（[schema](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/organization/schema.ts)）。
  - username：加 `user.username`、`displayUsername`。
  - multi-session、email-otp：存在于插件目录，端点细节本次未逐一核对（未验证）。
- Expo / native（[文档](https://www.better-auth.com/docs/integrations/expo)、[client.ts](https://github.com/better-auth/better-auth/blob/main/packages/expo/src/client.ts)）
  - server 端 `expo()` 插件加 client 端 `expoClient({ storage: SecureStore })`。
  - client 的 fetch 插件从响应 `Set-Cookie` 中挑出 better-auth cookie 存入 `expo-secure-store`，之后每次请求手动带 `Cookie` 头（`credentials: "omit"`），调自家 API 时用 `authClient.getCookie()` 取。
  - OAuth 走系统浏览器加 deep link（scheme 须加入 `trustedOrigins`），或原生拿 idToken 交给 server 校验。
  - 文档只覆盖 Expo（SDK 55+），未提及 Flutter、Swift、Kotlin、小程序 SDK。

**WeChat / 小程序**
- WeChat 是内置 social provider，但只实现开放平台"网站应用"扫码登录：`platformType?: "WebsiteApp"`、授权地址 `open.weixin.qq.com/connect/qrconnect`、scope `snsapi_login`；账号主键取 `unionid || openid`（[wechat.ts](https://github.com/better-auth/better-auth/blob/main/packages/core/src/social-providers/wechat.ts)）。
- 小程序 `code2session`、公众号网页授权（`snsapi_userinfo`）、移动应用 SDK 登录：源码中没有对应实现，需自写插件。
- 无小程序 client SDK：client 依赖 fetch、cookie 与 nanostores，小程序需自行用 `wx.request` 封装（推断）。

**已知痛点**
- 安全公告密度高：[advisories 页](https://github.com/better-auth/better-auth/security/advisories)至少 30 条（API 单页 30 条即满，该页最早一条为 2025-11，更早的未翻页核对），其中 2026-05-31 一天披露 12 条。
  - critical 级：OAuth state 可被当作 magic link 登录他人账号（[GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm)，2026-09-30）、SCIM token 接管（GHSA-rjg6-39jm-rgg4）、SSO SSRF（CVE-2026-53513）。
  - high 级举例：session cookie cache 可跳过 2FA（[GHSA-xg6x-h9c9-2m83](https://github.com/better-auth/better-auth/security/advisories/GHSA-xg6x-h9c9-2m83)）、OAuth 登录可链接到攻击者预注册的账号（CVE-2026-53516）、IPv6 轮换绕过限流（CVE-2026-45364）、任意登录用户可删他人 passkey（GHSA-4vcf-q4xf-f48m）。
  - 这些多属"插件间交互"和"并发原子性"类问题，自建时要优先设计。
- breaking change 节奏快：1.5.0（2026-03-01）、1.6.0（2026-04-06）、1.7.0（2026-08-18），v1.7.0 notes 含多个包的 Breaking Changes 段（OIDC 插件删除、generic-oauth API 改名、SAML ACS 路径变更、MCP 拆包）。
- 高票未决 issue：`name` 必填（[#424](https://github.com/better-auth/better-auth/issues/424)）、一个用户绑定多个邮箱或身份（[#6126](https://github.com/better-auth/better-auth/issues/6126)）、按请求动态 `baseURL`（[#4151](https://github.com/better-auth/better-auth/issues/4151)）、service accounts（[#3224](https://github.com/better-auth/better-auth/issues/3224)）、admin 动态角色（[#4557](https://github.com/better-auth/better-auth/issues/4557)）。

**可移植到 Go 的架构思想**
1. 四张核心表加"一种登录方式一行 `account`"（`providerId` + `accountId`，密码也是一种 account）；Go 版应把 email 降为可选，把 phone、unionid 等都建模为 account / identifier。
2. 通用 `verification` 表（identifier / value / expiresAt）承载所有一次性凭证，并做原子消费（吸取 CVE-2026-53518 的教训）。
3. 插件 = 一个声明式结构体：ID、Endpoints、Schema、Hooks(before / after 加 matcher)、Middlewares、OnRequest / OnResponse、RateLimit、Init、ErrorCodes。Go 中用 struct 加可选 interface 即可表达。
4. 插件通过 before / after hook 拦截其他端点（2FA 拦截登录、anonymous 的 `onLinkAccount`），核心不必感知插件。
5. 插件自带 schema 片段（新表、给核心表加列），由 CLI 合并生成 migration；Go 中可用各插件内嵌 SQL migration 加统一 runner。
6. `databaseHooks`（user / session / account 的 before / after）作为业务侧扩展点。
7. 回调式外部依赖（`sendOTP`、`sendEmail`、`verifyOTP`）：SMS 供应商不进核心，对接阿里云 / 腾讯云只是实现一个 interface。
8. `secondaryStorage`（KV）与主库分离承载 session、限流、verification；限流规则由插件随端点声明。
9. OAuth provider 作为构建在 session 核心之上的独立插件（登录态与 OAuth 授权解耦），JWT / JWKS 再独立一层；first-party app 直接用 session / bearer，third-party 才走 OAuth。
10. bearer 与 cookie 双通道的 session 传递（`set-auth-token` 头）适合 native 和小程序。

**依赖 TypeScript 特性、不能直接移植的部分**
- `$InferServerPlugin`：client 方法与参数类型从 server 端点类型推导、零 codegen。Go 无此能力，需从端点声明生成 OpenAPI（Better Auth 自己也有 `open-api` 插件）再 codegen 出各端 SDK。
- 插件 schema 自动改变 `User` / `Session` 的静态类型（`additionalFields`、`$Infer`）。Go 只能用 codegen 或 `map[string]any` 扩展字段 / JSONB 列。
- `init` 返回对 options / context 的 DeepPartial 覆盖、运行时拼装 endpoints 对象。Go 可以做，但失去类型安全，需要显式注册表。
- 通用 adapter（Kysely / Prisma / Drizzle / Mongo 一套 CRUD）是为"嵌入任意宿主 ORM"服务的。独立部署的 Go 服务应直接绑定一种数据库并使用事务与行锁，不需要这层抽象。
- client 侧 nanostores atoms、`atomListeners`、React hooks 属于前端状态层，与 Go 服务端无关，由各端 SDK 自行实现。
- "同进程调用" `auth.api.*`（服务端直接调端点函数）来自嵌入式库形态；独立服务形态下变成内部 RPC 或 admin API。

### Authentik

**基本面**
- 技术栈：Python（Django）为主，加 TypeScript Web UI 和 Rust 组件；语言占比 Python 7.7MB / TypeScript 5.1MB / Rust 0.49MB（[languages API](https://api.github.com/repos/goauthentik/authentik/languages)）。25,859 stars；最新 `version/2026.8.3`（2026-09-17）（[releases](https://github.com/goauthentik/authentik/releases)）。
- 许可：主体 MIT；`authentik/enterprise/` 目录为单独的企业许可；`website/` 为 CC BY-SA 4.0（[LICENSE](https://github.com/goauthentik/authentik/blob/main/LICENSE)）。
- open-core 划分（[pricing](https://goauthentik.io/pricing/)）
  - 开源版：OIDC、SAML、LDAP、SCIM、RADIUS、Kerberos、Proxy、OAuth token exchange。
  - Enterprise：$5 / 内部用户 / 月（年付），外部用户 $0.02 / 月；增加 PAM、Google Workspace / Entra 集成、客户端证书认证、设备合规、审计增强等。
  - Enterprise Plus：$20k / 年起（FIPS、SLA）。
  - 源码中的企业 stage：`account_lockdown`、`authenticator_endpoint_gdtc`、`mtls`、`source`（[enterprise/stages](https://github.com/goauthentik/authentik/tree/main/authentik/enterprise/stages)）。
- 部署：独立服务，server 加 worker 两个容器加 PostgreSQL，最低 2 核 / 2GB（[docker-compose 安装文档](https://docs.goauthentik.io/install-config/install/docker-compose/)）。安装文档未列 Redis；移除 Redis 的具体版本未验证。

**OIDC / OAuth2**
- OpenID Certified：是。认证列表有 Authentik Security Inc / authentik 2026.8.0，日期 07-Jul-2026，覆盖多个 OP profile；具体是 Basic / Implicit / Hybrid / Config / Form Post 中的哪几列未逐一核对（[OP 认证列表](https://openid.net/certification/certified-openid-providers-profiles/)）。
- 流程：authorization code（public client 用 PKCE）、implicit、hybrid、client credentials、device code、token exchange（RFC 8693 impersonation / delegation）、refresh token（可选自动 rotation）。
- 端点：introspection、revocation、end-session、JWKS、discovery、back-channel logout（[OAuth2 provider 文档](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/)）。

**原生 App 免浏览器登录**
- Flow Executor API：`GET` / `POST /api/v3/flows/executor/:slug/`，challenge / response 循环，每个 stage 一个 `component`，直到 `xak-flow-redirect` 或 `ak-stage-access-denied`（[flow-executor 文档](https://api.goauthentik.io/flow-executor/)）。
- 注意事项：必须保持 cookie，否则每次请求新开 session；flow 必须含 User Login stage 才产生登录态；客户端不认识的 stage 要回退到浏览器 `/if/flow/:slug/`。
- 该 API 产出的是 authentik 的 session cookie，不是 OAuth token。native app 仍需带着 cookie 再走 authorize 端点换 code / token（推断，文档未给 native 示例）。本质是把 Web flow 引擎"无头化"，不是为 first-party 移动端设计的直连 API。

**手机号 + SMS**
- 作为第一因子登录：不支持。Identification stage 只识别 Username / Email / UPN，没有手机号（[identification stage 文档](https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/identification/)）。
- SMS 只是 MFA authenticator：须先 enroll，再经 Authenticator Validation stage 验证（[SMS stage 文档](https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_sms/)）。
- SMS provider 只有 Twilio 和 Generic HTTP（Basic / Bearer 鉴权，webhook mapping 可改 payload）（[models.py](https://github.com/goauthentik/authentik/blob/main/authentik/stages/authenticator_sms/models.py)）。
- 阿里云 / 腾讯云需要请求签名，Generic provider 不能直连，要自建中转网关（推断）。

**WeChat**
- 内置 OAuth source 类型 `wechat`：仅开放平台网站扫码（`qrconnect`、scope `snsapi_login`），用户标识取 `unionid`，回退 `openid`（[wechat.py](https://github.com/goauthentik/authentik/blob/main/authentik/sources/oauth/types/wechat.py)）。
- 小程序 `code2session`、公众号网页授权、移动应用 SDK 登录：源码无对应类型；source 模型是浏览器重定向式 OAuth，小程序场景基本不可行（推断）。

**2FA / passkeys**
- 开源 stage 目录含 `authenticator_totp`、`authenticator_sms`、`authenticator_email`、`authenticator_duo`、`authenticator_static`（恢复码）、`authenticator_webauthn`、`authenticator_validate`（[stages 目录](https://github.com/goauthentik/authentik/tree/main/authentik/stages)）。
- passkey 无密码登录：Identification stage 支持 WebAuthn conditional UI 和关联的 passwordless flow；pricing 页未把 WebAuthn 列为付费项。

**扩展模型 / 管理 / 多租户**
- 扩展靠 flows → stages → policies（含 Python expression policy）在管理 UI 中编排，不是代码级插件；内置 stage 目录还有 captcha、consent、email、invitation、password、prompt、user_write、user_login 等（[stages 目录](https://github.com/goauthentik/authentik/tree/main/authentik/stages)）。要新增"手机号验证码登录" stage 需 fork 并修改 Python 加前端组件（推断）。
- 管理 UI 完整（TypeScript Web 应用）。
- 多租户：alpha 状态（2024.2 起），需要 Enterprise license，每租户一个 PostgreSQL schema，按域名路由；expression policy 可跨租户访问，embedded outpost 不支持。brands 只做外观区分（[tenancy 文档](https://docs.goauthentik.io/sys-mgmt/tenancy/)）。

**痛点**
- 高票 open issue：扫码识别登录（[#9883](https://github.com/goauthentik/authentik/issues/9883)）、常用设备 session 续期（[#14304](https://github.com/goauthentik/authentik/issues/14304)）、单 issuer 多 client ID（[#7251](https://github.com/goauthentik/authentik/issues/7251)）、基于上一 stage 结果的条件分支（[#12973](https://github.com/goauthentik/authentik/issues/12973)）、K8s operator（[#5675](https://github.com/goauthentik/authentik/issues/5675)）。
- 2026 年 advisory（[列表](https://github.com/goauthentik/authentik/security/advisories)）：SourceStage 空 POST 绕过（CVE-2026-49448，critical）、email authenticator 的 MFA 绕过（CVE-2026-94606）、SAML NameID 截断导致账号接管（CVE-2026-57580）、RAC 凭据暴露（CVE-2026-61574）。
- 对本项目的结论：面向企业 SSO 和内部员工，对"手机号优先加小程序加原生 UI"的 C 端场景结构性不匹配，且技术栈不是 Go。

### SuperTokens

**基本面**
- 架构三件套：Frontend SDK（管 session token、渲染 UI）、Backend SDK（嵌在你的后端里暴露登录 API）、SuperTokens Core（Java HTTP 服务加数据库）（[core README](https://github.com/supertokens/supertokens-core#readme)）。
- supertokens-core：Java，15,336 stars，最新 `v12.2.0`（2026-09-04）（[repo](https://github.com/supertokens/supertokens-core)）。Backend SDK：node `v24.0.3`（2026-07-24）、golang `v0.26.0`（2026-07-24，154 stars）（[supertokens-golang](https://github.com/supertokens/supertokens-golang)）。
- 许可：Apache 2.0，`ee/` 目录除外（[LICENSE.md](https://github.com/supertokens/supertokens-core/blob/master/LICENSE.md)）。
- core 内的付费 feature flag：`account_linking`、`multi_tenancy`、`dashboard_login`、`mfa`、`security`、`oauth`、`saml`（[EE_FEATURES.java](https://github.com/supertokens/supertokens-core/blob/master/src/main/java/io/supertokens/featureflag/EE_FEATURES.java)）。
- 定价（[pricing](https://supertokens.com/pricing)）
  - 自托管核心功能免费且不限量：email / password、social、passwordless OTP / magic link、session、RBAC、dashboard。
  - 付费 add-on（云和自托管同价）：MFA $0.01 / MAU（最低 $100 / 月）、account linking $0.005 / MAU（最低 $100 / 月）、dashboard 用户 $20 / 人 / 月（前 3 个免费）。
  - multi-tenancy、Unified Login / OAuth2 provider、attack protection、M2M：联系销售。
- 部署：Java core 加 PostgreSQL（官方 docker 镜像 `supertokens-postgresql`）加你自己的后端内嵌 SDK。MySQL 支持现状未验证。

**OIDC / OAuth2**
- OAuth2 provider（Unified Login）是付费功能：core 有 `oauth` flag；[文档 intro](https://supertokens.com/docs/authentication/unified-login/introduction) 称该功能随 Managed Service 提供、Self-Hosted 版不含，与 pricing 页"add-on 适用于自托管"的表述不一致，自托管能否购买需向官方确认（未验证）。
- 基于外部 OAuth 服务：core 配置项 `oauth_provider_public_service_url` / `oauth_provider_admin_service_url`（[config.yaml](https://github.com/supertokens/supertokens-core/blob/master/config.yaml)），core 源码 `oauth/HttpRequestForOAuthProvider.java`、`build.gradle` 中出现 hydra 字样（[代码搜索](https://github.com/search?q=repo%3Asupertokens%2Fsupertokens-core+hydra&type=code)），即 core 代理到 Ory Hydra。官方文档未明说。
- backend SDK 的 `oauth2provider` recipe 只有 Node / Python。Go SDK 的 recipe 目录没有 oauth2provider，也没有 accountlinking、multifactorauth、totp、saml（[node recipes](https://github.com/supertokens/supertokens-node/tree/master/lib/ts/recipe) 对比 [golang recipes](https://github.com/supertokens/supertokens-golang/tree/master/recipe)）。
- OpenID Certified：否，认证列表无 SuperTokens；列表里有 ORY Hydra v1.0.0，但那是 Hydra 自身的认证（[OP 认证列表](https://openid.net/certification/certified-openid-providers-profiles/)）。
- 文档只明确演示 authorization code 流程；device flow、token exchange、refresh rotation 细节未验证。

**原生 App 免浏览器登录**
- 这是 SuperTokens 的强项：登录本身就是 first-party REST API（Frontend Driver Interface，[FDI 规范仓库](https://github.com/supertokens/frontend-driver-interface)），自定义 UI 直接调用。
  - passwordless：`/signinup/code`、`/signinup/code/resend`、`/signinup/code/consume`（[constants.ts](https://github.com/supertokens/supertokens-node/blob/master/lib/ts/recipe/passwordless/constants.ts)）。
  - thirdparty：`/signinup` 接受 `redirectURIInfo`（授权码）或 `oAuthTokens`（原生 SDK 拿到的 token）（[signinup.ts](https://github.com/supertokens/supertokens-node/blob/master/lib/ts/recipe/thirdparty/api/signinup.ts)）。
- 移动端 SDK（react-native、iOS、Android、Flutter 仓库）只负责 session 维护，不封装登录调用（[supertokens-react-native README](https://github.com/supertokens/supertokens-react-native#readme)）。无小程序 SDK，需自行用 `wx.request` 实现 header-based session 与 refresh（推断）。

**手机号 + SMS OTP**
- 第一因子：支持。passwordless recipe 的 contact method 可为 phone、email 或两者，flow 可为 OTP 或 magic link（[passwordless 文档](https://supertokens.com/docs/authentication/passwordless/introduction)）。
- SMS 投递：内置 Twilio 和 SuperTokens 自家服务（[smsdelivery/services](https://github.com/supertokens/supertokens-node/tree/master/lib/ts/recipe/passwordless/smsdelivery/services)），也可自定义 `sendSms`。阿里云 / 腾讯云通过 override 自己实现（推断，文档无现成示例）。
- 手机号 + 密码登录：官方有 `phone-password-example` 示例仓库，非内置 recipe，细节未验证。

**WeChat**
- 非内置：node SDK 的 provider 目录只有 activeDirectory、apple、bitbucket、boxySaml、discord、facebook、github、gitlab、google、googleWorkspaces、linkedin、okta、saml、twitter（[providers 目录](https://github.com/supertokens/supertokens-node/tree/master/lib/ts/recipe/thirdparty/providers)）。
- 可做 custom provider：配置 `authorizationEndpoint` / `tokenEndpoint` / `userInfoEndpoint` / `userInfoMap`，非标准流程可 override `GetAuthorisationRedirectURL`、`ExchangeAuthCodeForOAuthTokens`、`GetUserInfo`（[custom providers 文档](https://supertokens.com/docs/authentication/social/custom-providers)）。
- 小程序 `code2session` 理论上可塞进 `ExchangeAuthCodeForOAuthTokens` override（推断，未验证）。
- unionid 合并：要么用 unionid 作 thirdPartyUserId，要么依赖付费的 account linking。

**2FA / passkeys**
- MFA 付费（`mfa` flag）；因子为 TOTP、email OTP、SMS OTP、WebAuthn，支持 step-up（[MFA 文档](https://supertokens.com/docs/additional-verification/mfa/introduction)）。Go SDK 无 multifactorauth / totp recipe。
- WebAuthn / passkey 作为第一因子：node 与 golang SDK 均有 `webauthn` recipe；core 的付费 flag 中没有 webauthn，推断为免费。core changelog 提到支持 Android 原生 origin（`android:apk-key-hash:`）（[CHANGELOG](https://github.com/supertokens/supertokens-core/blob/master/CHANGELOG.md)）。

**扩展模型 / 管理 / 多租户**
- 扩展模型是 recipe 加 override：每个 recipe 的 functions（业务逻辑）与 apis（HTTP 端点）都可在 backend SDK 中用代码 override，另有 hooks。它不是"声明 schema 加端点"的插件体系；自定义数据走 usermetadata recipe，core 表结构不能由用户侧扩展（推断，未在文档中找到明确表述）。新出的 [supertokens-plugins](https://github.com/supertokens/supertokens-plugins) 仓库的成熟度未验证。
- 管理 UI：dashboard recipe（用户管理），前 3 个 dashboard 用户免费。
- 多租户：付费（`multi_tenancy` flag，价格联系销售）；Go SDK 有 multitenancy recipe。

**痛点**
- Go SDK 明显落后于 Node / Python：缺 MFA、account linking、OAuth2 provider、TOTP、SAML recipe，154 stars。对"用 Go 做后端"的读者，等于付费功能基本用不上。
- 核心痛点功能要么付费、要么长期缺失：用户封禁（[#521](https://github.com/supertokens/supertokens-core/issues/521)，2022 至今 open）、API 限流（[#163](https://github.com/supertokens/supertokens-core/issues/163)，2021 至今 open）。
- 三层架构（Java core 加 backend SDK 加 DB）运维面比单体 Go 服务大。
- OAuth2 provider 依赖 Hydra 且未见 OpenID 认证；core changelog 记录过 SAML XML Signature Wrapping 认证绕过的修复（[CHANGELOG](https://github.com/supertokens/supertokens-core/blob/master/CHANGELOG.md)）。
- 对本项目的结论：first-party API 加 recipe 的思路（登录即 REST、session 与 OAuth 分层）值得借鉴，但直接采用会被付费墙和 Go SDK 缺口卡住。

## 附录 B：Go 构件库、中国生态 SDK 与协议事实

### Go 构件库

> 数据采集日 2026-10-06，版本/日期/stars 均来自 GitHub API（`gh api`）。标注"未验证"的条目表示未能从一手来源确认。

#### ory/fosite（OAuth2/OIDC 框架）

- **当前状态（关键）**：[ory/fosite](https://github.com/ory/fosite) 独立仓库**未 archived**，但事实上已停滞：最新 release [v0.49.0](https://github.com/ory/fosite/releases/tag/v0.49.0)（2024-12-12），最后一次 commit 为 2025-07-03（[commits](https://github.com/ory/fosite/commits/master)）。代码已于 2025-10-31 通过 [`Merge branch 'fosite-monorepo'`](https://github.com/ory/hydra/commit/2c3ba1311e) 并入 [ory/hydra 的 `fosite/` 目录](https://github.com/ory/hydra/tree/master/fosite)，此后的开发在那里进行（该目录最近 commit 2026-07-22）；[hydra 的 go.mod](https://github.com/ory/hydra/blob/master/go.mod) 已不再依赖 `github.com/ory/fosite`。
- **可导入性**：`github.com/ory/fosite@v0.49.0` 仍可 `go get`，但拿不到 2025-07 之后的修复。hydra 内的副本没有独立 `go.mod`，只能以 `github.com/ory/hydra/v2/fosite` 导入，即把整个 hydra 模块的依赖图拉进来（由目录结构推断，未实测构建）。独立仓库 README 中没有任何迁移/弃用公告（已读 README，未见）。
- **停滞的佐证**：独立仓库仍有未处理的安全类 issue（[#875 Request Object accepts alg=none…](https://github.com/ory/fosite/issues/875)，2026-05 开，仍 open）和搁置的 PR（[#847](https://github.com/ory/fosite/pull/847)，2025-04 开）。
- **下游都在 fork**：pocket-id 的 [go.mod](https://github.com/pocket-id/pocket-id/blob/main/backend/go.mod) 用 `replace github.com/ory/fosite => github.com/pocket-id/fosite v1.3.0`（[fork](https://github.com/pocket-id/fosite)，最近 push 2026-08-12）；Authelia 用自己的 [authelia/oauth2-provider](https://github.com/authelia/oauth2-provider)（模块名 `authelia.com/provider/oauth2`，[go.mod](https://github.com/authelia/authelia/blob/master/go.mod)），目录结构与 fosite 同构并额外带 `rfc8693`、`rfc9449`(DPoP)、`rfc8705`(mTLS)、`rfc7591` handler（[handler 目录](https://github.com/authelia/oauth2-provider/tree/master/handler)，最近 push 2026-10-06）。
- **支持的 flow**（[handler 目录](https://github.com/ory/fosite/tree/master/handler)：`oauth2 openid par pkce rfc7523 rfc8628 verifiable`）：auth code / implicit / hybrid、client credentials、refresh（rotation 于 [#838](https://github.com/ory/fosite/pull/838) 重构）、PKCE、PAR (RFC 9126)、JWT bearer (RFC 7523)、device flow (RFC 8628)。**没有 RFC 8693 token exchange handler**（独立仓库与 hydra 内副本均无）。
- **自定义 grant type**：[README "A word on extensibility"](https://github.com/ory/fosite#a-word-on-extensibility) 明确可注册自定义 token/authorize endpoint handler（实现 `TokenEndpointHandler` 并加入配置的 handler 列表；具体接口方法签名未逐一验证）。这是它相对 zitadel/oidc 的主要优势。
- **存储**：[README](https://github.com/ory/fosite#example-storage-implementation)："Fosite does not ship a storage implementation"，每个 handler 各有一组 storage 接口需自行实现（参考实现为 hydra 的 SQL store）。
- **认证**：库本身不在 [OpenID 认证实现列表](https://openid.net/developers/certified-openid-connect-implementations/)中（检索未见 fosite/Ory/Hydra 条目）；[Hydra README](https://github.com/ory/hydra#openid-connect-certified) 自称 OpenID Certified——Hydra 在 openid.net 上的具体条目**未验证**。
- **许可**：Apache-2.0；2.6k stars。

#### zitadel/oidc（OP + RP）

- 活跃：[v3.51.12](https://github.com/zitadel/oidc/releases)（2026-10-06 当天发布），Apache-2.0，1.9k stars；模块路径 `github.com/zitadel/oidc/v3`，自 v2→v3 起提供 [UPGRADING.md](https://github.com/zitadel/oidc/blob/main/UPGRADING.md)。
- **认证**：[README](https://github.com/zitadel/oidc#readme) 只声明 **RP** 通过 basic 与 config profile；README 的待办列表里仍有 "Certify this library as OP"，即 **OP 侧未认证**。openid.net 列表中有 "OIDC v0.15.7" 条目（[来源](https://openid.net/developers/certified-openid-connect-implementations/)，所属分区未逐项核对）。
- **flow**（[README 特性表](https://github.com/zitadel/oidc#features)）：OP 侧 code、implicit、client credentials、refresh、discovery、JWT profile (RFC 7523)、PKCE、token exchange (RFC 8693)、device authorization (RFC 8628)、back-channel logout 为 yes；hybrid 为 "not yet"；mTLS 为 "not yet"。README 表中无 PAR、DPoP。
- **存储负担**：[`op.Storage`](https://github.com/zitadel/oidc/blob/main/pkg/op/storage.go) = `AuthStorage`（auth request、code、access/refresh token 创建、撤销、签名密钥/KeySet，约 14 个方法）+ `OPStorage`（client 查询与鉴权、userinfo/introspection/私有 claims、JWT profile key，约 9 个方法）+ `Health`；可选扩展接口 `ClientCredentialsStorage`、`TokenExchangeStorage`、`DeviceAuthorizationStorage`、`CanSetUserinfoFromRequest` 等。登录 UI 完全由调用方实现（`CreateAuthRequest` → 自己的登录页 → 回调）。
- **自定义 grant type**：token endpoint 的 grant 分发是写死的 `switch`（[token_request.go](https://github.com/zitadel/oidc/blob/main/pkg/op/token_request.go)、[server_http.go](https://github.com/zitadel/oidc/blob/main/pkg/op/server_http.go)），未知 grant 直接返回 `unsupported_grant_type`，**没有注册自定义 grant 的 API**。可行路径（推断，未实测）：(a) 在 token endpoint 前挂自己的 handler 拦截自定义 `grant_type`；(b) 走 token exchange，用自定义 `subject_token_type` 承载 WeChat code / SMS OTP，在 `TokenExchangeStorage.ValidateTokenExchangeRequest` 与 `TokenExchangeTokensVerifierStorage.VerifyExchangeSubjectToken` 中校验。
- **用户**：ZITADEL 自身（未另行验证其他用户）。

#### go-webauthn/webauthn

- [v0.18.2](https://github.com/go-webauthn/webauthn/releases)（2026-09-19），BSD-3-Clause，1.3k stars，最后 commit 2026-09-27。Authelia 与 pocket-id 均依赖 v0.18.2（见上文两个 go.mod）。
- **passkey / discoverable credential**：[login.go](https://github.com/go-webauthn/webauthn/blob/master/webauthn/login.go) 提供 `BeginDiscoverableLogin`、`BeginDiscoverableMediatedLogin`（conditional UI）、`FinishPasskeyLogin`（通过 `DiscoverableUserHandler` 由 userHandle 反查用户并返回 user + credential）、以及不依赖 `*http.Request` 的 `ValidatePasskeyLogin`（native app 走 JSON API 时用）。
- **conformance**：[README](https://github.com/go-webauthn/webauthn#readme) 自述 "conformance tested against the conformance tools"；是否有 FIDO 官方认证**未验证**。支持 attestation 格式与 FIDO MDS（`metadata.Provider`）。
- **需要存储**：`webauthn.Credential` 记录（README 的 [Storage 表](https://github.com/go-webauthn/webauthn#readme) 对照 WebAuthn L3 credential record；可整体存 JSON）、RP ID、user handle；begin/finish 之间的 `SessionData`（challenge）需服务端暂存。库不含任何存储/HTTP 路由。

#### pquerna/otp

- TOTP (RFC 6238) / HOTP；[v1.5.0](https://github.com/pquerna/otp/releases)（release 发布 2025-05-16），最后 commit 2025-08-07，Apache-2.0，3.0k stars。低活跃但功能稳定（算法已冻结）。不做：secret 加密存储、防重放（同一 time-step 重复使用）、恢复码、限速——均需手写。
- 替代：Authelia 使用自己的 fork [`github.com/authelia/otp`](https://github.com/authelia/authelia/blob/master/go.mod) v1.0.4；[xlzd/gotp](https://github.com/xlzd/gotp) 最后 commit 2022-09，不建议。

#### 其他

- **[luikyv/go-oidc](https://github.com/luikyv/go-oidc)**：纯 OP 库，MIT，v0.25.0（2026-07-23），仅 115 stars、v0.x。[README](https://github.com/luikyv/go-oidc#certification) 声明通过 Basic/Implicit/Hybrid/Config/Dynamic OP、FAPI 1.0、FAPI 2.0 认证，openid.net 列表中有 "go-oidc 0.4.0" 条目（[来源](https://openid.net/developers/certified-openid-connect-implementations/)）。规范覆盖面是三者中最广：PAR、JAR、JARM、DPoP、mTLS、RAR、DCR、token exchange (RFC 8693)、device flow (RFC 8628)、CIBA、OpenID Federation、OID4VCI。风险：个人项目、API 未稳定；自定义 grant 的扩展方式未验证。
- **[go-oauth2/oauth2](https://github.com/go-oauth2/oauth2)**：v4.6.0（2026-09-01），MIT，3.6k stars。仅 OAuth2，README 中无任何 OpenID/OIDC 字样（grep 结果为 0）；不适合作为 OIDC provider 基座。
- **[dexidp/dex](https://github.com/dexidp/dex)**：v2.45.1（2026-03-03），Apache-2.0，11k stars，活跃。是联邦型 OP 而非库；[connector 目录](https://github.com/dexidp/dex/tree/master/connector)（github、gitlab、google、ldap、microsoft、oauth、oidc、saml 等）**没有 WeChat connector**。价值在于 connector 接口作为"上游身份源插件"的设计参考。
- **[coreos/go-oidc](https://github.com/coreos/go-oidc)**：v3.21.0（2026-09-01），Apache-2.0。RP 侧（discovery + ID token 校验），用于集成测试与上游 OIDC 联邦（功能边界按通行认知，未重读 README）。
- **JOSE/JWT**：[golang-jwt/jwt](https://github.com/golang-jwt/jwt) v5.3.1（2026-01-28，MIT，9.2k）；[lestrrat-go/jwx](https://github.com/lestrrat-go/jwx) **v4.5.0**（2026-09-08，MIT，已到 v4 大版本）；[go-jose/go-jose](https://github.com/go-jose/go-jose) v4.1.5（2026-09-03，Apache-2.0）。zitadel/oidc 的 storage 接口直接暴露 go-jose 类型（[storage.go](https://github.com/zitadel/oidc/blob/main/pkg/op/storage.go)）；pocket-id 同时用 jwx/v4 与 go-jose/v4。选型应跟随所选 OP 库。
- **密码哈希**：[alexedwards/argon2id](https://github.com/alexedwards/argon2id) v1.0.0（2023-10-21，MIT；薄封装，最后 commit 2025-10-28）；`golang.org/x/crypto/argon2`、`bcrypt` 版本状态未单独验证。
- **[markbates/goth](https://github.com/markbates/goth)**：v1.82.0（2025-08-18），最后 commit 2026-02-11，MIT。[providers 目录](https://github.com/markbates/goth/tree/master/providers)含 `wechat`、`wecom`、`dingtalk`、`lark`、`apple`、`tiktok`。goth 是浏览器重定向式 RP 抽象（基于 session/cookie），不覆盖小程序 `code2Session` 与 native SDK code 交换；wechat provider 具体走哪个授权端点未验证。
- **授权**：casbin 已迁至 [apache/casbin](https://github.com/apache/casbin)（v3.11.0，2026-08-20，Apache-2.0，20k）；[openfga/openfga](https://github.com/openfga/openfga) v1.21.0（2026-09-20，Apache-2.0）。属 authz，与本切片的 authn 核心正交。
- **参考实现**：[authelia/authelia](https://github.com/authelia/authelia) v4.39.28（2026-09-17，Apache-2.0，29k），[README](https://github.com/authelia/authelia#openid-connect-10--oauth-20) 声明通过 Basic/Implicit/Hybrid/Form Post/Config OP 认证；[pocket-id/pocket-id](https://github.com/pocket-id/pocket-id) v2.18.0（2026-10-04，BSD-2-Clause，9.4k），[README](https://github.com/pocket-id/pocket-id#readme)："only supports passkey authentication"，openid.net 列表有 "Pocket ID v2.10.0"；技术栈 = fosite fork + go-webauthn + jwx。tinyauth 已迁至 [tinyauthapp/tinyauth](https://github.com/tinyauthapp/tinyauth)（v5.2.0，**AGPL-3.0**）；[sebadob/rauthy](https://github.com/sebadob/rauthy)（Rust，v0.37.0，仅提及）。
- **手机号**：[nyaruka/phonenumbers](https://github.com/nyaruka/phonenumbers)（libphonenumber 的 Go 移植，MIT；GitHub release 最新 v1.8.1 @2026-07-15，但最新 tag 已是 **v2.0.14** @2026-10-02，需确认导入路径 `/v2`）。
- **限速**：[ulule/limiter](https://github.com/ulule/limiter) v3.11.2（2023-05-24，最后 commit 2024-10，趋于停滞）；[sethvargo/go-limiter](https://github.com/sethvargo/go-limiter) v1.2.0（2026-07-17，Apache-2.0，活跃）。SMS 的"每号码/每 IP/每设备"多维限额与日配额语义两者都不直接提供。
- **插件架构模型**：[hashicorp/go-plugin](https://github.com/hashicorp/go-plugin)（v1.8.0，MPL-2.0）是 "Go plugin system over RPC"——插件为独立子进程，适合不可信/多语言插件，代价是 RPC 边界与部署复杂度。[Caddy 模块](https://caddyserver.com/docs/extending-caddy)是编译期注册：模块在 `init()` 里 `caddy.RegisterModule()`，实现 `CaddyModule()` 返回 ID + 构造函数，通过 `import _ "…"`（xcaddy）编入二进制。对"Better Auth 式插件"而言，Caddy 模式（编译期注册 + 接口探测 + 生命周期钩子）更贴合单二进制自托管；Go 标准库 `plugin` 包未评估。

#### 汇总表

| library | 作用 | license | 最新版本/日期 | 状态 | 备注 |
|---|---|---|---|---|---|
| ory/fosite | OAuth2/OIDC 框架 | Apache-2.0 | v0.49.0 / 2024-12-12 | 独立仓库停滞（未 archive），已并入 ory/hydra `fosite/` | 可自定义 grant；无 token exchange；下游普遍 fork |
| authelia/oauth2-provider | fosite 系框架（Authelia 自用） | Apache-2.0 | 模块 v0.3.3（Authelia go.mod） | 活跃（push 2026-10-06） | 含 rfc8693/DPoP/mTLS；9 stars，API 稳定性未验证 |
| zitadel/oidc | OP + RP | Apache-2.0 | v3.51.12 / 2026-10-06 | 活跃 | RP 已认证，OP 未认证；grant 分发写死 |
| luikyv/go-oidc | OP | MIT | v0.25.0 / 2026-07-23 | 活跃，个人项目 | OP 认证最全（含 FAPI 2.0）；v0.x |
| go-oauth2/oauth2 | OAuth2 server | MIT | v4.6.0 / 2026-09-01 | 活跃 | 无 OIDC |
| dexidp/dex | 联邦 OP（服务） | Apache-2.0 | v2.45.1 / 2026-03-03 | 活跃 | connector 模型参考；无 WeChat |
| coreos/go-oidc | RP | Apache-2.0 | v3.21.0 / 2026-09-01 | 活跃 | 仅客户端 |
| go-webauthn/webauthn | WebAuthn RP | BSD-3-Clause | v0.18.2 / 2026-09-19 | 活跃 | passkey API 完整 |
| pquerna/otp | TOTP/HOTP | Apache-2.0 | v1.5.0 / 2025-05-16 | 低活跃、稳定 | 防重放/恢复码自写 |
| golang-jwt/jwt | JWT | MIT | v5.3.1 / 2026-01-28 | 活跃 | 仅 JWT |
| lestrrat-go/jwx | JOSE 全家桶 | MIT | v4.5.0 / 2026-09-08 | 活跃 | v4 |
| go-jose/go-jose | JOSE | Apache-2.0 | v4.1.5 / 2026-09-03 | 活跃 | zitadel/oidc 依赖 |
| alexedwards/argon2id | 密码哈希封装 | MIT | v1.0.0 / 2023-10-21 | 稳定 | |
| markbates/goth | 社交登录 RP | MIT | v1.82.0 / 2025-08-18 | 低活跃 | 有 wechat/wecom，仅 web 重定向 |
| apache/casbin | authz | Apache-2.0 | v3.11.0 / 2026-08-20 | 活跃 | 原 casbin/casbin |
| openfga/openfga | ReBAC 服务 | Apache-2.0 | v1.21.0 / 2026-09-20 | 活跃 | |
| nyaruka/phonenumbers | E.164 解析 | MIT | tag v2.0.14 / 2026-10-02 | 活跃 | |
| sethvargo/go-limiter | 限速 | Apache-2.0 | v1.2.0 / 2026-07-17 | 活跃 | ulule/limiter 已停滞 |
| hashicorp/go-plugin | RPC 插件 | MPL-2.0 | v1.8.0 / 2026-04-29 | 活跃 | 子进程模型 |
| silenceper/wechat | WeChat SDK | Apache-2.0 | v2.1.14 / 2026-07-20 | 活跃 | 见下节 |
| ArtisanCloud/PowerWeChat | WeChat SDK | MIT | v3.4.45 / 2026-08-29 | 活跃 | 见下节 |
| alibabacloud-go/dysmsapi-20170525 | Aliyun SMS | Apache-2.0 | v5.6.0 / 2026-07-01 | 官方生成 SDK | |
| TencentCloud/tencentcloud-sdk-go | Tencent Cloud SDK | Apache-2.0 | tag v1.3.191 / 2026-10-04 | 活跃 | `tencentcloud/sms/v20210111` |

### 中国生态 SDK

- **[silenceper/wechat](https://github.com/silenceper/wechat)**（5.3k stars）
  - 小程序：[miniprogram/auth/auth.go](https://github.com/silenceper/wechat/blob/v2/miniprogram/auth/auth.go) 提供 `Code2Session`/`Code2SessionContext`（`sns/jscode2session`）、`GetPhoneNumber`/`GetPhoneNumberContext`（`wxa/business/getuserphonenumber`，即 phonenumber.getPhoneNumber）、`CheckSession`、`ResetUserSessionKey`、`GetPaidUnionID`。
  - 公众号网页授权：[officialaccount/oauth/oauth.go](https://github.com/silenceper/wechat/blob/v2/officialaccount/oauth/oauth.go) 提供 `GetRedirectURL`（`open.weixin.qq.com/connect/oauth2/authorize`，scope 由调用方传入，如 `snsapi_userinfo`）、`GetWebAppRedirectURL`（`connect/qrconnect`，网站扫码登录）、`GetUserAccessToken`（`sns/oauth2/access_token`）、`RefreshAccessToken`、`GetUserInfo`（`sns/userinfo`）。
  - 开放平台移动应用登录：官方流程同样是服务端调用 `sns/oauth2/access_token`（见下节），因此可用同一 `oauth` 包配上移动应用的 appid/secret 完成换取（推断，未实测；SDK 是否有专门的 mobile-app 封装未验证）。
- **[ArtisanCloud/PowerWeChat](https://github.com/ArtisanCloud/PowerWeChat)**（1.8k stars）：仓库树中确认存在 `src/miniProgram/auth`（code→session）与 `src/miniProgram/phoneNumber`；OAuth 部分委托给依赖 [`ArtisanCloud/PowerSocialite/v3`](https://github.com/ArtisanCloud/PowerWeChat/blob/master/go.mod)，其公众号/开放平台登录的具体方法未验证。
- **取舍**：两者都是"全量 WeChat SDK"（支付、客服、消息等）。本系统只需 4 个 HTTP 调用（`jscode2session`、`getuserphonenumber` + `access_token` 缓存、`sns/oauth2/access_token`、`sns/userinfo`），直接手写或只引 silenceper 的两个子包均可；注意小程序 `access_token`（`cgi-bin/token`）需集中缓存与刷新，SDK 的缓存接口需对接自己的存储。
- **SMS 官方 SDK**：Aliyun [alibabacloud-go/dysmsapi-20170525](https://github.com/alibabacloud-go/dysmsapi-20170525)（v5.6.0，2026-07-01，自动生成）；Tencent Cloud [tencentcloud-sdk-go](https://github.com/TencentCloud/tencentcloud-sdk-go) 下 [`tencentcloud/sms`](https://github.com/TencentCloud/tencentcloud-sdk-go/tree/master/tencentcloud/sms) 含 `v20190711` 与 `v20210111` 两个 API 版本。
- **多厂商 SMS 抽象**：[casdoor/go-sms-sender](https://github.com/casdoor/go-sms-sender)（Apache-2.0，78 stars，最后 push 2024-11-29，覆盖 Aliyun/Tencent/Huawei/Volc 等）；[shellvon/go-sender](https://github.com/shellvon/go-sender)（MIT，0 stars，2026-01）。均不成熟；建议自定义一个 `Send(ctx, phone, templateID, params)` 接口 + 两个官方 SDK 适配器。国内短信的签名/模板报备、验证码频控属运营侧约束，未在本切片验证。

### 设计必须遵守的协议事实

**WeChat 小程序**

- 登录链路：`wx.login` 得到 code → 服务端调 [`code2Session`](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)（`/sns/jscode2session`）返回 `openid`、`session_key`、`unionid`。`session_key` 不得下发客户端（通行要求，本次未取到原文）。
- UnionID 条件（[UnionID 机制说明](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/union-id.html)）："绑定了开发者账号的小程序"才可获取；此时"开发者可以直接通过 wx.login + code2Session 获取到该用户 UnionID，无须用户授权"。"只要是同一个微信开放平台账号下的移动应用、网站应用、小程序、小游戏、公众号等，用户的 UnionID 是唯一的。"→ 账户模型必须以 `unionid` 为跨端主键、`(appid, openid)` 为次键，并处理"未绑定开放平台时只有 openid"的情形。
- 无法走标准浏览器重定向 OIDC：小程序没有系统浏览器；[`web-view`](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html) "个人类型的小程序暂不支持使用"，企业主体也须配置业务域名白名单（iframe 域名同样受限），且 web-view 内只开放有限 JSSDK 接口。→ 小程序端必须是"自有 API 直连 + code 换 token"的 first-party 流程；"web-view 内完成 authorize 重定向再把 code 传回小程序"是否可行未验证。
- 手机号一键获取（[手机号快速验证组件](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)）：仅**非个人主体且已完成微信认证**的小程序可用；自 2023-08-28 起收费，"每次组件调用成功，收费0.03元"，每个小程序账号有 1000 次体验额度；回调里的动态 `code`（5 分钟有效、一次性）由服务端调 `phonenumber.getPhoneNumber` 换取手机号。另有"手机号实时验证组件"（每次实时校验，价格未在本次取证中确认）。→ 这是 SMS OTP 之外的一条"已验证手机号"来源，需独立的 grant/端点。

**WeChat 开放平台 / 公众号**

- 移动应用登录（[开发指南](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/WeChat_Login/Development_Guide.html)）：App 通过 SDK `SendAuthReq`（scope `snsapi_userinfo`）拿到 code → 服务端调 `https://api.weixin.qq.com/sns/oauth2/access_token?appid=…&secret=…&code=…&grant_type=authorization_code`，返回 `access_token`（2 小时）、`refresh_token`（180 天）、`openid`，以及 `unionid`（"当且仅当该移动应用已获得该用户的 userinfo 授权时，才会出现该字段"）。官方建议 "将 AppSecret、用户数据（如 access_token）放在 App 云端服务器"→ code 必须交给本系统后端换取。
- 公众号网页授权：官方文档入口页注明"仅服务号可用"（[来源](https://developers.weixin.qq.com/doc/offiaccount/OA_Web_Apps/Wechat_webpage_authorization.html)）；授权端点 `open.weixin.qq.com/connect/oauth2/authorize` 与换取端点 `sns/oauth2/access_token` 由 [silenceper 源码](https://github.com/silenceper/wechat/blob/v2/officialaccount/oauth/oauth.go)佐证。`snsapi_base` 与 `snsapi_userinfo` 的差异、公众号场景下 unionid 的返回条件——官方原文本次未取到，**未验证**。
- 三端（小程序 / 移动应用 / 公众号）的 openid 各不相同，只有绑定到同一开放平台账号后才共享 `unionid`（见上 UnionID 文档）。

**"无浏览器重定向的 first-party 登录"在标准中的位置**

- [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)（BCP 212）：native app 的授权请求"should only be made through external user-agents"，"MUST NOT use embedded user-agents"；public native client 必须实现 PKCE；redirect URI 三选一（private-use scheme、claimed https、loopback）。→ 第三方 client 接入本系统时应走 auth code + PKCE。
- OAuth 2.1：[draft-ietf-oauth-v2-1](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) 最新为 **-16（2026-09-03）**，仍是 Internet-Draft；只定义 authorization code、client credentials、refresh token 三种 grant，implicit 与 ROPC（password grant）均被移除。→ 密码登录不应以 `grant_type=password` 暴露。
- [draft-ietf-oauth-first-party-apps](https://datatracker.ietf.org/doc/draft-ietf-oauth-first-party-apps/) 最新为 **-04（2026-07-01）**，WG 文档，状态 "WG Consensus: Waiting for Write-Up"，尚非 RFC。它定义 `authorization_challenge_endpoint`：first-party client 直接 POST 凭据/挑战应答，服务端以 `insufficient_authorization` + `auth_session` 驱动多步认证（OTP、MFA），最终返回 authorization code 再去 token endpoint 换 token。这正是"手机号+OTP / 密码 / passkey 原生登录"的标准化形态。
- **Go 库实现情况**：在 ory/hydra、ory/fosite、zitadel/oidc、luikyv/go-oidc、authelia/authelia、dexidp/dex、go-oauth2/oauth2、pocket-id 中用 GitHub code search 检索 `authorization_challenge`，结果为 0 → **没有任何一个实现该 draft**（code search 仅覆盖默认分支；authelia/oauth2-provider 未纳入检索）。
- 把 WeChat code / SMS OTP 换成 token 的标准挂载点：
  - [RFC 6749 §4.5](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.5) extension grant：以绝对 URI 作为 `grant_type` 值的自定义 grant（§4.5 原文本次未取到，按通行理解）。fosite 系可直接注册 handler；zitadel/oidc 需绕行。
  - [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html) token exchange：`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`，必填 `subject_token` 与 `subject_token_type`；"Other URIs MAY be used to indicate other token types"→ 可用自定义 token type URI 承载 WeChat code。zitadel/oidc、luikyv/go-oidc、authelia/oauth2-provider 支持，ory/fosite 不支持。
  - RFC 7523（JWT bearer assertion）：fosite、zitadel/oidc 均有实现，但它要求输入是 JWT，WeChat code/OTP 不是 JWT，不直接适用（适用性判断为推断）。

**Passkey（native app 与国内环境）**

- iOS（[Supporting passkeys](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys)）："You need to have an associated domain with the `webcredentials` service type when making a registration or assertion request; otherwise, the request returns an error." RP ID 必须是 app 的 associated domain → 认证域名需托管 `apple-app-site-association`，每个接入的 app 都要登记。
- Android（[Create passkeys](https://developer.android.com/identity/passkeys/create-passkeys)）：须先配置 Digital Asset Links，且目标设备为 Android 9 (API 28)+；`/.well-known/assetlinks.json` 的具体字段未在本次取证中逐项核对。Credential Manager 在无 Google Play 服务的国内 Android 机型上的可用性**未验证**（高风险项）。
- 小程序内 WebAuthn：在 developers.weixin.qq.com 未检索到任何关于小程序或 web-view 支持 WebAuthn / `navigator.credentials` 的官方说明，**未验证**，应按"不可用"设计。小程序自有的生物识别能力是 SOTER（[`wx.checkIsSupportSoterAuthentication`](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/soter/wx.checkIsSupportSoterAuthentication.html)），与 WebAuthn/passkey 不互通（"不互通"为推断）。
- → passkey 只能作为 native app / web 端的可选因子；RP ID 一旦选定，换域名即令全部 passkey 失效（WebAuthn 规范属性，未另取证）。
