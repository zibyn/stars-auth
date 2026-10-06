# internal/oidc

OIDC 协议层,由 [`luikyv/go-oidc`](https://github.com/luikyv/go-oidc) v0.25.0 并入(ADR 0001)。

- 上游 commit:`6aeac93f370044ca9a59a556b9230cd10bd96868`(tag `v0.25.0`)
- 许可证:MIT,原文见 [LICENSE](LICENSE),须随代码保留。
- 布局:上游 `pkg/goidc`、`pkg/provider` → `goidc/`、`provider/`;上游 `internal/*` → `internal/*`;
  上游 `examples/oidc` 与其依赖 → `conformance/`(只用于 conformance 回归,不进主二进制)。
- 并入后不再跟随上游 API;安全修复需人工比对上游。
