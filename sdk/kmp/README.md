# Stars Auth KMP SDK

iOS 和 Android App 不经浏览器登录 Stars Auth:验证码、密码、刷新、登出、注销账号。只管协议,不带界面。行为约定见 [SDK 行为说明](../../docs/sdk-behavior.md)。

SDK 0.x 支持服务端 API v1。

## 安装

Android / KMP:

```kotlin
implementation("com.starsdom.auth:stars-auth:0.1.0")
```

iOS:KMP 工程直接依赖;纯 Swift 工程用 `./gradlew assembleStarsAuthXCFramework` 产出的 `StarsAuth.xcframework`。

## 接入

先在管理端登记一个 public Application(开启 refresh token,配好默认 API),并登记 Team ID + Bundle ID、包名 + 签名指纹。

```kotlin
// Android
val auth = StarsAuth(StarsAuthConfig("https://auth.example.com", clientId = "nav-app"), KeystoreTokenStore(context))
// iOS (Kotlin);Swift 中同名
val auth = StarsAuth(StarsAuthConfig("https://auth.example.com", clientId = "nav-app"), KeychainTokenStore())
```

整个 App 只建一个实例:single-flight 刷新只在同一实例内成立。

### 验证码登录

```kotlin
val terms = auth.terms()                        // 勾选框链接 terms.termsUrl / terms.privacyUrl
val sent = auth.sendCode("+8613800000000", terms.version)   // 先算 PoW,约一秒
when (val step = auth.verifyCode(sent.session, code)) {
  SignInStep.SignedIn -> …
  is SignInStep.PhoneRequired -> {               // 实例要求绑定手机号
    val phoneSent = auth.sendCode(phone, step.session)
    auth.verifyCode(phoneSent.session, phoneCode)
  }
  is SignInStep.CodeSent -> Unit                 // 不会出现
}
```

密码登录:`auth.signInWithPassword(identifier, password, terms.version)`(用户名、手机号或邮箱),结果同上。

出错抛 `StarsAuthException`:`error == "invalid_request"` 时 `description` 可直接展示(验证码错误、发送太频繁等)。

### 调用业务后端

```kotlin
client.get(url) { bearerAuth(auth.accessToken()) }
```

`accessToken()` 自动刷新,并发调用只刷新一次。抛出 `error == StarsAuthException.SIGNED_OUT` 时回到登录页。

### 登出与注销

- 登出:`auth.signOut()`,离线也会清空本地令牌。
- 注销(应用商店要求 App 内提供入口):二次确认后让 User 重新登录一次,再调 `auth.deleteAccount()`;超过 10 分钟未登录会抛 `StarsAuthException.REAUTHENTICATE`。

### 自动填充验证码

- iOS:`textContentType = .oneTimeCode`(SwiftUI:`.textContentType(.oneTimeCode)`),键盘上方会出现短信里的验证码。
- Android(Compose):`Modifier.semantics { contentType = ContentType.SmsOtpCode }`;View 体系:`android:autofillHints="smsOTPCode"`(`View.AUTOFILL_HINT_SMS_OTP`)。
- 输入框只放一个,6 位数字,`keyboardType` 为数字。

### 自定义存储

实现 `TokenStore`(`read()` / `write(value)`,`null` 表示登出),传给 `StarsAuth`。

## 业务后端校验 access token

用主流 JWT 库按 JWKS 本地验签,检查签名(RS256)、`iss`、`aud`(你的 API 标识)、`typ: at+jwt`,权限读 `entitlements`。Node(`jose`):

```js
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://auth.example.com/jwks"));

export async function verify(authorization) {
  const token = authorization?.replace(/^Bearer /, "");
  const { payload } = await jwtVerify(token, jwks, {
    issuer: "https://auth.example.com",
    audience: "urn:example:nav-api",
    typ: "at+jwt",          // 挡住同一把密钥签的 ID token
    algorithms: ["RS256"],
  });
  return { sub: payload.sub, entitlements: payload.entitlements ?? [] };
}
```

吊销最多滞后一个 access token 的寿命(10 分钟)。

## 开发

```bash
./gradlew testAndroidHostTest       # 单元测试(iOS 目标在 Linux 上只编译)
scripts/integration.sh              # 对本地 Stars Auth 二进制跑集成测试;需要 Docker 和 web/dist/client
```

发布到 Maven Central:在 `~/.gradle/gradle.properties` 配好 `mavenCentralUsername`、`mavenCentralPassword` 与 `signing.*`(或 `signingInMemoryKey*`),改 `gradle.properties` 的 `VERSION_NAME`,然后 `./gradlew publishAndReleaseToMavenCentral`。
