package com.starsdom.auth

import io.ktor.client.HttpClient
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Parameters
import io.ktor.http.ParametersBuilder
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.io.encoding.Base64
import kotlin.time.Clock
import kotlin.uuid.Uuid

public class StarsAuthConfig(
  /** Stars Auth's address, e.g. `https://auth.example.com`. */
  public val issuer: String,
  /** The App's Application (public) in Stars Auth. */
  public val clientId: String,
  public val scope: String = "openid offline_access",
)

/** The tokens of a signed-in User; [expiresAt] is the access token's expiry in Unix seconds. */
@Serializable
public data class Tokens(
  val accessToken: String,
  val refreshToken: String? = null,
  val idToken: String? = null,
  val expiresAt: Long,
)

/** What the terms checkbox links to, and the version to sign in with once it is ticked. */
public data class Terms(val termsUrl: String, val privacyUrl: String, val version: String)

/** A sign-in in progress; pass it to the next step. */
public class AuthSession internal constructor(
  internal val id: String,
  internal val verifier: String,
  internal val termsVersion: String,
)

public sealed interface SignInStep {
  public data object SignedIn : SignInStep
  /** A code went out: ask for it and call [StarsAuth.verifyCode]. */
  public class CodeSent(public val session: AuthSession) : SignInStep
  /** The instance wants a phone number the User has not bound: [StarsAuth.sendCode] to one with this session. */
  public class PhoneRequired(public val session: AuthSession) : SignInStep
  /** The User has 两步验证 on: ask for a code from their authenticator ([StarsAuth.verifyTotp]) or a 恢复码 ([StarsAuth.verifyRecoveryCode]). */
  public class TotpRequired(public val session: AuthSession) : SignInStep
}

/**
 * An error from Stars Auth or the SDK. [error] is the OAuth error code, or
 * one of the constants below; for `invalid_request` [description] says what
 * the User got wrong in words fit to show.
 */
public class StarsAuthException(public val error: String, public val description: String? = null) :
  Exception(if (description == null) error else "$error: $description") {
  public companion object {
    /** No User is signed in, or their Session ended (signed out elsewhere, refresh token reused, deleted). Sign in again. */
    public const val SIGNED_OUT: String = "signed_out"
    /** Deleting the account needs a sign-in in the last 10 minutes: sign in again, then retry. */
    public const val REAUTHENTICATE: String = "insufficient_user_authentication"
    /** The server asked for a sign-in step this SDK version does not know: ask the User to update the App. */
    public const val UNSUPPORTED_STEP: String = "unsupported_step"
  }
}

/**
 * Signs a User in through the direct auth API and holds their tokens.
 * Behaviour (single-flight refresh, reuse, sign-out): docs/sdk-behavior.md.
 */
public class StarsAuth(
  private val config: StarsAuthConfig,
  private val store: TokenStore,
  private val http: HttpClient,
) {
  public constructor(config: StarsAuthConfig, store: TokenStore) : this(config, store, HttpClient())

  private val issuer = config.issuer.trimEnd('/')
  private val json = Json { ignoreUnknownKeys = true }
  // Guards the tokens: one refresh at a time, and sign-in, sign-out and
  // deletion never interleave with one.
  private val mutex = Mutex()
  private var loaded = false
  private var current: Tokens? = null

  @Throws(Exception::class)
  public suspend fun terms(): Terms {
    val r = http.get("$issuer/v1/auth/terms")
    val t = decode<TermsResponse>(r)
    return Terms(t.termsUrl, t.privacyUrl, t.version)
  }

  /** Sends a code to a +86 phone number or an email address. Solves a proof of work first, which takes about a second. */
  @Throws(Exception::class)
  public suspend fun sendCode(identifier: String, termsVersion: String): SignInStep.CodeSent =
    sendCode(identifier, null, termsVersion)

  /** Sends a code within [session], after [SignInStep.PhoneRequired]. */
  @Throws(Exception::class)
  public suspend fun sendCode(identifier: String, session: AuthSession): SignInStep.CodeSent =
    sendCode(identifier, session, session.termsVersion)

  private suspend fun sendCode(identifier: String, session: AuthSession?, termsVersion: String): SignInStep.CodeSent {
    val altcha = altcha()
    return challenge(session, termsVersion) {
      append("identifier", identifier)
      append("altcha", altcha)
    } as? SignInStep.CodeSent ?: throw StarsAuthException("unexpected_response", "sending a code signed in")
  }

  @Throws(Exception::class)
  public suspend fun verifyCode(session: AuthSession, code: String): SignInStep =
    challenge(session, session.termsVersion) { append("code", code) }

  /** Enters a code from the User's authenticator, after [SignInStep.TotpRequired]. */
  @Throws(Exception::class)
  public suspend fun verifyTotp(session: AuthSession, code: String): SignInStep =
    challenge(session, session.termsVersion) { append("totp", code) }

  /** Enters one of the User's 恢复码 instead of a TOTP code, after [SignInStep.TotpRequired]. */
  @Throws(Exception::class)
  public suspend fun verifyRecoveryCode(session: AuthSession, code: String): SignInStep =
    challenge(session, session.termsVersion) { append("recovery_code", code) }

  /** Signs in with an Identifier (username, phone number or email) and its password. */
  @Throws(Exception::class)
  public suspend fun signInWithPassword(identifier: String, password: String, termsVersion: String): SignInStep {
    val altcha = altcha()
    return challenge(null, termsVersion) {
      append("username", identifier)
      append("password", password)
      append("altcha", altcha)
    }
  }

  // About a second of hashing: off the caller's (often the main) thread.
  private suspend fun altcha(): String {
    val challenge = http.get("$issuer/altcha/challenge").bodyAsText()
    return withContext(Dispatchers.Default) { solveAltcha(challenge) }
  }

  private suspend fun challenge(
    session: AuthSession?,
    termsVersion: String,
    step: ParametersBuilder.() -> Unit,
  ): SignInStep {
    val verifier = session?.verifier ?: newVerifier()
    val r = http.submitForm("$issuer/v1/auth/challenge", Parameters.build {
      append("client_id", config.clientId)
      append("terms_version", termsVersion)
      if (session != null) {
        append("auth_session", session.id)
      } else {
        append("response_type", "code")
        append("scope", config.scope)
        append("code_challenge", base64Url.encode(sha256(verifier.encodeToByteArray())))
        append("code_challenge_method", "S256")
      }
      step()
    })
    if (r.status == HttpStatusCode.Forbidden) {
      val e = json.decodeFromString<ErrorResponse>(r.bodyAsText())
      if (e.error == "insufficient_authorization" && e.authSession != null) {
        val next = AuthSession(e.authSession, verifier, termsVersion)
        // Unknown values come from a newer server: fail rather than guess (ADR 0010).
        return when (e.next) {
          "code" -> SignInStep.CodeSent(next)
          "phone" -> SignInStep.PhoneRequired(next)
          "totp" -> SignInStep.TotpRequired(next)
          else -> throw StarsAuthException(StarsAuthException.UNSUPPORTED_STEP, "next step not supported by this SDK version: ${e.next}")
        }
      }
      throw StarsAuthException(e.error, e.description)
    }
    val code = decode<CodeResponse>(r).authorizationCode
    val t = tokenRequest {
      append("grant_type", "authorization_code")
      append("code", code)
      append("code_verifier", verifier)
    }
    mutex.withLock { save(t) }
    return SignInStep.SignedIn
  }

  /** The current tokens, or null when signed out. The access token may have expired: use [accessToken] to call APIs. */
  public suspend fun tokens(): Tokens? = mutex.withLock { load() }

  /**
   * A live access token, refreshed when it has under 30 seconds left. While
   * one refresh is under way, other callers wait for it rather than refresh
   * again. Throws [StarsAuthException.SIGNED_OUT] once the Session is gone.
   */
  @Throws(Exception::class)
  public suspend fun accessToken(): String = mutex.withLock { freshAccessToken() }

  // Call with the mutex held.
  private suspend fun freshAccessToken(): String {
    val t = load() ?: throw signedOut()
    if (t.expiresAt - 30 > now()) return t.accessToken
    val refresh = t.refreshToken ?: run { save(null); throw signedOut() }
    // Not cancellable: once the server rotates, dropping the answer would
    // leave only the spent token, whose reuse ends the Session.
    return withContext(NonCancellable) {
      val fresh = try {
        tokenRequest {
          append("grant_type", "refresh_token")
          append("refresh_token", refresh)
        }
      } catch (e: StarsAuthException) {
        // The refresh token is dead: revoked, expired, or reused (which ends
        // the Session on the server). Other failures keep it for a retry.
        if (e.error == "invalid_grant") { save(null); throw signedOut() }
        throw e
      }
      save(fresh.copy(refreshToken = fresh.refreshToken ?: refresh, idToken = fresh.idToken ?: t.idToken))
      fresh.accessToken
    }
  }

  /** Ends the Session on the server, best effort, and forgets the tokens whatever happens. */
  @Throws(Exception::class)
  public suspend fun signOut(): Unit = mutex.withLock {
    val refresh = load()?.refreshToken
    try {
      if (refresh != null) {
        http.submitForm("$issuer/revoke", Parameters.build {
          append("token", refresh)
          append("token_type_hint", "refresh_token")
          append("client_id", config.clientId)
        })
      }
    } catch (e: Exception) {
      if (e is CancellationException) throw e
    } finally {
      save(null)
    }
  }

  /**
   * Deletes the User's account at once and signs out. Needs a sign-in in
   * the last 10 minutes, else throws [StarsAuthException.REAUTHENTICATE]:
   * confirm with the User, sign them in again, and call this again.
   */
  @Throws(Exception::class)
  public suspend fun deleteAccount() {
    mutex.withLock {
      val token = freshAccessToken()
      val r = http.post("$issuer/v1/auth/delete") { bearerAuth(token) }
      when {
        r.status.isSuccess() -> save(null)
        r.status == HttpStatusCode.Unauthorized -> {
          val why = r.headers[HttpHeaders.WWWAuthenticate].orEmpty()
          if ("insufficient_user_authentication" in why) throw StarsAuthException(StarsAuthException.REAUTHENTICATE)
          save(null)
          throw signedOut()
        }
        else -> decode<Unit>(r)
      }
    }
  }

  private suspend fun tokenRequest(grant: ParametersBuilder.() -> Unit): Tokens {
    val r = http.submitForm("$issuer/token", Parameters.build {
      grant()
      append("client_id", config.clientId)
    })
    val t = decode<TokenResponse>(r)
    return Tokens(t.accessToken, t.refreshToken, t.idToken, now() + t.expiresIn)
  }

  private fun load(): Tokens? {
    if (!loaded) {
      current = store.read()?.let { runCatching { json.decodeFromString<Tokens>(it) }.getOrNull() }
      loaded = true
    }
    return current
  }

  // Memory first: should the store fail, this instance still holds the
  // rotated refresh token and won't reuse the spent one.
  private fun save(t: Tokens?) {
    current = t
    loaded = true
    store.write(t?.let { json.encodeToString(it) })
  }

  private suspend inline fun <reified T> decode(r: HttpResponse): T {
    val body = r.bodyAsText()
    if (r.status.isSuccess()) return if (T::class == Unit::class) Unit as T else json.decodeFromString(body)
    val e = runCatching { json.decodeFromString<ErrorResponse>(body) }.getOrNull()
    throw StarsAuthException(e?.error ?: "http_${r.status.value}", e?.description)
  }

  private fun signedOut() = StarsAuthException(StarsAuthException.SIGNED_OUT)

  private fun now() = Clock.System.now().epochSeconds
}

private val base64Url = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT)

// RFC 7636: 43 base64url characters. Uuid.random() is cryptographically
// secure on every platform; two give 244 random bits (each fixes 6).
private fun newVerifier(): String = base64Url.encode(Uuid.random().toByteArray() + Uuid.random().toByteArray())

@Serializable private class TermsResponse(
  @SerialName("terms_url") val termsUrl: String,
  @SerialName("privacy_url") val privacyUrl: String,
  val version: String,
)

@Serializable private class CodeResponse(@SerialName("authorization_code") val authorizationCode: String)

@Serializable private class TokenResponse(
  @SerialName("access_token") val accessToken: String,
  @SerialName("refresh_token") val refreshToken: String? = null,
  @SerialName("id_token") val idToken: String? = null,
  @SerialName("expires_in") val expiresIn: Long,
)

@Serializable private class ErrorResponse(
  val error: String,
  @SerialName("error_description") val description: String? = null,
  @SerialName("auth_session") val authSession: String? = null,
  val next: String? = null,
)
