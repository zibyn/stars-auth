# 外部身份提供者配置在管理端导航中的位置与命名（国内优先，海外参照）

- 调研日期：2026-10-09
- 问题：在统一的身份 / 认证平台里，管理员配置「外部身份提供者（Google / GitHub / 微信 / 企业 IdP）」这块界面，放在导航的第几层、叫什么名字？中文平台到底用哪个词？它和「登录方式」「短信 / 邮件通道」是合并还是拆开？它在权限模型里是不是独立权限点？有没有平台把它放进「设置」里面？
- 用途：为 #40「管理端文案、用语与引导改版」的导航分组、界面用语对照表和二期 Provider 规格提供对照材料。本项目现状：管理端分六组「概览 / 用户 / 应用 / API 资源 / 审计 / 设置」，`设置`组有三个 Tab「登录方式 / 通道 / 安全」，「Provider」按 `docs/spec/consoles.md` 放在**设置 → 登录方式**，二期启用，界面用语叫「外部登录」（见 `GLOSSARY.md`）。
- 与既有三份调研的分工：`console-ia-benchmark.md` 已覆盖顶层导航分组、创建应用流程、字段命名、依赖提示；`idp-naming.md` 已覆盖 API / 资源 / 角色等**领域对象**的命名；`auth-market-survey.md` 已覆盖各系统能力缺口。**本文不重复它们**，只补两块空白：① 外部 IdP 配置点的**导航层级 + 分组原文名 + 中文用词**；② 它在**权限模型**里的位置，以及**是否放进「设置」**。

## 0. 怎么读这份文档

- **第 1 节是结论**，直接回答五个问题；第 2–6 节逐项展开；附录是逐平台的原文与来源。
- 事实一律附一手来源 URL 与读取日期（均 2026-10-09）。**我自己的判断标【推断】；没取到一手来源的标「未验证」**；没有用记忆补。
- 中文原词照抄原文，不翻译。
- 取证方式：
  - **开源产品读源码**（`raw.githubusercontent.com` / `gh api`）：Casdoor `web/src/lib/nav.ts` + `locales/zh/data.json`；MaxKey `app-data.json` + `zh-CN.json` + `PermissionInterceptor.java`；TopIAM `console-fe/menu.ts` + `IdentityProviderController.java`；Keycloak `PageNav.tsx` + `messages_zh_Hans.properties` + `AdminRoles.java`；Logto `packages/phrases/.../zh-cn` + `Sidebar/hook.tsx`；Zitadel `zh.json` + `settings-list/settings.ts` + `cmd/defaults.yaml`。**未 pin commit SHA**，读的都是默认分支（Keycloak / Zitadel / MaxKey / TopIAM `main`，Casdoor `master`，Logto `master`），发布版可能有出入。
  - **闭源产品读官方文档**：Authing、阿里云 IDaaS、腾讯云、华为云、Auth0、Clerk、Okta、Microsoft Entra。
- **局限**：
  - 闭源产品的**真实控制台菜单**看不到，只能以官方文档叙述的路径为准；凡文档没写成"几级菜单"的，标「未验证」。
  - 部分英文/中文引文经抓取摘要工具转述，与原文可能有个别字词出入。
  - 「文档站左侧章节」不等于「控制台左侧菜单」，本文尽量标明是哪一种。

## 1. 结论速览

### Q1　外部 IdP 配置在第几层、叫什么名字？

**都在很浅的层级，没有一家把它埋到三级以下。** 分三档：

- **一级菜单**（国内商业基本都是这个形态）：
  - Authing：一级 **「身份源管理」**
  - 阿里云 IDaaS EIAM：一级 **「身份提供方」**
  - 腾讯云数字身份管控平台（员工版）：一级 **「认证管理」**；腾讯云 CIAM / OneID 也是 **「认证管理」**
  - 阿里云 IDaaS CIAM：**「认证源」**（层级未验证，疑一级）
- **一级分组下的二级项**（开源常见）：
  - Casdoor：一级分组 **「身份认证」** → 二级 **「提供商」**
  - MaxKey：一级分组 **「配置管理」** → 二级 **「社交登录」**
  - TopIAM：一级 **「认证管理」** → 二级 **「身份提供商」**（页面内文案叫「认证源」）
  - 华为云 OneAccess：一级 **「认证」** → 二级 **「认证源管理」**
  - Keycloak：一级分组 **「配置 Configure」** → 二级 **「身份供应商 / Identity providers」**（与「领域设置 Realm settings」平级）
  - Logto：一级分组 **「身份验证 authentication」** → 二级 **「连接器」**，另有并列二级 **「企业SSO」**
  - Auth0：经典导航一级 **「Authentication」** → 二级 **「Social」**、**「Enterprise」**；新导航（Early Access）改到一级 **「Integration」** 下（**「Connections」**、**「Enterprise SSO」**）
  - Clerk：一级 **「User & authentication」** → 二级 **「SSO connections」**
  - Okta：一级 **「Security」** → 二级 **「Identity Providers」**
- **放进「设置」里的二级项**（少数）：
  - Zitadel：一级 **「设置 Settings」** → 分组 **「登录和访问」** → 二级 **「身份提供者」**
  - （Entra 是**唯一的三级**：一级 **「Identity」** → 二级 **「External Identities」** → 三级 **「All identity providers」**。）

### Q2　中文平台到底用哪个词？

**没有统一，而且同一个产品内部也会混用。** 六派，谁在用（原文）见第 3 节：

| 用词 | 谁在用（原文） |
|---|---|
| **身份源**（菜单「身份源管理」） | Authing；阿里云 EIAM 的文档层级用「身份源」 |
| **身份提供方** | 阿里云 IDaaS EIAM（菜单名） |
| **身份提供者** | Zitadel（中文界面） |
| **身份提供商** | Casdoor（SAML 字段「IdP」译作「身份提供商」）；TopIAM（菜单名） |
| **身份供应商** | Keycloak 当前简体中文包（`identityProviders=身份供应商`） |
| **标识提供程序** | Microsoft Entra 中文文档（用的是「标识」不是「身份」） |
| **认证源** | 阿里云 IDaaS CIAM、腾讯云（员工版 / CIAM）、华为云 OneAccess、TopIAM 页面文案 |
| **社交登录** | MaxKey（菜单名「社交登录」）；Authing「配置社会化登录」 |
| **连接器** | Logto（菜单名「连接器」）；MaxKey 另有一个语义不同的「连接器管理」 |
| **提供商** | Casdoor（菜单名「提供商」） |
| **第三方登录** | Casdoor 用户侧命名空间（`3rd-party logins`）指已绑定的社交账号 |

**两个关键歧义（对本项目重要）：**
- **「身份源」在中文里有两层意思。** Authing 用「身份源」指**登录用的外部 IdP**；但华为云 OneAccess 和 TopIAM 把「身份源」专指**目录 / 用户同步来源**（AD、企业微信、钉钉），而把登录用的叫「认证源」。所以「身份源」不能安全地等同于本文问的那个概念。
- **国内商业 / 部分开源主流用「认证源」**（阿里 CIAM、腾讯、华为、TopIAM 页面），**「身份提供方 / 身份提供者 / 身份供应商」则是另一条线**（阿里 EIAM、Zitadel、Keycloak）。**「第三方登录 / 社交登录」只覆盖社交那部分，覆盖不了企业 IdP（SAML / OIDC）。**

### Q3　「登录方式」「外部 IdP」「短信 / 邮件通道」是合并还是拆开？

**外部 IdP 与「登录方式」几乎总是拆开；「通道」与「外部 IdP」的合并程度各家不同。** 三种形态：

1. **全合一**：Casdoor（一张「提供商」列表，按 Category 区分 OAuth / SAML / SMS / Email / Notification…）；腾讯云（员工版和 CIAM 都把账号密码 / 短信 / 邮件 / 社交统一叫「认证源」，收进「认证管理」）。腾讯是最彻底的合并。
2. **外部 IdP 与通道合一，但登录方式另立**：Logto（把社交 + 短信邮件并进同一个「连接器」页的两个 Tab，而「登录与账户」单独一项）；TopIAM（默认认证源【含密码、短信】与外部社交 / 企业认证源同一页，但邮件 / 短信服务另在「系统设置 → 消息设置」）。
3. **三块全拆**：Keycloak、Authing、阿里云 EIAM / CIAM、华为云、Zitadel、Auth0、Clerk、Okta、Entra。

**通道放在哪，两种主流：**
- **独立的「设置 / 消息 / 通知 / 通道」**：华为云（设置 → 企业配置 → 短信 / 语音 / 邮件 / 钉钉网关）、TopIAM（系统设置 → 消息设置）、Zitadel（设置 → 通知组 → SMTP 提供商 / 短信电话提供商）、Authing（品牌化 → 消息邮件和短信提醒；文档另有「设置 → 消息服务」）、Okta（Settings → Emails & SMS）、Clerk（Customization → SMS）、Auth0（顶级 **Messaging**）。
- **并入「连接器 / 认证源」**：Logto、Casdoor、腾讯云。

**【推断】规律**：通道（短信 / 邮件）比外部 IdP 更常被放进「设置 / 消息」；而外部 IdP 本身很少进「设置」。Auth0 把 Email + Phone 提到**顶级**「Messaging」是激进的一例；阿里云 EIAM 干脆**没有独立通道菜单**，短信只是「登录方式」里的一个内置项。

### Q4　是独立的权限点，还是和「实例设置」同一个权限？

**独立权限点是成熟海外平台的少数做法；国内平台公开文档里没有一家的 IdP 配置是独立权限点。**

- **有专属权限 / 角色**（3 家）：
  - **Keycloak**：`manage-identity-providers` / `view-identity-providers`（realm-management 客户端角色，与 `manage-realm` 等并列）。
  - **Auth0**：Dashboard 角色 `Editor - Connections`（覆盖 Database / Social / Enterprise / Passwordless 连接）；`Admin` 为全部。
  - **Entra**：内置角色 **`External Identity Provider Administrator`**（原文 "Can configure identity providers for use in direct federation."）。
- **中间态**（有细粒度权限码，但打包进通用角色）：
  - **Zitadel**：有 `iam.idp.read/write/delete` 与 `org.idp.*`，但打包进 `IAM_OWNER` / `IAM_OWNER_VIEWER` / `IAM_ORG_MANAGER` / `ORG_OWNER` 等通用管理员角色，没有单独的「IdP 管理员」。
  - **Okta**：无内置 IdP 角色；需自定义角色，从权限 `okta.identityProviders.read` / `okta.identityProviders.manage` 组装。
- **无独立点，靠实例 / 全局管理员**：
  - Casdoor（built-in 组织全局管理员）、MaxKey（`ROLE_ADMINISTRATORS`）、Logto（租户角色 admin / collaborator / viewer，scope `write:data`）、TopIAM（接口层只校验 `UserType.ADMIN`）。
  - 国内商业：Authing（靠「控制台菜单资源」型资源策略，文档未点名「身份源」权限点）、阿里云 IDaaS（**不支持资源级授权**，靠 RAM `AliyunYundunIdaasFullAccess` 全量）、华为云 OneAccess（超级管理员 / 普通管理员 + 华为云 IAM）、腾讯云（**未验证**）。
- **未验证**：Clerk 是否有专属 SSO 管理角色；腾讯云控制台 RBAC；TopIAM 是否有 IdP 专属权限码（权限码枚举在外部依赖里）。

**【推断】结论**：**「外部 IdP 配置与实例设置同一个权限」是国内外的主流**；把它拆成独立权限点的是 Keycloak / Auth0 / Entra 这类角色模型非常成熟的平台。国内平台（含商业化 IDaaS）在公开文档中**都没有**为它单列权限点——多数是"实例管理员 / 超级管理员能管一切"。

### Q5　有没有平台把它放在「设置」里面？（本项目规格目前放在设置的一个 Tab 里）

**有，但不是主流。** 明确放进「设置」区的只有：

- **Zitadel（最明确）**：一级**「设置」** → 分组**「登录和访问」** → **「身份提供者」**。文档原文背书："Access the settings page of your instance or the specific organization and select **Identity Providers**."（实例级 `/ui/console/instance?id=idp`，组织级 `/ui/console/org-settings?id=idp`）。
- **MaxKey（可算）**：一级**「配置管理」**（一个设置聚合区）→「社交登录」，与「LDAP配置 / 电子邮箱 / 短信服务 / 密码策略」并列。

**其余全都不在「设置」里**：国内商业是**一级菜单**（Authing 身份源管理、阿里云 身份提供方、腾讯 认证管理、华为 认证 > 认证源管理）；开源是**一级分组下的二级项**（Casdoor 身份认证 > 提供商、Keycloak 配置 > 身份供应商、Logto 身份验证 > 连接器）；海外商业也是二级（Auth0 / Clerk / Okta / Entra）。

**注意区分**：把**「通道」（短信 / 邮件）**放进「设置」很常见（华为、TopIAM、Zitadel、Authing、Okta、Clerk、Auth0）；但把**「外部 IdP 本身」**放进「设置」的很少——只有 Zitadel 和 MaxKey。本项目规格是**把外部 IdP 放进「设置 → 登录方式」**，与 Zitadel「设置 → 登录和访问」的思路同构，属于**少数派但有先例**。

## 2. 逐平台对照总表

「—」表示该平台没有对应实体或未找到；「未验证」表示没取到一手来源。

| 平台 | 一级分组 / 一级菜单（原文） | 二级 / 层级（原文） | 概念用词（原文） | 短信 / 邮件通道位置 | 在「设置」里？ | 独立权限点？ |
|---|---|---|---|---|---|---|
| **Casdoor**（开源） | **身份认证**（`general:Identity`） | **提供商**（`application:Providers`） | **提供商**；SAML 字段「IdP」译作 **身份提供商** | 同一张「提供商」列表（Category 含 `SMS`/`Email`/`Notification`） | 否 | 否（built-in 组织全局管理员 + 组织级 `navItems`） |
| **MaxKey**（开源） | **配置管理**（`mxk.menu.config`） | **社交登录**（`mxk.menu.config.socialsproviders`；静态文案写「社交服务」，i18n 覆盖为「社交登录」） | **社交登录**；另有 **连接器管理**（语义不同，指对接外部系统目录 / 账号） | 同组二级项 **电子邮箱**、**短信服务** | **是**（配置聚合区） | 否（`ROLE_ADMINISTRATORS`） |
| **TopIAM**（开源） | **认证管理**（`menu.authn`） | **身份提供商**（`menu.authn.identity_provider`；页面文案「认证源」） | 菜单 **身份提供商**；页面 **认证源**、**社交认证源 / 企业认证源**；另有独立概念 **身份源**（=目录同步来源，在账户管理 > 身份源管理） | **系统设置 → 消息设置**（邮件服务 / 短信服务） | 否（通道是） | 未验证（接口层只校验 `UserType.ADMIN`；有细粒度管理员模型但权限码在外部依赖，未验证） |
| **Authing**（商业） | **身份源管理**（一级） | — | **身份源**；「企业身份源」「社会化登录」「连接外部身份源（IdP）」 | **品牌化**（「配置消息邮件和短信提醒」）；SMS 配置文档页写控制台路径 **设置 → 消息服务** | 否（与「设置」平级） | 无独立点；归「控制台菜单资源」资源策略【推断】 |
| **阿里云 IDaaS EIAM**（商业） | **身份提供方**（一级） | 入方向 / 出方向 / 其他身份提供方 | 菜单 **身份提供方**；文档层级 / 面包屑用 **身份源**（产品内两词混用） | 无独立通道菜单；短信 = 「登录 → 通用配置 → 登录方式」里的内置「IDaaS 短信验证码登录」 | 否（与「其他设置」平级） | 无；IDaaS **不支持资源级授权**，靠 RAM `AliyunYundunIdaasFullAccess` 全量 |
| **阿里云 IDaaS CIAM**（商业） | **认证源**（层级未验证，疑一级） | 社交认证源 | **认证源**（唯一用词） | 无独立通道；短信 / 邮件 = 认证方式（验证码登录） | 否 | 无；RAM 全量（细粒度未验证） |
| **腾讯云数字身份（员工版）**（商业） | **认证管理**（一级） | 认证源类型（LDAP / 企业微信扫码 / 短信验证码 / AD） | **认证源** | 无独立通道；「短信验证码登录」本身是一种认证源 | 否 | 未验证（文档只写「管理员」） |
| **腾讯云 CIAM / OneID**（商业） | **认证管理**（层级未验证） | 通用认证源 / 社交认证源 | **认证源**（AuthSource） | 无独立通道；短信 / 邮件 OTP = 通用认证源 | 否（另有独立「个性化设置」） | 未验证 |
| **华为云 OneAccess**（商业） | **认证**（一级） | **认证源管理**（二级）→ 企业认证源 / 企业社交认证 / 个人社交认证 | **认证源**；**身份源** 另指目录导入来源（AD / 企业微信 / 钉钉 / 飞书 / LDAP） | **设置 → 企业配置 → 短信网关配置 / 语音网关配置 / 邮件网关配置 / 钉钉网关配置** | 认证源**否**；通道**是** | 无独立点；靠超级管理员「管理门户全部访问权限」/ 华为云 IAM【推断】 |
| **Keycloak**（开源） | **配置**（`configure`；另有 **管理** `manage`） | **身份供应商**（`identityProviders`，与 `realmSettings=领域设置` 平级） | **Identity providers / 身份供应商** | 无 SMS 菜单；邮件在 **领域设置 → 电子邮件** tab | 否（与领域设置平级） | **是**：`manage-identity-providers` / `view-identity-providers` |
| **Logto**（海外，有中文站） | **身份验证**（`authentication`） | **连接器**（`connectors`）；并列 **企业SSO**（`enterprise_sso`） | **连接器 Connector**（社交）；**企业单点登录**；内文用 **身份提供者** | **并入「连接器」页 tab**：`短信和邮件连接器` / `社交连接器` | 否（`租户设置` 不含连接器） | 无：租户角色 `admin`/`collaborator`/`viewer`，scope `write:data` |
| **Zitadel**（开源） | **设置**（`MENU.SETTINGS`） | 分组 **登录和访问**（`SETTINGS.GROUPS.LOGIN`）→ **身份提供者**（`SETTINGS.LIST.IDP`） | **身份提供者 / Identity Provider (IdP)** | 另一分组 **通知** → **SMTP 提供商** / **短信/电话提供商** | **是** | 无：`iam.idp.*` / `org.idp.*` 打包进 `IAM_OWNER` 等通用角色 |
| **Auth0**（海外） | 经典 **Authentication**；新导航 **Integration** | **Social** / **Enterprise**（新导航 **Connections** / **Enterprise SSO**） | **connection**（Social connections / Enterprise connections）；IdP = 来源 | 顶级 **Messaging**（`Emails` / `Phone`）；经典导航在 Branding > Email / Phone Provider | 否 | **是**：角色 `Editor - Connections`；`Admin` = 全部 |
| **Clerk**（海外） | **User & authentication** | **SSO connections** | **Enterprise SSO**；**Enterprise connections**；社交 = OAuth 子类型 | **Customization → SMS**（Settings tab）；邮件在 Customization | 否（connection 自带 Settings tab，非控制台 Settings） | 未验证（无公开的专属 SSO 角色） |
| **Okta**（海外） | **Security** | **Identity Providers** | **Identity Provider (IdP)** | 经典 **Settings → Emails & SMS**（SMS tab）；OIE **Customizations → SMS** + **Telephony providers** | 否 | 无内置；自定义角色用 `okta.identityProviders.read` / `.manage` |
| **Entra ID**（海外） | **Identity**（a.k.a. Entra ID） | **External Identities** → **All identity providers**（三级） | **Identity provider (IdP)** / **External Identities**；中文 **标识提供程序**、**外部标识提供程序管理员** | 无独立通道菜单；邮箱 OTP 本身是 External Identities 下的一个 IdP | 否 | **是**：**`External Identity Provider Administrator`** |

## 3. 中文用词分布（Q2 展开）

**用「身份源」的：**
- **Authing**：控制台一级菜单 **「身份源管理」**。原文（控制台概览，按左侧导航从上往下）：概览、应用、**身份源管理**、用户管理、权限管理、安全设置、品牌化、自动化、审计日志、设置。其下内容原文「连接企业身份源（OIDC、SAML、办公应用如钉钉、企业微信）、配置社会化登录、自定义数据库」。
- **阿里云 IDaaS EIAM**：`/user-guide/idps/` 页标题是「**身份提供方**」，但面包屑写「操作指南 / 身份资产 / **身份源**」，正文也有「**身份源** > 入方向 > 添加入方向」——**同产品两词混用**。
- **华为云 OneAccess / TopIAM**：用「**身份源**」，但指的是**目录 / 用户同步来源**，不是登录 IdP。华为概念文档把「身份源」（从 AD / 企业微信 / 钉钉 / 飞书 / LDAP 导入用户和组织）与「认证源 / 认证提供方」并列为两个概念；TopIAM 术语页原文「TOPIAM 支持企业从多种系统导入用户和机构信息……这些系统就称为身份源」。

**用「身份提供方 / 身份提供者 / 身份提供商 / 身份供应商」的：**
- **阿里云 EIAM**：菜单 **身份提供方**。
- **Zitadel**：中文界面 **身份提供者**（`SETTINGS.LIST.IDP`）。
- **Casdoor**：主菜单叫 **提供商**；`IdP` 字段译作 **身份提供商**。
- **TopIAM**：菜单 **身份提供商**（页面按钮却叫「认证源」）。
- **Keycloak**：当前简体中文包 `identityProviders=身份供应商`（社区构建 `messages_zh_Hans.properties`；我 2026-10-09 亲自复核过这一行，同文件 `manage=管理`、`configure=配置`）。**注意**：网上常见的「身份提供程序」在当前这份简体资源里**未出现**，是否在别的构建 / 旧文档里使用**未验证**。

**用「标识提供程序」的：**
- **Microsoft Entra**：中文文档用 **标识提供程序**（用「标识」而非「身份」），角色名 **外部标识提供程序管理员**，程序名 **外部 ID**。

**用「认证源」的（国内商业 / 部分开源主用）：**
- **阿里云 IDaaS CIAM**：原文「管理员在**认证源**中添加社交认证源」。
- **腾讯云数字身份（员工版）**：一级菜单 **「认证管理」**，认证源类型 LDAP / 企业微信扫码登录 / 短信验证码登录 / AD。
- **腾讯云 CIAM / OneID**：**认证源**（AuthSource），分「通用认证源」（自建账号密码、短信、邮件）与「社交认证源」（支付宝、QQ、微信）。
- **华为云 OneAccess**：一级 **「认证」** → 二级 **「认证源管理」**，下分企业认证源 / 企业社交认证 / 个人社交认证。
- **TopIAM**：页面文案「添加认证源」「认证源名称」「确定要删除认证源吗？」。

**用「社交登录 / 第三方登录 / 连接器 / 提供商」的：**
- **MaxKey**：二级菜单 **「社交登录」**（静态文案写「社交服务」，i18n 覆盖为「社交登录」）。
- **Authing**：把社交那部分叫「**配置社会化登录**」。
- **Casdoor**：用户侧命名空间 `3rd-party logins` 译作 **第三方登录**（指用户已绑定的社交登录）；主菜单用 **提供商**。
- **Logto**：主菜单 **「连接器」**，页内 tab **「社交连接器」** / **「短信和邮件连接器」**。
- **MaxKey** 另有 **「连接器管理」**（connectors），但它指对接外部系统目录 / 账号，是另一能力，**不要和 Logto 的 Connector 混为一谈**。

**【推断】** 如果本项目只想在界面选一个词，可选集合是：偏开发者的「**身份提供者 / 身份提供商**」（Zitadel / Casdoor / TopIAM），偏国内 CIAM 习惯的「**认证源**」（腾讯 / 华为 / 阿里 CIAM），或沿用本项目的「**外部登录**」（无先例，但语义只覆盖"外部"，覆盖不了企业 IdP 之外的通道，需在文案里说明）。

## 4. 登录方式 / 外部 IdP / 通道 的合并与拆分（Q3 展开）

| 平台 | (a) 登录方式 / 认证 | (b) 外部 IdP | (c) 短信 / 邮件通道 | 形态 |
|---|---|---|---|---|
| Casdoor | 应用级「登录方式」单独在应用配置里 | 提供商列表 | 同一提供商列表（Category） | **b+c 合一，a 另立** |
| MaxKey | 无独立「登录方式」菜单（登录页固定项） | 配置管理 > 社交登录 | 配置管理 > 电子邮箱 / 短信服务 | **三者同一级分组，拆不同二级项** |
| TopIAM | 与外部认证源同页（默认认证源含密码 / 短信） | 认证管理 > 身份提供商 | 系统设置 > 消息设置 | **a+b 合一，c 拆到设置** |
| Authing | 应用里「配置登录方式」 | 身份源管理 | 品牌化（消息邮件和短信提醒）/ 设置 > 消息服务 | **全拆** |
| 阿里云 EIAM | 登录 > 通用配置 > 登录方式 | 身份提供方 | 无独立通道；短信是内置登录方式 | **拆，且通道并入登录方式** |
| 阿里云 CIAM | 应用 > 注册登录设置 / 登录方式 | 认证源 | 无独立通道；短信 / 邮件 = 认证方式 | **拆，通道并入登录方式** |
| 腾讯云 员工版 | 认证源类型（账号 / 短信 / AD / 企微） | 认证管理 > 认证源 | 「短信验证码登录」是一种认证源 | **a+b+c 全合一** |
| 腾讯云 CIAM | 通用认证源（账号密码 / 短信 / 邮件） | 认证管理 > 社交认证源 | 通用认证源 | **a+b+c 全合一** |
| 华为云 OneAccess | 资源 > 应用 > 认证集成 | 认证 > 认证源管理 | 设置 > 企业配置（短信 / 语音 / 邮件 / 钉钉网关） | **全拆，通道在设置** |
| Keycloak | 配置 > Authentication | 配置 > Identity providers | 领域设置 > 电子邮件 tab（无 SMS） | **a、b 同组平级，c 在领域设置** |
| Logto | 身份验证 > 登录与账户 | 身份验证 > 连接器 / 企业SSO | 连接器页 tab（短信和邮件连接器） | **b+c 合一，a 另立** |
| Zitadel | 设置 > 登录和访问 > 登录行为和安全 | 设置 > 登录和访问 > 身份提供者 | 设置 > 通知 > SMTP / 短信提供商 | **a、b 同组，c 换组** |
| Auth0 | Authentication（MFA / Passwordless） | Authentication > Social / Enterprise | 顶级 Messaging | **全拆，通道提为顶级** |
| Clerk | User & authentication | SSO connections | Customization > SMS | **全拆** |
| Okta | Security > Authenticators | Security > Identity Providers | Settings > Emails & SMS | **全拆** |
| Entra | Authentication methods > Policies | External Identities > All identity providers | 无独立通道菜单 | **全拆** |

**三条规律【推断】：**
1. **外部 IdP 与「登录方式」几乎总是两个入口**（例外：腾讯云把它统一叫「认证源」收在一处，TopIAM 默认 + 外部认证源同页）。
2. **通道比 IdP 更常被放进「设置 / 消息 / 通知」**：华为、TopIAM、Zitadel、Authing、Okta、Clerk、Auth0 都是。少数（Logto、Casdoor、腾讯）把通道和社交并进一个「连接器 / 认证源」里。
3. **没有一家把"通道"单独提成一级菜单**；最"重"的是 Auth0 的顶级「Messaging」（Email + Phone 合并）。

## 5. 权限模型（Q4 展开）

- **Keycloak**：realm-management 客户端上的 realm 角色 **`view-identity-providers` / `manage-identity-providers`**（`server-spi-private/.../AdminRoles.java`），文档 `server_admin/#per-realm-admin-permissions` 与 `manage-realm`、`view-realm` 等并列。「配置 Configure」分组由 `hasSomeAccess("view-realm","query-clients","view-identity-providers")` 控制。
- **Auth0**：Dashboard 角色 **`Editor - Connections`** 覆盖"all types of connections"；**`Admin`** 为全权。（[feature-access-by-role](https://auth0.com/docs/get-started/manage-dashboard-access/feature-access-by-role)）
- **Entra**：内置角色 **`External Identity Provider Administrator`**（"Can configure identity providers for use in direct federation."，模板 ID `be2f45a1-457d-42af-a067-6ec1fa63bc45`）；认证方式另有 `Authentication Policy Administrator`。
- **Okta**：标准角色为 Super / Organization / Application / Group / Help Desk / Read-only Administrator 等，**无内置 IdP 角色**；细粒度用自定义角色 + 权限 `okta.identityProviders.read` / `okta.identityProviders.manage`，绑定到资源集 `orn:{partition}:idp:{orgId}:identity_provider`。
- **Zitadel**：细粒度 `iam.idp.read/write/delete`（实例）与 `org.idp.read/write/delete`（组织），**打包进通用角色** `IAM_OWNER`、`IAM_OWNER_VIEWER`、`IAM_ORG_MANAGER`、`ORG_OWNER`；`settings.ts` 的 `IDP.requiredRoles` 用 `policy.read` / `org.idp.read`。
- **Logto**：租户成员角色 `admin` / `collaborator` / `viewer`，scope 含 `read:data` / `write:data` / `manage:tenant`；管理连接器属 `write:data`，**无** `connectors.*` 专属权限。
- **Casdoor**：无 IdP 专属权限；`isAdminUser` 判 `account.owner === "built-in"`，菜单可见性由组织级 `navItems` 过滤；Permission（Casbin 策略）服务于被接入应用。
- **MaxKey**：控制台需 `ROLE_ADMINISTRATORS`（`PermissionInterceptor.java`）；RBAC 针对被接入应用，非后台菜单。
- **TopIAM**：各接口方法用 `@PreAuthorize("...hasAuthority(UserType.ADMIN)")`；有细粒度管理员权限模型，但**是否含 IdP 专属权限码未验证**。
- **Authing**：管理员权限文档用「超级管理员 / 应用管理员 / 自定义管理员角色」，资源策略分「控制台菜单资源 / API、SDK 资源」；**未出现「身份源」权限点**，【推断】由「控制台菜单资源」覆盖。
- **阿里云 IDaaS**：RAM 系统策略 **`AliyunYundunIdaasFullAccess`**；**不支持资源级授权**——"必须对该服务中的所有资源授予权限"。**无 IdP 独立权限点**。
- **华为云 OneAccess**：管理员分企业管理员 / 超级管理员（管理门户全部访问权限）/ 普通管理员（部分菜单权限）/ 系统管理员；实例级另受华为云 IAM（用户组 + 策略 / 角色）约束。**未发现「认证源管理」独立 IAM 权限**。【推断】由超级管理员或普通管理员菜单权限覆盖。
- **腾讯云**：员工版文档只写"管理员"，CIAM 文档未给控制台 RBAC；**未验证**。

## 6. 谁把 IdP 放进「设置」（Q5 展开）

**放进「设置」的：**
- **Zitadel**：设置 → **登录和访问** → 身份提供者（实例 / 组织两处）。文档：`_idps_overview.mdx` "Access the settings page of your instance or the specific organization and select **Identity Providers**."；同页另有 "Access the **Login Behavior and Security** section…"。
- **MaxKey**：配置管理 → 社交登录（「配置管理」是包含 LDAP / 邮箱 / 短信 / 密码策略的设置聚合区）。

**不放进「设置」的（其余全部）：** 见第 2 节总表。要点是——**国内商业一律把外部 IdP 做成一级菜单**；开源多做成一级分组下的二级项；海外商业做成二级项（Entra 是三级）。

**把「通道」放进「设置」的**（与 Q5 相关但不同）：华为云（设置 > 企业配置）、TopIAM（系统设置 > 消息设置）、Zitadel（设置 > 通知）、Authing（品牌化；文档另有设置 > 消息服务）、Okta（Settings > Emails & SMS）、Clerk（Customization > SMS）、Auth0（顶级 Messaging）。

## 7. 【推断】对本项目的启示

**本项目规格**：单实例、单用户池、六组导航；Provider（界面用语「外部登录」）放在 **设置 → 登录方式** 这个 Tab 里，二期启用。

1. **第几层？** 本项目把 Provider 放在「设置 → 登录方式」是**二级项**，与 Zitadel「设置 → 登录和访问 → 身份提供者」同构。对照下来它**不是三级深埋**，层级本身没问题；问题在于**分组**。
2. **是不是逆流？** 把**外部 IdP 本身**放进「设置」的**只有 Zitadel 和 MaxKey 两家**，属少数派。**主流（尤其国内商业）把外部 IdP 做成一级菜单或一级分组下的二级项**。所以本项目的做法**不是孤例，但确实逆着国内商业的主流**。
3. **和本项目最接近的先例是 Zitadel**：它把「登录行为和安全」与「身份提供者」并成**同一个分组「登录和访问」**，把 SMTP / SMS 放到**另一个分组「通知」**。本项目的「设置 → 登录方式 / 通道」几乎就是这套结构的中文翻版——可以据此说明本项目规格有据可依。
4. **命名风险**：本项目 GLOSSARY 界面用语是「**外部登录**」，并把 IdP / 第三方登录 / 社交登录列入 _Avoid_。对照中文用词，「外部登录」**没有先例**；最接近的国内用词是「**认证源**」（腾讯 / 华为 / 阿里 CIAM）和「**身份源**」（Authing）。
   - `console-ia-benchmark.md` 已建议把「通道」从「安全」组挪出，并给了两个方案（安全组内拆页 / 另设「登录」组）。本文的补充证据是：国内商业普遍把外部 IdP 当**一级入口**，因此**若二期要上 Provider，值得重新评估它是留在「设置」里，还是提到「登录方式」同级的独立入口**（例如在设置里做「登录方式 / 外部登录 / 通道」三个相邻页签，或另设「登录」组）。
   - 如果保留在「设置」内，界面用语「外部登录」需要一句说明覆盖"企业 IdP（SAML / OIDC）"和"社交登录"两类，避免读者以为只有社交。
5. **权限**：本项目用 `config:read` / `config:write` 管设置组。对照第 5 节——**「外部 IdP 与实例设置同权限」正是国内外主流**（Keycloak / Auth0 / Entra 那种独立权限点是少数）。所以把 Provider 归在 `config` 权限下**与主流一致**，不构成问题；若将来要给"只能管身份源、不能改其余设置"的角色，再考虑拆权限点。
6. **通道位置**：本项目把「通道」和「登录方式」都放在「设置」里。对照显示"通道放设置"很常见（华为 / TopIAM / Zitadel / Authing / Okta / Clerk / Auth0），**这一点比"IdP 放设置"更站得住**。

## 附录 A：逐平台原文与来源

（来源前缀为读取日期 2026-10-09。）

**Casdoor**（`casdoor/casdoor@master`）
- 侧栏结构 `web/src/lib/nav.ts`：一级分组 `general:Home` / `general:User Management` / `general:Identity`(→`/identity`) / `general:Authorization` / `general:LLM AI` / `general:Auditing` / `general:Business` / `general:Admin`；`/identity` 下子项 `/applications`(general:Applications)、`/providers`(application:Providers)、`/resources`、`/certs`、`/keys`。
- 文案 `web/src/locales/zh/data.json`：`general.Identity="身份认证"`、`application.Providers="提供商"`、`"IdP":"身份提供商"`、`user` 命名空间 `"3rd-party logins":"第三方登录"`、`application` 命名空间 `"Signin methods":"登录方式"`。
- `web/src/pages/ProviderEditPage.tsx` 分类枚举：`Audit, Captcha, Email, Face ID, ID Verification, Log, MFA, Notification, OAuth, Payment, SAML, Scan, SMS, Storage`。
- 权限 `web/src/lib/setting.tsx`：`isAdminUser(account) → account.owner === "built-in"`；`data.json` 原文「"built-in"组织中的所有用户均为Casdoor的全局管理员」。文档 https://casdoor.ai/docs/permission/overview/ 。

**MaxKey**（`dromara/MaxKey@main`）
- 菜单树 `maxkey-web-mgt-ng/src/assets/app-data.json`；i18n `.../src/assets/i18n/zh-CN.json`。一级 `mxk.menu.config="配置管理"`；二级含 机构配置、账号管理、同步器管理、连接器管理、**社交登录**（路由 `/config/socialsproviders`，静态文案「社交服务」被 i18n 覆盖）、LDAP配置、电子邮箱、短信服务、密码策略。
- 权限 `PermissionInterceptor.java`：`if (this.mgmt && !principal.isRoleAdministrators())`；角色常量 `ROLE_ADMINISTRATORS` 等（`ConstsRoles.java`）。

**TopIAM**（`topiam/eiam@master`；官网 topiam.cn）
- `console-fe/src/locales/zh-CN/menu.ts`：`menu.authn="认证管理"`、`menu.authn.identity_provider="身份提供商"`。
- `pages/authn/IdentityProvider/locales/zh-CN.ts`：`header_title='提供商列表'`、`add_button='添加认证源'`、`metas_title='认证源名称'`、页面描述《系统默认的认证源为用户密码和短信快捷认证，您还可添加钉钉、微信、企业微信、QQ等作为认证源。》；分类 **社交认证源 / 企业认证源**（`IdentityProviderCategory`）。
- 另有一级「账户管理」→「身份源管理」（`eiam-identity-source`，目录同步）；`pages/setting/Message/locales/zh-CN.ts`《消息服务设置包括邮件服务配置和短信服务配置…》。
- 权限 `controller/authn/IdentityProviderController.java`：`@PreAuthorize("authenticated and @sae.hasAuthority(T(...UserType).ADMIN)")`。
- 术语 https://topiam.cn/docs/overview/terminology/ 。

**Authing**
- 控制台导航 https://docs.authing.cn/v2/guides/basics/console/ （页末更新时间 2026-03-25）：一级菜单原文「概览、应用、**身份源管理**、用户管理、权限管理、安全设置、品牌化、自动化、审计日志、设置」；品牌化项原文「配置消息邮件和短信提醒。」。**「设置」项不含消息服务**（原文为：用户池基础信息设置、费用管理、扩展字段、环境变量、协作管理员）。
- 短信配置 https://docs.authing.cn/v2/guides/userpool-config/sms/ ：控制台路径「**设置→消息服务**」；文档站章节在 使用指南 → 品牌化 → 消息设置。
- 管理员权限 https://docs.authing.cn/v2/guides/userpool-config/new-collaboration-adminstrator.html ：资源类型只有「控制台菜单资源 / API、SDK 资源」。

**阿里云 IDaaS**
- EIAM 操作指南索引 https://help.aliyun.com/zh/idaas/eiam/user-guide/ ：同层章节含「**身份提供方**、账户、应用、…、登录、…、其他设置、实例管理…」。
- 绑定 OIDC 身份提供方 https://help.aliyun.com/zh/idaas/eiam/user-guide/bind-oidc-identity-provider ；绑定 SAML https://help.aliyun.com/zh/idaas/eiam/user-guide/bind-saml-identity-provider/ （正文写「身份源 > 入方向 > 添加入方向」）；身份提供方页 https://help.aliyun.com/zh/idaas/eiam/user-guide/idps/ （标题「身份提供方」，面包屑「身份源」）；登录通用配置 https://help.aliyun.com/zh/idaas/eiam/user-guide/common-configuration （登录方式含「IDaaS 短信验证码登录」）。
- RAM：https://error-center.alibabacloud.com/document/Eiam/change/ram （策略 `AliyunYundunIdaasFullAccess`；不支持 Resource 级）。
- CIAM：https://help.aliyun.com/zh/idaas/ciam/user-guide/social-media （「管理员在**认证源**中添加社交认证源」）；https://www.alibabacloud.com/help/zh/idaas/ciam/getting-started/ciam-quick-start （「应用 > 应用管理 > 添加应用」「设置 > 其他设置 > 添加管理员」）。

**腾讯云**
- 数字身份管控平台（员工版）认证管理 https://cloud.tencent.com/document/product/1442/55070 ：一级菜单「认证管理」，认证源 LDAP / 企业微信扫码登录 / 短信验证码登录 / AD。
- CIAM / OneID：https://cloud.tencent.com/document/product/1441/75533 、https://www.tencentcloud.com/zh/document/product/1148/51472 （「认证管理 → 通用认证源 → 创建认证源」；通用认证源含账号密码 / 短信 / 邮件，社交认证源含支付宝 / QQ / 微信）。

**华为云 OneAccess**
- 认证源管理 https://support.huaweicloud.com/intl/zh-cn/usermanual-oneaccess/oneaccess_03_0042.html ：「在导航栏中，选择「**认证 > 认证源管理**」」。
- 短信 / 邮件 / 语音 / 钉钉网关：「导航栏选择「**设置 > 企业配置**」」。
- 概念 https://support.huaweicloud.com/intl/en-us/productdesc-oneaccess/oneaccess_01_0003.html （「身份源」= 目录导入来源，与「认证源」并列）。

**Keycloak**（`keycloak/keycloak@main`）
- `js/apps/admin-ui/src/PageNav.tsx`：一级分组 `manage`/`configure`（master realm 另有 `manageRealms`）；`configure` 组含 realmSettings / authentication / **identityProviders** / userFederation / workflows。
- `js/apps/admin-ui/maven-resources-community/theme/keycloak.v2/admin/messages/messages_zh_Hans.properties`：`identityProviders=身份供应商`、`identityProvider=身份供应商`、`manage=管理`、`configure=配置`（**我 2026-10-09 亲自复核过前两行**）。
- 权限 `server-spi-private/.../AdminRoles.java`：`VIEW_IDENTITY_PROVIDERS="view-identity-providers"`、`MANAGE_IDENTITY_PROVIDERS="manage-identity-providers"`；文档 `server_admin/#per-realm-admin-permissions`。

**Logto**（`logto-io/logto@master`）
- `packages/console/src/containers/ConsoleContent/Sidebar/hook.tsx`；zh-cn `tabs.ts` / `tab-sections.ts` / `connectors.ts` / `enterprise-sso.ts`。section「身份验证 authentication」下含 全部应用 / 登录与账户 / 多因素认证 / **连接器** / **企业SSO** / 安全。
- `connectors.ts`：`page_title='连接器'`、`tab_social='社交连接器'`、`tab_email_sms='短信和邮件连接器'`；`enterprise-sso.ts`：`title='企业单点登录'`、`subtitle='连接企业身份提供者并启用单点登录。'`。
- 权限 `packages/schemas/src/types/tenant-organization.ts`：`TenantRole{Admin,Collaborator,Viewer}` + `TenantScope`（`write:data` 等）。

**Zitadel**（`zitadel/zitadel@main`）
- 顶层 `console/src/app/modules/nav/nav.component.html`（`MENU.*`：DASHBOARD=首页、ORGANIZATION=组织、PROJECT=项目、HUMANUSERS=用户、GRANTS=角色分配、ACTIONS=认证流程、**SETTINGS=设置**）；设置项 `console/src/app/modules/settings-list/settings.ts`（`SETTINGS.LIST.IDP`→`groupI18nKey=SETTINGS.GROUPS.LOGIN`）。
- `console/src/assets/i18n/zh.json`：`SETTINGS=设置`、`SETTINGS.GROUPS.LOGIN=登录和访问`、`SETTINGS.GROUPS.NOTIFICATIONS=通知`、`SETTINGS.LIST.IDP=身份提供者`、`SMTP_PROVIDER=SMTP 提供商`、`SMS_PROVIDER=短信/电话提供商`、`LOGIN=登录行为和安全`。
- 角色 `cmd/defaults.yaml`（`RolePermissionMappings`：`IAM_OWNER` / `IAM_OWNER_VIEWER` / `IAM_ORG_MANAGER` / `ORG_OWNER` 含 `iam.idp.*` / `org.idp.*`）。
- 文档 `apps/docs/content/guides/integrate/identity-providers/introduction.mdx`、`_idps_overview.mdx`；另见 https://zitadel.com/docs/guides/manage/console/default-settings （Default Settings 含 Identity Providers，SMTP/SMS 在 Notification 下）。

**Auth0**
- 新导航 https://auth0.com/docs/get-started/auth0-overview/dashboard/use-dashboard-navigation （顶级 Primary / Integration / Customization / Messaging / Automation & Extensibility / Security & Monitoring；Integration 下 `Connections: Manage social connections`、`Enterprise SSO`）。
- 社交 / 企业：https://auth0.com/docs/authenticate/identity-providers/social-identity-providers 、https://auth0.com/docs/authenticate/identity-providers/enterprise-identity-providers/saml （经典导航 “Dashboard > Authentication > Social / Enterprise”）。
- 角色 https://auth0.com/docs/get-started/manage-dashboard-access/feature-access-by-role ：`Editor - Connections`、`Admin`。

**Clerk**
- https://clerk.com/docs/authentication/configuration/sign-up-sign-in-options 、https://clerk.com/docs/authentication/enterprise-connections/overview ：侧栏 `User & authentication` → 页面 `SSO connections`（`dashboard.clerk.com/~/user-authentication/sso-connections`）；`Add connection` → `For all users`。
- SMS 在 `~/customization/sms`。

**Okta**
- https://developer.okta.com/docs/guides/social-login/yahoojp/main/ ：“In the Admin Console, go to **Security > Identity Providers**.”
- https://developer.okta.com/docs/concepts/identity-providers/ ；角色 https://help.okta.com/en-us/content/topics/security/administrators-admin-comparison.htm ；权限 https://developer.okta.com/docs/api/openapi/okta-management/guides/permissions （`okta.identityProviders.read/manage`）。

**Microsoft Entra**
- 导航 https://learn.microsoft.com/en-us/entra/external-id/google-federation ：“**Identity > External Identities > All identity providers**”。
- 角色 https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference ：`External Identity Provider Administrator`（"Can configure identity providers for use in direct federation."）。
- 中文 https://learn.microsoft.com/zh-cn/entra/external-id/identity-providers ：**标识提供程序**、**外部标识提供程序管理员**、**外部 ID**。

## 未验证汇总

- **Keycloak**：当前简体中文包里用「身份供应商」；网上常见的「身份提供程序」是否仍在别的构建 / 旧文档中出现，**未验证**。另有社区构建与打包两份 zh 资源，本文依据 `main` 的 `maven-resources-community`。
- **腾讯云 CIAM / OneID**：控制台左侧导航的确切一级 / 二级层级**未验证**（直接抓控制台指南失败）。
- **阿里云 EIAM**：「身份提供方」下「入方向 / 出方向 / 其他身份提供方」的确切菜单层级**未验证**（正文与面包屑用词不一致）。
- **阿里云 CIAM**：「认证源」的层级（疑一级）**未验证**。
- **Clerk**：是否有专属 SSO / IdP 管理角色**未验证**；`For specific domains`（SAML 路径）标签**未验证**；Customization 下邮件配置的确切标签**未验证**。
- **Okta**：当前 Email / SMS 菜单的确切字符串（经典 vs OIE）来自检索摘要，**未验证**。
- **Entra**：「External Identities」中文**菜单**标签**未验证**（中文页可见的是概念词「标识提供程序 / 外部 ID」，未见菜单原词）；外部租户（CIAM）的 IdP 导航路径**未验证**。
- **Auth0**：经典导航 `Branding > Email Provider / Phone Provider` 的确切字符串来自二手来源，**未验证**。
- **四家国内商业 + TopIAM**：是否存在针对「外部 IdP 配置」的**独立** RBAC 权限点，均只找到实例级 / 全量权限，未见按功能点拆分的策略项 → **均未验证**。
- 所有开源结论对应**默认分支快照**（未 pin commit），发布版可能有出入。
