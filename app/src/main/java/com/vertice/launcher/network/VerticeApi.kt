package com.vertice.launcher.network

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.min

/** Cliente HTTP do VÉRTICE. Segredos permanecem no servidor. */
class VerticeApi(private val baseUrl: String) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .build()
    private val json = "application/json; charset=utf-8".toMediaType()

    // Callback para tratar erros de autenticação (401) e assinatura (402)
    var onAuthError: (() -> Unit)? = null
    var onSubscriptionError: (() -> Unit)? = null

    fun login(login: String, password: String): Result<AuthResult> = requestResult {
        val body = JSONObject()
            .put("login", login)
            .put("email", login)
            .put("password", password)
            .toString()
            .toRequestBody(json)
        val req = Request.Builder().url("${clean()}/auth/login").post(body).build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
            val o = JSONObject(r.body!!.string())
            AuthResult(
                o.getString("token"),
                o.getJSONObject("customer").getString("id"),
                o.getJSONObject("customer").optString("email", login),
                o.optString("role", "CUSTOMER")
            )
        }
    }

    fun status(token: String): Result<SubscriptionStatus> = requestResult {
        val req = Request.Builder().url("${clean()}/me")
            .header("Authorization", "Bearer $token").get().build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada. Por favor, faça login novamente.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Sua assinatura não está ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val o = JSONObject(r.body!!.string())
                    val s = o.optJSONObject("subscription")
                    SubscriptionStatus(
                        s?.optString("plan", "basic") ?: "basic",
                        s?.optString("status", "blocked") ?: "blocked",
                        s?.optString("currentPeriodEnd", "") ?: ""
                    )
                }
            }
        }
    }

    fun registerDevice(token: String, deviceId: String, mode: String, deviceName: String,
                       owner: Boolean = false): Result<Unit> = requestResultWithRetry {
        val body = JSONObject()
            .put("deviceId", deviceId)
            .put("mode", mode)
            .put("deviceName", deviceName)
            .toString()
            .toRequestBody(json)
        val endpoint = if (owner) "/owner/devices/register" else "/devices/register"
        val req = Request.Builder().url("${clean()}$endpoint")
            .header("Authorization", "Bearer $token")
            .post(body).build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                }
            }
        }
    }

    fun chat(token: String, message: String, mode: String): Result<AiReply> = requestResultWithRetry {
        val body = JSONObject()
            .put("message", message)
            .put("mode", mode)
            .toString()
            .toRequestBody(json)
        val req = Request.Builder().url("${clean()}/ai/chat")
            .header("Authorization", "Bearer $token")
            .post(body).build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val o = JSONObject(r.body!!.string())
                    val actions = mutableListOf<String>()
                    val arr = o.optJSONArray("actions")
                    if (arr != null) for (i in 0 until arr.length())
                        actions.add(arr.getJSONObject(i).optString("label"))
                    AiReply(o.optString("answer"), actions)
                }
            }
        }
    }

    fun sendCommand(token: String, command: String, mode: String, deviceId: String,
                    imageBase64: String? = null, owner: Boolean = false): Result<CommandResult> = requestResultWithRetry {
        val body = JSONObject()
            .put("command", command)
            .put("mode", mode)
            .put("deviceId", deviceId)
            .put("scope", "somente_o_solicitado")
            .put("preservar_demais_configuracoes", true)
            .apply { if (imageBase64 != null) put("imageBase64", imageBase64) }
            .toString()
            .toRequestBody(json)
        val endpoint = if (owner) "/owner/commands" else "/commands"
        val req = Request.Builder().url("${clean()}$endpoint")
            .header("Authorization", "Bearer $token")
            .post(body).build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val o = JSONObject(r.body!!.string())
                    CommandResult(o.optString("id"), o.optString("status"), o.optString("message"))
                }
            }
        }
    }

    fun commands(token: String): Result<List<CommandResult>> = requestResultWithRetry {
        val req = Request.Builder().url("${clean()}/commands")
            .header("Authorization", "Bearer $token").get().build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val arr = JSONObject(r.body!!.string()).getJSONArray("commands")
                    buildList {
                        for (i in 0 until arr.length()) {
                            val x = arr.getJSONObject(i)
                            add(CommandResult(
                                x.optString("id"),
                                x.optString("status"),
                                x.optString("message", "")  // FIX: Use message field, not command
                            ))
                        }
                    }
                }
            }
        }
    }

    fun nextCommand(token: String, deviceId: String): Result<QueuedCommand?> = requestResultWithRetry {
        val req = Request.Builder().url("${clean()}/commands/next?deviceId=${java.net.URLEncoder.encode(deviceId, "UTF-8")}")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val body = r.body?.string().orEmpty()
                    val o = JSONObject(body)
                    if (o.isNull("command")) null else {
                        val x = o.getJSONObject("command")
                        QueuedCommand(
                            x.getString("id"),
                            x.optString("command"),
                            x.optString("mode"),
                            x.optString("status")
                        )
                    }
                }
            }
        }
    }

    fun updateCommandStatus(token: String, id: String, status: String, message: String): Result<Unit> = requestResultWithRetry {
        val body = JSONObject()
            .put("status", status)
            .put("message", message)
            .toString()
            .toRequestBody(json)
        val req = Request.Builder().url("${clean()}/commands/$id/status")
            .header("Authorization", "Bearer $token")
            .post(body).build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                }
            }
        }
    }

    fun monthlyReport(token: String): Result<SalesReport> = requestResultWithRetry {
        val req = Request.Builder().url("${clean()}/reports/monthly")
            .header("Authorization", "Bearer $token").get().build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val o = JSONObject(r.body!!.string()).getJSONObject("report")
                    SalesReport(
                        o.optString("month"),
                        o.optDouble("grossRevenue"),
                        o.optDouble("netRevenue"),
                        o.optInt("salesCount"),
                        o.optInt("activeSubscriptions"),
                        o.optInt("cancellations"),
                        o.optInt("delinquent"),
                        o.optDouble("ticketAverage")
                    )
                }
            }
        }
    }

    fun ranking(token: String): Result<RankingInfo> = requestResultWithRetry {
        val req = Request.Builder().url("${clean()}/ranking")
            .header("Authorization", "Bearer $token").get().build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val o = JSONObject(r.body!!.string())
                    val x = o.getJSONObject("ranking")
                    RankingInfo(
                        if (x.isNull("position")) null else x.optInt("position"),
                        x.optInt("total"),
                        x.optInt("score"),
                        o.getJSONObject("benchmark").optInt("topScore")
                    )
                }
            }
        }
    }

    fun adminOverview(token: String): Result<AdminOverview> = requestResultWithRetry {
        val req = Request.Builder().url("${clean()}/admin/overview")
            .header("Authorization", "Bearer $token").get().build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val o = JSONObject(r.body!!.string())
                    AdminOverview(
                        o.optInt("customers"),
                        o.optInt("activeSubscriptions"),
                        o.optInt("devices"),
                        o.optInt("commandsToday"),
                        o.optDouble("salesMonth")
                    )
                }
            }
        }
    }

    fun adminCustomers(token: String): Result<List<AdminCustomer>> = requestResultWithRetry {
        val req = Request.Builder().url("${clean()}/admin/customers")
            .header("Authorization", "Bearer $token").get().build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val arr = JSONObject(r.body!!.string()).getJSONArray("customers")
                    buildList {
                        for (i in 0 until arr.length()) {
                            val o = arr.getJSONObject(i)
                            add(AdminCustomer(
                                o.getString("id"),
                                o.getString("email"),
                                o.optString("createdAt"),
                                o.optString("subscriptionStatus"),
                                o.optString("plan"),
                                o.optInt("devices"),
                                o.optInt("commands")
                            ))
                        }
                    }
                }
            }
        }
    }

    fun createSaleOrder(token: String, product: String, amount: Double,
                        description: String? = null): Result<SaleCheckout> = requestResultWithRetry {
        val body = JSONObject()
            .put("product", product)
            .put("amount", amount)
            .apply { if (!description.isNullOrBlank()) put("description", description) }
            .toString()
            .toRequestBody(json)
        val req = Request.Builder().url("${clean()}/sales/orders")
            .header("Authorization", "Bearer $token")
            .post(body).build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val o = JSONObject(r.body!!.string())
                    SaleCheckout(
                        o.getString("saleId"),
                        o.optString("orderId"),
                        o.optString("status"),
                        o.getString("checkoutUrl")
                    )
                }
            }
        }
    }

    fun sales(token: String, month: String? = null): Result<SalesList> = requestResultWithRetry {
        val suffix = if (month.isNullOrBlank()) "" else "?month=${java.net.URLEncoder.encode(month, "UTF-8")}"
        val req = Request.Builder().url("${clean()}/sales$suffix")
            .header("Authorization", "Bearer $token").get().build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    val o = JSONObject(r.body!!.string())
                    val summary = o.getJSONObject("summary")
                    val arr = o.getJSONArray("sales")
                    val items = buildList {
                        for (i in 0 until arr.length()) {
                            val x = arr.getJSONObject(i)
                            add(SaleItem(
                                x.getString("id"),
                                x.optDouble("amount"),
                                x.optString("product"),
                                x.optString("status"),
                                x.optString("checkoutUrl"),
                                x.optString("paidAt"),
                                x.optString("createdAt")
                            ))
                        }
                    }
                    SalesList(
                        o.optString("month"),
                        summary.optDouble("grossRevenue"),
                        summary.optInt("paidCount"),
                        summary.optInt("totalCount"),
                        items
                    )
                }
            }
        }
    }

    fun syncSale(token: String, saleId: String): Result<String> = requestResultWithRetry {
        val req = Request.Builder().url("${clean()}/sales/orders/$saleId/sync")
            .header("Authorization", "Bearer $token")
            .post("{}".toRequestBody(json)).build()
        http.newCall(req).execute().use { r ->
            when (r.code) {
                401 -> {
                    onAuthError?.invoke()
                    error("Sessão expirada.")
                }
                402 -> {
                    onSubscriptionError?.invoke()
                    error("Assinatura não ativa.")
                }
                else -> {
                    if (!r.isSuccessful) error(readError(r.code, r.body?.string()))
                    JSONObject(r.body!!.string()).optString("status", "pending")
                }
            }
        }
    }

    private fun clean() = baseUrl.trimEnd('/')

    /**
     * Retry com exponential backoff para falhas de rede (não aplica a 401/402/422).
     * Max 3 tentativas com delay: 100ms, 300ms, 900ms
     */
    private fun <T> requestResultWithRetry(block: () -> T): Result<T> {
        var lastException: Exception? = null
        var delayMs = 100L
        
        repeat(3) { attempt ->
            try {
                return runCatching { block() }
            } catch (e: Exception) {
                lastException = e
                val isAuthError = e.message?.contains("Sessão expirada") == true ||
                                  e.message?.contains("Assinatura não ativa") == true
                if (isAuthError) {
                    return Result.failure(e)  // Não retenta erros de auth
                }
                if (attempt < 2) {
                    Thread.sleep(delayMs)
                    delayMs = min(delayMs * 3, 3000)  // Cap at 3s
                }
            }
        }
        
        return Result.failure(lastException ?: Exception("Falha na requisição HTTP"))
    }

    private fun <T> requestResult(block: () -> T): Result<T> = runCatching(block)

    private fun readError(code: Int, body: String?): String {
        val message = try {
            JSONObject(body ?: "{}").optString("error")
        } catch (_: Exception) {
            ""
        }
        
        return when {
            message.isNotBlank() -> message
            code == 401 -> "Não autenticado"
            code == 402 -> "Assinatura não está ativa"
            code == 403 -> "Acesso negado"
            code == 404 -> "Recurso não encontrado"
            code == 422 -> "Dados inválidos"
            code >= 500 -> "Erro no servidor. Tente novamente."
            else -> "Erro HTTP $code"
        }
    }
}

data class AuthResult(val token: String, val customerId: String, val email: String, val role: String)
data class AiReply(val answer: String, val actions: List<String>)
data class SubscriptionStatus(val plan: String, val status: String, val currentPeriodEnd: String)
data class CommandResult(val id: String, val status: String, val message: String)
data class QueuedCommand(val id: String, val command: String, val mode: String, val status: String)
data class SalesReport(
    val month: String, val grossRevenue: Double, val netRevenue: Double,
    val salesCount: Int, val activeSubscriptions: Int, val cancellations: Int,
    val delinquent: Int, val ticketAverage: Double
)
data class RankingInfo(val position: Int?, val total: Int, val score: Int, val topScore: Int)
data class AdminOverview(
    val customers: Int, val activeSubscriptions: Int, val devices: Int,
    val commandsToday: Int, val salesMonth: Double
)
data class AdminCustomer(
    val id: String, val email: String, val createdAt: String,
    val subscriptionStatus: String, val plan: String, val devices: Int, val commands: Int
)
data class SaleCheckout(val saleId: String, val orderId: String, val status: String, val checkoutUrl: String)
data class SaleItem(
    val id: String, val amount: Double, val product: String, val status: String,
    val checkoutUrl: String, val paidAt: String, val createdAt: String
)
data class SalesList(
    val month: String, val grossRevenue: Double, val paidCount: Int,
    val totalCount: Int, val sales: List<SaleItem>
)
