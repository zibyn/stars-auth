# 直连 API 用 `next` 字段指明下一步

challenge 端点返回 `insufficient_authorization` 时,除草案规定的 `error`、`error_description`、`auth_session` 外,多带一个非标准字段 `next`,取值 `code`(输入刚发出的验证码)、`phone`(先绑定手机号)、`totp`(输入 TOTP 或恢复码),以后按需追加。草案没有规定如何告诉客户端下一步做什么;一期只有发码和绑手机号两种情况,App 尚能从上下文推断,加入两步验证后同一个响应可能对应三种界面,只能靠一个机器可读的字段来区分。

## Considered Options

- **让 App 解析 `error_description`**:不偏离草案,但描述是写给人看的,改一句措辞就会打断所有已发布的 App。
- **每一步用不同的 `error` 码**:同样能区分,但草案只定义了 `insufficient_authorization`,自定义错误码比加一个字段更容易被通用客户端当成失败。

## Consequences

- `next` 进入 `/v1` 的公开契约:只能新增取值,不能改名或删除;KMP SDK 遇到不认识的取值时按失败处理。
- 草案以后若规定了同类机制,要在新主版本里迁移过去。
