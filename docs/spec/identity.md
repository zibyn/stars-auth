# 身份模型

## 概念

```
User (sub: 不透明、稳定、永不复用)
├── Identifier          手机号 ≤1 · 邮箱 ≤1 · 用户名 ≤1   池内唯一
├── External Identity   每个 Provider 实例 ≤1            池内唯一
├── Credential          密码 ≤1 · Passkey 多把 · TOTP ≤1 · 恢复码
├── Session             不限数量
├── Role 分配            按 API,见 rbac.md
└── 同意记录             见 security-compliance.md
```

- **Identifier**:
  - 手机号以 E.164 格式存储(一期只接受 +86);邮箱整体转小写后比较;两者都必须已验证,并且能接收验证码。
  - 用户名不需要验证,不能接收验证码,只能配合密码使用;3–32 位字母、数字或 `. _ -`,不区分大小写(不含 `@`、`+`,不会与邮箱或手机号混淆)。
- **External Identity**:由 Provider 实例和其侧的用户 ID 组成,不对 Application 暴露。
- **Credential**:见 [authentication.md](authentication.md)。

## 不变式

1. **至少一个可登录途径**:User 至少要有以下之一:手机号、邮箱、用户名 + 密码、External Identity。最后一个途径不允许解绑。
2. **登录即注册**:用池内不存在的手机号或邮箱完成验证时,自动创建 User。不提供"关闭注册"开关。
3. **永不合并**:要绑定的 Identifier 或 External Identity 已属于其他 User 时,直接拒绝;User 需先在那边解绑或注销。(ADR 0003)
4. **不自动关联**:Provider 返回的邮箱或手机号不会把新的 External Identity 关联到已有 User;只能由已登录的 User 主动绑定。
5. **设密码的前提**:至少要有一个 Identifier。只有 External Identity 的 User 不能设密码。
6. **"必须绑定手机号"开关**:实例级,默认关闭。打开后,没有手机号的 User 登录时须先补绑。

## 对 Application 暴露

- `sub`:User ID,public 类型,不用手机号。
- `phone` scope:`phone_number`,`phone_number_verified` 恒为 true。
- `email` scope:`email`,`email_verified` 恒为 true。
- External Identity 和用户名不暴露。

## 账号生命周期

### 换绑与解绑

- 都要求**近期重新认证**:10 分钟内用任一方式认证过;已开启 2FA 的,必须包含 TOTP 或 Passkey。
- 新的手机号或邮箱要用验证码验证;旧的不要求。
- 解绑规则相同,受不变式 1 约束。
- 换绑后不踢其他 Session。

### 找回

User 无法自助找回丢失的唯一途径。由持有 `users:write` 的管理员线下核实身份后,在管理端替换 Identifier 或重置 2FA,并写入审计日志。只有用户名的 User 丢了密码,同样只能由其他管理员处理。

### 运营商二次放号

不专门处理,作为已知风险写进部署文档。开了 2FA 或 Passkey 的 User 不受影响。

### 注销

- **发起**:账号中心,或直连 API(供 App 内注销,满足 App Store 要求)。
- **前提**:近期重新认证,并二次确认。
- **生效**:立即生效,没有冷静期。
- **删除范围**:物理删除 User、Identifier、External Identity、Credential、Session、Role 分配、同意记录,并吊销所有 refresh token。审计日志只保留 `sub` 和事件。
- **释放与复用**:`sub` 永不复用;Identifier 立即释放,同一个手机号可以马上注册为新 User。
- **外部吊销**:触发 Provider 的注销回调(如 Apple 吊销令牌)。
- **通知 Application**:向配置了 webhook 的每个 Application 发送 `user.deleted` 事件,见 [protocol.md](protocol.md#webhook)。

### 管理员对 User 的操作

- **禁用**:禁止登录,并终止全部 Session;可以恢复。
- **删除**:效果等同注销。
- **替换 Identifier**、**重置 2FA**、**下线 Session**。
- **保护规则**:最后一个「所有者」不能被删除、禁用或降级。
