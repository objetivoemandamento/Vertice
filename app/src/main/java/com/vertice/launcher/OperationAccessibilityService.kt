package com.vertice.launcher

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityEvent
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

/**
 * VÉRTICE real Android operator.
 *
 * Loop: receber objetivo -> observar UI -> executar ação -> aguardar UI -> validar -> próxima ação.
 * O EmergencyState é consultado antes de cada ação; a IA nunca pode reativar a autonomia.
 */
class OperationAccessibilityService : AccessibilityService() {
    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)
    private lateinit var api: VerticeApi
    private lateinit var session: VerticeSession
    private var failureCount = 0
    @Volatile private var commandInFlight = false
    private val mainHandler = Handler(Looper.getMainLooper())

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
                if (!EmergencyState.isStopped(this@OperationAccessibilityService) &&
                    !token.isNullOrBlank() && mode.equals("operacao", ignoreCase = true) && !commandInFlight) {
                    api.nextCommand(token, deviceId)
                        .onSuccess { command ->
                            failureCount = 0
                            if (command != null && !commandInFlight && !EmergencyState.isStopped(this@OperationAccessibilityService)) {
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
                        .onFailure { e -> failureCount++; Log.w(TAG, "Falha no polling: ${e.message}") }
                }
            } catch (e: Exception) {
                failureCount++
                Log.e(TAG, "Erro no loop de operação: ${e.message}", e)
            }
            val interval = if (failureCount == 0) 900L else min(1200L + failureCount * 1800L, 30000L)
            delay(interval)
        }
    }

    private suspend fun executeCommand(token: String, deviceId: String, command: QueuedCommand) {
        if (EmergencyState.isStopped(this)) {
            runCatching { api.updateCommandStatus(token, command.id, "cancelled", "Execução bloqueada pelo botão de emergência.", deviceId) }
            return
        }
        val result = withContext(Dispatchers.Main.immediate) { performCommandPlan(command.command) }
        val status = when {
            EmergencyState.isStopped(this) -> "cancelled"
            result.first -> "completed"
            else -> "failed"
        }
        api.updateCommandStatus(token, command.id, status, result.second, deviceId)
            .onFailure { e -> Log.e(TAG, "Falha ao atualizar status ${command.id}: ${e.message}") }
    }

    /** Executes a bounded natural-language plan and validates each step before continuing. */
    private fun performCommandPlan(raw: String): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val text = raw.trim()
        if (text.isBlank()) return false to "Comando vazio."

        val steps = text.split(Regex("\\s+(?:e|depois|então|entao)\\s+"))
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .take(MAX_PLAN_STEPS)

        val results = mutableListOf<String>()
        for ((index, step) in steps.withIndex()) {
            if (EmergencyState.isStopped(this)) return false to "Execução interrompida pelo botão de emergência após ${index} passo(s)."
            val before = uiFingerprint()
            val result = performSingleCommand(step)
            results += result.second
            if (!result.first) return false to "Passo ${index + 1} falhou: ${result.second}"
            if (index < steps.lastIndex) {
                waitForUiProgress(before, 2200L)
                if (EmergencyState.isStopped(this)) return false to "Execução interrompida pelo botão de emergência."
            }
        }
        return true to results.joinToString(" ")
    }

    private fun performSingleCommand(raw: String): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val text = raw.trim()
        val lower = text.lowercase()
        if (text.isBlank()) return false to "Comando vazio."

        when {
            lower in setOf("voltar", "volte", "retornar", "retorne", "tela anterior") ->
                return globalAction(GLOBAL_ACTION_BACK, "Voltou uma tela.", "Não foi possível voltar.")
            lower in setOf("início", "inicio", "home", "tela inicial", "saia do app", "sair do app", "feche o app") ->
                return globalAction(GLOBAL_ACTION_HOME, "Saiu do aplicativo e foi para a tela inicial.", "Não foi possível ir para a tela inicial.")
            lower in setOf("recentes", "apps recentes", "abrir recentes") ->
                return globalAction(GLOBAL_ACTION_RECENTS, "Abriu os aplicativos recentes.", "Não foi possível abrir os recentes.")
            lower in setOf("notificações", "notificacoes", "abrir notificações", "abrir notificacoes") ->
                return globalAction(GLOBAL_ACTION_NOTIFICATIONS, "Abriu as notificações.", "Não foi possível abrir as notificações.")
            lower in setOf("configurações", "configuracoes", "abrir configurações", "abrir configuracoes") ->
                return globalAction(GLOBAL_ACTION_QUICK_SETTINGS, "Abriu as configurações rápidas.", "Não foi possível abrir as configurações rápidas.")
        }

        Regex("(?i)https?://\\S+").find(text)?.value?.let { return openUrl(it) }

        val site = Regex("(?i)^(?:abra|abrir|abre|acesse|acessar)\\s+(?:o\\s+)?site\\s+(.+)$").find(text)
        if (site != null) {
            val target = site.groupValues[1].trim()
            return openUrl(if (target.startsWith("http://") || target.startsWith("https://")) target else "https://$target")
        }

        val search = Regex("(?is)^(?:pesquise|pesquisar|procure|buscar|busque)\\s+(.+)$").find(text)
        if (search != null) {
            val query = Uri.encode(search.groupValues[1].trim())
            return openUrl("https://www.google.com/search?q=$query")
        }

        val app = Regex("(?i)^(?:abra|abrir|abre|acesse|acessar|inicie|iniciar)\\s+(?:(?:o|a)\\s+)?(?:aplicativo\\s+|app\\s+)?(.+)$").find(text)
        if (app != null) {
            val requested = app.groupValues[1].trim().lowercase()
            return launchApp(requested)
        }

        val click = Regex("(?i)^(?:clique|clicar|toque|tocar)\\s+(?:em|no|na)\\s+(.+)$").find(text)
        if (click != null) {
            val label = click.groupValues[1].trim()
            return if (clickBySemanticTarget(label)) true to "Clique executado em: $label" else false to "Não encontrei um elemento clicável com: $label"
        }

        val coord = Regex("(?i)^(?:clique|toque|clicar|tocar)\\s+(?:em\\s+)?(?:x\\s*)?([0-9]{1,4})\\s*[,;]\\s*(?:y\\s*)?([0-9]{1,4})$").find(text)
        if (coord != null) return tapAt(coord.groupValues[1].toFloat(), coord.groupValues[2].toFloat())

        val longClick = Regex("(?i)^(?:pressione|segure)\\s+(?:em|no|na)\\s+(.+)$").find(text)
        if (longClick != null) {
            val label = longClick.groupValues[1].trim()
            return if (longClickByText(label)) true to "Pressão longa executada em: $label" else false to "Não encontrei um elemento para pressionar: $label"
        }

        val scroll = Regex("(?i)^(?:role|rolar|deslize|deslizar)\\s*(?:para\\s+)?(baixo|cima|esquerda|direita)?$").find(text)
        if (scroll != null) return swipe(scroll.groupValues[1].ifBlank { "baixo" })

        val type = Regex("(?is)^(?:digite|escreva|preencha)\\s*[:=-]?\\s*(.+)$").find(text)
        if (type != null) {
            val node = findFocusedEditable(rootInActiveWindow) ?: findFirstEditable(rootInActiveWindow)
            if (node == null) return false to "Não encontrei campo de texto."
            val value = type.groupValues[1].trim()
            val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) }
            return if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                true to "Texto preenchido."
            } else {
                false to "O aplicativo não aceitou o texto."
            }
        }

        val enter = Regex("(?i)^(?:pressione|toque|aperte)\\s+(?:enter|ok|enviar)$").matches(text)
        if (enter) return pressEnter()

        return false to "Comando recebido, mas sem ação executável: $text"
    }

    private fun globalAction(action: Int, success: String, failure: String): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        return if (performGlobalAction(action)) true to success else false to failure
    }

    private fun launchApp(requestedRaw: String): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val requested = requestedRaw.removeSuffix(".")
            .replace("google chrome", "chrome")
            .replace("whats app", "whatsapp")
            .replace("mercado-livre", "mercado livre")
            .trim()
        val packageName = appPackages[requested] ?: findInstalledPackage(requested)
        if (packageName.isNullOrBlank()) return false to "Não reconheci ou não encontrei o aplicativo: $requested"
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: return false to "Aplicativo não instalado ou desativado: $requested"
        return try {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            startActivity(launchIntent)
            waitForPackage(packageName, 3500L)
            true to "Aplicativo aberto: $requested"
        } catch (e: Exception) {
            Log.e(TAG, "Falha ao abrir $requested", e)
            false to "Não foi possível abrir $requested: ${e.message ?: "erro do Android"}"
        }
    }

    private fun findInstalledPackage(requested: String): String? {
        val needle = normalize(requested).replace(" ", "")
        return packageManager.getInstalledApplications(0).firstOrNull { info ->
            val label = packageManager.getApplicationLabel(info).toString().replace(" ", "").lowercase()
            label == needle || label.contains(needle) || needle.contains(label)
        }?.packageName
    }

    private fun openUrl(url: String): Pair<Boolean, String> = try {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        waitForPackage(rootInActiveWindow?.packageName, 3500L)
        true to "Site aberto: $url"
    } catch (e: Exception) {
        false to "Não foi possível abrir o site: ${e.message ?: "erro"}"
    }

    private fun clickBySemanticTarget(label: String): Boolean {
        if (EmergencyState.isStopped(this)) return false
        val needle = normalize(label)
        repeat(3) {
            val root = rootInActiveWindow
            val candidates = mutableListOf<AccessibilityNodeInfo>()
            collectNodes(root, candidates)
            val target = candidates.firstOrNull { node ->
                val text = normalize(node.text?.toString().orEmpty())
                val desc = normalize(node.contentDescription?.toString().orEmpty())
                val viewId = normalize(node.viewIdResourceName?.substringAfterLast('/') ?: "")
                (text == needle || desc == needle || viewId == needle || text.contains(needle) || desc.contains(needle) || viewId.contains(needle)) &&
                    (node.isClickable || node.isFocusable || node.isEnabled)
            }
            if (target != null && clickNode(target)) return true
            if (!EmergencyState.isStopped(this)) Thread.sleep(180)
        }
        return false
    }

    private fun collectNodes(node: AccessibilityNodeInfo?, out: MutableList<AccessibilityNodeInfo>) {
        if (node == null || out.size >= MAX_NODES) return
        out += node
        for (i in 0 until node.childCount) {
            collectNodes(node.getChild(i), out)
            if (out.size >= MAX_NODES) return
        }
    }

    private fun clickNode(node: AccessibilityNodeInfo): Boolean {
        if (EmergencyState.isStopped(this)) return false
        var current: AccessibilityNodeInfo? = node
        repeat(8) {
            if (EmergencyState.isStopped(this)) return false
            if (current?.isClickable == true && current?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) return true
            current = current?.parent
        }
        return tapNodeCenter(node)
    }

    private fun longClickByText(label: String): Boolean {
        if (EmergencyState.isStopped(this)) return false
        val needle = normalize(label)
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(rootInActiveWindow, nodes)
        val node = nodes.firstOrNull { normalize(it.text?.toString().orEmpty()).contains(needle) } ?: return false
        if (node.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)) return true
        return tapNodeCenter(node, long = true)
    }

    private fun tapNodeCenter(node: AccessibilityNodeInfo, long: Boolean = false): Boolean {
        val r = android.graphics.Rect()
        node.getBoundsInScreen(r)
        return if (r.width() > 0 && r.height() > 0) tapAt(r.exactCenterX(), r.exactCenterY(), long).first else false
    }

    private fun tapAt(x: Float, y: Float, long: Boolean = false): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        if (x < 0 || y < 0 || x > resources.displayMetrics.widthPixels || y > resources.displayMetrics.heightPixels) {
            return false to "Coordenada fora da tela."
        }
        val path = Path().apply { moveTo(x, y); lineTo(x + 1f, y + 1f) }
        val duration = if (long) 700L else 90L
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build()
        val accepted = dispatchGesture(gesture, null, null)
        return if (accepted) true to if (long) "Pressão longa executada em ($x, $y)." else "Toque executado em ($x, $y)."
        else false to "O Android não aceitou o toque."
    }

    private fun swipe(direction: String): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val dm = resources.displayMetrics
        val w = dm.widthPixels.toFloat(); val h = dm.heightPixels.toFloat()
        val (sx, sy, ex, ey) = when (direction.lowercase()) {
            "cima" -> listOf(w / 2, h * .78f, w / 2, h * .22f)
            "esquerda" -> listOf(w * .80f, h / 2, w * .20f, h / 2)
            "direita" -> listOf(w * .20f, h / 2, w * .80f, h / 2)
            else -> listOf(w / 2, h * .22f, w / 2, h * .78f)
        }
        val path = Path().apply { moveTo(sx, sy); lineTo(ex, ey) }
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 450)).build()
        return if (dispatchGesture(gesture, null, null)) true to "Deslize executado para $direction." else false to "O Android não aceitou o gesto."
    }

    private fun pressEnter(): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val root = rootInActiveWindow
        val focused = findFocusedEditable(root)
        if (focused != null && android.os.Build.VERSION.SDK_INT >= 30) {
            if (focused.performAction(AccessibilityNodeInfo.ACTION_IME_ENTER)) return true to "Enter executado."
        }
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        val actionNode = nodes.firstOrNull {
            val t = normalize(it.text?.toString().orEmpty())
            it.isClickable && (t == "enter" || t == "ok" || t == "enviar" || t == "buscar" || t == "search")
        }
        if (actionNode != null && actionNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true to "Ação enviada."
        return false to "Não encontrei uma ação Enter/Enviar disponível."
    }

    private fun findFocusedEditable(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.isEditable && root.isFocused) return root
        for (i in 0 until root.childCount) findFocusedEditable(root.getChild(i))?.let { return it }
        return null
    }

    private fun findFirstEditable(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.isEditable && root.isEnabled) return root
        for (i in 0 until root.childCount) findFirstEditable(root.getChild(i))?.let { return it }
        return null
    }

    private fun uiFingerprint(): String {
        val root = rootInActiveWindow ?: return ""
        val pkg = root.packageName?.toString().orEmpty()
        val texts = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, texts)
        return pkg + "|" + texts.take(24).joinToString(";") {
            normalize(it.text?.toString().orEmpty()) + ":" + normalize(it.contentDescription?.toString().orEmpty())
        }
    }

    private fun waitForUiProgress(before: String, timeoutMs: Long): Boolean {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            if (EmergencyState.isStopped(this)) return false
            if (uiFingerprint() != before) return true
            Thread.sleep(120)
        }
        return false
    }

    private fun waitForPackage(packageName: String?, timeoutMs: Long): Boolean {
        if (packageName.isNullOrBlank()) return true
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            if (EmergencyState.isStopped(this)) return false
            if (rootInActiveWindow?.packageName?.toString() == packageName) return true
            Thread.sleep(120)
        }
        return rootInActiveWindow?.packageName?.toString() == packageName
    }

    private fun normalize(value: String): String = value.trim().lowercase().replace(Regex("\\s+"), " ")

    override fun onDestroy() {
        scope.cancel()
        serviceJob.cancel()
        mainHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        private const val TAG = "VerticeOperation"
        private const val MAX_PLAN_STEPS = 12
        private const val MAX_NODES = 500
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
