# internal/oidc

OIDC 协议层,由 [`luikyv/go-oidc`](https://github.com/luikyv/go-oidc) v0.25.0 并入(ADR 0001)。

- 上游 commit:`6aeac93f370044ca9a59a556b9230cd10bd96868`(tag `v0.25.0`)
- 许可证:MIT,原文见 [LICENSE](LICENSE),须随代码保留。
- 布局:上游 `pkg/goidc`、`pkg/provider` → `goidc/`、`provider/`;上游 `internal/*` → `internal/*`;
  上游 `examples/oidc` 与其依赖 → `conformance/`(只用于 conformance 回归,不进主二进制)。
- 并入后不再跟随上游 API;安全修复需人工比对上游。

## 裁剪

按目录整块删除,每删一块都跑一次 conformance 回归(`conformance/run.sh`,CI 见 `.github/workflows/conformance.yml`):
OpenID Federation、VC 签发(连同只为它存在的 pre-authorized code)、CIBA、device、token exchange、jwt-bearer grant、DCR(连同只为它服务的 client 元数据解析)、PAR、JARM、JAR(连同只为它服务的服务端解密)、mTLS、FAPI。

- `request` / `request_uri` 参数以 `request_not_supported` / `request_uri_not_supported` 拒绝;discovery 显式声明 `request_uri_parameter_supported: false`。
- 运行时只依赖 `go-jose/v4` 与标准库(`google/uuid` 换成 `crypto/rand.Text`);`go-cmp` 仅用于测试。
- 保留但尚未裁剪:DPoP、RAR、resource indicators、introspection、opaque token、attestation 客户端认证;Implicit / Hybrid 仍在代码里,只是 conformance 只测 code flow。
