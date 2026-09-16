package com.vertice.launcher

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.vertice.launcher.network.QueuedCommand
import com.vertice.launcher.network.VerticeApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.min

class OperationAccessibilityService : AccessibilityService() {
    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)
    private lateinit var api: VerticeApi
    private lateinit var session: VerticeSession
    private var failureCount = 0
    private var commandInFlight = false

    override fun onServiceConnected() {
        super.onServiceConnected()
        api = VerticeApi(BuildConfig.VERTICE_API_URL)
        session = VerticeSession(this)
        api.onAuthError = { session.clearLogin(); failureCount = 0 }
        scope.launch { pollLoop() }
        Log.i(TAG, "Serviço de operação conectado. deviceId=${session.deviceId} mode=${session.mode}")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    private suspend fun pollLoop() {
        while (scope.isActive) {
            try {
                val token = session.sessionToken
                val mode = session.mode
                val deviceId = session.deviceId
                if (!token.isNullOrBlank() && mode.equals("operacao", ignoreCase = true) && !commandInFlight) {
                    api.nextCommand(token, deviceId)
                        .onSuccess { command ->
                            failureCount = 0
                            if (command != null && !commandInFlight) {
                                commandInFlight = true
                                scope.launch {
                                    try {
                                        executeCommand(token, deviceId, command)
                                    } catch (e: Exception) {
                                        Log.e(TAG, "Erro inesperado na execução ${command.id}: ${e.message}", e)
                                        runCatching {
                                            api.updateCommandStatus(token, command.id, "failed", "Erro inesperado: ${e.message ?: "erro"}", deviceId)
                                        }
                                    } finally {
                                        commandInFlight = false
                                    }
                                }
                            }
                        }
                        .onFailure { e ->
                            failureCount++
                            Log.w(TAG, "Falha no polling: ${e.message}")
                        }
                }
            } catch (e: Exception) {
                failureCount++
                Log.e(TAG, "Erro no loop de operação: ${e.message}", e)
            }
            val interval = if (failureCount == 0) 1200L else min(1200L + failureCount * 1800L, 30000L)
            delay(interval)
        }
    }

    private suspend fun executeCommand(token: String, deviceId: String, command: QueuedCommand) {
        val result = withContext(Dispatchers.Main.immediate) { performCommand(command.command) }
        api.updateCommandStatus(
            token,
            command.id,
            if (result.first) "completed" else "failed",
            result.second,
            deviceId
        ).onFailure { e -> Log.e(TAG, "Falha ao atualizar status ${command.id}: ${e.message}") }
    }

    private fun performCommand(raw: String): Pair<Boolean, String> {
        val text = raw.trim()
        val lower = text.lowercase()
        if (text.isBlank()) return false to "Comando vazio."

        if (lower in setOf("voltar", "volte", "retornar", "retorne", "tela anterior")) {
            return if (performGlobalAction(GLOBAL_ACTION_BACK)) true to "Voltou uma tela." else false to "Não foi possível voltar."
        }
        if (lower in setOf("início", "inicio", "home", "tela inicial")) {
            return if (performGlobalAction(GLOBAL_ACTION_HOME)) true to "Voltou para a tela inicial." else false to "Não foi possível ir para a tela inicial."
        }

        Regex("(?i)https?://\\S+").find(text)?.value?.let { return openUrl(it) }

        val site = Regex("(?i)^(?:abra|abrir|abre|acesse|acessar)\\s+(?:o\\s+)?site\\s+(.+)$").find(text)
        if (site != null) {
            val target = site.groupValues[1].trim()
            return openUrl(if (target.startsWith("http://") || target.startsWith("https://")) target else "https://$target")
        }

        val app = Regex("(?i)^(?:abra|abrir|abre|acesse|acessar|inicie|iniciar)\\s+(?:(?:o|a)\\s+)?(?:aplicativo\\s+|app\\s+)?(.+)$").find(text)
        if (app != null) {
            val requested = app.groupValues[1].trim().lowercase()
            return launchApp(requested)
        }

        val click = Regex("(?i)^(?:clique|clicar|toque|tocar)\\s+(?:em|no|na)\\s+(.+)$").find(text)
        if (click != null) {
            val label = click.groupValues[1].trim()
            return if (clickByText(label)) true to "Clique executado em: $label" else false to "Não encontrei um elemento clicável com o texto: $label"
        }

        val type = Regex("(?is)^(?:digite|escreva|preencha)\\s*[:=-]?\\s*(.+)$").find(text)
        if (type != null) {
            val node = findFocusedEditable(rootInActiveWindow) ?: return false to "Não encontrei campo de texto focado."
            val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, type.groupValues[1].trim()) }
            return if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) true to "Texto preenchido." else false to "O aplicativo não aceitou o texto."
        }

        return false to "Comando recebido, mas ainda não há um executor compatível para: $text"
    }

    private fun launchApp(requestedRaw: String): Pair<Boolean, String> {
        val requested = requestedRaw
            .removeSuffix(".")
            .replace("google chrome", "chrome")
            .replace("whats app", "whatsapp")
            .replace("mercado-livre", "mercado livre")
            .trim()
        val packageName = appPackages[requested]
        if (packageName == null) {
            return false to "Não reconheci o aplicativo: $requested"
        }

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        if (launchIntent == null) {
            return false to "Aplicativo não instalado ou desativado: $requested"
        }

        return try {
            launchIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
            startActivity(launchIntent)
            true to "Aplicativo aberto: $requested"
        } catch (e: Exception) {
            Log.e(TAG, "Falha ao abrir $requested", e)
            false to "Não foi possível abrir $requested: ${e.message ?: "erro do Android"}"
        }
    }

    private fun openUrl(url: String): Pair<Boolean, String> = try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        true to "Site aberto: $url"
    } catch (e: Exception) {
        false to "Não foi possível abrir o site: ${e.message ?: "erro"}"
    }

    private fun clickByText(label: String): Boolean {
        val root = rootInActiveWindow ?: return false
        for (node in root.findAccessibilityNodeInfosByText(label)) {
            var current: AccessibilityNodeInfo? = node
            repeat(7) {
                if (current?.isClickable == true && current?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) return true
                current = current?.parent
            }
        }
        return false
    }

    private fun findFocusedEditable(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.isEditable && root.isFocused) return root
        for (i in 0 until root.childCount) {
            findFocusedEditable(root.getChild(i))?.let { return it }
        }
        return null
    }

    override fun onDestroy() {
        scope.cancel()
        serviceJob.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "VerticeOperation"
        private val appPackages = mapOf(
            "whatsapp" to "com.whatsapp",
            "instagram" to "com.instagram.android",
            "facebook" to "com.facebook.katana",
            "youtube" to "com.google.android.youtube",
            "chrome" to "com.android.chrome",
            "navegador" to "com.android.chrome",
            "google" to "com.android.chrome",
            "mercado livre" to "com.mercadolibre",
            "mercadolivre" to "com.mercadolibre",
            "play store" to "com.android.vending",
            "gmail" to "com.google.android.gm"
        )
    }
}
