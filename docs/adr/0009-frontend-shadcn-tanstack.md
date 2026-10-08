# 前端:组件用 shadcn 官方组件,数据走路由 loader,表单用 TanStack Form + zod

管理端和账号中心只用一套交互:shadcn 有的组件一律用 shadcn 官方组件(`components/ui/`),不再自行封装。`components/ui/` 可以改,但只改 variant 和配色 token,不改结构。

路由按目录组织,与 URL 一一对应:`routes/console/route.tsx` 是布局,子页面是 `routes/console/apps/$clientId.tsx` 这样的文件;只被某组路由使用的组件放在该目录的 `-components/` 下。Panel、面包屑和页头由布局根据路由的 `staticData` / loader 数据统一渲染,子页面只渲染内容;区块级组件(`Section`、`SaveBar`、`DangerZone`)放 `routes/console/-components/`,同样用 shadcn 拼。`components/` 只放跨路由共用的组件,`lib/` 放与路由无关的纯函数、query 和 schema。

路由按 TanStack Router 的惯例写:`beforeLoad` 做登录守卫并把 `me` 放进 context;页面数据由 `loader` 调 `ensureQueryData` 预取,组件用 `useSuspenseQuery` 读取;加载、出错、找不到分别交给路由的 `pendingComponent`(Skeleton)、`errorComponent`(Alert + 重试)、`notFoundComponent`。只有部分角色能读的数据仍在组件里用 `useQuery` + `enabled`。search 参数用 zod schema + `.catch(默认值)`,默认值由 `stripSearchParams` 从 URL 去掉。

表单用 TanStack Form,zod schema 直接作为 validators,错误显示在 shadcn `FieldError`。第一次提交时才校验,之后逐字段随输入重新校验。schema 放在 `src/lib/<领域>.ts`,配 `node --test`。前端只做简单规则(必填、格式、长度、字符集);唯一性等业务规则以服务端为准,服务端拒绝时在表单内显示 Alert。

反馈:"已保存"和页面级操作的失败用 Sonner toast,右下角;失败的 toast 不自动消失。弹窗里的错误留在弹窗里。

## Considered Options

- **继续自行封装**:每个页面各写一套错误行、确认框和空状态,交互和无障碍处理(label 关联、alertdialog 焦点)不一致。
- **表单只用 FormData + `schema.safeParse`**:不加依赖,但字段级错误、touched 状态要自己管理;TanStack Form 已经装了,而且是 shadcn 文档给出的搭配。
- **所有反馈都用 toast**:页面加载失败时 toast 会消失,页面上什么也不剩,所以加载失败交给路由的 errorComponent。

## Consequences

- 前端校验规则是服务端规则的副本,两边可能不一致;服务端始终是最终裁决。
- 升级 shadcn 组件时,`components/ui/` 里改过的 variant 需要手动合并。
