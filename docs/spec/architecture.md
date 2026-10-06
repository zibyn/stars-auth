# 架构

## 部署形态

- **单个 Go 二进制**:内嵌并托管管理端、账号中心、托管登录页的静态资源;以单镜像形式发布。
- **唯一外部依赖**:PostgreSQL 15+。不使用 Redis。(ADR 0005)
- **进程无状态**:进程内不保存任何需要在副本间共享的状态,允许多个副本连同一个 PG;主流场景是单实例。
- **只监听 HTTP**:部署在反向代理之后,只信任已配置代理传来的 `X-Forwarded-*`;issuer 必须是 https,启动时检查。
- **规模假设**:约一万 User。

## 存储

- 只支持 PostgreSQL。数据访问用 sqlc 从手写 SQL 生成代码,不用 ORM;go-oidc 的存储接口实现在这一层之上。
- 短命数据(验证码、PoW 题目、限流计数、登录过程中的临时状态、Grant 记录)也放 PG,带过期时间,由每小时一次的定时任务清理。
- 迁移用 goose,脚本嵌入二进制,启动时自动执行;只能向前升级。多副本时用 PG advisory lock 保证只有一个副本执行迁移。

## OIDC 协议层

- 以 `luikyv/go-oidc` v0.25.0 为起点并入仓库(保留 MIT 版权声明,记录上游 commit),按目录删除用不上的部分:Federation、VC、CIBA、device、PAR、JAR、JARM、token exchange、jwt-bearer、pre-auth code、DCR、mTLS、FAPI。每删一块都跑一次 conformance 回归。(ADR 0001)
- JOSE 与密码学只依赖 `go-jose/v4` 和标准库,不手写。

## 插件

两类插件,都是仓库内的 Go 包,实现接口后在 `init` 中注册,随二进制发布;内部接口不承诺稳定。(ADR 0004)

| 类型 | 职责 | 产出 | 实例数 |
|---|---|---|---|
| **Channel** | 把 Stars Auth 生成的验证码投递到手机号或邮箱 | 投递结果 | 每种 Identifier(短信、邮件)同时只启用一个,不做故障切换 |
| **Provider** | 由外部服务证明"这是谁" | 一个已验证的 Identifier(如一键登录给出的手机号),**或**一个 External Identity | 可以配多个实例,每个实例都是独立的服务商 |

- **核心能力不做成插件**:验证码登录、密码、Passkey、TOTP。
- **两个免写代码的通用插件**:
  - **Webhook Channel**:把 `{"to": 目标, "code": 验证码}` POST 到管理员指定的 URL,返回 2xx 即视为送达;请求头 `X-Stars-Signature: t=<秒>,v1=<hex HMAC-SHA256(密钥, "<t>.<body>")>`,接收方应拒绝过旧的 `t` 以防重放;
  - **通用 OIDC Provider**:填 issuer、client_id、secret 即可接入。
- **Apple Provider**:单独实现(自签 JWT 作 client secret、form_post 回调、姓名只在首次登录返回),内部复用通用 OIDC 的代码。
- **Provider 的交互形态**:Provider 声明自己支持哪种,或两种都支持。
  - **重定向型**:托管登录页跳到服务商,再接收回调;
  - **客户端令牌型**:客户端从平台拿到令牌,提交到直连 API,并带上 Provider 实例 ID。
- **Provider 的可选回调**:解绑或注销时触发,用于吊销第三方令牌(Apple 必需)。
- **配置 schema**:每个插件声明自己的配置字段(类型、是否为密钥字段),管理端据此自动渲染表单。
- **服务商附带的信息**:Provider 返回的邮箱等附带信息一律忽略,不据此关联 User。
- **一期内置插件**:
  - Channel:阿里云短信认证、SMTP、Webhook;
  - Provider:无(通用 OIDC 与 Apple 在二期)。

## 配置与密钥

- **环境变量**只放启动必需项,不使用配置文件:
  - PG 连接串;
  - 主密钥:`STARS_AUTH_MASTER_KEY` 或 `STARS_AUTH_MASTER_KEY_FILE`;
  - 对外 URL(即 issuer);
  - 监听地址;
  - 信任的代理。
- **其余配置全部存 PG**,由管理端经 Management API 修改,包括插件配置、登录策略、Application、API、Role 等。多副本之间以秒级缓存同步。
- **加密**:插件的密钥字段、OIDC 签名私钥、TOTP 密钥用主密钥做 AES-256-GCM 加密后入库,密文带密钥版本号。密码和恢复码只做哈希。
- **主密钥轮换**:离线命令 `stars-auth rotate-master-key`,同时给出新旧两把密钥,一次性重新加密全部数据(二期)。
- **主密钥丢失**:所有加密数据都无法还原,部署文档须醒目提示备份。
- **签名私钥**:首次启动时自动生成 RS256 私钥,不支持导入;由管理员在管理端手动轮换,轮换期间 JWKS 新旧两把密钥并存。

## 首次启动引导

1. 没有任何管理员时,启动后在日志中打印一次性 setup token。
2. 带 token 打开引导页,设置用户名和密码,创建第一个 User,并赋予 Management API 的「所有者」Role。全程不需要任何 Channel。
3. 引导完成后,引导页永久关闭,token 失效。

没有后门:所有管理员都无法登录时,只能直接改数据库。(ADR 0006、0007)
