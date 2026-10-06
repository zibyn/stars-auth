# 角色与权限

Stars Auth 负责定义 Role、分配 Role,并把它们写进令牌;访问控制判断由业务后端完成。不做组、组织架构和策略引擎。(ADR 0007)

## 模型

```
API (aud)
├── Permission   key 不可改(如 track:write)+ 显示名
└── Role         key 不可改 + 显示名;是 Permission 的集合;可标记为"默认"
      └── 分配给 User 或 confidential Application(同一 API 上可以有多个,权限取并集)
```

- **默认 Role**:只能在业务 API 上设置。User **创建时**自动获得默认 Role;之后修改默认设置,不影响已有 User。
- **删除 Role**:如果 Role 仍被分配,先提示影响了几个 User 和 Application,确认后连同分配记录一起删除。删除 Permission 时,它也同步从所有 Role 中移除。
- **public Application**(App、SPA):不能持有 Role。

## 令牌中的表现

- access token 按 RFC 9068 §2.2.3.1 携带 `roles`(Role 的 key)和 `entitlements`(展开后的 Permission key),只包含当前 `aud` 那个 API 下的。
- ID token 不带角色,也不使用 `groups`。
- **生效时机**:业务 API 以令牌为准,Role 变更最多滞后 10 分钟。

## Management API

Stars Auth 自带的内置 API,是一套 REST 接口。管理端前端只调用它;业务后端也可以调用。

- **调用凭证**:
  - 管理员登录后拿到的 access token(`aud` 为 Management API);
  - confidential Application 走 `client_credentials` 拿到的令牌(二期)。
- **实时鉴权**:每次请求都从数据库实时读取调用者的 Role,令牌只用来确认是谁,所以降级或撤销立即生效。
- **默认 Role**:不允许设置,免得新注册的人自动成为管理员。
- **内置 Role**:内置 Role 和内置 Permission 不能修改,也不能删除;可以另建自定义 Role。

### 内置 Permission 与 Role

| Permission | 所有者 | 管理员 | 只读 |
|---|---|---|---|
| `users:read` | ✓ | ✓ | ✓ |
| `users:write`(禁用、删除、替换 Identifier、重置 2FA、下线 Session) | ✓ | ✓ | |
| `roles:assign`(分配业务 API 的 Role) | ✓ | ✓ | |
| `admin-roles:assign`(分配 Management API 的 Role) | ✓ | | |
| `applications:read` | ✓ | ✓ | ✓ |
| `applications:write`(Application、API、Role 与 Permission 的定义) | ✓ | ✓ | |
| `config:read` | ✓ | ✓ | ✓ |
| `config:write`(通道、认证服务商、登录策略) | ✓ | ✓ | |
| `keys:rotate` | ✓ | | |
| `audit:read` | ✓ | ✓ | ✓ |

- **管理员**:在 Management API 上持有任一 Role 的 User。首次引导创建的是「所有者」。
- **保护规则**:最后一个所有者不能被删除、禁用或降级。
