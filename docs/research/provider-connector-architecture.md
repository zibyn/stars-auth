# 上游身份源（Provider 连接器）的架构：类型、预设与通用 OAuth2

- 调研日期：2026-10-09
- 问题：本项目把 Provider 类型做成编译期的 Go 包（目前只有通用 OIDC 与 Apple 两个）。要回答六件事，并据此决定两件事：
  - 六件事：(1) 每个供应商是不是一个独立类型/插件包，各家内置清单是什么；(2) 有没有"预设"机制，界面怎么呈现；(3) 通用/自定义的**非 OIDC** OAuth2 支持吗，叫什么、要填什么、拿哪个字段当用户 ID；(4) 对"非 OIDC 上游"的取舍与安全警告；(5) GitHub 具体怎么接（用户 ID 字段、邮箱、verified）；(6) 类型是编译期注册还是运行时可扩展。
  - 决策 A：Google / Microsoft 应该是独立的 Provider 类型，还是通用 OIDC 类型的"预设"？
  - 决策 B：是否新增一个通用的标准 OAuth2（非 OIDC）Provider 类型以便接入 GitHub，安全取舍是什么？
- 对照对象：Keycloak 26.8、Logto v1.44、Casdoor、Authing、Zitadel v4、Okta；以及 GitHub / Google / Microsoft 的上游事实。
- 用法：本文只服务上面两个决策与六问，不复述市场调研（`auth-market-survey.md`）与协议层选型（`oidc-reference-impl.md`）；本项目现有定义见 `docs/spec/architecture.md#provider-的配置与身份`、`docs/adr/0004-compile-time-plugins.md`、`docs/spec/identity.md`。

## 0. 怎么读这份文档

- **第 1 节是综合结论与两个决策**；第 2–7 节按六问逐项对照；第 8 节是未验证汇总与下一步；附录是逐系统取证记录。
- 每条非显然事实附一手来源 URL 与读取日期（均为 2026-10-09）。**我自己的判断标【推断】**；没取到一手来源的标 **未验证**，没有用记忆补。
- 取证方式：四路并行调查（Keycloak / Logto / Casdoor+Authing / Zitadel+Okta），读官方文档与官方仓库源码（`gh api`、raw.githubusercontent.com、浅克隆）。**我另外亲自复核了与决策最相关的一批上游事实**：GitHub REST API 与它的 OIDC discovery（404）、Google 与 Microsoft 的 OIDC discovery、Logto 的 `oauth2` 连接器存在性。四路调查的其余内容未逐条复核。凡原文引文经网页摘要工具转述的，可能有字词出入。
- 三家开源产品读的是 `master`/`main` 分支，不是发行 tag，发行版可能有细微出入（在各条里标注）。

## 1. 结论速览

### 1.1 已验证的事实

1. **六家全部是"运行期实例 + 固定类型集"**，没有一家允许运行期注入协议实现。差别只在"类型"以什么形态存在：Keycloak 是可编译的 Java SPI 类；Logto 是独立 npm 包 `@logto/connector-*`；Casdoor 是 DB 行 + Go 工厂 switch；Zitadel / Okta 是 proto / OpenAPI 里的枚举值；Authing 是用户池下的配置对象。**Google、Microsoft、GitHub 在六家里都是内置的具名条目**（Microsoft 在 Authing 归在"企业身份源 Azure AD"）。
2. **"预设"机制普遍存在，且形态一致**：管理员在一个**卡片目录 / 分组下拉**里挑一个具名条目，选中后进入**该条目专属的表单**；内置条目的**端点写死在代码里**，表单只问 client id / secret。**只有通用 OIDC / OAuth2 条目才要求管理员手填端点。** Keycloak、Logto、Zitadel 三家的源码都能直接看出这一点（见 §3）。
3. **通用非 OIDC OAuth2 支持是主流，不是异类**：Keycloak（叫 **"OAuth v2"**）、Logto（`oauth2` 连接器）、Zitadel（**Generic OAuth**）、Casdoor（type **Custom**）、Authing（**OAuth2.0 身份源**）**五家都有**。唯一的例外是 **Okta——它只有通用 OIDC 与 SAML2，没有通用 OAuth2**（这是一个重要的负面事实）。
4. **通用 OAuth2 的上游一律不做 discovery、也没有 id_token**：身份完全来自**带 access token 调 userinfo 端点**拿到的 JSON，再按一个**可配置的"用户 ID 字段"**取主键。四家都把这个字段做成配置项：Keycloak `ID Claim`（默认 `sub`）、Zitadel `idAttribute`（必填）、Logto `profileMap.id`（必填）、Casdoor `UserMapping.id`（必填）。
5. **由此产生的取舍被各家文档/源码显式承认**：Keycloak 文档原话是"该 broker **把 access token 当作不透明字符串**，用户资料应来自单独的端点"；Zitadel 的通用 OAuth mapper **只映射 ID**，`GetEmail()` 返回空、`IsEmailVerified()` 返回 false，其余资料要管理员写 Action 自己补；Logto 文档要求连接器作者自己确保 email/phone 是 verified，且只有 OIDC 连接器有 `trustUnverifiedEmail` 开关，通用 oauth2 **没有**等价物。
6. **GitHub 不是 OIDC**：`https://github.com/.well-known/openid-configuration` 返回 **404**（我实测）；GitHub 官方文档写 "GitHub does not currently implement OpenID Connect … does not issue ID tokens"。它的稳定用户 ID 是**数值 `id`**（`login` 官方写明"可以随时间改变"），邮箱要 `user:email` scope 走 `/user/emails`。
7. **GitHub 的用户 ID 字段，六家里凡是能读到源码的，全部用数值 `id`，没有一个用 `login`**：Keycloak、Logto、Casdoor、Zitadel 一致。这印证了"用 `login` 当锚点是错的"。
8. **扩展性：没有一家支持"运行时注册一个新类型"**。Keycloak 要 Java SPI + jar + `kc.sh build`/重启；Zitadel 要改 Go + proto + Console + 重编译；Casdoor 新类型要写 Go 重编译；**Logto 的新连接器也不是运行期 HTTP 服务**——官方路径是写一个 TS 包，用 `npx @logto/cli connector link` 软链进 core 的 `connectors/` 目录再**重启进程**（见 §7）。

### 1.2 【推断】我的判断

- **决策 A：Google / Microsoft 应是通用 OIDC 类型的"预设"，不是独立的 Provider 类型。** 两者都发布完整 OIDC discovery、都签发 RS256 id_token（我实测），今天用现有的通用 OIDC 类型**填 issuer + client_id + secret 就能接**，一行 Go 代码都不用加。给它们各写一个类型，等于把通用 OIDC 的实现原样复制两遍，只换来一个更漂亮的标签。行业里"每家一张卡片"是**呈现层的预设**，底下的实现是同一套端点写死的单一实现——本项目对应的做法是"预设表"（预填 issuer、显示名、图标），而不是新包。唯一的硬骨头是 **Microsoft 的多租户 issuer 是模板化的**（见 §4 与 §8）。
- **决策 B：应新增通用标准 OAuth2（非 OIDC）Provider 类型。** 四家主流都提供，需求（接 GitHub）真实，且没有它就没有任何"免写代码"的方式接 GitHub。安全取舍是可说清的：**它比 OIDC 类型低一档——没有签名令牌，身份等于"信任 userinfo 端点经 TLS 返回的 JSON"**。因此这个类型必须自带两个护栏：(a) 强制管理员显式指定**用户 ID 字段**（GitHub 预设里写死 `id`），绝不允许默认到某个可变字段；(b) 在本项目"Provider 邮箱一律忽略、不据此关联 User"（`identity.md` 不变式 4）的既有前提下，把"不信任邮箱"写进这个类型的定义，正好绕开行业里最容易踩的 `email_verified` 坑。
- 反过来，**Apple 保持独立类型是对的**：它没有 discovery、回调是 `form_post`、client secret 是用 `.p8` 自签的 JWT、原生端只提交 code——这些都是协议机制不同，不是"端点写死"能覆盖的。**分界线就是：协议机制不同 → 独立类型；只是端点与品牌不同 → 预设。**

## 2. 六问之一：每个供应商是不是一个独立类型/插件包？

结论：**是"一个具名条目"，但不是"一个进程内可插拔的插件"**。六家的形态、内置清单如下（"✅ 内置"= 官方把该供应商作为一个具名条目前置提供，管理员选的不是通用类型）。

| 系统 | "类型"的形态 | Google | Microsoft | GitHub | 内置清单的一手来源 |
|---|---|---|---|---|---|
| **Keycloak** | 编译进服务端的 Java 类，经 `META-INF/services` 注册；12 个 social + 通用协议类 | ✅ | ✅（名 "Microsoft"） | ✅ | social 注册文件；[server_admin Social Identity Providers](https://www.keycloak.org/docs/latest/server_admin/#social-identity-providers) |
| **Logto** | 独立 npm 包 `@logto/connector-*`，随 core 打包 | ✅ `connector-google` | ✅ `connector-azuread` | ✅ `connector-github` | [`packages/connectors`](https://github.com/logto-io/logto/tree/master/packages/connectors) |
| **Casdoor** | DB 行（`Provider` 对象，含 `category`+`type`），type 存在前端选项与 Go 工厂 | ✅ | ✅（`AzureAD`/`AzureADB2C`/`MicrosoftOnline`） | ✅ | [`object/provider.go`](https://github.com/casdoor/casdoor/blob/master/object/provider.go)、`web/src/lib/setting.tsx` |
| **Zitadel** | 运行期 IdP 实例 + 编译进 proto 的枚举 `ProviderType` | ✅ `PROVIDER_TYPE_GOOGLE` | ✅ `PROVIDER_TYPE_AZURE_AD` | ✅ `PROVIDER_TYPE_GITHUB`(+`_ES`) | [`proto/zitadel/idp.proto`](https://github.com/zitadel/zitadel/blob/main/proto/zitadel/idp.proto) |
| **Okta** | 运行期 IdP 实例 + OpenAPI 枚举 `type` | ✅ `GOOGLE` | ✅ `MICROSOFT` | ✅ `GITHUB` | Okta OpenAPI spec `management-oneOfInheritance.yaml` 的 `type` 枚举 |
| **Authing** | 用户池下的配置对象（`ExtIdp`），控制台卡片目录 | ✅ | 归"企业身份源 → Azure AD" | ✅ | [社会化身份源](https://docs.authing.cn/v2/guides/connections/social.html)、[企业身份源](https://docs.authing.cn/v2/guides/connections/enterprise/) |

**内置清单细节（一手）**：

- **Keycloak social 共 12 个**（服务注册文件与文档一致）：Facebook、PayPal、GitHub、Google、LinkedIn、Stack Overflow、Twitter、Microsoft、OpenShift v4、GitLab、Bitbucket、Instagram。通用协议 provider 的 UI 名是 **"OpenID Connect v1.0"**、**"OAuth v2"**、**"SAML v2.0"**（[`OAuth2IdentityProviderFactory`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/broker/oauth/OAuth2IdentityProviderFactory.java) 的 `PROVIDER_ID="oauth2"`、`getName()` 返回 `"OAuth v2"`）。代码里按 `groupName` 分成 `"Social"` 与 `"User-defined"`（`ServerInfoAdminResource`）。
- **Logto 社交连接器**（`ConnectorType.Social`）：alipay-native/web、amazon、apple、azuread、dingtalk-web、discord、facebook、feishu-web、github、gitlab、google、huggingface、kakao、kook、line、linkedin、naver、**oauth2、oidc、saml**、patreon、qq、slack、wechat-native/web、wecom、x、xiaomi。注意 `connector-amazon` 是社交（Login with Amazon）、`connector-whatsapp` 属 SMS。**包名更正**：OAuth2 连接器目录叫 `connector-oauth2`，npm 包名是 **`@logto/connector-oauth`**（`@logto/connector-oauth2` 在 npm 上不存在）。
- **Zitadel 模板**：`PROVIDER_TYPE_{OIDC, JWT, LDAP, OAUTH, AZURE_AD, GITHUB, GITHUB_ES, GITLAB, GITLAB_SELF_HOSTED, GOOGLE, APPLE, SAML, ZITADEL}`。**Okta 不是独立模板**——文档里 "OKTA generic OIDC / OKTA SAML" 是让你用通用 OIDC / SAML 模板的配置指南（providers 目录里没有 `okta` 包）。
- **Casdoor OAuth 类型**含 Google、GitHub、GitLab、Gitee、QQ、WeChat、WeChatMiniProgram、Facebook、DingTalk、Weibo、LinkedIn、WeCom、Lark、ADFS、Baidu、Alipay、Apple、AzureAD、AzureADB2C、Okta、Douyin、MicrosoftOnline、Twitter、**OIDC**、**Custom / Custom2..Custom10 / "Custom Flexible"** 等（完整列表在 `web/src/lib/setting.tsx` 的 `getProviderTypeOptions('OAuth')`）。
- **Okta 类型枚举**：AMAZON、APPLE、DISCORD、FACEBOOK、GITHUB、GITLAB、GOOGLE、LINKEDIN、LOGINGOV、MICROSOFT、OIDC、OKTA_INTEGRATION、PAYPAL、SALESFORCE、SAML2、SPOTIFY、X509、YAHOO 等。Google / Microsoft 有专用 type，不走 generic；GitHub 是 `GITHUB`（较新加入，旧 SDK 可能没有）。

**对小节的直接回答**："独立的类型/插件包"这个说法要拆开看——**每家的每个供应商确实是一个独立的具名条目**，但只有 **Logto 把它做成了物理上独立的包**；Keycloak 做成独立的 Java 类；其余三家只是类型枚举里的一项。三者都**不能**在运行期新增。

## 3. 六问之二：有没有"预设"机制，界面怎么呈现？

结论：**有，且六家一致。呈现是"卡片目录 / 分组下拉"，不是每家一个类型。** 关键是选中具名条目后**端点是否预填**：

| 系统 | 呈现形态 | 具名条目是否预填端点 | 一手来源 |
|---|---|---|---|
| **Keycloak** | 无 provider 时是一组按 `groupName` 分组的**卡片网格**（PatternFly `Gallery`+`ClickableCard`）；已有 provider 后变成表格 + **分组 "Add provider" 下拉** | ✅ 内置 social 在 Java 构造函数里写死端点，表单只暴露少数字段；通用 OIDC/OAuth2 要手填 | [`IdentityProvidersSection.tsx`](https://github.com/keycloak/keycloak/blob/main/js/apps/admin-ui/src/identity-providers/IdentityProvidersSection.tsx) |
| **Logto** | "Create connector" 弹窗拉取 `GET api/connector-factories`，渲染 **`ConnectorRadioGroup` 卡片**（logo+名称+描述），标准连接器单列一区 | ✅ 热门连接器端点在 `constant.ts` 里写死；标准连接器（oauth2/oidc/saml）是**空的必填文本框** | [`CreateConnectorForm/index.tsx`](https://github.com/logto-io/logto/blob/master/packages/console/src/components/CreateConnectorForm/index.tsx) |
| **Casdoor** | 一张**可搜索的 Type 下拉**（带 logo） | 部分预填：选 OIDC 时预填 `scopes`，选 Custom 时预填 Casdoor demo 端点；**不是每家真实端点都预填** | [`ProviderEditPage.tsx`](https://github.com/casdoor/casdoor/blob/master/web/src/pages/ProviderEditPage.tsx) |
| **Zitadel** | **带 logo 的卡片网格**，每个模板一个路由 | ✅ 内置模板表单**只问 clientId/clientSecret/name**，端点藏在 Go 常量里；Generic OAuth 要手填全部端点 | `console/.../idp-settings.component.html`、`providers-routing.module.ts` |
| **Okta** | 类型目录 → 该类型专属表单（完整一手清单未取到，help 页 JS 渲染） | 【推断】同上；**未验证** | [Add social login](https://help.okta.com/oie/en-us/content/topics/security/idp-social.htm) |
| **Authing** | **卡片目录**：进入"社会化身份源 → 创建"→ 选一张卡片（如 GitHub）→ 填表单；企业身份源同理先选卡片 | 各类型页面即预设（字段已定），未见"切类型自动回填端点" | [社会化身份源](https://docs.authing.cn/v2/guides/connections/social.html) |

**两条可直接借鉴的界面规律**：

1. **"卡片目录选类型 → 专属表单"是通行做法**，卡片文案是"一句说明 + 举例"（Zitadel 的模板卡片、Logto 的 `ConnectorRadio`）。本项目 `consoles.md` 的"添加时先选 Provider 类型，再按它声明的字段渲染表单"已经与之同构。
2. **预设的价值在"少问几个字段"，不在"多一个类型"**。Zitadel 的 Google 模板只问 3 个字段，就是因为它把端点写死了；本项目若要给 Google/Microsoft 做预设，实质就是**预填 issuer + 显示名 + 图标**，其余交给通用 OIDC 类型。这与"每家写一个 Go 类型"是两回事。

## 4. 六问之三 + 之四：通用/自定义非 OIDC OAuth2

### 4.1 谁支持、叫什么、要填什么

| 系统 | 通称 | 必填字段 | 用户 ID 从哪个字段取 | 要不要 discovery |
|---|---|---|---|---|
| **Keycloak** | **"OAuth v2"**（provider id `oauth2`） | Authorization URL、Token URL、**User Info URL**、Client ID、Client Secret、Default Scopes、（Client Authentication 等） | **`ID Claim`，默认 `sub`**（另有 Username/Email/Name 等 claim 映射） | 不需要（元数据导入是可选便利） |
| **Logto** | `oauth2` 连接器（npm `@logto/connector-oauth`） | `authorizationEndpoint`、`tokenEndpoint`、`userInfoEndpoint`、`clientId`、`clientSecret`（可选 `scope`、`profileMap`、`tokenEndpointAuthMethod`、`tokenEndpointResponseType`…） | **`profileMap.id`**，zod 默认 `{id:'id', email:'email', …}`，`id` 是唯一必填映射 | 不需要 |
| **Zitadel** | **Generic OAuth**（`PROVIDER_TYPE_OAUTH`） | `authorizationEndpoint`、`tokenEndpoint`、`userEndpoint`、**`idAttribute`**、`clientId`、`clientSecret`、`scopes`、`usePkce` | **`idAttribute`**，在 userEndpoint 返回的 JSON 里按此键取 | 不需要 |
| **Casdoor** | type **`Custom`**（及 `Custom2..10`、"Custom Flexible"） | Client ID/Secret、Auth URL、Token URL、UserInfo URL、Scope、Enable PKCE、**UserMapping** | **`UserMapping.id`**（必填，取不到报错 `cannot get the user ID`），回退标准 OIDC claim（`id`→`sub`…） | 自定义 OAuth2 不做 discovery |
| **Authing** | **"OAuth2.0 身份源"**（企业身份源） | 授权 URL、Token URL、Scope、Client ID/Secret、授权链接模版、**Code 换 Token 脚本**、**Token 换用户信息脚本** | 由"Token 换用户信息脚本"自行决定，**字段未文档化 → 未验证** | 文档未提（未验证） |
| **Okta** | **不存在** | — | — | Okta 只有通用 **OIDC** 与 **SAML2**，没有通用 OAuth2 |

补充：通用 **OIDC** 条目也都有，只是验端点的方式不同——Zitadel generic OIDC 只填 **Issuer URL** 就自动 discovery（【推断】走 `.well-known`，库内部行为，源码未明写）；Logto 的 OIDC 连接器反而**不做 discovery**，要手填 `idTokenVerificationConfig.jwksUri` 并用 `jose` 校验 id_token；Okta 的通用 OIDC 也是让你从 well-known 文档**手动抄** Issuer/Authorize/Token/JWKS，不是给一个 discovery URL。

### 4.2 非 OIDC 上游的取舍（安全）

各家对"没有 id_token 时身份从哪来"的处理与它们自己承认的局限：

- **Keycloak**：code 换 access token → `GET <User Info URL>`，带 `Authorization: Bearer`，**要求响应 Content-Type 是 `application/json`**（否则报错），按 `ID Claim`（默认 `sub`）设 broker user id。文档明说这个 broker **把 access token 当作不透明字符串**，资料只来自 userinfo 端点；因此**不校验任何令牌签名**（对 `fetchUserProfile` 源码的解读 → 【推断】）。我没在 `oauth2.adoc` 里找到针对非 OIDC 上游的独立"安全警告"段落（**未验证**是否存在）。**邮箱是否 verified**：若 userinfo/ID token 带 `email_verified` 就用它，**缺失时由通用的 `Trust Email` 开关决定**。
- **Logto**：oauth2 连接器 `_getUserInfo` → 调 `userInfoEndpoint` → `profileMap` 映射 → 取 `id`。**没有签名校验**。文档限制：只支持 `Authorization Code`（"for security consideration"）；要求连接器作者自己确保 profile 里的 email/phone 是 **verified**。**通用 oauth2 没有 `email_verified` 处理**（只有 OIDC 连接器有 `trustUnverifiedEmail` 开关），映射到什么字段就当什么 email（【推断】不校验）。
- **Zitadel**：Generic OAuth 的 mapper **只映射 ID**——`GetEmail()` 返回 `""`、`IsEmailVerified()` 返回 `false`、username/display name 全为零值；文档注释说这是**故意**的，其余资料要管理员**写 Action 读 `RawInfo` 自己补**。【推断】因此通用 OAuth 下"基于 email 的自动关联/自动创建"开箱基本不可用。对照：Zitadel 内置 GitHub 模板的 `IsEmailVerified()` **硬编码 true**。
- **Casdoor**：`mapUserInfo` 先查 `UserMapping`，再回退标准 OIDC claim；`id` 必填，取不到直接报错。自定义 OAuth2 不做 discovery，端点须直接给出。
- **Authing**：两段 JS 脚本自己决定，官方未文档化默认脚本与用户 ID 字段（**未验证**）。
- **Okta**：无此能力，不适用。

**一句话总结取舍**：通用 OAuth2 **丢掉了"身份可与一个可离线验证的签名令牌绑定"这一保证**，身份等于"信任上游 userinfo 端点经 TLS 返回的 JSON Google/Microsoft 那套 id_token + discovery 的强度在这里没有"。附带两个必须自己拿主意的点：**(a) 用哪个字段当用户 ID（可变字段是陷阱）；(b) email 的 verified 语义（很多家干脆不管）。**

## 5. 六问之五：GitHub 具体怎么接

### 5.1 GitHub 上游事实（我实测）

- **不是 OIDC**：`https://github.com/.well-known/openid-configuration` → **HTTP 404**（2026-10-09 实测）。GitHub 文档（经 Zitadel/Okta 调查引用）写 "GitHub does not currently implement OpenID Connect … does not issue ID tokens"（[企业版 discovery 说明页](https://docs.github.com/en/enterprise-server@3.21/apps/github-authentication-discovery-endpoints)）。→ **任何"要求 discovery + 校验 id_token"的通用 OIDC 类型都接不了 GitHub。**
- **`GET /user`** 返回 `id`（`integer, int64`，官方在 [GET /user/{account_id}](https://docs.github.com/en/rest/users/users?apiVersion=2022-11-28) 页说明它用"durable user ID instead of their login, **which can change over time**"）、`login`（可变）、`node_id`、`email`（**可空**，且只有"公开可见的邮箱"）。scope 要 `read:user` 或更宽的 `user`。
- **`GET /user/emails`** 需要 **`user:email`** scope；每条含 `email`、`primary`、`verified`（必填 boolean）、`visibility`（[emails 端点](https://docs.github.com/en/rest/users/emails?apiVersion=2022-11-28)）。
- **OAuth2 端点**：authorize `https://github.com/login/oauth/authorize`、token `https://github.com/login/oauth/access_token`，支持 PKCE（仅 `S256`）、device flow、refresh token（[authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)）。

### 5.2 六家的 GitHub 实现

| 系统 | 用户 ID | 邮箱怎么拿 | 是否当 verified | 默认 scope |
|---|---|---|---|---|
| **Keycloak** | **数值 `id`**（`getJsonProperty(profile,"id")`），username=`login` | `/user` 的 `email`，为空则 `GET /user/emails`，取 **`primary==true`** 那条 | **代码不检查 `verified`**，由通用 `Trust Email` 决定 | `user:email` |
| **Logto** | **数值 `id`**（`z.number()`→`String(id)`） | 优先 `/user` 的 **public email**；为空才从 `/user/emails` 取 `verified && primary` | 连接器不返回 verified 标记；public email 分支**不过滤 verified**；核心把该 email 当 primary email 同步（不独立复核） | `read:user user:email` |
| **Casdoor** | **数值 `id`**（`strconv.Itoa(githubUserInfo.Id)`） | `/user` 的 `email` 为空 → `GET /user/emails`；**跳过 `!verified` 与 `users.noreply.github.com`**，优先 primary 的已验地址 | `EmailVerified = email != ""`（视公开邮箱即已验证） | `user:email`、`read:user` |
| **Zitadel** | **数值 `id`**（`strconv.Itoa(u.ID)`）；`login` 只做 nickname | `profile.email` 为空且 scope 含 `user:email` → `GET /user/emails`，取 **`primary && verified`** | **`IsEmailVerified()` 硬编码 `true`**（注释："GitHub validates emails themselves"） | GitHub 模板 Console 预填 `['openid','profile','email']`（**不含 `user:email` → 拿不到私有邮箱**） |
| **Authing** | **未文档化（未验证）** | 官方文档未写；账号关联表里 GitHub 行**匹配字段是邮箱** | **未验证**（是否校验 verified） | 文档未明写（未验证） |
| **Okta** | 内置 `GITHUB` 类型（OAuth2，scope `user`），字段级细节**未验证** | 未验证 | 未验证 | `user` |

**证据来源**：Keycloak `services/.../social/github/GitHubIdentityProvider.java`；Logto `connector-github/src/{index,constant,types}.ts`；Casdoor `idp/github.go`；Zitadel `internal/idp/providers/github/{github,session}.go`；Okta OpenAPI `type: GITHUB`。

**三条对本项目有用的结论**：

1. **GitHub 的锚点只能是数值 `id`**，"用 `login` 当 `sub`"是明确错误（会随改名漂移）。四家源码一致。
2. **拿私有邮箱要 `user:email` 并调 `/user/emails`**；不请求就只剩 `/user` 的可空 public email，甚至可能压根没有。Keycloak/Logto/Casdoor/Zitadel 都实现了这个回退。
3. **"GitHub 邮箱算不算 verified"各家做法不一致**（Keycloak 交给开关、Zitadel 硬编码 true、Casdoor 过滤 verified、Logto 不返回标记）。**本项目已经不需要纠结**：`identity.md` 不变式 4 规定 Provider 返回的邮箱**一律忽略、不据此关联 User**，所以这里的差异对本项目无影响。

## 6. 六问之六：编译期注册还是运行时可扩展？

| 系统 | 新增一个"类型"要做什么 | 能否不改主程序、运行期加一家 |
|---|---|---|
| **Keycloak** | 写 Java（实现 `IdentityProviderFactory` / `SocialIdentityProvider`），注册 `META-INF/services`，jar 放进 `providers/`，**`kc.sh build` 或重启** | **否**。存在的脚本化 provider 只覆盖 Authenticator / Policy / Protocol Mapper，**不含 identity provider** |
| **Logto** | 写一个 TS 连接器包，`npx @logto/cli connector link` 把包**软链**进 `<instance>/packages/core/connectors/`，**重启进程**；`POST /api/connectors` 只能实例化**已加载**的工厂 | **否**（但"不用改 Logto 源码"——见下） |
| **Casdoor** | 配置已有类型=纯运行期；新增**类型**=写 Go + 重编译 | 配置已有类型是；新类型否 |
| **Zitadel** | 写 Go 包 + 改 proto 枚举 + 加 Console 组件 + 重编译；Actions v2 只是 HTTP 回调 | **否** |
| **Okta** | 【推断】编译期，无插件文档 | **否** |
| **Authing** | 配置身份源=运行期；服务端闭源不可扩展 | 配置是；新类型否 |

**Logto 的关键澄清（因为任务背景里对它有假设）**：Logto **没有**"把连接器跑成一个独立 HTTP 服务、通过远程注册让 Logto 去调用"的机制——`docs.logto.io/connectors/custom-connector` 与 `/connectors/connector-standard` 两个 URL **都 404**（2026-10-09 实测），全仓搜 "remote connector" 命中 0。Logto 的"自定义连接器"是**本地 TS/JS 包 + 软链进 core 目录 + 重启进程**（[官方 develop-your-connector 指南](https://docs.logto.io/logto-oss/develop-your-connector/step-by-step-guide)；[`packages/cli/src/commands/connector/link.ts`](https://github.com/logto-io/logto/blob/master/packages/cli/src/commands/connector/link.ts) 就是 `fs.symlink`）。所以：**内置 `@logto/connector-*` 集合在构建/发布时固定**；要"加一家"要么走已有的通用 `oauth2`/`oidc`/`saml` 连接器（纯配置），要么写包并链接、重启——**仍然要动到 Logto 的部署本身**。

**对本项目的对照**：这与本项目 ADR 0004"编译期注册、随单二进制发布"是同一类模型，Logto 只是把"包"做得物理上更松一点。**"运行时注册新类型"在六家里零先例**，可以不作为设计目标；真正的运行时灵活性落在**通用 OIDC / 通用 OAuth2 这两种通用类型**上——这也正是本项目 `architecture.md` 已经写的"免写代码"路线。

## 7. 对两个决策的建议（均为【推断】）

### 决策 A：Google / Microsoft = 通用 OIDC 的"预设"，不是独立类型

**理由**：

1. **两者都是纯 OIDC，今天就能接。** 我实测：`https://accounts.google.com/.well-known/openid-configuration`（issuer `https://accounts.google.com`，userinfo、jwks、`id_token_signing_alg_values_supported:["RS256"]` 齐全）；`https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration`（issuer 为模板 `https://login.microsoftonline.com/{tenantid}/v2.0`，token/jwks/userinfo 齐全，RS256）。本项目的通用 OIDC 类型要求的"discovery + 校验 id_token"两条它们都满足，**填 issuer + client_id + secret 即可，无需新代码**。
2. **独立类型 = 复制通用 OIDC 的实现。** 与 Apple 不同，Google/Microsoft 在协议机制上没有任何特殊之处（没有 `form_post`、没有自签 client secret、没有"原生端只交 code"、没有非 discovery 的固定 issuer），所以新类型只会把同一段代码抄两遍，还增加编译期类型面（ADR 0004 的负担）。
3. **行业的"每家一张卡片"是呈现层预设。** Keycloak 的 Google social provider、Logto 的 `connector-google`、Zitadel 的 Google 模板，**底下都是"端点写死 + 管理员只填 client id/secret"的同一套逻辑**，不是另一套协议实现。本项目对应的最小做法就是一张**预设表**：`{ 显示名, issuer, 图标, 建议 scope }`，选中后预填通用 OIDC 的表单。

**落地形态【推断】**：给通用 OIDC 类型加一个"从预设开始"的入口（卡片目录里列 Google / Microsoft / 其他 OIDC），选中即预填 `issuer` 与显示名；Provider 本身仍是通用 OIDC 类型，`id`（slug）仍由管理员填、`issuer` 仍创建后不可改。

**必须处理的坑**：

- **Microsoft 的多租户 issuer 是模板化的**。`/common/v2.0` 返回的 `issuer` 字面量含 `{tenantid}`（我实测），而本项目要求 issuer 固定且用于校验 id_token 的 `iss`——多租户场景下 token 的 `iss` 是**具体租户**值，与模板不相等。**可行做法**：预设里让管理员填**具体租户**的 issuer（`https://login.microsoftonline.com/<tenant-id>/v2.0`），或只支持单租户/`consumers`。**具体行为需在实现前实测**（本项目 GitHub 之外的一个 spike 项）。
- **预设不得改变身份语义**：预设只能预填 issuer 与显示名，锚点必须仍是上游 `sub`，不能借预设把某个可变字段抬成主键。

### 决策 B：新增通用标准 OAuth2（非 OIDC）类型——建议做

**理由**：

1. **需求真实且无替代**：GitHub 不是 OIDC（404 实测），现有的"必须 discovery + 校验 id_token"的通用 OIDC 类型**结构上接不了**（`architecture.md` 已如此写明）。
2. **行业高度支持**：六家里**五家有**通用非 OIDC OAuth2（Keycloak "OAuth v2"、Logto `oauth2`、Zitadel Generic OAuth、Casdoor `Custom`、Authing OAuth2.0 身份源），唯一没有的是 Okta。加这个类型是主流做法，不是自造。
3. **它不是删掉安全，是把安全换一种说法**：本项目的通用 OIDC 类型用"discovery + id_token 校验"把身份绑到一个可验证的签名令牌；通用 OAuth2 **没有这个保证**，身份等于"信任 userinfo 端点的 HTTPS 响应"。这是**真实的降级**，行业文档也这么承认（Keycloak：access token 视为不透明；Zitadel：只映射 ID、email 空且未验证；Logto：无 `email_verified` 处理）。所以这个类型应当**明确标注为较低保证**，并自带护栏。

**建议的护栏【推断】**：

- **用户 ID 字段必须由管理员显式指定**（对齐 Keycloak `ID Claim` / Zitadel `idAttribute` / Logto `profileMap.id`）。**默认值不能是"空"或某个可变字段**；给 GitHub 之类的预设把该字段写死为 `id`，并在字段说明里点明"必须是上游稳定不变的标识，改名会漂移的字段（如 GitHub 的 `login`）不能选"。
- **不请求、不存储、不使用上游邮箱**：沿用 `identity.md` 不变式 4 与 `architecture.md` 的"服务商附带的信息一律忽略"。这恰好绕开行业里最脏的 `email_verified` 问题（各家处理不一致、Logto 通用 oauth2 干脆没有）。
- **协议加固照旧**：authorization code + PKCE + `state`，回调校验与本项目 OIDC 类型同一套；userinfo 响应要求 JSON（对齐 Keycloak 的 Content-Type 校验）。
- **类型数量上只加一个**：GitHub 用这个类型的**预设**（端点写死 + ID 字段 `id` + scope `read:user user:email`），而不是再写一个 GitHub 专用 Go 类型——这与 Keycloak/Logto/Zitadel "GitHub 是具名条目、但实现是同一套"的形态一致，也符合决策 A 的分界线。

## 8. 未验证汇总与建议的下一步

**未验证**

- Keycloak：源码读自 `main`，未固定到 26.x 发行 tag；`ServerInfoAdminResource` 的 `"User-defined"` 分组字符串在发行版是否一致未逐一核对；非 OIDC 上游是否存在官方独立"安全警告"段落未找到（只找到"把 token 当不透明"那一句）。
- Okta：Admin Console 完整 provider 选择菜单的一手清单（help 页 JS 渲染取不到正文）。
- Authing：自定义 OAuth2 的用户 ID 字段与默认脚本；OIDC 是否走 discovery；GitHub 的 ID 字段取值与邮箱 verified 判定。
- Logto：Cloud（闭源）是否有额外的连接器注册路径（只读了 OSS）；除 7 个 spot-check 外的连接器 npm 发布状态。
- Microsoft：多租户 issuer 模板与 token `iss` 的具体校验行为（未实测一个带具体租户的端点）。

**建议的下一步（【推断】）**

1. 定决策 A/B 后，把"预设表"这个新概念写进 `architecture.md`（预设只预填 issuer 与显示名，不改变身份语义），并新增"通用 OAuth2 Provider 类型"一节，写明它比 OIDC 类型低一档、ID 字段必须显式指定。
2. 做一个 Microsoft 多租户 issuer 的小 spike（单租户 vs `common`），确认通用 OIDC 类型能否直接接 Microsoft。
3. 若决定接 GitHub，按其上游事实（数值 `id`、`user:email` + `/user/emails`、邮箱一律忽略）确定预设字段与 scope；不要以它作为 user id 可配性的反例——恰恰要防有人把它配成 `login`。

---

## 附录 A：逐系统取证记录

> 除注明外，源码均读自 `master`/`main` 分支，日期 2026-10-09。标注"我实测"的条目由我本人用 WebFetch 复核。

### A.1 Keycloak（26.8.0 文档 / `main` 源码）

- **内置 social 12 个**：服务注册文件 `services/src/main/resources/META-INF/services/org.keycloak.broker.social.SocialIdentityProviderFactory`；文档 [Social Identity Providers](https://www.keycloak.org/docs/latest/server_admin/#social-identity-providers)。Google/GitHub/Microsoft 均在内。
- **通用协议 provider**：`org.keycloak.broker.provider.IdentityProviderFactory` 服务文件；`oidc`="OpenID Connect v1.0"、`oauth2`="OAuth v2"（[`OAuth2IdentityProviderFactory`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/broker/oauth/OAuth2IdentityProviderFactory.java)）、`saml`="SAML v2.0"，另有 `openid-connect`(Keycloak)、`spiffe`、`kubernetes` 等。
- **预设 UI**：[`IdentityProvidersSection.tsx`](https://github.com/keycloak/keycloak/blob/main/js/apps/admin-ui/src/identity-providers/IdentityProvidersSection.tsx)——首次是卡片网格（`Gallery`+`ClickableCard`，按 `groupName` 分组），已有后是表格 + 分组 `Dropdown`。分组字符串来自 [`ServerInfoAdminResource.java`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/services/resources/admin/info/ServerInfoAdminResource.java) 的 `"Social"`/`"User-defined"`。
- **"OAuth v2" 字段**：文档 [oauth2.adoc / server_admin](https://www.keycloak.org/docs/latest/server_admin/#_identity_broker_oauth)——Authorization URL、Token URL、User Info URL、Client Authentication、Client ID/Secret、Client Assertion 相关、Default Scopes、Prompt 等；claim 映射 ID/Username/Email/Name/Given/Family（默认 `sub`/`preferred_username`/`email`/`name`/…）。默认值在 `broker/oidc/OAuth2IdentityProviderConfig.java`。**不要求 discovery**（元数据导入可选）。
- **非 OIDC 身份来源**：`broker/oauth/OAuth2IdentityProvider.java`——`fetchUserProfile` 调 userinfo（要求 `application/json`），`identity.setId(getJsonProperty(userInfo, getConfig().getUserIDClaim()))`。文档："this broker assumes access tokens are opaque and that user profile information should be obtained from a separate endpoint."
- **GitHub**：`services/.../social/github/GitHubIdentityProvider.java`——`new BrokeredIdentityContext(getJsonProperty(profile,"id"))`，username=`login`；`searchEmail` 走 `/user/emails` 取 `primary`；**不检查 `verified`**；`DEFAULT_SCOPE="user:email"`。`GitHubUserAttributeMapper` 兼容 provider `github`。
- **扩展模型**：`server_development/topics/providers.adoc`——实现 `ProviderFactory`+`Provider`+`META-INF/services`，jar 放 `providers/`，**`kc.sh build`/重启**；无运行时加 IdP。

### A.2 Logto（v1.44 / `master`）

- **连接器是独立 npm 包**：目录 [`packages/connectors`](https://github.com/logto-io/logto/tree/master/packages/connectors)；npm 实查 `@logto/connector-github` 1.7.6、`-google` 1.8.7、`-azuread` 1.7.0、`-oidc` 1.7.6、`-saml` 1.3.7、**`-oauth` 1.7.9**（`-oauth2` 不存在）。
- **社交连接器清单**（`ConnectorType.Social`，逐一读 `src/index.ts`）：见 §2 列表。
- **预设 UI**：[`CreateConnectorForm/index.tsx`](https://github.com/logto-io/logto/blob/master/packages/console/src/components/CreateConnectorForm/index.tsx) 的 `ConnectorRadioGroup` 卡片；`GET api/connector-factories` 分组；标准连接器单列；社交入口过滤掉 SAML。
- **通用 oauth2**：[`connector-oauth2/src/oauth2/types.ts`](https://github.com/logto-io/logto/blob/master/packages/connectors/connector-oauth2/src/oauth2/types.ts) 的 `oauth2ConfigGuard`（`responseType`/`grantType` 固定 code；`authorizationEndpoint`/`tokenEndpoint`/`clientId`/`clientSecret` 必填；`tokenEndpointAuthMethod` 默认 `client_secret_post`）+ `src/types.ts` 的 `oauth2ConnectorConfigGuard`（`userInfoEndpoint` 必填、`profileMap`、`tokenEndpointResponseType`、`customConfig`）。`profileMapGuard` 默认 `{id:'id',email:'email',phone:'phone',name:'name',avatar:'avatar'}`，`id` 唯一必填；映射见 `src/utils.ts` 的 `userProfileMapping`（`getSafe` 支持嵌套路径）。**文档把 `tokenEndpoint` 标为选填，源码与表单均为必填（以源码为准）。**
- **OIDC 连接器不做 discovery**：需 `idTokenVerificationConfig.jwksUri`，用 `jose.createRemoteJWKSet` 校验 id_token（`connector-oidc/src/index.ts`）。
- **非 OIDC 身份来源**：`connector-oauth2/src/index.ts` 的 `_getUserInfo` 调 userinfo → profileMap → 取 `id`；无签名校验。文档只支持 Authorization Code（"for security consideration"）。
- **GitHub**：`connector-github/src/{index,constant,types}.ts`——端点写死；`id`(`z.number()`→String)；`Promise.all([/user, trySafe(/user/emails)])`；email 优先 public email，否则 `verified && primary`；默认 scope `read:user user:email`。README 与源码在默认 scope 上有出入（源码为准）。
- **扩展模型**：[`packages/core/src/utils/connectors/index.ts`](https://github.com/logto-io/logto/blob/master/packages/core/src/utils/connectors/index.ts) 的 `loadConnectorFactories` 从 `packages/core/connectors` 目录读包；`POST /api/connectors` 只在已加载工厂里查（[`routes/connector/index.ts`](https://github.com/logto-io/logto/blob/master/packages/core/src/routes/connector/index.ts)）。自定义连接器=[develop-your-connector 指南](https://docs.logto.io/logto-oss/develop-your-connector/step-by-step-guide)+`npx @logto/cli connector link`（[`link.ts`](https://github.com/logto-io/logto/blob/master/packages/cli/src/commands/connector/link.ts) 的 `fs.symlink`）+重启。`docs.logto.io/connectors/custom-connector`、`/connectors/connector-standard` 均 404（实测）。

### A.3 Casdoor（`master`）

- **Provider = DB 行**：`object/provider.go`（`Name`/`Category`/`Type`/`SubType`、`ClientId`/`ClientSecret`、`CustomAuthUrl`/`CustomTokenUrl`/`CustomUserInfoUrl`/`CustomLogoutUrl`、`Scopes`、`UserMapping map[string]string`、`IssuerUrl`、`EnablePkce` 等）。14 个 category（[provider overview](https://casdoor.ai/docs/provider/overview)）。
- **内置 OAuth 类型**：`web/src/lib/setting.tsx` 的 `getProviderTypeOptions('OAuth')`（Google/GitHub/AzureAD/AzureADB2C/MicrosoftOnline/OIDC/Custom…）。
- **预设 UI**：`web/src/pages/ProviderEditPage.tsx` 可搜索 Type 下拉；`onChangeType` 部分预填（OIDC 预填 scopes；Custom 预填 demo 端点）。
- **通用 OAuth2 = type `Custom`**（[CustomProvider 文档](https://casdoor.ai/docs/provider/oauth/CustomProvider/)）：Client ID/Secret、Auth URL、Scope、Enable PKCE、Token URL、UserInfo URL。**通用 OIDC**：`idp/oidc.go` 懒加载 discovery；前端填 Issuer + 「Request」按钮回填端点。
- **字段映射**：`idp/custom.go` 的 `mapUserInfo`——先 `UserMapping`，回退 `id`→`sub`、`username`→`preferred_username`/`name`/`sub`、`email`→`email`、`avatarUrl`→`picture`、`phone`→`phone_number`；`id` 必填。
- **GitHub**：`idp/github.go`——`strconv.Itoa(githubUserInfo.Id)`、username=`login`；email 为空才调 `/user/emails`；跳过 `!verified` 与 `users.noreply.github.com`，优先 primary；`EmailVerified = email != ""`；scope `{user:email, read:user}`。
- **扩展模型**：`idp/provider.go` 的 `GetIdProvider` 用 `switch idpInfo.Type`，default 分支查 ~50 个 Goth provider 列表，再接受 `Custom` 前缀；否则报错。新类型要写 Go 重编译。

### A.4 Authing（闭源 SaaS；docs.authing.cn）

- **身份源 = 用户池下的配置对象**（SDK `ExtIdpDto`，含 `id`/`name`/`tenantId`/`type`）。内置社会化身份源见 [social.html](https://docs.authing.cn/v2/guides/connections/social.html)；**Microsoft 不在 social 页，归"企业身份源 → Azure AD"**。
- **预设 UI**：卡片目录（选类型卡片 → 表单）；企业身份源同理。
- **通用 OAuth2**：[OAuth2.0 身份源](https://docs.authing.cn/v2/connections/oauth2/)——授权 URL、Token URL、Scope、Client ID/Secret、授权链接模版、**Code 换 Token 脚本**、**Token 换用户信息脚本**；用户 ID 字段未文档化（**未验证**）。
- **通用 OIDC**：[OIDC 企业身份源](https://docs.authing.cn/v2/guides/connections/enterprise/oidc/)——模式、Issuer URL、Client ID/Secret、回调地址；是否 discovery **未验证**。
- **SDK type 枚举**：`oidc, oauth2, saml, ldap, ad, cas, azure-ad, wechat, google, …, github, …`。
- **GitHub**：[配置文档](https://docs.authing.cn/v2/en/guides/connections/social/github/)存在；账号关联表里 GitHub 行**匹配邮箱**；ID 字段取值与邮箱 verified **未验证**。

### A.5 Zitadel（v4；`main`）

- **类型 = proto 枚举**：[`proto/zitadel/idp.proto`](https://github.com/zitadel/zitadel/blob/main/proto/zitadel/idp.proto) 的 `ProviderType`（OIDC/JWT/LDAP/OAUTH/AZURE_AD/GITHUB/GITHUB_ES/GITLAB/GITLAB_SELF_HOSTED/GOOGLE/APPLE/SAML/ZITADEL）；provider 包在 `internal/idp/providers/*`。**Okta 不是独立模板**。
- **预设 UI**：`console/.../policies/idp-settings/idp-settings.component.html` 的**卡片网格**（每模板一个 `routerLink`）；内置模板表单只问 `clientId`/`clientSecret`/`name`（`provider-google.component.html`、`provider-github.component.html`）。
- **Generic OAuth**：`provider-oauth.component.html` 字段 = `name`、`authorizationEndpoint`、`tokenEndpoint`、`userEndpoint`、`idAttribute`、`clientId`、`clientSecret`、`usePkce`；文档 [`_generic_oauth.mdx`](https://zitadel.com/docs/guides/integrate/identity-providers/introduction)、API [`AddGenericOAuthProvider`](https://zitadel.com/docs/reference/api/admin/zitadel.admin.v1.AdminService.AddGenericOAuthProvider)。
- **非 OIDC 身份来源**：`internal/idp/providers/oauth/mapper.go` 的 `UserMapper.GetID` 按 `idAttribute` 从 JSON 取；**只映射 ID**，`GetEmail()=""`、`IsEmailVerified()=false`。
- **通用 OIDC**：`internal/idp/providers/oidc/oidc.go` 的 `New(name, issuer, …)` 走 `rp.NewRelyingPartyOIDC`（【推断】内部 discovery）；文档要求填 Issuer URL。
- **GitHub**：`internal/idp/providers/github/{github,session}.go`——`strconv.Itoa(u.ID)`；`/user/emails` 取 `primary && verified`；`IsEmailVerified()` 硬编码 true；Console 模板预填 scope `['openid','profile','email']`（**不含 `user:email`**）。
- **扩展模型**：改 Go + proto + Console + 重编译；Actions v2 = 外部 HTTP target（[actions_v2](https://zitadel.com/docs/concepts/features/actions_v2)）。

### A.6 Okta（当前 OpenAPI spec）

- **类型枚举**：`okta-management-openapi-spec` 的 `dist/current/management-oneOfInheritance.yaml` 的 `type`（AMAZON、APPLE、DISCORD、FACEBOOK、**GITHUB**、GITLAB、GOOGLE、LINKEDIN、**MICROSOFT**、**OIDC**、**SAML2**…）。Google/Microsoft 是内置 type；GitHub 是内置 `GITHUB`（OAuth2，scope `user`，较新加入）。
- **没有通用 OAuth2**：枚举里无 `OAUTH2`/`OAUTH`；通用只有 `OIDC` 与 `SAML2`。
- **通用 OIDC 不是 discovery URL**：[add-an-external-idp/openidconnect](https://developer.okta.com/docs/guides/add-an-external-idp/openidconnect/main/) 让你从 well-known 文档**手动抄** Issuer/Authorize/Token/JWKS。
- **预设 UI**：help 页 JS 渲染取不到正文（**未验证**完整清单）。

### A.7 GitHub / Google / Microsoft 上游（我实测）

- `https://github.com/.well-known/openid-configuration` → **404**；GitHub 文档 "does not currently implement OpenID Connect … does not issue ID tokens"。
- `GET /user`：`id` int64（durable，"login … can change over time"）、`login`、`node_id`、`email`（可空、仅公开）。`GET /user/emails`：需 `user:email`，字段 `email`/`primary`/`verified`/`visibility`。OAuth2 端点 authorize/token + PKCE(S256) + device flow（[users](https://docs.github.com/en/rest/users/users?apiVersion=2022-11-28)、[emails](https://docs.github.com/en/rest/users/emails?apiVersion=2022-11-28)、[scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)、[authorizing](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)）。
- `https://accounts.google.com/.well-known/openid-configuration`：issuer `https://accounts.google.com`，authorization `…/o/oauth2/v2/auth`、token `https://oauth2.googleapis.com/token`、userinfo `https://openidconnect.googleapis.com/v1/userinfo`、jwks `…/oauth2/v3/certs`、`id_token_signing_alg_values_supported:["RS256"]`。
- `https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration`：issuer 模板 `https://login.microsoftonline.com/{tenantid}/v2.0`，authorization `…/common/oauth2/v2.0/authorize`、token `…/common/oauth2/v2.0/token`、jwks `…/common/discovery/v2.0/keys`、userinfo `https://graph.microsoft.com/oidc/userinfo`、RS256。
