package com.vertice.launcher

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.accessibility.AccessibilityManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.ActivityCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.vertice.launcher.network.AdminOverview
import com.vertice.launcher.network.AuthResult
import com.vertice.launcher.network.CommandResult
import com.vertice.launcher.network.SalesList
import com.vertice.launcher.network.VerticeApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val VERTICE_BASE_URL = "https://vertice-backend-8gj5.onrender.com"
private val MODES = listOf("comando", "operacao", "monitoramento")

data class ChatLine(val fromUser: Boolean, val text: String)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { VerticeApp() }
    }
}

private fun accessibilityEnabled(context: Context): Boolean {
    val enabled = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    val expected = android.content.ComponentName(
        context,
        OperationAccessibilityService::class.java
    ).flattenToString()
    return enabled.split(':').any { TextUtils.equals(it, expected) }
}

private fun openAccessibilitySettings(context: Context) {
    runCatching {
        context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

@Composable
private fun VerticeApp() {
    val context = LocalContext.current
    val session = remember { VerticeSession(context) }
    val api = remember { VerticeApi(VERTICE_BASE_URL) }
    var token by remember { mutableStateOf(session.sessionToken) }
    var role by remember { mutableStateOf(session.role) }
    var mode by remember { mutableStateOf(session.mode) }
    var permissionsReady by remember { mutableStateOf(mode != "operacao" || accessibilityEnabled(context)) }

    val refreshPermissionState = {
        permissionsReady = mode != "operacao" || accessibilityEnabled(context)
    }

    DisposableEffect(Unit) {
        val lifecycleOwner = (context as? ComponentActivity)?.lifecycle
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshPermissionState()
        }
        lifecycleOwner?.addObserver(observer)
        onDispose { lifecycleOwner?.removeObserver(observer) }
    }

    MaterialTheme(colorScheme = darkColorScheme()) {
        Surface(Modifier.fillMaxSize()) {
            when {
                token.isNullOrBlank() -> LoginScreen(api) { result ->
                    session.sessionToken = result.token
                    session.email = result.email
                    session.role = result.role
                    token = result.token
                    role = result.role
                    mode = session.mode
                    permissionsReady = mode != "operacao" || accessibilityEnabled(context)
                }
                !permissionsReady -> PermissionSetupScreen(
                    context = context,
                    onRefresh = { refreshPermissionState() }
                )
                mode.isNullOrBlank() -> ModeSelectionScreen(
                    api = api,
                    token = token!!,
                    owner = role == "OWNER",
                    session = session,
                    onSelected = { selected ->
                        session.mode = selected
                        mode = selected
                        permissionsReady = selected != "operacao" || accessibilityEnabled(context)
                    }
                )
                else -> CommandCenter(
                    api = api,
                    token = token!!,
                    role = role ?: "CUSTOMER",
                    mode = mode!!,
                    session = session,
                    onModeChange = { selected ->
                        session.mode = selected
                        mode = selected
                        permissionsReady = selected != "operacao" || accessibilityEnabled(context)
                    },
                    onLogout = {
                        session.clearLogin()
                        token = null
                        role = null
                        mode = null
                        permissionsReady = true
                    }
                )
            }
        }
    }
}

@Composable
private fun PermissionSetupScreen(context: Context, onRefresh: () -> Unit) {
    val activity = context as? Activity
    var notificationGranted by remember {
        mutableStateOf(Build.VERSION.SDK_INT < 33 || androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED)
    }
    val accessibility = accessibilityEnabled(context)

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 && !notificationGranted && activity != null) {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101)
        }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                notificationGranted = Build.VERSION.SDK_INT < 33 ||
                    androidx.core.content.ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS
                    ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                onRefresh()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Column(
        Modifier.fillMaxSize().padding(22.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text("CONFIGURAÇÃO NECESSÁRIA", fontSize = 27.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("Antes de operar, o VÉRTICE vai verificar as permissões necessárias deste aparelho.")
        Spacer(Modifier.height(18.dp))

        PermissionCard(
            title = "📣 Notificações",
            description = "Permite avisos de tarefas, vendas e resultados.",
            ready = notificationGranted,
            actionLabel = if (notificationGranted) "ATIVA" else "PERMITIR"
        ) {
            if (Build.VERSION.SDK_INT >= 33 && activity != null) {
                ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101)
            }
        }

        Spacer(Modifier.height(12.dp))
        PermissionCard(
            title = "📣 OPERAÇÃO — Acessibilidade",
            description = "Necessária para o VÉRTICE executar comandos no Android, como abrir aplicativos, clicar e digitar.",
            ready = accessibility,
            actionLabel = if (accessibility) "ATIVA" else "ATIVAR AGORA"
        ) {
            openAccessibilitySettings(context)
        }

        Spacer(Modifier.height(18.dp))
        Text(
            if (accessibility) "✅ Permissões principais prontas."
            else "⚠️ Ative “VÉRTICE Operação” na tela de Acessibilidade e volte para o aplicativo.",
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = onRefresh,
            modifier = Modifier.fillMaxWidth(),
            enabled = accessibility
        ) { Text("VERIFICAR NOVAMENTE") }
    }
}

@Composable
private fun PermissionCard(
    title: String,
    description: String,
    ready: Boolean,
    actionLabel: String,
    onClick: () -> Unit
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(description, fontSize = 13.sp)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(if (ready) "🟢 Pronta" else "🔴 Pendente")
                OutlinedButton(onClick = onClick, enabled = !ready) { Text(actionLabel) }
            }
        }
    }
}

@Composable
private fun LoginScreen(api: VerticeApi, onSuccess: (AuthResult) -> Unit) {
    var login by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("VÉRTICE", fontSize = 38.sp, fontWeight = FontWeight.Bold)
        Text("Inteligência Autônoma de Negócios", fontSize = 15.sp)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(login, { login = it }, Modifier.fillMaxWidth(), label = { Text("Login ou e-mail") }, singleLine = true)
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Senha") }, singleLine = true)
        if (error.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(error, color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                loading = true
                error = ""
                scope.launch {
                    val result = withContext(Dispatchers.IO) { api.login(login.trim(), password) }
                    loading = false
                    result.onSuccess(onSuccess).onFailure { error = it.message ?: "Não foi possível entrar." }
                }
            },
            Modifier.fillMaxWidth(), enabled = !loading
        ) { Text(if (loading) "ENTRANDO…" else "ENTRAR") }
    }
}

@Composable
private fun ModeSelectionScreen(
    api: VerticeApi,
    token: String,
    owner: Boolean,
    session: VerticeSession,
    onSelected: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf("") }

    fun choose(selected: String) {
        busy = selected
        message = ""
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                api.registerDevice(token, session.deviceId, selected, "Android • ${selected.uppercase()}", owner)
            }
            result.onSuccess { onSelected(selected) }
                .onFailure { message = it.message ?: "Falha ao registrar o terminal." }
            busy = null
        }
    }

    Column(Modifier.fillMaxSize().padding(22.dp), verticalArrangement = Arrangement.Center) {
        Text("CONFIGURAÇÃO DO TERMINAL", fontSize = 25.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("Uma instalação. Três funções. Escolha como este aparelho participará do VÉRTICE.")
        Spacer(Modifier.height(18.dp))
        ModeCard("🧠 COMANDO", "Decisão, estratégia e conversa com o VÉRTICE", busy == "comando") { choose("comando") }
        Spacer(Modifier.height(10.dp))
        ModeCard("📣 OPERAÇÃO", "Execução de comandos e rotinas externas", busy == "operacao") { choose("operacao") }
        Spacer(Modifier.height(10.dp))
        ModeCard("📊 MONITORAMENTO", "Status, métricas e acompanhamento", busy == "monitoramento") { choose("monitoramento") }
        if (message.isNotBlank()) { Spacer(Modifier.height(10.dp)); Text(message, color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
private fun ModeCard(title: String, subtitle: String, busy: Boolean, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(15.dp)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Text(subtitle, fontSize = 13.sp)
            Spacer(Modifier.height(8.dp))
            Button(onClick, Modifier.fillMaxWidth(), enabled = !busy) { Text(if (busy) "CONFIGURANDO…" else "USAR ESTE MODO") }
        }
    }
}

@Composable
private fun CommandCenter(
    api: VerticeApi,
    token: String,
    role: String,
    mode: String,
    session: VerticeSession,
    onModeChange: (String) -> Unit,
    onLogout: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var input by remember { mutableStateOf("") }
    var chat by remember { mutableStateOf(listOf(ChatLine(false, "VÉRTICE ativo. Diga o que precisa decidir, pesquisar, estruturar ou executar."))) }
    var busy by remember { mutableStateOf(false) }
    var lastCommand by remember { mutableStateOf("") }
    var lastQueuedId by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf("") }
    var sales by remember { mutableStateOf<SalesList?>(null) }
    var admin by remember { mutableStateOf<AdminOverview?>(null) }

    LaunchedEffect(mode) {
        withContext(Dispatchers.IO) { api.registerDevice(token, session.deviceId, mode, "Android • ${mode.uppercase()}", role == "OWNER") }
        if (mode != "operacao") {
            withContext(Dispatchers.IO) { api.sales(token) }.onSuccess { sales = it }
            if (role == "OWNER") withContext(Dispatchers.IO) { api.adminOverview(token) }.onSuccess { admin = it }
        }
    }

    LaunchedEffect(chat.size) { if (chat.isNotEmpty()) listState.animateScrollToItem(chat.lastIndex) }

    LaunchedEffect(lastQueuedId) {
        val id = lastQueuedId ?: return@LaunchedEffect
        repeat(30) {
            delay(1000)
            withContext(Dispatchers.IO) { api.commands(token) }.onSuccess { items ->
                val current = items.firstOrNull { it.id == id }
                if (current != null) {
                    status = "Status: ${current.status}${if (!current.message.isNullOrBlank()) " • ${current.message}" else ""}"
                    if (current.status == "completed" || current.status == "failed") return@onSuccess
                }
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                Text("VÉRTICE", fontSize = 27.sp, fontWeight = FontWeight.Bold)
                Text(if (role == "OWNER") "👑 PROPRIETÁRIO • ${mode.uppercase()}" else "🤖 OPERADOR • ${mode.uppercase()}", fontSize = 12.sp)
            }
            TextButton(onClick = onLogout) { Text("Sair") }
        }

        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MODES.forEach { value ->
                if (value == mode) Button(onClick = {}) { Text(value.uppercase()) }
                else OutlinedButton(onClick = { onModeChange(value) }) { Text(value.uppercase()) }
            }
        }
        Spacer(Modifier.height(10.dp))
        Text("CENTRO DE DECISÃO", fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))

        LazyColumn(Modifier.weight(1f), state = listState, verticalArrangement = Arrangement.spacedBy(7.dp)) {
            items(chat) { line ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(10.dp)) {
                        Text(if (line.fromUser) "VOCÊ" else "VÉRTICE", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Text(line.text)
                    }
                }
            }
        }

        if (mode != "operacao" && lastCommand.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Button(
                onClick = {
                    busy = true
                    scope.launch {
                        val result = withContext(Dispatchers.IO) { api.sendCommand(token, lastCommand, mode, session.deviceId, owner = role == "OWNER") }
                        busy = false
                        result.onSuccess {
                            lastQueuedId = it.id
                            status = "Comando enfileirado: ${it.id}"
                            chat = chat + ChatLine(false, "Comando enviado para execução. Status: ${it.status}.")
                        }.onFailure { status = it.message ?: "Falha ao enviar comando." }
                    }
                },
                Modifier.fillMaxWidth(), enabled = !busy
            ) { Text(if (busy) "ENVIANDO…" else "▶ EXECUTAR ÚLTIMO COMANDO") }
        }

        Spacer(Modifier.height(8.dp))
        OutlinedTextField(input, { input = it }, Modifier.fillMaxWidth(), label = { Text("Fale com o VÉRTICE") }, maxLines = 4)
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    val text = input.trim()
                    if (text.isBlank()) return@Button
                    input = ""
                    lastCommand = text
                    chat = chat + ChatLine(true, text)
                    busy = true
                    scope.launch {
                        val replyResult = withContext(Dispatchers.IO) { api.chat(token, text, mode) }
                        replyResult.onSuccess { chat = chat + ChatLine(false, it.answer) }
                            .onFailure { chat = chat + ChatLine(false, it.message ?: "Falha ao consultar o VÉRTICE.") }

                        if (mode == "operacao" && replyResult.isSuccess) {
                            val commandResult = withContext(Dispatchers.IO) {
                                api.sendCommand(token, text, mode, session.deviceId, owner = role == "OWNER")
                            }
                            commandResult.onSuccess {
                                lastQueuedId = it.id
                                status = "Execução iniciada • ${it.status}"
                                chat = chat + ChatLine(false, "📣 OPERAÇÃO recebeu o comando automaticamente. Status inicial: ${it.status}.")
                            }.onFailure {
                                status = it.message ?: "A análise respondeu, mas o comando não foi enfileirado."
                            }
                        }
                        busy = false
                    }
                },
                Modifier.weight(1f), enabled = !busy
            ) { Text("ENVIAR") }
            OutlinedButton(
                onClick = { chat = listOf(ChatLine(false, "Conversa reiniciada.")); lastCommand = ""; lastQueuedId = null; status = "" },
                enabled = !busy
            ) { Text("LIMPAR") }
        }

        if (status.isNotBlank()) { Spacer(Modifier.height(6.dp)); Text(status, fontSize = 12.sp) }
        Text("🛡 Adaptação controlada: alterar somente o que foi solicitado e preservar o restante.", fontSize = 10.sp)
    }
}
