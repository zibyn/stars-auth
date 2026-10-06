# Stars Auth

为自有应用提供统一认证的中心化身份服务:一个用户池,所有应用共用,应用自身不再处理认证复杂度。

## Language

**Stars Auth**:
独立部署的中心化身份服务,所有 Application 的 User 身份都由它持有和验证。
_Avoid_: 认证库, 认证框架, SSO 平台

**Operator**:
部署并运营一个 Stars Auth 实例的个人或团队,负责配置登录方式与通道。
_Avoid_: 管理员, 站长, 租户

**User**:
一个自然人在 Stars Auth 中的唯一账号,跨所有 Application 是同一个。
_Avoid_: 账户, 会员, 成员

**Application**:
在 Stars Auth 注册、委托其认证 User 的一个接入方(App、小程序或 Web 端)。
_Avoid_: Client, 租户, 项目

**First-party Application**:
由该实例的 Operator 自己开发和运营的 Application;当前所有 Application 都属于此类。
_Avoid_: 内部应用, 自有客户端

**API**:
Operator 登记的一个受保护业务后端,以一个标识字符串区分;Stars Auth 签发给 Application 的 access token 指明它供哪个 API 使用,多个 Application 可共用同一个 API。
_Avoid_: Resource Server, 资源, 后端服务

**Session**:
一个 User 在一台设备或一个浏览器上的一次登录;App 中由 refresh token 承载,浏览器中由 cookie 承载,终止它即让该设备下线。
_Avoid_: 登录态, 会话令牌, 设备

**Identifier**:
User 用来登录、并能接收验证码的手机号或邮箱;在用户池内唯一,只存已验证的。
_Avoid_: 账号, 用户名, 联系方式

**External Identity**:
某个 Provider 认定的一个用户(Provider 实例 + 其侧用户 ID,如微信 openid、Apple `sub`),绑定在某个 User 上。
_Avoid_: 社交账号, 第三方账号, Identity

**Credential**:
User 持有、用于证明身份的秘密,如密码、Passkey、TOTP;本身不能定位 User,须配合 Identifier 或由设备提供。
_Avoid_: 密钥, 因子

**Channel**:
把验证码送达 Identifier 的外部投递服务(短信或邮件),由 Operator 选择并配置;每种 Identifier 同时只启用一个。
_Avoid_: 网关, 短信服务商, 发送器

**Provider**:
替 Stars Auth 证明"这是谁"的外部认证服务(如微信、运营商一键登录、Apple、任意 OIDC 上游),认证结果是一个已验证的 Identifier 或一个 External Identity;Operator 可配置多个实例。
_Avoid_: 社交登录, IdP, 第三方登录, 认证服务商
