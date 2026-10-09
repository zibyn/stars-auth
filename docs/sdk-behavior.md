# SDK 行为说明

所有官方 SDK 都按这份说明实现;不用 SDK、自己调 HTTP API 的接入方也必须做到其中标 **必须** 的几条。端点细节见 `/v1/auth/openapi.json`。

## 登录

- **PKCE**:每次登录生成新的 `code_verifier`(43 个 base64url 字符,至少 240 位随机),第一步带上 `code_challenge`(S256);同一个 `auth_session` 内沿用,兑换 code 时带上 `code_verifier`,不带 `redirect_uri`。
- **协议版本**:每个 challenge 请求都带 User 勾选同意的 `terms_version`(`GET /v1/auth/terms` 的 `version`)。实例尚未配置协议(`version` 为空)时任意版本都行,空串也可以。
- **PoW**:发码和密码登录前,从 `GET /altcha/challenge` 取题目,按 ALTCHA v2(PBKDF2/SHA-256,计数器为 4 字节大端)求解,把题目原样连同解答 base64 后作为 `altcha` 发送。一个解答只能用一次。
- **多步**:`403 insufficient_authorization` 带回 `auth_session`,下一步带上它。**必须**按 `next` 决定下一步,不要解析 `error_description`:`code` 表示"输入验证码"(给绑定的手机号发码后也是 `code`);`phone` 表示"需要绑定手机号",在同一 `auth_session` 内给手机号发码再验证;`totp` 表示"User 开了两步验证",在同一 `auth_session` 内提交 `totp`(验证器上的 6 位码)或 `recovery_code`(恢复码),先于 `phone`。`totp` 输错返回 `invalid_request` 并带回 `auth_session`,可以重输;第 5 次输错后返回 `invalid_session`。`next` 以后只新增取值;遇到不认识的取值**必须**按失败处理(KMP SDK 抛 `StarsAuthException`,`error` 为 `unsupported_step`),提示 User 升级 App。
- **外部登录**(Apple):App 用系统的 Sign in with Apple 拿到 `authorization_code`,原样作为 `authorization_code`、连同 Provider ID 作为 `provider` 提交(KMP:`signInWithProvider`),不提交 identity token,也不需要 nonce(ADR 0011)。code 只能用一次,`400 invalid_grant` 表示 Apple 没认这个 code,让 User 重新用 Apple 登录。之后照常按 `next` 走。
- **用户错误**:`400 invalid_request` 的 `error_description` 可直接展示;返回了 `auth_session` 时它仍然可用(比如重输验证码)。`invalid_session` 表示从头再来。

## 刷新

- **single-flight(必须)**:同一时间只有一个刷新请求,其余调用方等它的结果。服务端没有宽限窗口:同一个 refresh token 用两次即视为泄露。
- **时机**:access token 剩余不足 30 秒时刷新;刷新后旧 refresh token 立刻作废,新令牌原子地写入存储。
- **网络失败、5xx**:保留现有令牌,下次再试。注意:若服务端已完成轮换而响应丢失,下次刷新会用到旧 token,按重用处理。

## refresh token 重用后

服务端发现重用时终止整个 Session:旧 token、新 token 和这个 Session 签发的 access token(在 Account API 上立即,在业务后端最多滞后 10 分钟)都失效。`/token` 返回 `invalid_grant` 时 SDK 清空本地令牌,报告"已登出"(KMP:`StarsAuthException.SIGNED_OUT`),App 应回到登录页。被吊销、过期、在账号中心下线、账号被删除,表现相同。

## 登出

- 向 `/revoke`(RFC 7009)吊销 refresh token,这会结束服务端的 Session。
- **尽力而为**:吊销失败(离线等)也照样清空本地令牌,登出总是成功;残留的 Session 闲置到期,或由 User 在账号中心下线。

## 注销账号

- `POST /v1/auth/delete`,带 access token。要求 10 分钟内登录过:否则 401 `insufficient_user_authentication`,App 应让 User 确认后重新登录,再调一次。
- 成功(204)后清空本地令牌。最后一个所有者不能注销(409)。

## 令牌存储

默认加密存储:iOS Keychain(`AfterFirstUnlockThisDeviceOnly`,不同步、不随备份迁移到别的设备),Android Keystore 中的 AES-GCM 密钥加密后存入私有 SharedPreferences;解不开(如密钥丢失)视为未登录。存储接口可替换。
