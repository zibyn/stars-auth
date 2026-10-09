# 认证方式

## 矩阵

| 方式 | 角色 | 默认 | 可用的面 | 分期 |
|---|---|---|---|---|
| 短信验证码 | 第一因素 | 配好短信 Channel 即可用 | 托管页、直连 API | 一期 |
| 邮箱验证码 | 第一因素 | 配好邮件 Channel 即可用 | 托管页、直连 API | 一期 |
| 用户名 / 手机号 / 邮箱 + 密码 | 第一因素 | "仅管理员" | 托管页、直连 API | 一期 |
| Passkey | 第一因素(本身已是多因素) | 开 | 托管页、直连 API;小程序不提供 | 二期 |
| TOTP | 唯一的第二因素 | User 自愿开启 | 托管页、直连 API | 二期 |
| Provider(通用 OIDC、Apple 等) | 第一因素 | 管理员添加 Provider | 通用 OIDC:托管页;Apple:托管页、直连 API | 二期起 |

## 验证码

- **生成**:由 Stars Auth 生成和核验,Channel 只负责投递。
- **格式**:6 位数字,5 分钟有效,用一次即作废,同一个码输错 5 次即作废。
- **短信末行**:`@域名 #验证码` 可按 Channel 配置,默认关闭(国内能否过审未验证)。
- **限流与 PoW**:见 [security-compliance.md](security-compliance.md)。

## 密码

- **开关**:实例级三档:关闭 / **仅管理员**(默认) / 所有 User。关闭期间,已设的密码保留但不能用,也不能新设。
- **登录名**:用户名、手机号或邮箱任一,配合密码登录。
- **设置**:注册时从不要求;User 登录后在账号中心设置、修改或删除。
- **忘记密码**:不单独做重置流程,忘记即改用验证码登录,再到账号中心修改。只有用户名的 User 见 [identity.md](identity.md#找回)。
- **存储与规则**:argon2id 存储;最短 8 位,不设字符组合规则;不接外部泄露库。

## Passkey(二期)

- **RP ID**:固定为 Stars Auth 的域名;使用可发现凭证;User 可以添加多把。
- **托管页**:用 conditional UI(`autocomplete="username webauthn"`)。
- **直连 API**:增加 WebAuthn challenge;KMP SDK 只调用系统凭证 API(Credential Manager / ASAuthorization),界面由系统弹出。
- **大陆 Android**:先探测能力,有才展示。
- **小程序**:不提供。

## 2FA(二期)

- **开启**:User 自愿开启。
- **管理员必须启用两步验证**:实例设置里的开关(设置组「登录方式」Tab),默认关闭,只对持有 Management API Role 的 User 生效。打开后:
  - 持有 Role 但没开两步验证的 User 调用任何 Management API 接口,都返回 403,错误体带 `code: "two_factor_required"`;开启两步验证后立即恢复,不用等令牌过期。只看代表 User 的令牌,`client_credentials` 的服务账号不受影响。
  - 持有 Role 的 User 不能在账号中心关闭两步验证(409),但可以重新生成恢复码;管理员仍可为别人重置两步验证。
  - 当前管理员自己没开两步验证时,保存"打开"会被拒绝(422,「请先为自己开启两步验证」),免得把自己锁在外面。
  - Passkey 上线后,含义扩大为"两步验证或 Passkey"。
- **生效范围**:开启后,除 Passkey 外,任何第一因素登录都要再输一次 TOTP。不把短信或邮箱验证码当第二因素。
- **TOTP 参数**:`otpauth://` 固定 SHA1 / 6 位 / 30 秒,同时显示可复制的 Base32 密钥。
- **恢复码**:开启时生成 10 个一次性恢复码,只显示一次,可以重新生成。
- **登录**:第一因素通过后进入两步验证这一步,输入一个 TOTP 或一个恢复码,两者效果相同。步骤顺序固定为 TOTP → 绑手机号 → 同意协议;TOTP 通过之前不建 Session,也不发授权码,"已通过第一因素"的状态只存在 AuthnSession 的 store(托管页)或 `auth_session`(直连 API)里。
  - **托管页**:输入框标注 `autocomplete="one-time-code"`;可切换到「使用恢复码」。
  - **直连 API**:返回 `next: "totp"`,在同一 `auth_session` 里提交 `totp` 或 `recovery_code`,见 [protocol.md](protocol.md#直连认证-api)。
  - **输错**:每个待完成的登录最多输错 5 次,第 5 次后本次登录作废(托管页回到第一步,直连 API 的 `auth_session` 失效)。不按 User 锁定。
  - **时钟偏差**:接受前后各一个 30 秒时间步。
- **已有浏览器 Session**:静默登录不再要求 TOTP,那个 Session 建立时已经输过了。
- **`amr`**:做过两步验证的登录为 `[第一因素, "otp", "mfa"]`,不重复:邮箱验证码登录为 `["otp", "mfa"]`。
- **认证强度**:Application 需要更强认证时,用 `max_age` / `prompt=login`,并检查 `amr`。不支持 `acr_values`。

## Provider(二期)

- **首次登录**:没有绑定过的 External Identity 直接新建 User,之后照常走 2FA、"必须绑定手机号"和协议同意。
- **2FA**:Provider 登录属于第一因素,开了 2FA 的 User 仍要输入 TOTP。
- **托管页**:每个启用中的重定向型 Provider 一个按钮,"使用 {名称} 登录",放在验证码表单下方,按创建顺序排列;Apple 按 HIG 黑底样式,通用 OIDC 不带图标。
- 配置与各 Provider 类型的细节见 [architecture.md](architecture.md#provider-的配置与身份)。

## 密码管理器适配

- **`/.well-known/` 文件**:
  - `apple-app-site-association`:`webcredentials.apps` 汇总所有 Application 登记的 Team ID + Bundle ID;以 `application/json` 返回,不重定向。
  - `assetlinks.json`:每个登记的 Android 应用一条,`relation` 含 `delegate_permission/common.get_login_creds` 和 `delegate_permission/common.handle_all_urls`。
  - 还没登记任何原生 App 时,两个文件返回空列表的合法 JSON;这两个关联文件也不受 Passkey 开关影响,密码自动填充同样要用。
  - 提供 `passkey-endpoints`(指向账号中心);
  - `change-password` 只在密码开关打开时提供;
  - 不做 `/.well-known/webauthn`。
- **托管页面**:用真实的 `<form>`,按 HTML 标准标注 `autocomplete`;验证码用单个输入框,标注 `one-time-code`(一期)。
- **原生自动填充**:标注写进 SDK 接入文档(一期)。

## 首次登录的界面

不做零表单入口,不提供游客身份。首次登录就是手机号或邮箱验证码(以及管理员启用的 Provider)。App 若允许未登录使用,自己在本地处理。
