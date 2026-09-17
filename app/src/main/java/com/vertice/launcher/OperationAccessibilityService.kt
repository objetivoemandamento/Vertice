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
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import kotlin.math.min

/** VÉRTICE real Android operator: objetivo -> observar -> agir -> validar -> próxima ação. */
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
        Log.i(TAG, "Serviço conectado. deviceId=${session.deviceId} mode=${session.mode}")
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
                    !token.isNullOrBlank() && mode.equals("operacao", true) && !commandInFlight) {
                    api.nextCommand(token, deviceId).onSuccess { command ->
                        failureCount = 0
                        if (command != null && !commandInFlight && !EmergencyState.isStopped(this@OperationAccessibilityService)) {
                            commandInFlight = true
                            scope.launch {
                                try { executeCommand(token, deviceId, command) }
                                catch (e: Exception) {
                                    Log.e(TAG, "Erro ${command.id}: ${e.message}", e)
                                    runCatching { api.updateCommandStatus(token, command.id, "failed", "Erro inesperado: ${e.message ?: "erro"}", deviceId) }
                                } finally { commandInFlight = false }
                            }
                        }
                    }.onFailure { e -> failureCount++; Log.w(TAG, "Polling: ${e.message}") }
                }
            } catch (e: Exception) { failureCount++; Log.e(TAG, "Loop: ${e.message}", e) }
            delay(if (failureCount == 0) 900L else min(1200L + failureCount * 1800L, 30000L))
        }
    }

    private suspend fun executeCommand(token: String, deviceId: String, command: QueuedCommand) {
        val safety = EmergencyState.snapshot(this)
        if (safety.stopped) {
            runCatching { api.updateCommandStatus(token, command.id, "cancelled", "Execução bloqueada pelo botão de emergência.", deviceId) }
            return
        }
        val result = performCommandPlan(command.command, safety.generation)
        val status = when {
            EmergencyState.isStopped(this) -> "cancelled"
            EmergencyState.generation(this) != safety.generation -> "cancelled"
            result.first -> "completed"
            else -> "failed"
        }
        api.updateCommandStatus(token, command.id, status, result.second, deviceId)
            .onFailure { e -> Log.e(TAG, "Status ${command.id}: ${e.message}") }
    }

    private suspend fun performCommandPlan(raw: String, expectedGeneration: Long): Pair<Boolean, String> {
        if (!EmergencyState.canContinue(this, expectedGeneration)) return false to "Execução interrompida pelo botão de emergência."
        val text = raw.trim()
        if (text.isBlank()) return false to "Comando vazio."
        val steps = text.split(Regex("\\s+(?:e|depois|então|entao)\\s+"))
            .map(String::trim).filter(String::isNotBlank).take(MAX_PLAN_STEPS)
        val results = mutableListOf<String>()
        for ((index, step) in steps.withIndex()) {
            if (!EmergencyState.canContinue(this, expectedGeneration)) return false to "Execução interrompida pelo botão de emergência após $index passo(s)."
            val before = uiFingerprint()
            val result = withContext(Dispatchers.Main.immediate) { performSingleCommand(step) }
            if (!EmergencyState.canContinue(this, expectedGeneration)) return false to "Execução interrompida pelo botão de emergência."
            results += result.second
            if (!result.first) return false to "Passo ${index + 1} falhou: ${result.second}"
            if (index < steps.lastIndex) {
                val progressed = waitForUiProgress(before, 2500L, expectedGeneration)
                if (!progressed) return false to "Passo ${index + 1} executado, mas a tela não apresentou mudança verificável."
                if (!EmergencyState.canContinue(this, expectedGeneration)) return false to "Execução interrompida pelo botão de emergência."
                delay(350L)
            }
        }
        return true to results.joinToString(" ")
    }

    private suspend fun performSingleCommand(raw: String): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val text = raw.trim(); val lower = text.lowercase()
        if (text.isBlank()) return false to "Comando vazio."
        when {
            lower in setOf("voltar", "volte", "retornar", "retorne", "tela anterior") -> return globalAction(GLOBAL_ACTION_BACK, "Voltou uma tela.", "Não foi possível voltar.")
            lower in setOf("início", "inicio", "home", "tela inicial", "saia do app", "sair do app", "feche o app") -> return globalAction(GLOBAL_ACTION_HOME, "Foi para a tela inicial.", "Não foi possível ir para a tela inicial.")
            lower in setOf("recentes", "apps recentes", "abrir recentes") -> return globalAction(GLOBAL_ACTION_RECENTS, "Abriu os aplicativos recentes.", "Não foi possível abrir os recentes.")
            lower in setOf("notificações", "notificacoes", "abrir notificações", "abrir notificacoes") -> return globalAction(GLOBAL_ACTION_NOTIFICATIONS, "Abriu as notificações.", "Não foi possível abrir as notificações.")
            lower in setOf("configurações", "configuracoes", "abrir configurações", "abrir configuracoes") -> return globalAction(GLOBAL_ACTION_QUICK_SETTINGS, "Abriu as configurações rápidas.", "Não foi possível abrir as configurações rápidas.")
        }
        Regex("(?i)https?://\\S+").find(text)?.value?.let { return openUrl(it) }
        Regex("(?i)^(?:abra|abrir|abre|acesse|acessar)\\s+(?:o\\s+)?site\\s+(.+)$").find(text)?.let {
            val target = it.groupValues[1].trim(); return openUrl(if (target.startsWith("http://") || target.startsWith("https://")) target else "https://$target")
        }
        Regex("(?is)^(?:pesquise|pesquisar|procure|buscar|busque)\\s+(.+)$").find(text)?.let {
            return openUrl("https://www.google.com/search?q=${Uri.encode(it.groupValues[1].trim())}")
        }
        Regex("(?i)^(?:abra|abrir|abre|acesse|acessar|inicie|iniciar)\\s+(?:(?:o|a)\\s+)?(?:aplicativo\\s+|app\\s+)?(.+)$").find(text)?.let {
            return launchApp(it.groupValues[1].trim().lowercase())
        }
        Regex("(?i)^(?:clique|clicar|toque|tocar)\\s+(?:em|no|na)\\s+(.+)$").find(text)?.let {
            val label = it.groupValues[1].trim(); return if (clickBySemanticTarget(label)) true to "Clique executado em: $label" else false to "Não encontrei um elemento clicável com: $label"
        }
        Regex("(?i)^(?:clique|toque|clicar|tocar)\\s+(?:em\\s+)?(?:x\\s*)?([0-9]{1,4})\\s*[,;]\\s*(?:y\\s*)?([0-9]{1,4})$").find(text)?.let {
            return tapAt(it.groupValues[1].toFloat(), it.groupValues[2].toFloat())
        }
        Regex("(?i)^(?:pressione|segure)\\s+(?:em|no|na)\\s+(.+)$").find(text)?.let {
            val label = it.groupValues[1].trim(); return if (longClickByText(label)) true to "Pressão longa executada em: $label" else false to "Não encontrei um elemento para pressionar: $label"
        }
        Regex("(?i)^(?:role|rolar|deslize|deslizar)\\s*(?:para\\s+)?(baixo|cima|esquerda|direita)?$").find(text)?.let {
            return swipe(it.groupValues[1].ifBlank { "baixo" })
        }
        Regex("(?is)^(?:digite|escreva|preencha)\\s*[:=-]?\\s*(.+)$").find(text)?.let {
            val node = findFocusedEditable(rootInActiveWindow) ?: findFirstEditable(rootInActiveWindow) ?: return false to "Não encontrei campo de texto."
            val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, it.groupValues[1].trim()) }
            return if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) true to "Texto preenchido." else false to "O aplicativo não aceitou o texto."
        }
        if (Regex("(?i)^(?:pressione|toque|aperte)\\s+(?:enter|ok|enviar)$").matches(text)) return pressEnter()
        return false to "Comando recebido, mas sem ação executável: $text"
    }

    private fun globalAction(action: Int, success: String, failure: String): Pair<Boolean, String> =
        if (EmergencyState.isStopped(this)) false to "Execução bloqueada pelo botão de emergência." else if (performGlobalAction(action)) true to success else false to failure

    private fun launchApp(requestedRaw: String): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val requested = requestedRaw.removeSuffix(".").replace("google chrome", "chrome").replace("whats app", "whatsapp").replace("mercado-livre", "mercado livre").trim()
        val packageName = appPackages[requested] ?: findInstalledPackage(requested) ?: return false to "Não encontrei o aplicativo: $requested"
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return false to "Aplicativo não instalado ou desativado: $requested"
        return try { launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED or Intent.FLAG_ACTIVITY_CLEAR_TOP); startActivity(launchIntent); true to "Aplicativo aberto: $requested" }
        catch (e: Exception) { Log.e(TAG, "Falha ao abrir $requested", e); false to "Não foi possível abrir $requested: ${e.message ?: "erro do Android"}" }
    }

    private fun findInstalledPackage(requested: String): String? {
        val needle = normalize(requested).replace(" ", "")
        return packageManager.getInstalledApplications(0).firstOrNull { info ->
            val label = packageManager.getApplicationLabel(info).toString().replace(" ", "").lowercase()
            label == needle || label.contains(needle) || needle.contains(label)
        }?.packageName
    }

    private fun openUrl(url: String): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true to "Site aberto: $url"
        } catch (e: Exception) {
            false to "Não foi possível abrir o site: ${e.message ?: "erro"}"
        }
    }

    private suspend fun clickBySemanticTarget(label: String): Boolean {
        if (EmergencyState.isStopped(this)) return false
        val needle = normalize(label); val nodes = mutableListOf<AccessibilityNodeInfo>(); collectNodes(rootInActiveWindow, nodes)
        val target = nodes.firstOrNull { node ->
            val text = normalize(node.text?.toString().orEmpty()); val desc = normalize(node.contentDescription?.toString().orEmpty()); val viewId = normalize(node.viewIdResourceName?.substringAfterLast('/') ?: "")
            (text == needle || desc == needle || viewId == needle || text.contains(needle) || desc.contains(needle) || viewId.contains(needle)) && (node.isClickable || node.isFocusable || node.isEnabled)
        } ?: return false
        return clickNode(target)
    }

    private fun collectNodes(node: AccessibilityNodeInfo?, out: MutableList<AccessibilityNodeInfo>) {
        if (node == null || out.size >= MAX_NODES) return
        out += node
        for (i in 0 until node.childCount) { collectNodes(node.getChild(i), out); if (out.size >= MAX_NODES) return }
    }

    private suspend fun clickNode(node: AccessibilityNodeInfo): Boolean {
        if (EmergencyState.isStopped(this)) return false
        var current: AccessibilityNodeInfo? = node
        repeat(8) {
            if (EmergencyState.isStopped(this)) return false
            if (current?.isClickable == true && current?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) return true
            current = current?.parent
        }
        return tapNodeCenter(node)
    }

    private suspend fun longClickByText(label: String): Boolean {
        if (EmergencyState.isStopped(this)) return false
        val needle = normalize(label); val nodes = mutableListOf<AccessibilityNodeInfo>(); collectNodes(rootInActiveWindow, nodes)
        val node = nodes.firstOrNull { normalize(it.text?.toString().orEmpty()).contains(needle) } ?: return false
        if (node.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)) return true
        return tapNodeCenter(node, true)
    }

    private suspend fun tapNodeCenter(node: AccessibilityNodeInfo, long: Boolean = false): Boolean {
        val r = android.graphics.Rect(); node.getBoundsInScreen(r)
        return r.width() > 0 && r.height() > 0 && tapAt(r.exactCenterX(), r.exactCenterY(), long).first
    }

    private suspend fun tapAt(x: Float, y: Float, long: Boolean = false): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val dm = resources.displayMetrics
        if (x < 0 || y < 0 || x > dm.widthPixels || y > dm.heightPixels) return false to "Coordenada fora da tela."
        val path = Path().apply { moveTo(x, y); lineTo(x + 1f, y + 1f) }
        val duration = if (long) 700L else 90L
        val outcome = dispatchGestureAwait(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build())
        return when (outcome) {
            GestureOutcome.COMPLETED -> true to if (long) "Pressão longa concluída em ($x, $y)." else "Toque concluído em ($x, $y)."
            GestureOutcome.DISPATCHED_PENDING -> false to "O Android aceitou o gesto, mas não confirmou sua conclusão."
            GestureOutcome.CANCELLED -> false to "O Android cancelou o gesto."
            GestureOutcome.DISPATCH_REJECTED -> false to "O Android não aceitou o toque."
        }
    }

    private suspend fun swipe(direction: String): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val dm = resources.displayMetrics; val w = dm.widthPixels.toFloat(); val h = dm.heightPixels.toFloat()
        val p = when (direction.lowercase()) { "cima" -> listOf(w/2,h*.78f,w/2,h*.22f); "esquerda" -> listOf(w*.80f,h/2,w*.20f,h/2); "direita" -> listOf(w*.20f,h/2,w*.80f,h/2); else -> listOf(w/2,h*.22f,w/2,h*.78f) }
        val path = Path().apply { moveTo(p[0],p[1]); lineTo(p[2],p[3]) }
        return when (dispatchGestureAwait(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path,0,450)).build())) {
            GestureOutcome.COMPLETED -> true to "Deslize concluído para $direction."
            GestureOutcome.DISPATCHED_PENDING -> false to "O Android aceitou o gesto, mas não confirmou sua conclusão."
            GestureOutcome.CANCELLED -> false to "O Android cancelou o gesto."
            GestureOutcome.DISPATCH_REJECTED -> false to "O Android não aceitou o gesto."
        }
    }

    private suspend fun dispatchGestureAwait(gesture: GestureDescription): GestureOutcome {
        val callbackResult = withTimeoutOrNull(GESTURE_CONFIRM_TIMEOUT_MS) {
            suspendCancellableCoroutine<GestureOutcome> { continuation ->
                val accepted = dispatchGesture(
                    gesture,
                    object : GestureResultCallback() {
                        override fun onCompleted(gestureDescription: GestureDescription?) {
                            if (continuation.isActive) continuation.resume(GestureOutcomeResolver.callback(true))
                        }
                        override fun onCancelled(gestureDescription: GestureDescription?) {
                            if (continuation.isActive) continuation.resume(GestureOutcomeResolver.callback(false))
                        }
                    },
                    mainHandler
                )
                if (!accepted && continuation.isActive) continuation.resume(GestureOutcomeResolver.initial(false))
            }
        }
        return callbackResult ?: GestureOutcome.DISPATCHED_PENDING
    }

    private fun pressEnter(): Pair<Boolean, String> {
        if (EmergencyState.isStopped(this)) return false to "Execução bloqueada pelo botão de emergência."
        val root = rootInActiveWindow ?: return false to "Não há janela ativa."
        val focused = findFocusedEditable(root)
        if (focused != null) {
            val candidates = listOf("enter", "ok", "enviar", "buscar", "pesquisar", "confirmar", "continuar")
            val nodes = mutableListOf<AccessibilityNodeInfo>()
            collectNodes(root, nodes)
            val button = nodes.firstOrNull { node ->
                if (!node.isClickable || !node.isEnabled) return@firstOrNull false
                val text = normalize(node.text?.toString().orEmpty())
                val desc = normalize(node.contentDescription?.toString().orEmpty())
                candidates.any { it == text || it == desc }
            }
            if (button != null && button.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true to "Ação de confirmação executada."
        }
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        collectNodes(root, nodes)
        val button = nodes.firstOrNull { node ->
            if (!node.isClickable || !node.isEnabled) return@firstOrNull false
            val text = normalize(node.text?.toString().orEmpty())
            val desc = normalize(node.contentDescription?.toString().orEmpty())
            text in setOf("enter", "ok", "enviar", "buscar", "pesquisar", "confirmar", "continuar") ||
                desc in setOf("enter", "ok", "enviar", "buscar", "pesquisar", "confirmar", "continuar")
        }
        return if (button != null && button.performAction(AccessibilityNodeInfo.ACTION_CLICK)) true to "Ação de confirmação executada." else false to "Não encontrei uma ação Enter/Enviar disponível."
    }

    private fun findFocusedEditable(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? { if (root==null)return null; if(root.isEditable&&root.isFocused)return root; for(i in 0 until root.childCount)findFocusedEditable(root.getChild(i))?.let{return it}; return null }
    private fun findFirstEditable(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? { if(root==null)return null; if(root.isEditable&&root.isEnabled)return root; for(i in 0 until root.childCount)findFirstEditable(root.getChild(i))?.let{return it}; return null }
    private fun uiFingerprint(): String { val root=rootInActiveWindow?:return ""; val nodes=mutableListOf<AccessibilityNodeInfo>(); collectNodes(root,nodes); return root.packageName?.toString().orEmpty()+"|"+nodes.take(24).joinToString(";"){normalize(it.text?.toString().orEmpty())+":"+normalize(it.contentDescription?.toString().orEmpty())} }
    private suspend fun waitForUiProgress(before:String,timeoutMs:Long,expectedGeneration:Long):Boolean { val end=System.currentTimeMillis()+timeoutMs; while(System.currentTimeMillis()<end){if(!EmergencyState.canContinue(this,expectedGeneration))return false;if(uiFingerprint()!=before)return true;delay(120)};return false }
    private fun normalize(value:String):String=value.trim().lowercase().replace(Regex("\\s+")," ")

    override fun onDestroy(){scope.cancel();serviceJob.cancel();mainHandler.removeCallbacksAndMessages(null);super.onDestroy()}

    companion object {
        private const val TAG="VerticeOperation"
        private const val MAX_PLAN_STEPS=12
        private const val MAX_NODES=500
        private const val GESTURE_CONFIRM_TIMEOUT_MS=2500L
        private val appPackages=mapOf("whatsapp" to "com.whatsapp","instagram" to "com.instagram.android","facebook" to "com.facebook.katana","youtube" to "com.google.android.youtube","chrome" to "com.android.chrome","navegador" to "com.android.chrome","google" to "com.android.chrome","mercado livre" to "com.mercadolibre","mercadolivre" to "com.mercadolibre","play store" to "com.android.vending","gmail" to "com.google.android.gm")
    }
}