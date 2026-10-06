# 管理端与账号中心

两者都内嵌在二进制中,技术栈为 TanStack + shadcn/ui(Base UI 原语)。管理端是内置的 First-party Application,经 OIDC 登录,数据全部来自 Management API。原型(一次性)见分支 `prototype/console-ui`:管理端方案 C,账号中心方案 A。

## 管理端:顶部分组

| 分组 | 内容 | 所需 Permission |
|---|---|---|
| **概览** | 统计数字(User 数、今日登录、活跃 Session、Application 数)和最近事件。不做配置健康清单。 | `users:read` |
| **身份** | User 列表(搜索 sub、手机号、邮箱、用户名;"角色"列;按角色筛选)。点一行从右侧滑出 User 详情:Identifier 与外部身份、安全状态、Role 分配,以及禁用、删除、替换 Identifier、重置 2FA、下线 Session 等操作。 | `users:*`、`roles:assign`、`admin-roles:assign` |
| **接入** | Application(类型、client_id、默认 API、Session 寿命、webhook URL 与签名密钥、App 关联信息);API 及其 Permission、Role、默认 Role。 | `applications:*` |
| **安全** | 登录策略(密码三档、Passkey、2FA、必须绑定手机号、管理员必须启用 2FA、每日发送上限、协议 URL 与版本、审计保留期);通道(按短信、邮件分组,选一个并填写参数,可发送测试码);认证服务商(添加实例、启用 / 停用);签名密钥(列表与轮换)。 | `config:*`、`keys:rotate` |
| **审计** | 按条件筛选的审计日志;导出 CSV(二期)。 | `audit:read` |

- **按钮可见性**:缺少相应 Permission 的操作按钮不显示。
- **密钥字段**:只写不回显,只显示"已设置 · 更新于 X",只能整体替换。

## 账号中心:单页长滚动

面向 User,桌面和手机共用一个页面,从上到下依次是:

1. **头部**:头像和主标识。
2. **登录方式**:手机号、邮箱(更换、解绑)、外部身份(解除绑定;"绑定其他账号"只列出管理员启用的 Provider)。
3. **安全**:密码(开关允许时显示)、Passkey(列表与添加)、两步验证(开关与恢复码)。
4. **设备与会话**:每个 Session 的设备、地点、最近活动,可以下线;已结束的 Session 显示 30 天。
5. **数据与隐私**:导出我的数据(JSON)。
6. **危险操作**:注销账号(重新认证,并输入"注销"确认)。

所有敏感操作都在弹窗里先完成近期重新认证,规则见 [identity.md](identity.md#换绑与解绑)。
