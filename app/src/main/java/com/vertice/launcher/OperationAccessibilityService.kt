package com.vertice.launcher

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
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

/** Executor do terminal OPERAÇÃO. Só atua quando o modo local é operacao e o usuário habilitou Acessibilidade. */
class OperationAccessibilityService : AccessibilityService() {
    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)
    private lateinit var api: VerticeApi
    private lateinit var session: VerticeSession

    override fun onServiceConnected() {
        super.onServiceConnected()
        api = VerticeApi("https://vertice-backend-8gj5.onrender.com")
        session = VerticeSession(this)
        scope.launch { pollLoop() }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    private suspend fun pollLoop() {
        while (scope.isActive) {
            val token = session.sessionToken
            val mode = session.mode
            if (!token.isNullOrBlank() && mode == "operacao") {
                try {
                    api.nextCommand(token, session.deviceId).onSuccess { command ->
                        if (command != null) {
                            scope.launch { executeCommand(token, command) }
                        }
                    }
                } catch (_: Throwable) {
                    // Falhas de rede não derrubam o executor; a próxima rodada tenta novamente.
                }
            }
            delay(1800)
        }
    }

    private suspend fun executeCommand(token: String, command: QueuedCommand) {
        val result = withContext(Dispatchers.Main.immediate) { performCommand(command.command) }
        try {
            api.updateCommandStatus(
                token,
                command.id,
                if (result.first) "completed" else "failed",
                result.second
            )
        } catch (_: Throwable) {
            // O comando já foi marcado running no servidor; a próxima auditoria pode identificar a pendência.
        }
    }

    private fun performCommand(raw: String): Pair<Boolean, String> {
        val text = raw.trim()
        val lower = text.lowercase()
        if (text.isBlank()) return false to "Comando vazio."

        if (lower == "voltar" || lower == "volte") {
            return if (performGlobalAction(GLOBAL_ACTION_BACK)) true to "Voltou uma tela." else false to "Não foi possível voltar."
        }
        if (lower == "início" || lower == "inicio" || lower == "home" || lower == "tela inicial") {
            return if (performGlobalAction(GLOBAL_ACTION_HOME)) true to "Voltou para a tela inicial." else false to "Não foi possível ir para a tela inicial."
        }

        val url = Regex("(?i)https?://\\S+").find(text)?.value
        if (url != null) return openUrl(url)

        val openSite = Regex("(?i)^(?:abra|abrir|acesse|acessar)\\s+(?:o\\s+)?site\\s+(.+)$").find(text)
        if (openSite != null) {
            val target = openSite.groupValues[1].trim()
            val normalized = if (target.startsWith("http://") || target.startsWith("https://")) target else "https://$target"
            return openUrl(normalized)
        }

        // Aceita tanto "abra o aplicativo Chrome" quanto o comando natural "abra o Chrome".
        val appMatch = Regex("(?i)^(?:abra|abrir|abre|acesse|acessar|inicie|iniciar)\\s+(?:o\\s+|a\\s+)?(?:aplicativo|app\\s+)?(.+)$").find(text)
        if (appMatch != null) {
            val requested = appMatch.groupValues[1].trim().lowercase()
                .removePrefix("o ").removePrefix("a ").trim()
            val pkg = appPackages[requested]
            if (pkg != null) {
                val launch = packageManager.getLaunchIntentForPackage(pkg)
                    ?: return false to "Aplicativo não instalado: $requested"
                return try {
                    startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    true to "Aplicativo aberto: $requested"
                } catch (e: Exception) {
                    false to "Não foi possível abrir $requested: ${e.message ?: "erro"}"
                }
            }
        }

        val clickMatch = Regex("(?i)^(?:clique|clicar|toque|tocar)\\s+(?:em|no|na)\\s+(.+)$").find(text)
        if (clickMatch != null) {
            val label = clickMatch.groupValues[1].trim()
            val clicked = clickByText(label)
            return if (clicked) true to "Clique executado em: $label" else false to "Não encontrei um elemento clicável com o texto: $label"
        }

        val typeMatch = Regex("(?is)^(?:digite|escreva|preencha)\\s*[:=-]?\\s*(.+)$").find(text)
        if (typeMatch != null) {
            val value = typeMatch.groupValues[1].trim()
            val node = findFocusedEditable(rootInActiveWindow)
            if (node == null) return false to "Não encontrei campo de texto focado."
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
            }
            val ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            return if (ok) true to "Texto preenchido." else false to "O aplicativo não aceitou o texto."
        }

        // Comandos comuns de navegação para evitar falsas falhas por pequenas variações de linguagem.
        if (lower.matches(Regex("(voltar|volte|retorne|retornar)(\\s+uma\\s+tela)?"))) {
            return if (performGlobalAction(GLOBAL_ACTION_BACK)) true to "Voltou uma tela." else false to "Não foi possível voltar."
        }

        return false to "Comando recebido, mas ainda não há um executor compatível para: $text"
    }

    private fun openUrl(url: String): Pair<Boolean, String> = try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true to "Site aberto: $url"
    } catch (e: Exception) {
        false to "Não foi possível abrir o site: ${e.message ?: "erro"}"
    }

    private fun clickByText(label: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val nodes = root.findAccessibilityNodeInfosByText(label)
        for (node in nodes) {
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
            val found = findFocusedEditable(root.getChild(i))
            if (found != null) return found
        }
        return null
    }

    override fun onDestroy() {
        scope.cancel()
        serviceJob.cancel()
        super.onDestroy()
    }

    companion object {
        private val appPackages = mapOf(
            "whatsapp" to "com.whatsapp",
            "instagram" to "com.instagram.android",
            "facebook" to "com.facebook.katana",
            "youtube" to "com.google.android.youtube",
            "chrome" to "com.android.chrome",
            "navegador" to "com.android.chrome",
            "mercado livre" to "com.mercadolibre",
            "mercadolivre" to "com.mercadolibre",
            "play store" to "com.android.vending",
            "gmail" to "com.google.android.gm",
            "configurações" to Settings.ACTION_SETTINGS,
            "configuracoes" to Settings.ACTION_SETTINGS
        )
    }
}
