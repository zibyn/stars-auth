# 领域术语对照：规范与同类 IdP 怎么叫这些概念

- 调研日期：2026-10-07
- 问题：本项目的领域术语（Application、API、默认 API、Permission、Role、默认 Role、Session、Identifier、Management API、接入等）是否符合 OAuth2 / OIDC 规范和同类产品的主流叫法？特别是 "API" / "默认 API" 是否应改称"资源"？
- 对照对象：GLOSSARY.md、docs/spec/rbac.md、docs/spec/consoles.md、ADR 0002 / 0007，以及代码中的表名与界面文案（`apis`、`applications.default_api`、管理端"接入"分组、"默认 API"字段）。

## 0. 怎么读这份文档

- **第 1 节是结论，第 2 节是对照表，第 3 节是建议**。第 4 节是逐条取证记录，每条事实都附一手来源（RFC 原文、OpenID 规范、官方文档、GitHub 源码）。我自己的判断标 **【推断】**；没有取到一手来源的标 **未验证**，没有用记忆补。
- 规范条文（RFC 6749 / 7519 / 8707 / 9068 / 9728、OIDC Core / Session）是我下载原文后逐字摘录的。
- 产品部分由四路并行调查完成，方式是 `gh api` 读源码加抓取官方页面。部分英文引文经网页摘要工具转述，与原文可能有个别字词出入。我亲自用 `gh api` 复核了最关键的一条，即 Logto 的"默认 API"为租户级（`resources.sql` 的唯一索引与 zh-cn 文案），结果一致。其余条目未逐条复核。

## 1. 结论速览

**已验证的事实**

1. **"API"作为资源服务器实体的名字是主流叫法之一，不是自造词。**
   - RFC 8707 原文就写 "protected resource (a.k.a. resource server, application, API, etc.)"（[§1、§2](https://www.rfc-editor.org/rfc/rfc8707#section-2)）。
   - Auth0 的实体就叫 "API"，并写明 "In the OAuth2 specification, an API maps to the Resource Server"（[Auth0 APIs](https://auth0.com/docs/get-started/apis)）。
   - Logto 叫 "API resource"，中文界面叫 "API 资源"。
   - Entra 在应用注册里用 "Expose an API"（中文版"公开 API"）。
   - 规范本身的叫法是 resource server / protected resource（[RFC 6749 §1.1](https://www.rfc-editor.org/rfc/rfc6749#section-1.1)、[RFC 9728 §1.2](https://www.rfc-editor.org/rfc/rfc9728#section-1.2)）。
2. **单独用"资源"在中文 IdP 里歧义很大，各家指的东西互不相同。**
   - Authing 的"资源"是应用内的权限对象（API 资源 / 数据资源 / UI 资源），scope 格式为 `资源标识符:资源操作`，它的 access token `aud` 并不指向"资源"。
   - Casdoor 的 "Resource"（中文"资源"）是上传文件的记录。
   - 华为云 OneAccess 的"资源"是顶层菜单，下面同时挂"应用"和"企业API"。
   - 只有 Logto 用"API 资源"表示资源服务器。阿里云 IDaaS 把资源服务器叫"服务端"，把它的标识叫"受众标识"。
3. **"默认 API"是现成的术语，但别家都放在租户（环境）级，不是按应用设置。**
   - **Logto** 的中文界面就叫"默认 API"，英文是 "Default API"，文案原话是"每个租户只能设置零个或一个默认 API"。源码用唯一索引 `resources (tenant_id) where is_default = true` 强制每个租户最多一个。
   - **Auth0** 叫 "Default Audience"，放在 Tenant Settings 里，Management API 字段是租户上的 `default_audience`，Client 对象上没有这个字段。社区里"按应用设置默认 audience"的功能请求至今仍未实现（2025-07 帖）。
   - **WorkOS** 的 Resource Indicator 可以 "Set as default"，也是环境级。
   - **规范**里的对应说法是 "default resource indicator"（[RFC 9068 §3](https://www.rfc-editor.org/rfc/rfc9068#section-3)）和 "predefined default resource value"（[RFC 8707 §2](https://www.rfc-editor.org/rfc/rfc8707#section-2)）。RFC 9068 明确说 scope 怎么映射到默认资源由实现自定（"outside the scope of this specification"）。
   - 本项目按 Application 设置默认 API，这本身合乎规范，但在调查的产品里**没有找到同名、同粒度的先例**。其他产品的做法：Okta 由客户端选用哪个 authorization server 来决定 `aud`（每个 server 只有一个 audience），Entra 由带资源前缀的 scope 推出 `aud`，Hydra 和 FusionAuth 没有默认 audience。
4. **Role 挂在 API 上有先例，不是主流。**
   - 与本项目同构的有：Entra 的 App roles 定义在应用注册（也就是 API）上，Keycloak 有 client roles（"Each client gets its own namespace"），Zitadel 的角色定义在 Project 上。
   - 角色全局的有：Auth0（"Tenant roles"）和 Logto（全局角色可以从多个 API resource 选权限）。
   - FusionAuth 把 Role 挂在 Application（client）上。
   - 这是模型差异，不是命名问题。"Role" / "角色"本身是通用叫法。
5. **"默认 Role"是通用术语。** Keycloak 叫 "Default roles"（`default-roles-{realm}`），Logto 叫"默认角色"（"Default role"），FusionAuth 用 `isDefault`，WorkOS 和 Clerk 叫 "default role"。各家都是"新用户创建时自动获得"，与本项目语义一致。
6. **Permission 的叫法分两派。**
   - 一派把 permission 等同于 OAuth scope：Auth0 写 "permissions (scopes)"，Logto 写 "'permissions' and 'scopes' refer to the same concept"，Entra 写 "these permissions are called *scopes*"。
   - 另一派不经过 scope：本项目把 Permission 放进 RFC 9068 §2.2.3.1 的 `entitlements` claim，不放进 `scope`，所以 GLOSSARY 把 "scope" 列入 _Avoid_ 与设计一致。FusionAuth 的 Entity Type permissions 进的也是独立的 `permissions` claim。
7. **其余术语与主流一致。**
   - Application：Auth0、Logto、FusionAuth、Casdoor、Zitadel、阿里云、腾讯云、Authing 都叫 Application / 应用；规范叫 client（Keycloak、Hydra 沿用）。
   - Session：OIDC Session 规范、Okta、Logto、Keycloak、Casdoor 都叫 Session / 会话；只有 Authing 叫"登录态"。
   - Identifier：Okta 叫 "Identifiers"，Auth0 有 "Identifier First"，Logto 叫"登录标识"，Clerk 叫 "user identifiers"。
   - Management API：Auth0、Logto（中文"管理 API"）、Zitadel v1、Okta 都这样叫；Keycloak 叫 "Admin REST API"，Entra 叫 "Microsoft Graph"。
8. **"接入"作为控制台分组名，在调查的中文控制台里没有先例。** Authing（应用 → 自建应用）、阿里云 IDaaS（应用 / 应用管理）、腾讯云（应用管理）都用"应用"，华为云 OneAccess 用"资源"。

**【推断】我的判断**

- **"API" 不必改成"资源"。** 它与 RFC 8707 的别称和 Auth0 / Entra 的叫法一致，而单独的"资源"在中文 IdP 里至少有三种不同含义（第 2 条）。如果想要中文名，Logto 的"API 资源"是有先例且无歧义的选择，代价是名字变长。
- **"默认 API"可以保留，但要把"按 Application"写进定义。** 熟悉 Logto / Auth0 的人会默认它是全实例只有一个。GLOSSARY 目前没有收录"默认 API"，这是比改名更该补的缺口。
- 真正值得处理的命名问题有两个，都比"API vs 资源"更实在：
  - API 的"标识"与 User 的 **Identifier** 撞词。Auth0 和 Logto 都把 API 的字段叫 "Identifier" / "API 标识符"，代码里列名也是 `apis.identifier`。
  - GLOSSARY 自身用了已列入 _Avoid_ 的"管理端 API"（见第 3 节）。

## 2. 对照表

"—"表示该产品没有对应实体；"未验证"表示没有找到一手来源。

### 2.1 英文 / 规范术语

| 概念 | 规范 | Auth0 | Okta | Entra ID | Logto | Zitadel | Keycloak | Ory Hydra | FusionAuth | Casdoor | WorkOS | **本项目** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 客户端应用 | client（RFC 6749）；Relying Party（OIDC） | Application（API 对象 `clients`） | app integration / Application | App registration（+ service principal） | Application | Application（属于 Project） | Client | OAuth 2.0 client | Application | Application | Application（Connect） | **Application** |
| 资源服务器 | resource server / protected resource | **API**（Identifier = `aud`） | Authorization Server 的 Audience | Expose an API + Application ID URI | **API resource**（API identifier） | Project（project id 进 `aud`）【推断】 | 另一个 client + Audience mapper / client scope | —（client 的 `audience` 白名单） | —（`aud` = client_id；可选 RFC 8707 resource；机器用 Entity） | —（`aud` = client_id；RFC 8707 resource 时用 resource） | Resource Indicator（环境级） | **API** |
| 默认 audience | default resource indicator（RFC 9068 §3） | Default Audience，**租户级** | 无独立设置；每个 server 一个 audience | 无；从 scope 推出，不带前缀即 Graph | **默认 API，租户级** | 默认含所有 client id 与 project id | 无；Audience Resolve 按 client role 自动加 | 未找到（未验证） | 未找到 | 无 | Set as default，**环境级** | **默认 API，按 Application** |
| 权限 | scope（RFC 6749 §3.3）；entitlements（RFC 9068） | permissions (scopes)，挂在 API 上 | scopes，挂在 server 上 | scopes（delegated）/ app roles（application） | permissions = scopes，挂在 API resource 上 | 无独立对象（未验证） | client scope / role | scope | Application roles；Entity Type permissions | Permission（Casbin 策略对象） | Permissions（slug） | **Permission**（进 `entitlements`） |
| 角色归属 | `roles` claim（RFC 9068 §2.2.3.1） | 租户级 Roles | 无（用 Groups） | App roles，挂在应用注册上 | 全局 Roles（User / M2M） | 挂在 Project 上 | realm roles / client roles | — | 挂在 Application 上 | 挂在 Organization 上 | 环境级 + 组织自定义 | **挂在 API 上** |
| 默认角色 | — | 无（要写 Action） | 无；有注册时加入的组 | 无；有 Default Access | Default role，可多个 | 未验证 | Default roles | — | `isDefault` | 未找到 | default role（`member`） | **默认 Role** |
| 会话 | Session（OIDC Session 1.0） | session（多层） | Session | Microsoft Entra session | Sessions | Session（v2 service） | Sessions | 未调查 | SSO session | Session | Sessions | **Session** |
| 登录标识 | Identifier（OIDC：唯一刻画实体的值） | identifier（Identifier First） | `login` / Identifiers | UPN | sign-in identifier（英文原文未验证） | loginname | Username | — | loginId（未验证原文） | Signin items | 未验证 | **Identifier** |
| 管理接口 | — | Auth0 Management API | Okta Admin Management API | Microsoft Graph | Management API（本身是一个 API resource） | Management API（v1）/ v2 APIs | Admin REST API | admin API（4445 端口） | APIs（API key） | Casdoor Public API | 未验证 | **Management API**（本身是一个 API） |

### 2.2 中文界面 / 文档用词

| 概念 | Logto zh-cn | Keycloak zh_Hans | Casdoor zh | Authing | 阿里云 IDaaS | 腾讯云 | 华为云 OneAccess | Entra zh-cn | **本项目** |
|---|---|---|---|---|---|---|---|---|---|
| 客户端应用 | 应用（全部应用） | 客户端 | 应用 | 应用 / 自建应用 | 应用 / M2M 应用 | 应用 | 应用 | 应用注册 | Application |
| 资源服务器 | **API 资源** | 客户端 | —（"资源"是文件） | —（"资源"是应用内权限对象） | **服务端** | 未找到 | 企业API / API产品 | **公开 API** | API |
| 其标识 | **API 标识符**（文档：资源指示器） | — | — | 资源标识符（scope 用） | **受众标识**（= `aud`） | — | 资源代码 / 权限代码 | 应用程序 ID URI | （API 的）标识字符串 |
| 默认 audience | **默认 API**（每租户 0–1 个） | — | — | 未找到 | 未找到 | 未找到 | 未找到 | — | 默认 API（每 Application 一个） |
| `aud` 的译法 | Audience（界面未译）/ 受众（文档） | — | — | 受众 | 受众 | — | — | 受众 | — |
| 权限 | 权限（scope） | — | 权限 | 操作 / 资源操作 | 权限 / 权限标识 | 未找到 | 权限 / 权限代码 | 范围 / 作用域 | Permission |
| 角色 / 默认角色 | 角色 / **默认角色** | 角色 / **默认角色** | 角色 / 未找到 | 角色 / 未找到 | 未找到 | 未找到 | 应用侧角色 / 未找到 | 应用角色 | Role / 默认 Role |
| 会话 | 会话 | 会话 | 会话 | 登录态 | 登录会话 | 未找到 | 未调查 | 未调查 | Session |
| 登录标识 | 登录标识（界面）/ 标识符（文档） | 用户名 | 登录项 | 无统一词 | 账户名 | 认证属性 / 用户名 | 未调查 | — | Identifier |
| 管理接口 | **管理 API** | — | — | 管理模块（SDK） | 管理接口（CIAM） | 身份访问控制 API | 未调查 | 未调查 | Management API |
| 控制台分组 | — | — | — | 应用 → 自建应用 → 访问授权 | 应用 | 应用管理 | 资源（含应用、企业API） | — | **接入** |

## 3. 建议（均为【推断】）

| # | 术语 | 建议 | 取舍 |
|---|---|---|---|
| 1 | **API** | **保留**。不要改成单独的"资源"。如果要给中文读者一个落地词，可以在 GLOSSARY 定义里补一句"即 OAuth 的 resource server；Logto 称 API 资源"，并把 "API 资源" 从 _Avoid_ 之外显式允许为同义说法。 | 改成"资源"：贴近 RFC 的 resource，但在中文 IdP 里与 Authing、Casdoor、华为云的"资源"冲突，还会和将来 RFC 8707 的 `resource` 参数（值是 URI）在口语上混淆。改成"API 资源"：无歧义、有 Logto 先例，但代码（`apis` 表、`/apis` 路由、界面）都要跟着改，收益只在中文可读性。 |
| 2 | **默认 API** | **保留名字，补进 GLOSSARY**，定义里写明"每个 Application 一个；即 RFC 9068 所说的 default resource indicator；请求不带 `resource` 时使用"。 | 别名"默认受众"（Auth0 Default Audience 的直译）更贴近 `aud`，但"受众"对非协议读者很陌生，而且界面已经在"默认 API"旁标注了 "access token 的 aud"。保留"默认 API"的风险是 Logto / Auth0 用户会以为它是全实例级的，靠定义消除。 |
| 3 | **API 的标识** | 给它一个固定叫法并写进 GLOSSARY，例如 **"API 标识符"**（Logto 中文）或直接写 **`aud` 值**，并避免单说"标识 / Identifier"。 | 现在 GLOSSARY 的 Identifier 专指 User 的手机号 / 邮箱 / 用户名，而 Auth0 / Logto 把 API 的字段也叫 Identifier，代码列名也是 `apis.identifier`。代码列名可以不改，只需在文档层面区分。 |
| 4 | **Management API** | 保留。修正 GLOSSARY 中**管理员**定义里的"管理端 API"，它是自己列入 _Avoid_ 的词，ADR 0007 也用了"管理端 API"。 | 无实质代价。ADR 是历史记录，可以不改，以 GLOSSARY 为准。 |
| 5 | **接入**（控制台分组） | 可以考虑改为 **"应用"**，或保留"接入"。 | 改成"应用"与 Authing、阿里云、腾讯云一致，但这个分组里还有 API，叫"应用"会让 API 显得放错了地方。"接入"不常见，但恰好能把 Application 与 API 合在一起，问题不大。我倾向不改。 |
| 6 | Application / Permission / Role / 默认 Role / Session / Identifier | 不改。 | 与规范或主流产品一致（见第 1 节第 5–7 条）。Permission 不叫 scope 是正确的，因为本项目确实没有把它放进 `scope`。 |

另有一处**不是命名**、但调查中顺带发现的规范对照：RFC 9068 §3 说请求带 `scope` 时，授权服务器 "SHOULD use it to infer the value of the default resource indicator"。本项目按 Application 固定默认 API，不从 scope 推断。由于本项目的 Permission 不走 scope，这个 SHOULD 实际上没有可依据的输入，【推断】不构成问题，但将来支持 RFC 8707 时值得在 protocol.md 里写一句。

## 4. 取证记录

### 4.1 规范

- **RFC 6749 §1.1**：四个角色是 resource owner、resource server（"The server hosting the protected resources, capable of accepting and responding to protected resource requests using access tokens."）、client（"An application making protected resource requests on behalf of the resource owner…"）和 authorization server。原文还写 "A single authorization server may issue access tokens accepted by multiple resource servers."（[RFC 6749 §1.1](https://www.rfc-editor.org/rfc/rfc6749#section-1.1)）
- **RFC 6749 §3.3**：scope 是 "a list of space-delimited, case-sensitive strings"。（[§3.3](https://www.rfc-editor.org/rfc/rfc6749#section-3.3)）
- **RFC 8707**：
  - §1："Knowing the protected resource (a.k.a. resource server, application, API, etc.) that will process the access token…"
  - §1 区分 scope 与资源："Scope is typically about what access is being requested rather than where that access will be redeemed"。
  - §2："If the client omits the "resource" parameter…, the authorization server MAY process the request with no specific resource or by using a predefined default resource value."
  - 来源：[RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)
- **RFC 9068**：
  - §2.2：`aud` REQUIRED。
  - §3："If the request does not include a "resource" parameter, the authorization server MUST use a default resource indicator in the "aud" claim. If a "scope" parameter is present in the request, the authorization server SHOULD use it to infer the value of the default resource indicator… The mechanism through which scopes are associated with default resource indicator values is outside the scope of this specification."
  - §2.2.3.1：建议使用 "groups"、"roles" 和 "entitlements"，并说 "No specific vocabulary is provided for "roles" and "entitlements"."
  - 来源：[RFC 9068](https://www.rfc-editor.org/rfc/rfc9068)
- **RFC 7519 §4.1.3**："The "aud" (audience) claim identifies the recipients that the JWT is intended for."（[RFC 7519](https://www.rfc-editor.org/rfc/rfc7519#section-4.1.3)）
- **RFC 9728 §1.2**："Resource Identifier: The protected resource's resource identifier, which is a URL that uses the https scheme…"（[RFC 9728](https://www.rfc-editor.org/rfc/rfc9728#section-1.2)）
- **OIDC Core §1.2**：
  - Relying Party = "OAuth 2.0 Client application requiring End-User Authentication and Claims from an OpenID Provider"。
  - OpenID Provider = "OAuth 2.0 Authorization Server that is capable of Authenticating the End-User…"。
  - Identifier = "Value that uniquely characterizes an Entity in a specific context."
  - 来源：[OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html#Terminology)
- **OIDC Session Management 1.0**：Session = "Continuous period of time during which an End-User accesses a Relying Party relying on the Authentication of the End-User performed by the OpenID Provider."（[Session 1.0](https://openid.net/specs/openid-connect-session-1_0.html)）
- 中文版 RFC 没有官方译本，规范术语的中文译法**未验证**。

### 4.2 Auth0

- 客户端应用叫 Application，Management API 里的对象是 `clients`。（[Applications](https://auth0.com/docs/get-started/applications)、[Management API v2](https://auth0.com/docs/api/management/v2)）
- 资源服务器叫 API："An API is an entity that represents an external resource…"，"In the OAuth2 specification, an API maps to the Resource Server."（[APIs](https://auth0.com/docs/get-started/apis)）
  - Identifier 的说明："A unique identifier for your API. This value is set upon API creation and cannot be modified afterward."（[API Settings](https://auth0.com/docs/get-started/apis/api-settings)）
  - Management API 里的对象叫 `resource-servers`。
- Audience 词条："its value contains the ID of either an application (Client ID) for an ID Token or an API (API Identifier) for an Access Token."（[Get Access Tokens](https://auth0.com/docs/secure/tokens/access-tokens/get-access-tokens)）
- Default Audience 是租户级："API identifier to use for Authorization Flows. If you enter a value, all access tokens issued by Auth0 will specify this API identifier as an audience."（[Tenant Settings](https://auth0.com/docs/get-started/tenant-settings)）
  - go-auth0 的 `management/types.go` 里只有 TenantSettings 上有 `default_audience`。
  - 按应用设置默认 audience 的社区请求见 [Default Audience for Application](https://community.auth0.com/t/default-audience-for-application/189691)（2025-07-31）。
- RFC 8707 `resource` 参数要在租户上打开 "Resource Parameter Compatibility Profile" 才支持，而且两者同时出现时以 `audience` 优先。（[Resource Param Compatibility Profile](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile)）新租户是否默认打开：**未验证**。
- RBAC：
  - Permissions 定义在 API 上；Roles 是 "Tenant roles: Apply across your entire tenant"。（[RBAC](https://auth0.com/docs/manage-users/access-control/rbac)、[Create Roles](https://auth0.com/docs/manage-users/access-control/configure-core-rbac/roles/create-roles)）
  - 打开 "Add Permissions in the Access Token" 后 token 带 `permissions` claim。（[Enable RBAC for APIs](https://auth0.com/docs/get-started/apis/enable-role-based-access-control-for-apis)）
  - "一个 Role 可以含多个 API 的权限"是【推断】，官方没有明说。
- 没有默认角色："Adding roles to sign-up is not a built-in feature"。（[Auth0 blog](https://auth0.com/blog/assign-default-role-on-sign-up-with-actions/)）
- 登录标识："Users will enter their identifier on the first screen"。（[Identifier First](https://auth0.com/docs/authenticate/login/auth0-universal-login/identifier-first)）
- 没有官方中文文档：`auth0.com/docs/zh-cn` 返回 404。

### 4.3 Okta

- 资源服务器：Authorization Server 的 Audience "should be set to the URI for the OAuth 2.0 resource server that consumes the access token"。（[Customize authz server](https://developer.okta.com/docs/guides/customize-authz-server/main/)）
  - 管理接口规范写着 "Okta currently supports only one audience"（okta-management-openapi-spec 中的 `AuthorizationServer.audiences`）。
  - "客户端靠选用哪个 server 来决定 `aud`"是【推断】。
- 权限叫 scopes（[Auth servers](https://developer.okta.com/docs/concepts/auth-servers/)）。没有应用级角色，用 Groups 和 `groups` claim（[Groups claim](https://developer.okta.com/docs/guides/customize-tokens-groups-claim/main/)）。
- 登录标识："Identifiers are attributes that a user can enter instead of their username when they sign in."（[Multiple identifiers](https://developer.okta.com/docs/guides/multiple-identifiers/main/)）
- 管理接口的规范标题是 "Okta Admin Management API"。
- 是否支持 RFC 8707：**未验证**。中文版文档：**未验证**。

### 4.4 Microsoft Entra ID

- 应用叫 App registration，即 application object，另有 service principal。（[App objects](https://learn.microsoft.com/en-us/entra/identity-platform/app-objects-and-service-principals)）
- Expose an API 与 Application ID URI："This defaults to `api://<application-client-id>`. The App ID URI acts as the prefix for the scopes"。（[Expose web APIs](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis)）
- `aud`："In v2.0 tokens, this value is always the client ID of the API."（[Access token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)）
- 没有默认 audience：
  - "if the resource identifier is omitted in the scope parameter, the resource is assumed to be Microsoft Graph"。
  - "these permissions are called *scopes*, though they're often referred to as *permissions*"。
  - 来源：[Scopes](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)
- App roles："App roles are defined on an application registration representing a service, app, or API."，token 带 `roles` claim。（[App roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps)）
- 中文版用词：应用注册、公开 API、应用程序 ID URI（也简称"应用 ID URI"）、范围 / 作用域、应用角色；`aud` 译作"受众"。（[zh-cn 公开 Web API](https://learn.microsoft.com/zh-cn/entra/identity-platform/quickstart-configure-app-expose-web-apis)、[zh-cn 访问令牌声明](https://learn.microsoft.com/zh-cn/entra/identity-platform/access-token-claims-reference)）

### 4.5 Logto

以下 GitHub 路径均在 [logto-io/logto](https://github.com/logto-io/logto) master 分支，2026-10-07 读取。

- 资源服务器叫 API resource，`aud` 用它的 indicator：
  - [`packages/schemas/tables/resources.sql`](https://github.com/logto-io/logto/blob/master/packages/schemas/tables/resources.sql)："indicator text not null, /* resource indicator also used as audience */"。
  - 文档："Ensure the `aud` (audience) matches the API resource identifier you registered"。（[API resources](https://docs.logto.io/authorization/global-api-resources)）
- **默认 API 是租户级**：
  - 同一 SQL 文件里有 `is_default boolean` 和 `create unique index resources__is_default_true on resources (tenant_id) where is_default = true`。这两处我亲自复核过。
  - [zh-cn `api-resources.ts`](https://github.com/logto-io/logto/blob/master/packages/phrases/src/locales/zh-cn/translation/admin-console/api-resources.ts)：
    - `title: 'API 资源'`
    - `api_identifier: 'API 标识符'`
    - `default_api: '默认 API'`
    - "每个租户只能设置零个或一个默认 API。当指定默认 API 时，可以在认证请求中省略资源参数。后续令牌交换将默认使用该 API 作为 Audience，从而签发JWT。"
    - 以上我亲自复核过。
  - 英文按钮的确切文案是否为 "Set as default API"：**未验证**。
- 权限即 scope："In Logto (and OAuth 2.1), 'permissions' and 'scopes' refer to the same concept."（[RBAC](https://docs.logto.io/authorization/role-based-access-control)）
  - zh-cn 文案：`permissions_tab: '权限'`。
- 角色是全局的，可以选多个 API resource 的权限，分 User / M2M 两类（`roles.sql`、`roles_scopes` 表，见上面的 RBAC 文档）。
  - 默认角色："Set this role as a default role for new users. Multiple default roles can be set."
  - zh-cn 文案：`field_is_default: '默认角色'`。
- 会话：zh-cn 文案 `title: '会话'`。登录标识：zh-cn 文案为"登录标识和身份认证设置""注册标识"。
- Management API 本身是一个 API resource，见 [`packages/schemas/src/seeds/management-api.ts`](https://github.com/logto-io/logto/blob/master/packages/schemas/src/seeds/management-api.ts)："The fixed resource indicator for Management APIs."
  - zh-cn 叫"Logto 管理 API"。

### 4.6 Zitadel

- Application 属于 Project："All applications within a project share the same roles, grants, and role assignments"。（[Projects](https://zitadel.com/docs/guides/manage/console/projects)）
- `aud`："by default all client id's and the project id are included"。（[Claims](https://zitadel.com/docs/apis/openidoauth/claims)）
  - 用 scope `urn:zitadel:iam:org:project:id:{projectid}:aud` 可以加入其他 project。（[Scopes](https://zitadel.com/docs/apis/openidoauth/scopes)）
  - "Project 充当资源服务器"是【推断】。
- 角色："Roles define the access rights of a project"；"Role Assignment now replaces what was previously referred to as User Grant or Authorization."（[Roles](https://zitadel.com/docs/guides/manage/console/roles)）
  - claim 名：`urn:zitadel:iam:org:project:roles`。
- 登录标识叫 loginname（[Users](https://zitadel.com/docs/guides/manage/console/users-overview)）。管理接口：v1 叫 Management API，新集成用 v2（[APIs](https://zitadel.com/docs/apis/introduction)）。

### 4.7 Keycloak

以下 GitHub 路径均在 [keycloak/keycloak](https://github.com/keycloak/keycloak) main 分支，`docs/documentation/server_admin/topics/` 下。

- `aud`："The claim `aud` should typically represent client ids of all services where the token is supposed to be used."
  - 有两种加法：Audience Resolve（"The client ID of each such client is then added as an audience"）和硬编码的 Audience mapper。
  - 一个资源服务即 "a client without any flows enabled… It represents an OAuth 2 Resource Server"。
  - 来源：[`clients/oidc/con-audience.adoc`](https://github.com/keycloak/keycloak/blob/main/docs/documentation/server_admin/topics/clients/oidc/con-audience.adoc)
- client roles："Client roles are namespaces dedicated to clients. Each client gets its own namespace."（[`roles-groups/con-client-roles.adoc`](https://github.com/keycloak/keycloak/blob/main/docs/documentation/server_admin/topics/roles-groups/con-client-roles.adoc)）
  - token 里分别放在 `realm_access` 和 `resource_access`。
- 默认角色："Default roles allow you to automatically assign user role mappings when any user is newly created"。（[`roles-groups/con-default-roles.adoc`](https://github.com/keycloak/keycloak/blob/main/docs/documentation/server_admin/topics/roles-groups/con-default-roles.adoc)）
  - 源码前缀：`DEFAULT_ROLES_ROLE_PREFIX = "default-roles"`。
- 管理接口叫 Admin REST API。（[REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html)）
- 中文用词见 [`messages_zh_Hans.properties`](https://github.com/keycloak/keycloak/blob/main/js/apps/admin-ui/maven-resources-community/theme/keycloak.v2/admin/messages/messages_zh_Hans.properties)：
  - `clients=客户端`、`clientScopes=客户端范围`
  - `realmRoles=领域角色`、`clientRoles=客户端角色`、`defaultRoles=默认角色`
  - `sessions=会话`、`username=用户名`

### 4.8 Ory Hydra

- 客户端叫 OAuth 2.0 client。`audience` 是 client 上的白名单："An allow-list defining the audiences this client is allowed to request tokens for."（[`client/client.go`](https://github.com/ory/hydra/blob/master/client/client.go)）
  - 请求参数 `audience` 按这个白名单校验。（[Audiences](https://www.ory.com/docs/hydra/guides/audiences)）
- 默认 audience 设置：未找到（**未验证**）。没有角色概念。
- 管理接口在 admin 端口（4445）："None of the administrative endpoints have any built-in access control."（[Production](https://www.ory.com/docs/hydra/self-hosted/production)）

### 4.9 FusionAuth

- 应用叫 Application，其 Client Id "is equal to the unique Id of the Application"。（[Applications](https://fusionauth.io/docs/get-started/core-concepts/applications)）
- `aud`："equal to the `client_id`, or, if one or more `resource` values was provided, an array containing both"。（[Tokens](https://fusionauth.io/docs/lifecycle/authenticate-users/oauth/tokens)）
  - RFC 8707 的资源白名单按应用配置：`authorizedResourceUris`。（[Applications API](https://fusionauth.io/docs/v1/tech/apis/applications)）
- 角色挂在 Application 上。默认角色用 `isDefault`："A default role is automatically assigned to a user during registration if no roles are provided."（同一 Applications API 页）
- 机器对机器场景用 Entities / Entity Type permissions。（[Entity management](https://fusionauth.io/docs/get-started/core-concepts/entity-management)）
- 登录标识 `loginId` 的原文：**未验证**。

### 4.10 Casdoor

以下 GitHub 路径均在 [casdoor/casdoor](https://github.com/casdoor/casdoor) master 分支。

- 应用叫 Application："Each application functions as an OAuth client"。（[Core concepts](https://casdoor.ai/docs/basic/core-concepts/)）
- `aud` 取值：[`object/token_jwt.go`](https://github.com/casdoor/casdoor/blob/master/object/token_jwt.go) 里写的是 `Audience: []string{application.ClientId}`，带 RFC 8707 resource 时 "Use resource as audience when provided"。
- "Resource" 是上传文件的记录（[`object/resource.go`](https://github.com/casdoor/casdoor/blob/master/object/resource.go)），不是资源服务器。
- Permission 是 Casbin 策略对象。（[Permission overview](https://casdoor.ai/docs/permission/overview/)）
- 中文用词见 [`web/src/locales/zh/data.json`](https://github.com/casdoor/casdoor/blob/master/web/src/locales/zh/data.json)：应用、权限、角色、资源、会话、提供商、组织、权限范围（Scopes）、登录项（Signin items）。

### 4.11 Clerk、WorkOS

- **Clerk**：
  - 客户端叫 OAuth application。（[How Clerk implements OAuth](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)）
  - 没有找到 API / 资源实体；OAuth access token 的 `aud` 取值**未验证**。
  - 组织级的 Default Role 是 `org:member`。（[Roles and permissions](https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions)）
  - 管理接口叫 Backend API。（[Backend overview](https://clerk.com/docs/reference/backend/overview)）
- **WorkOS**：
  - Resource Indicator 在环境级配置："Access tokens will be issued with an `aud` claim that matches the requested `resource`"。
  - 没有配置时，"a default `aud` value unique to your WorkOS Environment will be used"。
  - 可以 "Set as default"，但只对 CIMD / DCR 客户端生效。
  - 来源：[MCP](https://workos.com/docs/authkit/mcp)
  - 默认角色："Each environment is seeded with a default `member` role"。（[Roles and permissions](https://workos.com/docs/authkit/roles-and-permissions)）

### 4.12 中文厂商

- **Authing**：
  - 应用在"控制台的 应用->自建应用"。（[应用](https://docs.authing.cn/v2/concepts/application.html)）
  - "资源模块对应用内所有资源作了分类： API 资源 、 数据资源 和 UI 资源"。（[应用访问控制](https://docs.authing.cn/v2/guides/app-new/create-app/application-access-control.html)）
  - scope 格式是"资源标识符:资源操作"。（[M2M 授权](https://docs.authing.cn/v2/guides/authorization/m2m-authz.html)）
  - "token 的 受众 （aud）是 编程访问账号 Key"。（[用户授权](https://docs.authing.cn/v2/guides/authorization/user-consent-authz.html)）
  - 权限空间："当你每创建一个应用时，Authing 都会为你创建一个对应的权限空间"。（[权限空间](https://docs.authing.cn/v2/guides/access-control/data-permission/permission-space.html)）
  - 会话叫"登录态"。（[管理用户的登录态](https://docs.authing.cn/v2/guides/user/login-state.html)）
  - 有没有默认角色、文档里是否出现"管理 API"一词：**未验证**。
- **阿里云 IDaaS**：
  - "服务端 即被调用方应用或受保护资源（对应 OAuth 中的 Resource Server）"。
  - "受众标识 对应 Claim 中的 aud，表示 Access Token 的受众，即服务端的唯一标识"。
  - 以上两句来源：[M2M 应用权限管理](https://help.aliyun.com/zh/idaas/eiam/user-guide/m2m-application-inter-machine-rights-management/)
  - 应用的控制台路径："应用 > 应用管理 > 添加应用"。（[CIAM 快速入门](https://help.aliyun.com/zh/idaas/ciam/getting-started/ciam-quick-start)）
  - 会话叫"登录会话"。（[认证方式](https://help.aliyun.com/zh/idaas/eiam/user-guide/authentication-methods-1)）
  - CIAM 的管理接口："接口分为认证接口、管理接口、用户接口"。（[API 概览](https://help.aliyun.com/zh/idaas/ciam/developer-reference/api-overview)）
- **腾讯云 CIAM**：
  - 控制台分组叫"应用管理"。（[文档](https://cloud.tencent.com/document/product/1441/60374)）
  - 没有找到资源服务器、权限、角色等概念（**未验证**）。
- **华为云 OneAccess**：
  - "OneAccess支持对资源进行统一管理，包括对应用、企业API的管理"。（[资源管理](https://support.huaweicloud.com/usermanual-oneaccess/oneaccess_03_0032.html)）
  - 应用侧权限用"资源代码 / 权限代码 / 角色代码"。（[应用权限](https://support.huaweicloud.com/usermanual-oneaccess/oneaccess_03_0082.html)）
