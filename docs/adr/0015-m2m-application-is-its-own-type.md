# M2M Application 是单独的类型,只调一个 API

`client_credentials` 只开给新增的 Application 类型 `m2m`(与 `public`、`confidential` 并列),Role 也只能分配给它;让 User 登录的 confidential Web Application 不能持有 Role,也不能走 `client_credentials`。每个 M2M Application 只能调它的默认 API:创建时指定,之后不可改,Role 只在这个 API 上分配;一个后端要调 Management API 和业务 API,就建两个 M2M Application。这样"让 User 登录"和"以自己的身份调 API"两种职责不会落在同一个 client 上,用户登录的 Web 端不会顺带握着管理权限,`aud` 固定、一张令牌也不会混入两个 API 的权限。

## Considered Options

- **confidential Web Application 顺带开启 `client_credentials`**(Auth0 的做法):少一种类型,但一个 client 同时代表 User 和它自己,Role 归属与审计上的操作者都变得含糊。
- **服务账号做成 Application 之外的独立实体**:概念上干净,但要重复一套 client 认证、密钥、令牌签发;go-oidc 的 `client_credentials` 本就以 client 为主体。
- **对 M2M 开放 RFC 8707 `resource`,一个 M2M Application 可在多个 API 上持有 Role**:少建几个 Application,但打破"默认 API 即唯一 API"的约定,`aud` 由请求决定;日后需要可在本方案上增量加入。

## Consequences

- Management API 不再只能作管理端的默认 API,M2M Application 也可以;实时鉴权的调用者从"User"扩为"User 或 M2M Application",后者不受"管理员必须启用两步验证或 Passkey"约束,不能持有「所有者」。
- 审计的操作者需要区分 User 与 Application。
- M2M 没有 refresh token,也不受默认 Role 影响(默认 Role 只在 User 创建时生效)。
