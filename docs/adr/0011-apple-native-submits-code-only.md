# Apple 原生登录只提交 authorization code

客户端令牌型的 Apple 登录只向 challenge 端点提交 Sign in with Apple 给出的 `authorization_code`,不提交 identity token,也不用 nonce。服务端以 Bundle ID 为 client_id、自签 JWT 为 client secret 去 Apple 换码,把换回的 id_token 当作认证结果,同时把 refresh token 加密存在 External Identity 上,供解绑和注销时撤销。撤销本来就要求换码;换码的 id_token 由 Apple 经 TLS 直接返回,code 一次性有效,而且只有持有 .p8 私钥的服务端能兑换,所以客户端那份 identity token 和防重放用的 nonce 都是多余的。

## Considered Options

- **提交 identity token + code,配合服务端下发的 nonce**:这是 Apple 文档和多数实现的写法,但要多一轮请求取 nonce,客户端要传两样东西,换码却仍然少不了。

## Consequences

- 换码失败,这次登录就失败;Apple token 端点不可用时,原生 Apple 登录也不可用。
- 提交的字段进入 `/v1` 的公开契约;以后若要改为校验 identity token,只能新增字段。
