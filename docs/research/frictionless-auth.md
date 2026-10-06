# 调研：「凭证优先、无注册表单」的身份模型是否可作为默认登录方式

- 调研日期：2026-10-06
- 问题：对面向消费者的 App 与微信小程序（尤其中国大陆），"不走注册/登录表单，直接凭用户持有的凭证认证"（Happy 式）能否作为默认登录？auth 系统需要为此提供什么能力？
- 标注约定：**[已验证]** = 本次调研读到了一手来源（源码、官方文档、法规原文）；其中标 "(摘要)" 或注明"经摘要工具转述"的，事实来自该页面但引文措辞未逐字复核；§1 为直接阅读源码；**[未验证]** = 未能从一手来源确认，仅供参考；**[推断]** = 基于已验证事实的分析结论，不是事实。

## 0. 结论速览

见文末 [§6 建议](#6-建议)。一句话：**"无表单"可行，"无标识符（纯密钥）"不可行**。大陆消费级场景里，"凭证"应当是平台已经替用户持有的东西（微信 openid、SIM 卡本机号码、系统 passkey），而不是 App 自己生成、让用户自己保管的密钥。

## 1. "Happy Code" 指什么，它的认证模型是什么

**名称歧义**：没有名为 "Happy Code" 的知名认证产品。最吻合描述的是 **Happy / Happy Coder**（`slopus/happy`，<https://happy.engineering>，Claude Code / Codex 的移动端与 Web 客户端）。以下按此理解，全部结论来自其源码（commit [`3d809c7`](https://github.com/slopus/happy/tree/3d809c7d8cc919922ef9346c3575d35d4a7d23b3)，2026-10-05）。若 owner 指的是别的产品，本节需重做。

### 1.1 身份如何创建 [已验证]

- App 首屏 "Create account" 只做一件事：本地生成 32 字节随机数作为 secret，然后直接调用登录接口。没有任何表单字段。见 [`happy-app/sources/app/(app)/index.tsx`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-app/sources/app/(app)/index.tsx) 的 `createAccount`：`getRandomBytesAsync(32)` → `authGetToken(secret)` → `auth.login(token, secret)`。
- 登录 = 用 secret 作为 seed 派生 Ed25519 密钥对，对一个 32 字节 challenge 签名，把 `{publicKey, challenge, signature}` POST 到 `/v1/auth`。见 [`authChallenge.ts`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-app/sources/auth/authChallenge.ts)、[`authGetToken.ts`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-app/sources/auth/authGetToken.ts)。
- 服务端验签后按公钥 `upsert` 账号并签发 bearer token —— **注册与登录是同一个接口**，"账号"就是"第一次见到的公钥"。见 [`happy-server/.../authRoutes.ts`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-server/sources/app/api/routes/authRoutes.ts)（`db.account.upsert({ where: { publicKey } , create: { publicKey } })`）。
- 值得注意的实现细节：challenge 是**客户端自己生成**的随机数，不是服务端下发的（请求体里同时带 `challenge` 与 `signature`，服务端只做 `tweetnacl.sign.detached.verify`）。[推断] 这意味着该签名本身没有服务端 nonce 防重放，安全性依赖 TLS；自建系统若借鉴此模型，应改为服务端下发 challenge（WebAuthn 的做法）。

### 1.2 凭证是什么、存在哪 [已验证]

- 凭证 = 那 32 字节 secret（同时也是端到端加密的根密钥，见 [`docs/encryption.md`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/docs/encryption.md)）。
- 原生端存 `expo-secure-store`（iOS Keychain / Android Keystore 封装），Web 端存 `localStorage`。见 [`tokenStorage.ts`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-app/sources/auth/tokenStorage.ts)。

### 1.3 设备如何关联 [已验证]

- 新设备生成一次性 X25519（`crypto_box`）密钥对，把公钥 POST 到 `/v1/auth/account/request` 并以二维码展示；已登录设备扫码后，用新设备公钥加密**账号 secret 本身**，POST 到 `/v1/auth/account/response`；新设备每秒轮询，拿到密文后解密得到 secret 与 token。见 [`authQRStart.ts`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-app/sources/auth/authQRStart.ts)、[`authQRWait.ts`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-app/sources/auth/authQRWait.ts)、[`authAccountApprove.ts`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-app/sources/auth/authAccountApprove.ts)。
- CLI/终端关联走同构的 `/v1/auth/request` + `/v1/auth/response`（`TerminalAuthRequest` 表）。
- [推断] 所以"多设备"实质是**把同一个根密钥复制到每台设备**，不是"一个账号挂多把设备密钥"。无法单独吊销某台设备；任何一台设备泄露 = 账号永久泄露（无密钥轮换）。

### 1.4 恢复 [已验证]

- 唯一恢复手段是用户自己备份 secret：App 把它格式化为每 5 字符一组的 base32 串 `XXXXX-XXXXX-…`（源码注释自称 "similar to 1Password"），在 restore 页手动输入即可登录。见 [`secretKeyBackup.ts`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-app/sources/auth/secretKeyBackup.ts)、[`restore/manual.tsx`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-app/sources/app/(app)/restore/manual.tsx)。
- 服务端没有任何可用于找回的字段（见下），丢了 secret 且没有其他已登录设备 = 账号与数据永久丢失。

### 1.5 服务端存什么 [已验证]

[`schema.prisma`](https://github.com/slopus/happy/blob/3d809c7d8cc919922ef9346c3575d35d4a7d23b3/packages/happy-server/prisma/schema.prisma) 的 `Account`：`id`、`publicKey`（unique）、可选 profile（`firstName/lastName/username/avatar`）、可选 `githubUserId`（事后绑定 GitHub，用于资料/社交，不是恢复渠道）。无邮箱、无手机号、无密码哈希。

### 1.6 对本项目的意义 [推断]

Happy 的模型成立有三个前提，消费级 App 基本都不满足：

1. **用户是开发者**，能理解并保管一串密钥；
2. **总有第二台设备在场**（手机 + 跑着 CLI 的电脑），天然互为备份；
3. **端到端加密是产品卖点**，"服务端无法帮你找回"是特性而非缺陷。

可以借鉴的是它的**形态**（注册与登录是同一个动作、首屏零字段、扫码加设备），而不是它的**凭证选择**（用户自管根密钥）。

## 2. Passkeys / WebAuthn：最接近 Happy 的主流形态，各平台现状

> 本节与 §3 中标 "(摘要)" 的条目，事实来自对应官方页面，但措辞经抓取工具的摘要模型转述，引用原文前请复核。

### 2.1 iOS [已验证]

- Passkey 自 iOS 16 / macOS Ventura 起可用，经 iCloud Keychain 端到端加密同步（[WWDC22](https://developer.apple.com/videos/play/wwdc2022/10092/)、[Apple Support](https://support.apple.com/en-us/102195)，摘要）。
- 第三方凭证提供方（1Password、Bitwarden）自 **iOS 17** 起可保存/提供 passkey：`prepareInterface(forPasskeyRegistration:)` 标注 iOS 17.0+（[Apple 文档](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderviewcontroller/prepareinterface(forpasskeyregistration:))）；[Bitwarden](https://bitwarden.com/help/storing-passkeys/)、[1Password](https://1password.com/blog/save-use-passkeys-web-ios) 各自文档同此（摘要）。
- 原生 App 必须配 associated domain：没有 `webcredentials` 关联时 passkey 请求直接报错（[Supporting passkeys](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys)，摘要）。
- **与本问题最相关的两个新能力**：
  - **Account creation API**（iOS 26+）：`ASAuthorizationAccountCreationProvider`，"Create a new account creation request backed by a platform public key credential, i.e. a passkey."（[文档](https://developer.apple.com/documentation/authenticationservices/asauthorizationaccountcreationprovider)）。系统弹一张预填了姓名/邮箱(或手机号)的表单并同时创建 passkey，一次确认完成注册（[WWDC25 session 279](https://developer.apple.com/videos/play/wwdc2025/279/)，摘要）；设备未配置好时报 `deviceNotConfiguredForPasskeyCreation`，需回退到普通表单。这是 Apple 官方版的"无注册表单" —— 但注意它**仍然收集一个联系方式标识符**。
  - **自动 passkey 升级**（iOS 18+）：用户用密码登录成功后静默创建 passkey（`requestStyle: .conditional` / Web `mediation: "conditional"`），第三方凭证管理器可参与（[WWDC24](https://developer.apple.com/videos/play/wwdc2024/10125/)，摘要；[Chrome 文档](https://developer.chrome.com/docs/identity/webauthn-conditional-create)）。

### 2.2 Android，尤其是无 Google Play Services 的大陆机型

- Credential Manager 面向 Android 9（API 28）及以上（[文档](https://developer.android.com/identity/passkeys/create-passkeys)）。[已验证]
- `credentials-play-services-auth` 这个依赖 "is needed for devices running Android API level <= 33"，用于对接 Google Password Manager（[Jetpack release notes](https://developer.android.com/jetpack/androidx/releases/credentials)，摘要）。Android 14+ 才有系统级的第三方 provider 框架，用户可在系统设置里另选 passkey 提供方（[supported environments](https://developers.google.com/identity/passkeys/supported-environments)、[credential-provider](https://developer.android.com/identity/sign-in/credential-provider)，摘要）。[已验证]
- Android 13 及以下留了 OEM 接口："for SDK version 33 and below, this interface can be implemented by any OEM provider that wishes to return credentials"（[CredentialProvider](https://developer.android.com/reference/androidx/credentials/CredentialProvider)）。[已验证]
- **[未验证]** 小米 HyperOS / OPPO ColorOS / vivo OriginOS / 荣耀 MagicOS 的国行 ROM 是否自带系统 passkey 提供方 —— 没找到任何一手来源，正反都没有。Google 也没有一句明确的"无 GMS 则 passkey 不可用"。
- [推断] 无 GMS 的手机上：Android ≤13 除非 OEM 自己实现否则没有 passkey 提供方；Android 14+ 有框架但需要用户装了某个提供方（如 1Password/Bitwarden）。**在大陆 Android 上不能假设 passkey 可用，只能做能力探测后作为可选项。**
- **HarmonyOS**：Online Authentication Kit 提供基于 FIDO2 的 Passkey，支持地区 "Chinese mainland"，手机/平板/PC 自 6.0.0(20) 起，需自建符合协议的服务端（[介绍](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/onlineauthentication-introduction)）；ArkTS 接口 `import { fido2 } from '@kit.OnlineAuthenticationKit'`，含 `register` / `authenticate` / `getClientCapabilities`（[指南](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/onlineauthentication-passkey-arkts)）。[已验证]。是否跨设备同步、是否需要域名关联文件 **[未验证]**。

### 2.3 微信小程序

- **[未验证·否定性结论]** 在小程序官方文档中没有找到任何 WebAuthn API；`<web-view>` 内 WebAuthn 是否可用也未验证。
- 有的是 **SOTER 生物认证** [已验证]：
  - `wx.checkIsSupportSoterAuthentication` 返回 `supportMode`（如 `['fingerPrint','facial']`）（[文档](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/soter/wx.checkIsSupportSoterAuthentication.html)）；`wx.checkIsSoterEnrolledInDevice` 查是否已录入。
  - `wx.startSoterAuthentication` 传入 `challenge`，返回 `resultJSON`（含 `raw`=你的 challenge、`counter`、TEE 信息等）与 `resultJSONSignature`（[文档](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/soter/wx.startSoterAuthentication.html)）。
  - 服务端验签只能调微信接口：`POST https://api.weixin.qq.com/cgi-bin/soter/verify_signature`，参数 `{openid, json_string, json_signature}`，返回 `is_ok`（[生物认证说明](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/bio-auth.html)）。
- [推断] SOTER 不是 passkey 的替代品：服务端拿不到公钥，验证必须经微信且依赖 `openid`，凭证不可携带、不防钓鱼。它的合理定位是**小程序内敏感操作的本地二次确认**（step-up），不是登录方式。小程序的登录凭证就是微信身份本身（§5.1）。iOS 上签名行为 **[未验证]**。

### 2.4 跨设备与可迁移性 [已验证，标注处除外]

- Hybrid transport（扫码 + 蓝牙近场）在 [CTAP 2.2](https://fidoalliance.org/specs/fido-v2.2-ps-20250714/fido-client-to-authenticator-protocol-v2.2-ps-20250714.html) §11.5 标准化；这是 Happy "扫码加设备"的标准化版本，区别在于**私钥不离开原设备**，新设备只拿到一次断言。
- 凭证迁移：[CXF v1.0](https://fidoalliance.org/specs/cx/cxf-v1.0-ps-errata-20260309.html) 已是 Proposed Standard；[CXP v1.0](https://fidoalliance.org/specs/cx/cxp-v1.0-wd-20241003.html) 仍是 Working Draft。iOS/Android 系统层的导入导出支持情况未调研。
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) 的状态（据抓取结果为 2026-08-25 W3C Recommendation，摘要，未逐字复核）。

## 3. "1Password 开箱即用"具体要求 auth 系统做什么

密码管理器没有私有协议可对接，"兼容"= 把下面这些开放约定做对。按 auth server 的职责分三类。[已验证，标 (摘要) 者措辞待复核]

### 3.1 服务端要托管的 `/.well-known/` 文件

| 路径 | 作用 | 格式要点 | 来源 |
|---|---|---|---|
| `/.well-known/apple-app-site-association` | iOS App ↔ 域名关联；密码自动填充、passkey、SMS 验证码域绑定都依赖它 | 无扩展名、有效证书、**不可重定向**；`{"webcredentials":{"apps":["TEAMID.bundle.id"]}}`；App 侧 entitlement `webcredentials:example.com` | [Apple](https://developer.apple.com/documentation/xcode/supporting-associated-domains) (摘要) |
| `/.well-known/assetlinks.json` | Android App ↔ 域名关联；Credential Manager 在原生 App 里用 passkey 的前提 | `application/json`、HTTP 200；`relation` 含 `delegate_permission/common.get_login_creds`（及 `handle_all_urls`）；`target` 为包名 + `sha256_cert_fingerprints` | [Android](https://developer.android.com/identity/credential-manager/prerequisites) (摘要) |
| `/.well-known/webauthn` | Related Origin Requests：多个域名共用一个 RP ID | `{"origins":[...]}`；客户端至少支持 5 个 registrable origin label | [WebAuthn L3](https://www.w3.org/TR/webauthn-3/) |
| `/.well-known/passkey-endpoints` | 告诉密码管理器去哪创建/管理 passkey | `{"enroll":"…","manage":"…"}`；"An empty JSON object CAN be returned to signal support for passkeys"；W3C Working Draft | [W3C](https://www.w3.org/TR/passkey-endpoints/) |
| `/.well-known/change-password` | 密码管理器的"去改密码"跳转 | 302/303/307 重定向到真实改密页；Editor's Draft | [W3C](https://w3c.github.io/webappsec-change-password-url/) (摘要) |

[推断] 这些文件按**客户端应用**而异（每个下游 App 的 Team ID/包名/签名不同），所以它们应由 auth server 根据已注册的 client 元数据**动态生成**，而不是静态文件。RP ID 建议固定为 auth 域名（各 App 的 passkey 都注册在同一 RP 下，才能跨 App 复用）。

### 3.2 登录页 / 原生界面的自动填充标注

- **Web**（auth server 自己托管的登录页）：`autocomplete="username"`、`current-password`、`new-password`、`one-time-code`；passkey 自动填充用 `autocomplete="username webauthn"`（[HTML 标准](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill)）。
- **1Password 的开发者指引**：用真实的 `<form>` 与 `<label for>`、稳定唯一的 `id`/`name`；OTP 输入框加 `autocomplete="one-time-code"`；不想被填充的字段加 `data-1p-ignore`（[1Password 文档](https://www.1password.dev/web/compatible-website-design/)）。[推断] 即：**不要**做成六个独立小方块的验证码输入、不要用 `div` 冒充表单。
- **iOS 原生**：`UITextContentType` 的 `.username` / `.password` / `.newPassword` / `.oneTimeCode`（[Apple](https://developer.apple.com/documentation/uikit/uitextcontenttype)，摘要）。
- **Android 原生**：`HintConstants.AUTOFILL_HINT_USERNAME`、`PASSWORD`、`NEW_PASSWORD`、`SMS_OTP`（`"smsOTPCode"`）、`2FA_APP_OTP`（[Android](https://developer.android.com/reference/androidx/autofill/HintConstants)）。
- [推断] 原生侧属于客户端 SDK / 接入文档的职责，auth server 本身管不到；需要在 SDK 或接入清单里写明。

### 3.3 TOTP 与短信验证码

- **TOTP**：下发 `otpauth://totp/Issuer:account?secret=<Base32>&issuer=Issuer` 二维码；**保持默认 SHA1 / 6 位 / 30 秒**（Google Authenticator 忽略 `algorithm` 与 `period` 参数）（[Key URI Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)、[RFC 6238](https://www.rfc-editor.org/rfc/rfc6238)，摘要）。1Password 通过扫码或粘贴 setup key 录入并自动填充（[1Password Support](https://support.1password.com/one-time-passwords/)，摘要）—— 所以除了二维码还要**显示可复制的 Base32 密钥**。
- **短信验证码域绑定格式**：短信最后一行 `@example.com #123456`（[WICG 草案](https://wicg.github.io/sms-one-time-codes/)，非标准轨道）；Apple 自 iOS 14 起采用同一格式并要求 associated domain（[Apple](https://developer.apple.com/documentation/security/enabling-autofill-for-domain-bound-sms-codes)，摘要）；Web 端 WebOTP 仅 Chrome on Android（[Chrome](https://developer.chrome.com/docs/identity/web-apis/web-otp)，摘要）。
- Android 的 SMS Retriever / SMS User Consent 都是 Google Play services API（[文档](https://developer.android.com/identity/sms-retriever)）—— [推断] **大陆 Android 不可用**，那里只能依赖各 ROM 自带的"识别验证码并一键填入"，这部分没有可对接的规范 [未验证]。
- [推断] 国内短信模板需运营商/通道审核，末行追加 `@domain #code` 能否过审未验证；应设计成按通道可配置的模板。

## 4. 匿名/游客账号"先用后绑"，以及密钥对身份

### 4.1 匿名账号后升级：各家怎么做

| 系统 | 创建 | 升级/绑定 | 冲突与数据合并 | 来源 |
|---|---|---|---|---|
| Better Auth `anonymous` 插件 | `signIn.anonymous()`（`/sign-in/anonymous`），建一个 `isAnonymous: true` 的用户，邮箱为生成值（默认 `{id}@anonymous.placeholder.invalid`，配置 `emailDomainName` 后为 `temp-{id}@{domain}`） | 匿名会话下再用其他方式 `signIn`/`signUp` 时触发 `onLinkAccount({anonymousUser, newUser})`，随后**匿名用户默认被删除**（`disableDeleteAnonymousUser` 可关） | 不自动迁移数据；文档只给了"把购物车从匿名用户移到新用户"的回调示例，迁移由集成方自己写 | [文档](https://www.better-auth.com/docs/plugins/anonymous)、[源码](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/anonymous/index.ts) [已验证] |
| Firebase Anonymous Auth | `signInAnonymously` | 给**同一个** uid `link` 一个凭证（uid 不变） | 凭证已属于别的账号时报 `auth/credential-already-in-use`，文档原话 "you must handle merging the accounts and associated data as appropriate for your app" | [anonymous-auth](https://firebase.google.com/docs/auth/web/anonymous-auth)、[account-linking](https://firebase.google.com/docs/auth/web/account-linking)、[错误码](https://firebase.google.com/docs/reference/js/v8/firebase.User) [已验证，部分引文经摘要工具转述] |
| Supabase anonymous sign-ins | `signInAnonymously`，JWT 带 `is_anonymous` claim | `updateUser()` 绑邮箱/手机，`linkIdentity()` 绑 OAuth | "This process requires manual handling of potential conflicts."；强烈建议加 CAPTCHA/Turnstile，默认 IP 限流 30 次/小时；无自动清理 | [文档源文件](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/auth-anonymous.mdx) [已验证] |
| PlayFab（游戏"游客账号"） | `LoginWithIOSDeviceID` / `LoginWithAndroidDeviceID` / `LoginWithCustomID` | 登录后再 `LinkXxx` 加"可恢复凭证" | `ForceLink`：把标识从旧账号摘下挂到当前账号，**移动链接而非合并数据**；否则报 `LinkedIdentifierAlreadyClaimed` | [best practices](https://learn.microsoft.com/en-us/xbox/playfab/identity/player-identity/login/login-basics-best-practices)、[LinkCustomID](https://learn.microsoft.com/en-us/rest/api/playfab/client/account-management/link-custom-id?view=playfab-rest) [已验证] |

共同点 [已验证]：

- 匿名账号**没有可恢复信息**。PlayFab："contain no recoverable information about the player. If the player loses or breaks their device, the account is lost"；Firebase 安全清单："Anonymous authentication data will not persist if the user clears local storage or switches devices"，并建议 "Only use anonymous authentication for warm onboarding"（[来源](https://firebase.google.com/support/guides/security-checklist)）。
- 官方推荐路径一致：先匿名建号 → 完成后**提示用户添加可恢复凭证**（PlayFab 原话："once the anonymous login is complete, you should provide the option to add *recoverable* login credentials"）。
- **合并从来不是 auth 系统替你做的**：四家都把"两个账号的数据怎么合"留给业务方。

两种升级语义，必须二选一并写进设计 [推断]：

1. **原地升级**（Firebase/Supabase）：匿名 user id 保留，只是多挂一个 identity。业务数据的外键不用动。冲突只发生在"要绑的手机号已属于另一个 user"时。
2. **切换并删除**（Better Auth 默认）：登录成另一个 user，匿名 user 被删，数据靠回调迁移。实现简单但每个业务表都要写迁移。

对 OIDC provider 而言原地升级更合适：下游应用拿到的 `sub` 不变。

设备侧"凭证能活多久"的事实，决定了游客账号的寿命 [已验证，除标注外]：

- iOS `identifierForVendor`：用户删光该厂商所有 App 再重装后会变（[Apple 文档](https://developer.apple.com/documentation/uikit/uidevice/identifierforvendor)）。
- iOS Keychain 项在卸载重装后常常还在，但这是**未文档化的实现细节**，Apple DTS 明确说文档从未承诺过此行为（[论坛帖](https://developer.apple.com/forums/thread/36442)，引文经摘要工具转述）。不能当作设计保证。
- Android Keystore 的 key 随卸载清除（[AOSP 文档](https://source.android.com/docs/security/features/keystore)）。
- Android Block Store 可跨卸载/换机恢复，但它是 "a library powered by Google Play services"（[文档](https://developer.android.com/identity/block-store)）—— **大陆 Android 不可用**。
- [推断] 所以在大陆 Android 上，纯设备绑定的游客账号"卸载即丢"，没有平台级兜底。

### 4.2 密钥对 / DID 式身份为何没成主流

- **Nostr**：身份就是 secp256k1 密钥对（[NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)）；NIP-01 全文没有轮换、恢复、吊销机制；助记词派生（NIP-06）与委托（NIP-26）在 [NIP 索引](https://github.com/nostr-protocol/nips/blob/master/README.md)里被标为 unrecommended；多端使用靠 [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) 远程签名器（bunker）把私钥集中到一处。[已验证]
- **Sign-In with Ethereum**（[ERC-4361](https://eips.ethereum.org/EIPS/eip-4361)）：协议本身设计得很规整（消息绑定 domain，`nonce` 必填防重放），但前提是用户有钱包。[已验证]
- **DPoP**（[RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)）：设备密钥用来**绑定 token**，RFC 明说 "DPoP itself is not used for client authentication" —— 它是会话加固手段，不是身份。[已验证]
- 行业的结论体现在 passkey 的演进上：WebAuthn L3 写明 "A single-device credential is not resilient to single device loss. Relying Parties SHOULD ensure that each user account has additional authenticators registered and/or an account recovery process"（[§6.1.3](https://www.w3.org/TR/webauthn-3/#sctn-credential-backup)）；FIDO 联盟 2022 年推出"多设备凭证"（即可同步的 passkey）正是为了解决换机即丢的问题（[白皮书](https://fidoalliance.org/white-paper-multi-device-fido-credentials/)，引文经摘要工具转述）。[已验证]
- [推断] 归纳：裸密钥对身份卡在**恢复**与**多设备**两件事上。Passkey = "密钥对身份 + 平台替你同步和备份"，是这条路线里唯一进入主流的形态；Happy（§1）属于没解决这两件事、靠用户群体特殊而成立的那一类。

## 5. 中国大陆的"无感"方案，以及迫使你收手机号的约束

> 本节引文多数经抓取工具的摘要模型转述，中文原文措辞请以链接页面为准。

### 5.1 微信小程序静默登录：`wx.login` + `code2Session` [已验证]

- `wx.login` 拿 `code` → 服务端调 `GET /sns/jscode2session` → 得到 `openid`、`session_key`、`unionid`。全程无用户交互、无弹窗。[文档](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)
- `unionid` 只有在小程序绑定到微信开放平台账号后才返回；绑定后无需用户授权即可拿到。[UnionID 机制说明](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/union-id.html)
- `openid` "对当前开发者账号唯一"（每个 App/小程序各不相同），`unionid` "针对一个微信开放平台账号下的应用，同一用户的 unionid 是唯一的"。[文档](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/WeChat_Login/Authorized_API_call_UnionID.html)
- [推断] 这就是小程序里天然的 "Happy 式"登录：凭证由微信替用户持有，注册与登录同一个动作，且**微信账号自带恢复能力**。identity 表必须以 `unionid` 为主键候选、`openid` 按 appid 存多条。

### 5.2 小程序手机号快速验证组件 [已验证]

- `<button open-type="getPhoneNumber">` → 回调给一个 `code`（5 分钟有效、一次性）→ 服务端调 `/wxa/business/getuserphonenumber` → 返回 `phoneNumber`、`purePhoneNumber`、`countryCode`、`watermark{timestamp, appid}`。[服务端 API](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-info/phone-number/getPhoneNumber.html)
- 资格："针对非个人主体，且完成了认证的小程序开放" —— **个人主体小程序拿不到手机号**。
- 价格（注意起始日是 8 月 28 日，不是任务描述里的 26 日）："自2023年8月28日起，手机号快速验证组件将需要付费使用。标准单价为：每次组件调用成功，收费0.03元"，每个小程序 1000 次体验额度。[组件说明](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)
- 实时验证组件 `getRealtimePhoneNumber`：0.04 元/次，每次都实时校验号码有效性。[文档](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getRealtimePhoneNumber.html)
- 用户体验是一次点击 + 一个微信系统弹窗，不用收短信。

### 5.3 原生 App 的微信登录 [已验证，费用除外]

- 需要在微信开放平台创建并审核通过"移动应用"且开通微信登录；OAuth2 `snsapi_userinfo`，`code` 换 `access_token`，返回 `openid` + `unionid`。[开发指南](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/WeChat_Login/Development_Guide.html)
- 开放平台开发者认证费用：只找到微信开发者社区的回答（称 300 元、仅非个人主体），**官方费用页 [未验证]**。

### 5.4 运营商本机号码一键登录 [已验证，除标注外]

- **流程**（阿里云号码认证服务）：SDK 初始化 →（可提前"预取号"）→ `getLoginToken` 拉起授权页，展示脱敏号码与运营商协议 → 用户点击 → SDK 拿到 token → App 服务端调 `GetMobile` 换取完整手机号。另一形态"本机号码校验"：用户输入号码，服务端 `VerifyMobile` 只返回一致/不一致。[交互流程](https://help.aliyun.com/zh/pnvs/developer-reference/interaction-process)、[GetMobile](https://help.aliyun.com/zh/pnvs/api-one-click-login-number)、[VerifyMobile](https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-verifymobile)
- 创蓝闪验同构：初始化 → 预取号 → 拉起授权页 → 服务端 token 置换（[文档](https://doc.chuanglan.com/document/V9XAD2Q06MLC2NR3)）。极光 JVerification 的 `loginTokenVerify`（返回 RSA 加密手机号）**[未验证]**（官方文档站抓取失败，仅见搜索摘要）。中国移动自有文档 dev.10086.cn **[未验证]**（页面无法渲染）。
- **腾讯云号码认证已不接新客户**："目前号码认证产品仅支持已开通的存量白名单新购，其余场景不支持新接入"（[来源](https://cloud.tencent.com/document/product/1415/53463)）。
- **硬约束**：
  - 必须开蜂窝数据："必须打开移动数据开关，仅在Wi-Fi环境下，会提示用户打开移动蜂窝网络"（[腾讯云文档](https://cloud.tencent.com/document/product/1415/53464)）；Wi-Fi 与数据双开可用，SDK 强制走数据网络（[腾讯云 FAQ](https://cloud.tencent.com/document/product/1415/104284)）。
  - 支持三大运营商，不支持纯流量卡，"不支持在国际漫游下发起认证"（同一 FAQ）。境外/港澳台/虚拟运营商号码是否支持 **[未验证]**。
  - 双卡：取默认上网卡的号码（[阿里云 SDK FAQ](https://help.aliyun.com/zh/pnvs/support/faq-sdk)）—— 不一定是用户想用来注册的那个号。
  - 授权页受运营商规范约束并被审查："不得诱导用户授权，开发者不得通过任何技术手段跳过或模拟此步骤"，违规会被停服（交互流程页）。
  - 必须有降级："当一键登录失败时，自动切换为短信认证或其他认证方式"（[最佳实践](https://help.aliyun.com/zh/pnvs/use-cases/best-practices-for-user-authentication)）。公开的失败率数据 **[未验证]**（未找到）。
- **平台**：阿里云列出 "Android、iOS、HarmonyOS、uni-app和H5"（[产品概述](https://help.aliyun.com/zh/pnvs/product-overview/number-authentication)）。H5 版是降级体验：需关闭 Wi-Fi 且用户补输中间 4 位（[H5 接入](https://help.aliyun.com/zh/pnvs/developer-reference/h5-client-access)）。是否覆盖 "HarmonyOS NEXT" 这一具体版本 **[未验证]**。微信小程序不在任何平台列表中 —— [推断] 小程序内不能用运营商一键登录，应使用 §5.2 的微信组件。
- **价格**：阿里云 0.050 元/次（月 ≤10 万次）阶梯降到 0.026；一键登录仅成功取号才计费，本机号码校验无论结果都计费（[定价](https://help.aliyun.com/document_detail/85132.html)）。对比：腾讯云国内短信 0.041–0.050 元/条（[定价](https://cloud.tencent.com/document/product/382/9556)）。[推断] 一键登录与短信验证码单价同一量级，收益在转化率而非成本。
- **资质**：阿里云要求完成企业或个人实名认证，并登记 Android 包名 + 包签名 / iOS BundleID（最佳实践页）。

### 5.5 法规：哪些情况必须实名（= 实际上必须收手机号）

- **《网络安全法》**：实名条款在 2025-10-28 修正（2026-01-01 施行）后**现为第二十六条**（修正前为第二十四条，任务描述中的条号已过时）。本次调研直接核对了现行文本："网络运营者为用户办理网络接入、域名注册服务，办理固定电话、移动电话等入网手续，或者为用户提供信息发布、即时通讯等服务，在与用户签订协议或者确认提供服务时，应当要求用户提供真实身份信息。用户不提供真实身份信息的，网络运营者不得为其提供相关服务。" [现行文本](https://www.cac.gov.cn/2025-12/29/c_1768735112911946.htm)、[修改决定](https://www.cac.gov.cn/2025-10/29/c_1763461514768457.htm) [已验证；新旧条文逐字对比未做]
- **《互联网用户账号信息管理规定》第九条**（2022-08-01 施行）：为用户提供"信息发布、即时通讯等服务的，应当对申请注册相关账号信息的用户进行基于移动电话号码、身份证件号码或者统一社会信用代码等方式的真实身份信息认证"。[原文](https://www.cac.gov.cn/2022-06/26/c_1657868775042841.htm) [已验证]
- **《移动互联网应用程序信息服务管理规定》第六条**：同样措辞，主体为应用程序提供者。[原文](https://www.cac.gov.cn/2022-06/14/c_1656821626455324.htm) [已验证]
- [推断/解读] 触发条件是"信息发布、即时通讯等服务"。**只要 App 有 UGC（发帖、评论、昵称头像公开展示、聊天），就必须在用户使用这些功能前完成手机号实名**；纯工具类功能字面上不在其列，但"等"字是开放的，监管与应用商店审核的实际尺度本次未能从一手来源验证。
- **反方向的约束（不许多收）** [已验证]：
  - 《个人信息保护法》第六条"收集个人信息，应当限于实现处理目的的最小范围"、第十六条不得以不同意为由拒绝服务（必需的除外）。[原文](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)
  - 《常见类型移动互联网应用程序必要个人信息范围规定》第四条："App不得因为用户不同意提供非必要个人信息，而拒绝用户使用其基本功能服务。" 其中即时通信、网络社区、网络支付、网上购物、网络游戏、学习教育等类别把手机号列为必要信息；**实用工具、浏览器、输入法、短视频、在线影音等类别"无须个人信息即可使用基本功能服务"**。[原文](https://www.cac.gov.cn/2021-03/22/c_1617990997054277.htm)
  - [推断] 两组规则合起来正好支持"分层"：基本功能不强制手机号（合规上甚至是义务），到了信息发布/即时通讯/支付再要求绑定。
- **App 备案**（工信部信管〔2023〕105号）：义务主体是 "APP主办者"，分发平台含"小程序、快应用等分发"；不对终端用户设义务。[原文](https://www.gov.cn/zhengce/zhengceku/202308/content_6897341.htm)、[微信小程序备案指引](https://developers.weixin.qq.com/miniprogram/product/record/record_guidelines.html) [已验证] —— 与登录方式设计无直接关系，但意味着运营主体必须是可备案的实体。
- **国家网络身份认证公共服务（网号/网证）**：《管理办法》2025-07-15 施行；用户"可以自愿"申领，"鼓励互联网平台按照自愿原则接入"，接入后用户以此方式核验的，"互联网平台不得要求用户另行提供明文身份信息"。[原文](https://www.gov.cn/gongbao/2025/issue_12166/202507/content_7032498.html) [已验证]。接入流程与 SDK **[未验证]**（未调研）。[推断] 可作为未来一种 identity provider 预留，不必首期实现。

### 5.6 Apple App Store 的约束 [已验证]

- **Guideline 4.8**：使用第三方/社交登录（原文点名 "WeChat Login"）作为主账号登录方式的 App，必须同时提供一个等价的、隐私友好的登录选项（仅收集姓名和邮箱、可隐藏邮箱、不做广告追踪）；豁免情形之一是 "Your app exclusively uses your company's own account setup and sign-in systems"。[原文](https://developer.apple.com/app-store/review/guidelines/#login-services)
  - [推断] iOS App 只要放了"微信登录"按钮，就得同时放 Sign in with Apple（或同等服务）；只用自有体系（手机号+短信、一键登录、passkey、游客）则不触发。后半句是对豁免条款的解读，非 Apple 原话。
  - Sign in with Apple 在大陆是否有限制：未找到 Apple 的正式说明 **[未验证]**。
- **Guideline 5.1.1(v)**："If your app doesn't include significant account-based features, let people use it without a login. If your app supports account creation, you must also offer account deletion within the app."（同上页面）Apple 的[账号删除说明](https://developer.apple.com/support/offering-account-deletion-in-your-app)还要求：仅停用不算删除；**自动生成的"游客"账号也要能删**；用了 Sign in with Apple 的要调 REST API 吊销 token。
- [推断] 5.1.1(v) 前半句实际上是在**要求**"先用后登录"；后半句意味着匿名账号从第一天起就要有删除路径。

## 6. 建议

> 本节整体为 **[推断]**：是基于 §1–§5 事实的设计判断，不是调研到的事实。

### 6.1 对原问题的回答

**"无注册表单"作为默认登录：可行，而且在大陆已经是事实上的主流。** 小程序静默登录、运营商一键登录、微信手机号组件都是"注册与登录同一个动作、零输入"。

**"纯自持密钥、不留任何标识符"（字面上的 Happy 模型）作为默认：不可行。** 理由按硬度排序：

1. **恢复**：服务端什么都不留 = 丢设备即丢号（§1.4）；匿名账号各家官方都只建议用于"暖启动"（§4.1）。
2. **法规**：一旦有信息发布/即时通讯功能，必须基于手机号等做真实身份认证（§5.5）。
3. **平台**：大陆 Android 上既没有可依赖的 passkey 提供方（§2.2），也没有 Block Store 这类跨卸载的凭证存储（§4.1）；设备密钥"卸载即丢"。
4. **小程序**：没有找到 WebAuthn 或文档化的安全密钥存储（§2.3，否定性结论未验证），现实可用的凭证只有微信身份。

所以应当借鉴 Happy 的**形态**，把**凭证**换成"平台已替用户持有、且平台负责恢复"的东西。

### 6.2 各平台现实可用的无感方式

| 平台 | 第一优先（零输入） | 兜底 | 升级项（可选） | 注意 |
|---|---|---|---|---|
| 微信小程序 | `wx.login` → `code2Session` 静默拿 `openid`/`unionid`，直接建号 | — | 需要手机号时用 `getPhoneNumber` 组件（0.03 元/次，非个人主体） | 个人主体拿不到手机号；SOTER 仅用于敏感操作二次确认 |
| Android（大陆） | 运营商一键登录 | 短信验证码；微信登录 | 探测到 passkey 提供方时提供 passkey；账号密码（配好 autofill hints） | 不能依赖 GMS：无 SMS Retriever、无 Block Store、passkey 不确定 |
| iOS | 运营商一键登录（大陆用户）；或 iOS 26 的 Account creation API（passkey + 预填联系方式） | 短信验证码；微信登录 + Sign in with Apple（4.8 成对出现） | 登录后自动 passkey 升级（iOS 18+）；1Password/Bitwarden 自 iOS 17 起可作提供方 | 必须有应用内删号（含游客号）；基本功能应允许免登录 |
| HarmonyOS | 运营商一键登录（阿里云列出 HarmonyOS） | 短信验证码 | Online Authentication Kit 的 Passkey（6.0.0(20)+） | 同步与域名关联要求未验证 |
| Web（管理后台为主） | Passkey（conditional UI） | 账号密码 + TOTP；微信扫码 | — | 这里才是"1Password 开箱即用"的主战场，按 §3 清单做 |

### 6.3 建议的分层

```
L0 游客（可选）   设备本地密钥建匿名 user —— 仅当产品确有"未登录也能产生数据"的需求
      ↓ 懒绑定
L1 平台身份       微信 unionid / 运营商本机号码 / Apple —— 零输入，平台负责恢复
      ↓ 触发点：UGC、支付、跨端同步、换机
L2 强标识符       已验证手机号（合规实名的载体）；邮箱作为次选恢复渠道
      ↓ 机会性升级
L3 强凭证         passkey（自动升级/显式添加）、TOTP、密码（为密码管理器用户保留）
```

- 小程序与大陆 App 实际上从 L1 起步即可，**L0 不必首期做**：一键登录/静默登录已经足够无感，而 L0 会带来合并、滥用（Supabase 建议 CAPTCHA + 限流）、删号等一整套额外复杂度。只有 iOS 审核 5.1.1(v) 要求"无重要账号功能时免登录"的场景需要它，而那种场景通常可以用"客户端本地不建号"解决。
- L1 → L2 的触发点要由**下游应用声明**（"这个操作需要已验证手机号"），对应 OIDC 的 step-up：用 `acr_values` / `claims` 请求，auth server 发现当前 user 缺该 identity 时插入绑定流程。
- 运营商一键登录直接给出 L2（手机号），因此大陆原生 App 一步到位；小程序是 L1（unionid）先行、L2 按需。

### 6.4 对 auth server 身份模型的要求

1. **User 与 Identity 分离，一对多。** `user`（稳定的 `sub`，无任何必填标识符）↔ `identity`（`type` + `provider` + `subject`，唯一约束在 `(provider, subject)` 上）。类型至少包括：`phone`、`email`、`wechat_unionid`、`wechat_openid`（按 appid 多条，挂在同一 unionid 下）、`apple`、`anonymous_device`。
2. **Credential 与 Identity 分离。** `passkey`（多把，记录 BE/BS 标志与 AAGUID）、`password`、`totp` 是"证明你是这个 user 的方式"，不是"你是谁"。Happy 把两者合一（公钥既是身份又是凭证）正是它无法轮换/吊销的根源。
3. **注册与登录合并为一个端点语义**（"sign in or create"）：用已验证的 identity 查找 user，找不到就创建。Happy 的 `upsert` 是对的。
4. **绑定（link）是一等操作，冲突策略显式化。** 当前 user 要绑的 identity 已属于另一 user 时，只有三种出路，需逐一设计：拒绝并提示改为登录那个账号；**移动** identity（PlayFab `ForceLink` 语义，原账号失去该登录方式）；**合并**两个 user。合并需要向下游应用发事件（哪个 `sub` 并入哪个），因为数据合并只能由业务方做（§4.1 四家无一例外）。首期建议只做"拒绝"与"匿名 user 并入正式 user"这一种合并。
5. **匿名 → 正式采用原地升级**（保留 `sub`，§4.1），并提供匿名 user 的 TTL 清理与删除接口（Apple 要求游客号可删）。
6. **Assurance 等级随 token 下发**：`amr`（[RFC 8176](https://www.rfc-editor.org/rfc/rfc8176) 已注册的 `sms`/`otp`/`hwk`/`pwd` 等，微信、运营商取号需自定义值）与"是否已有已验证手机号"的 claim，让下游自行决定何时 step-up。
7. **服务端下发 challenge**，不要照搬 Happy 的客户端自签 challenge（§1.1）。
8. **按 client 动态生成 `/.well-known/` 文件**并固定单一 RP ID（§3.1）。
9. **验证渠道可插拔**：运营商一键登录（阿里云等聚合商的 token 置换）、短信、微信 `code2Session`/`getuserphonenumber`、Apple 都是"把外部凭证换成一个已验证 identity"的适配器，接口同构。腾讯云号码认证已不接新客户，供应商需可替换。

### 6.5 尚未验证、值得后续单独确认的问题

- 小米/OPPO/vivo/荣耀国行 ROM 是否自带 passkey 提供方（决定大陆 Android 上 passkey 的优先级）。
- 小程序与 `<web-view>` 内确实没有 WebAuthn（目前只是"没找到"）。
- HarmonyOS Passkey 的同步与域名关联要求。
- 运营商一键登录的实际失败率；对港澳台/境外/虚拟运营商号码的支持；极光、创蓝、中国移动自有平台的接口与价格。
- 纯工具类 App 在监管与应用商店审核实践中是否会被要求手机号实名（法规字面不要求）。
- 国内短信通道是否允许 `@domain #code` 末行。
- Sign in with Apple 在大陆的可用性是否有限制；微信开放平台认证费用的官方数字。
- 国家网络身份认证（网号/网证）的第三方接入流程。
- "Happy Code" 是否确指 `slopus/happy`。
