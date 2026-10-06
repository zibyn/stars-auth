# 插件编译期注册,随单个二进制发布

Channel 与 Provider 以仓库内 Go 包的形式实现接口,并在 `init` 中注册,随单个二进制和镜像一起发布;内部接口不承诺稳定。要用官方之外的服务,有两条免写代码的路:通用 OIDC Provider(填 issuer、client_id、secret)和 Webhook Channel(把目标与验证码 POST 到 Operator 指定的 URL)。需要的若不止于此,就 fork 后自行编译。

## Considered Options

- **Go `plugin`(.so)**:动态加载,但要求与主程序同一 Go 版本和依赖版本,Windows 不支持,升级时极易失配。
- **进程外插件(gRPC / HashiCorp go-plugin)**:隔离好、可用任意语言,但要多管理进程与协议版本,违背单二进制单镜像的部署前提,对一人维护者负担过重。

## Consequences

- 新增一个服务商要发新版本,社区贡献走 PR。
- 通用 OIDC Provider 和 Webhook Channel 覆盖了大多数"官方没做"的情况。
