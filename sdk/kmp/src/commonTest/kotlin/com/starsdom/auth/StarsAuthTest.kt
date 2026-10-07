package com.starsdom.auth

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import io.ktor.http.parseQueryString
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withContext
import kotlinx.io.IOException

/** A Stars Auth that answers by path; tests set the answers they need. */
class FakeServer {
  val forms = mutableListOf<Pair<String, Map<String, String>>>()
  var handlers = mutableMapOf<String, MockRequestHandleScope.(Map<String, String>) -> HttpResponseData>()
  val store = MemoryTokenStore()

  fun calls(path: String) = forms.count { it.first == path }

  fun auth() = StarsAuth(
    StarsAuthConfig(issuer = "https://auth.test", clientId = "app"),
    store,
    HttpClient(MockEngine { req ->
      val form = formOf(req)
      forms += req.url.encodedPath to form
      handlers[req.url.encodedPath]?.invoke(this, form) ?: respond("", HttpStatusCode.NotFound)
    }),
  )

  private fun formOf(req: HttpRequestData): Map<String, String> {
    val body = req.body as? OutgoingContent.ByteArrayContent ?: return emptyMap()
    return parseQueryString(body.bytes().decodeToString()).entries().associate { it.key to it.value.single() }
  }
}

fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.OK) =
  respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))

const val solvableChallenge = """{"parameters":{"algorithm":"PBKDF2/SHA-256","nonce":"554e47b3e19cb6fd8f7e8c23ead53957","salt":"2c5905e1896874850e3377650b76c0ff","cost":1,"keyLength":32,"keyPrefix":""},"signature":"x"}"""

fun tokens(n: Int, expiresIn: Int = 600) =
  """{"access_token":"at$n","refresh_token":"rt$n","id_token":"id$n","token_type":"Bearer","expires_in":$expiresIn}"""

class StarsAuthTest {
  private val server = FakeServer().apply {
    handlers["/altcha/challenge"] = { json(solvableChallenge) }
    handlers["/token"] = { json(tokens(1)) }
  }

  @Test
  fun passwordSignInStoresTheTokens() = runTest {
    server.handlers["/v1/auth/challenge"] = { json("""{"authorization_code":"c1"}""") }
    val auth = server.auth()

    assertEquals(SignInStep.SignedIn, auth.signInWithPassword("alice", "secret123", termsVersion = "2026-01"))

    val (_, challenge) = server.forms.first { it.first == "/v1/auth/challenge" }
    assertEquals("alice", challenge["username"])
    assertEquals("2026-01", challenge["terms_version"])
    assertEquals("S256", challenge["code_challenge_method"])
    val (_, token) = server.forms.first { it.first == "/token" }
    assertEquals("authorization_code", token["grant_type"])
    assertEquals("c1", token["code"])
    assertEquals("app", token["client_id"])
    assertEquals(43, token["code_verifier"]!!.length)
    assertEquals("at1", auth.accessToken())
    assertEquals("id1", auth.tokens()?.idToken)
  }

  @Test
  fun codeSignInBindsAPhoneWhenAsked() = runTest {
    server.handlers["/v1/auth/challenge"] = { form ->
      when {
        form["identifier"] == "a@example.com" -> json(insufficient("s1"), HttpStatusCode.Forbidden)
        form["code"] == "000000" -> json("""{"error":"invalid_request","error_description":"验证码错误","auth_session":"s1"}""", HttpStatusCode.BadRequest)
        form["code"] == "111111" -> json(insufficient("s1"), HttpStatusCode.Forbidden)
        form["identifier"] == "+8613800000000" -> json(insufficient("s1"), HttpStatusCode.Forbidden)
        form["code"] == "222222" -> json("""{"authorization_code":"c1"}""")
        else -> error("unexpected $form")
      }
    }
    val auth = server.auth()

    val sent = auth.sendCode("a@example.com", termsVersion = "")
    val wrong = assertFailsWith<StarsAuthException> { auth.verifyCode(sent.session, "000000") }
    assertEquals("invalid_request", wrong.error)
    assertEquals("验证码错误", wrong.description)
    val phone = assertIs<SignInStep.PhoneRequired>(auth.verifyCode(sent.session, "111111"))
    val phoneSent = auth.sendCode("+8613800000000", phone.session)
    assertEquals(SignInStep.SignedIn, auth.verifyCode(phoneSent.session, "222222"))

    val steps = server.forms.filter { it.first == "/v1/auth/challenge" }.map { it.second }
    assertNotNull(steps[0]["altcha"])
    assertNotNull(steps[0]["code_challenge"])
    assertTrue(steps.drop(1).all { it["auth_session"] == "s1" && it["terms_version"] == "none" })
    assertNotNull(steps[3]["altcha"])
    assertEquals("at1", auth.accessToken())
  }

  @Test
  fun tenConcurrentCallersShareOneRefresh() = runTest {
    server.store.value = stored(expiresAt = 0)
    server.handlers["/token"] = { json(tokens(2)) }
    val auth = server.auth()

    val got = withContext(Dispatchers.Default) { (1..10).map { async { auth.accessToken() } }.awaitAll() }

    assertEquals(List(10) { "at2" }, got)
    assertEquals(1, server.calls("/token"))
    val form = server.forms.single { it.first == "/token" }.second
    assertEquals("refresh_token", form["grant_type"])
    assertEquals("rt1", form["refresh_token"])
    assertTrue(server.store.value!!.contains("rt2"))
  }

  @Test
  fun aRejectedRefreshTokenSignsOut() = runTest {
    server.store.value = stored(expiresAt = 0)
    server.handlers["/token"] = { json("""{"error":"invalid_grant","error_description":"refresh token reused"}""", HttpStatusCode.BadRequest) }
    val auth = server.auth()

    assertEquals(StarsAuthException.SIGNED_OUT, assertFailsWith<StarsAuthException> { auth.accessToken() }.error)
    assertNull(server.store.value)
    assertNull(auth.tokens())
  }

  @Test
  fun aFailedRefreshKeepsTheTokensForARetry() = runTest {
    server.store.value = stored(expiresAt = 0)
    server.handlers["/token"] = { json("""{"error":"server_error"}""", HttpStatusCode.InternalServerError) }
    val auth = server.auth()

    assertEquals("server_error", assertFailsWith<StarsAuthException> { auth.accessToken() }.error)
    server.handlers["/token"] = { json(tokens(2)) }
    assertEquals("at2", auth.accessToken())
  }

  @Test
  fun signOutRevokesAndForgetsEvenOffline() = runTest {
    server.store.value = stored()
    val auth = server.auth()
    auth.signOut()
    assertEquals(mapOf("token" to "rt1", "token_type_hint" to "refresh_token", "client_id" to "app"), server.forms.single().second)
    assertNull(server.store.value)

    server.store.value = stored()
    server.handlers["/revoke"] = { throw IOException("offline") }
    val offline = server.auth()
    offline.signOut()
    assertNull(server.store.value)
    assertEquals(StarsAuthException.SIGNED_OUT, assertFailsWith<StarsAuthException> { offline.accessToken() }.error)
  }

  @Test
  fun deleteAccountAsksForAFreshSignIn() = runTest {
    server.store.value = stored()
    server.handlers["/v1/auth/delete"] = {
      respond("", HttpStatusCode.Unauthorized, headersOf(HttpHeaders.WWWAuthenticate, """Bearer error="insufficient_user_authentication", max_age="600""""))
    }
    val auth = server.auth()
    assertEquals(StarsAuthException.REAUTHENTICATE, assertFailsWith<StarsAuthException> { auth.deleteAccount() }.error)
    assertNotNull(server.store.value)

    server.handlers["/v1/auth/delete"] = { respond("", HttpStatusCode.NoContent) }
    auth.deleteAccount()
    assertNull(server.store.value)
  }

  @Test
  fun deleteAccountSendsTheAccessToken() = runTest {
    server.store.value = stored()
    var bearer: String? = null
    val auth = StarsAuth(StarsAuthConfig("https://auth.test/", "app"), server.store, HttpClient(MockEngine { req ->
      bearer = req.headers[HttpHeaders.Authorization]
      respond("", HttpStatusCode.NoContent)
    }))
    auth.deleteAccount()
    assertEquals("Bearer at1", bearer)
  }

  @Test
  fun termsComeFromTheServer() = runTest {
    server.handlers["/v1/auth/terms"] = { json("""{"terms_url":"https://t","privacy_url":"https://p","version":"v2"}""") }
    assertEquals(Terms("https://t", "https://p", "v2"), server.auth().terms())
  }
}

fun insufficient(session: String) = """{"error":"insufficient_authorization","auth_session":"$session"}"""

fun stored(expiresAt: Long = 4102444800) = """{"accessToken":"at1","refreshToken":"rt1","idToken":"id1","expiresAt":$expiresAt}"""
