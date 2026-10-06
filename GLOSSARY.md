# Stars Auth

为自有应用提供统一认证的中心化身份服务:一个用户池,所有应用共用,应用自身不再处理认证复杂度。

## Language

**Stars Auth**:
独立部署的中心化身份服务,所有 Application 的 User 身份都由它持有和验证。
_Avoid_: 认证库, 认证框架, SSO 平台

**管理员**(Admin):
在管理端 API 上持有任一 Role 的 User,负责配置登录方式、通道与 Application;部署实例的人即首个所有者。旧称 Operator。
_Avoid_: Operator, 站长, 租户

**User**:
一个自然人在 Stars Auth 中的唯一账号,跨所有 Application 是同一个。
_Avoid_: 账户, 会员, 成员

**Application**:
在 Stars Auth 注册、委托其认证 User 的一个接入方(App、小程序或 Web 端)。
_Avoid_: Client, 租户, 项目

**First-party Application**:
由该实例的运营方自己开发和运营的 Application;当前所有 Application 都属于此类。
_Avoid_: 内部应用, 自有客户端

**API**:
管理员登记的一个受保护业务后端,以一个标识字符串区分;Stars Auth 签发给 Application 的 access token 指明它供哪个 API 使用,多个 Application 可共用同一个 API。
_Avoid_: Resource Server, 资源, 后端服务

**Session**:
一个 User 在一台设备或一个浏览器上的一次登录;App 中由 refresh token 承载,浏览器中由 cookie 承载,终止它即让该设备下线。
_Avoid_: 登录态, 会话令牌, 设备

**Identifier**:
User 用来登录的手机号、邮箱或用户名,在用户池内唯一;手机号和邮箱必须已验证、能接收验证码,用户名不验证、只能配合密码使用。
_Avoid_: 账号, 用户名, 联系方式

**External Identity**:
某个 Provider 认定的一个用户(Provider 实例 + 其侧用户 ID,如微信 openid、Apple `sub`),绑定在某个 User 上。
_Avoid_: 社交账号, 第三方账号, Identity

**Credential**:
User 持有、用于证明身份的秘密,如密码、Passkey、TOTP;本身不能定位 User,须配合 Identifier 或由设备提供。
_Avoid_: 密钥, 因子

**Channel**:
把验证码送达 Identifier 的外部投递服务(短信或邮件),由管理员选择并配置;每种 Identifier 同时只启用一个。
_Avoid_: 网关, 短信服务商, 发送器

**Provider**:
替 Stars Auth 证明"这是谁"的外部认证服务(如微信、运营商一键登录、Apple、任意 OIDC 上游),认证结果是一个已验证的 Identifier 或一个 External Identity;管理员可配置多个实例。
_Avoid_: 社交登录, IdP, 第三方登录, 认证服务商

**Permission**:
某个 API 定义的一项可授予的能力,以字符串表示(如 `track:write`)。
_Avoid_: 权限点, scope, 授权

**Role**:
某个 API 上一组 Permission 的命名集合,分配给 User 或 confidential Application;同一 API 上可持有多个 Role。
_Avoid_: 用户组, 身份, 职位

**Management API**:
Stars Auth 自带的内置 API,管理 User、Application、Role 与配置;管理端界面和业务后端都通过它操作,权限由其上的内置 Role(所有者、管理员、只读)或自定义 Role 决定。
_Avoid_: 管理端 API, Admin API, 后台接口
