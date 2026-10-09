# 直连 API 的 Passkey 登录:两次往返,取 challenge 不要 PoW

Passkey 登录走现有的 `POST /v1/auth/challenge`,分两次往返:第一次带首次参数和 `passkey=begin`,返回 `200 {auth_session, options}`,`options` 是标准的 `PublicKeyCredentialRequestOptionsJSON`;第二次带 `auth_session` 和 `passkey=<AuthenticationResponseJSON>`,通过后照常进入后续步骤(绑手机号、同意协议)并返回 `authorization_code`。`begin` 不要求 ALTCHA 解答,这打破了"不带 `auth_session` 的请求要么发码、要么验密码,都必须附带 PoW"的惯例。我们接受这一点:`begin` 不发短信、不验密码,只写一行带 TTL 的 challenge session,滥用代价靠按 IP 限流和每小时清理兜住;而在 SDK 里先算几秒 PoW 再弹系统 Passkey 框,会让最快的登录方式变成最慢的。

## Considered Options

- **`begin` 也要 PoW**:惯例统一,但 PoW 防的是"让我们花钱发短信"和"撞密码",这两样 `begin` 都不做;Passkey 断言本身不可撞,PoW 换不来安全。
- **单独开一个 `/v1/auth/passkey/options` 端点**:语义更清楚,但 SDK 要多处理一个端点和它的错误形状;challenge 端点按字段分支的风格已经能容纳它。
- **无状态 challenge**(服务端签名的 challenge,不落库):省掉写库,也就不需要限流兜底,但要另做防重放(记已用过的 challenge),复杂度回到原处,且和现有 `auth_session` 模型分叉。

## Consequences

- `passkey` 字段和 `begin` 取值进入 `/v1` 公开契约,规则同 ADR 0010:只增不改。
- `begin` 的 200 响应是 challenge 端点第一个"成功但没有 `authorization_code`"的响应;SDK 按 `options` 是否存在区分。
- 注册 Passkey 不走这个端点,走账号中心 API(`/v1/account/passkeys/*`),要求 10 分钟内重新验证过。
