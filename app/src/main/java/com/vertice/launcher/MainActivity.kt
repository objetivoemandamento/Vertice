package com.vertice.launcher

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
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
import com.vertice.launcher.network.AuthResult
import com.vertice.launcher.network.PlanInfo
import com.vertice.launcher.network.VerticeApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

private val MODES = listOf("comando", "operacao", "monitoramento")
data class ChatLine(val fromUser: Boolean, val text: String)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); setContent { VerticeApp() } }
}

private fun accessibilityEnabled(context: Context): Boolean {
    val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    val expected = android.content.ComponentName(context, OperationAccessibilityService::class.java).flattenToString()
    return enabled.split(':').any { TextUtils.equals(it, expected) }
}
private fun openAccessibilitySettings(context: Context) { runCatching { context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }

@Composable
private fun VerticeApp() {
    val context = LocalContext.current; val session = remember { VerticeSession(context) }; val api = remember { VerticeApi(BuildConfig.VERTICE_API_URL) }
    var token by remember { mutableStateOf(session.sessionToken) }; var role by remember { mutableStateOf(session.role) }; var mode by remember { mutableStateOf(session.mode) }; var permissionReady by remember { mutableStateOf(mode != "operacao" || accessibilityEnabled(context)) }; var signupOpen by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { val update = withContext(Dispatchers.IO) { UpdateManager.check(context) }; if (update != null) UpdateManager.downloadAndInstall(context, update) }
    LaunchedEffect(api) { api.onAuthError = { session.clearLogin(); token = null; role = null; mode = null } }
    DisposableEffect(Unit) { val lifecycle = (context as? ComponentActivity)?.lifecycle; val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) permissionReady = mode != "operacao" || accessibilityEnabled(context) }; lifecycle?.addObserver(observer); onDispose { lifecycle?.removeObserver(observer) } }
    MaterialTheme(colorScheme = darkColorScheme()) { Surface(Modifier.fillMaxSize()) { when {
        signupOpen -> SignupScreen(api, { signupOpen = false }) { r -> session.sessionToken = r.token; session.email = r.email; session.role = r.role; token = r.token; role = r.role; mode = null; signupOpen = false; permissionReady = true }
        token.isNullOrBlank() -> LoginScreen(api, { signupOpen = true }) { r -> session.sessionToken = r.token; session.email = r.email; session.role = r.role; token = r.token; role = r.role; mode = session.mode; permissionReady = mode != "operacao" || accessibilityEnabled(context) }
        !permissionReady -> PermissionSetupScreen(context) { permissionReady = mode != "operacao" || accessibilityEnabled(context) }
        mode.isNullOrBlank() -> ModeSelectionScreen(api, token!!, role == "OWNER", session) { selected -> session.mode = selected; mode = selected; permissionReady = selected != "operacao" || accessibilityEnabled(context) }
        else -> CommandCenter(api, token!!, role ?: "CUSTOMER", mode!!, session, { selected -> session.mode = selected; mode = selected; permissionReady = selected != "operacao" || accessibilityEnabled(context) }, { session.clearLogin(); token = null; role = null; mode = null; permissionReady = true })
    } } }
}

@Composable private fun LoginScreen(api: VerticeApi, onCreateAccount: () -> Unit, onSuccess: (AuthResult) -> Unit) {
    val scope = rememberCoroutineScope(); var login by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var error by remember { mutableStateOf("") }; var loading by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) { Text("VÉRTICE", fontSize = 38.sp, fontWeight = FontWeight.Bold); Text("Inteligência Autônoma de Negócios"); Spacer(Modifier.height(24.dp)); OutlinedTextField(login, { login = it }, Modifier.fillMaxWidth(), label = { Text("Login ou e-mail") }, singleLine = true); Spacer(Modifier.height(8.dp)); OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Senha") }, singleLine = true); if (error.isNotBlank()) { Spacer(Modifier.height(8.dp)); Text(error, color = MaterialTheme.colorScheme.error) }; Spacer(Modifier.height(12.dp)); Button(onClick = { loading = true; scope.launch { val r = withContext(Dispatchers.IO) { api.login(login.trim(), password) }; loading = false; if (r.isSuccess) onSuccess(r.getOrThrow()) else error = r.exceptionOrNull()?.message ?: "Falha no login." } }, Modifier.fillMaxWidth(), enabled = !loading) { Text(if (loading) "ENTRANDO…" else "ENTRAR") }; Spacer(Modifier.height(4.dp)); TextButton(onClick = onCreateAccount, Modifier.fillMaxWidth(), enabled = !loading) { Text("Ainda não tenho uma conta — CRIAR CONTA", fontWeight = FontWeight.SemiBold) } }
}

@Composable private fun SignupScreen(api: VerticeApi, onBack: () -> Unit, onPaid: (AuthResult) -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope(); var plans by remember { mutableStateOf<List<PlanInfo>>(emptyList()) }; var selectedPlan by remember { mutableStateOf("") }; var email by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var confirm by remember { mutableStateOf("") }; var signupId by remember { mutableStateOf<String?>(null) }; var signupToken by remember { mutableStateOf<String?>(null) }; var error by remember { mutableStateOf("") }; var status by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { val r = withContext(Dispatchers.IO) { api.plans() }; if (r.isSuccess) { plans = r.getOrThrow(); selectedPlan = plans.firstOrNull()?.id.orEmpty() } else error = r.exceptionOrNull()?.message ?: "Não foi possível carregar os planos." }
    fun startPayment() { error = ""; if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches()) { error = "Informe um e-mail válido."; return }; if (password.length < 8) { error = "A senha precisa ter pelo menos 8 caracteres."; return }; if (password != confirm) { error = "As senhas não conferem."; return }; if (selectedPlan.isBlank()) { error = "Escolha um plano."; return }; busy = true; scope.launch { val r = withContext(Dispatchers.IO) { api.startSignup(email.trim(), password, selectedPlan) }; busy = false; if (r.isSuccess) { val x = r.getOrThrow(); signupId = x.signupId; signupToken = x.signupToken; status = "Checkout criado. Finalize o pagamento para ativar sua conta."; runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(x.checkoutUrl))) }.onFailure { error = "Não foi possível abrir o pagamento neste aparelho." } } else error = r.exceptionOrNull()?.message ?: "Não foi possível iniciar o pagamento." } }
    fun verifyPayment() { val id = signupId ?: return; val st = signupToken ?: return; busy = true; scope.launch { val r = withContext(Dispatchers.IO) { api.signupStatus(id, st) }; busy = false; if (r.isSuccess) { val x = r.getOrThrow(); when (x.status.lowercase(Locale.ROOT)) { "paid" -> if (!x.token.isNullOrBlank() && !x.email.isNullOrBlank()) onPaid(AuthResult(x.token, x.customerId.orEmpty(), x.email, "CUSTOMER")) else error = "Pagamento aprovado, mas a sessão não pôde ser criada."; "pending" -> status = "Pagamento ainda não confirmado."; "cancelled" -> status = "O pagamento foi cancelado."; "expired" -> status = "O checkout expirou."; else -> status = "Status do pagamento: ${x.status}" } } else error = r.exceptionOrNull()?.message ?: "Não foi possível verificar o pagamento." } }
    Column(Modifier.fillMaxSize().padding(18.dp)) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("CRIAR CONTA", fontSize = 27.sp, fontWeight = FontWeight.Bold); TextButton(onClick = onBack, enabled = !busy) { Text("Voltar") } }; Spacer(Modifier.height(8.dp)); Text("Crie sua conta e escolha o plano para liberar o acesso ao VÉRTICE."); Spacer(Modifier.height(14.dp)); OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("E-mail") }, singleLine = true); Spacer(Modifier.height(7.dp)); OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Senha — mínimo 8 caracteres") }, singleLine = true); Spacer(Modifier.height(7.dp)); OutlinedTextField(confirm, { confirm = it }, Modifier.fillMaxWidth(), label = { Text("Confirmar senha") }, singleLine = true); Spacer(Modifier.height(12.dp)); Text("ESCOLHA SEU PLANO", fontWeight = FontWeight.Bold); Spacer(Modifier.height(6.dp)); LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) { items(plans) { p -> Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Column(Modifier.weight(1f)) { Text(p.name, fontWeight = FontWeight.Bold, fontSize = 17.sp); Text(p.description, fontSize = 12.sp) }; Text("R$ ${"%.2f".format(Locale("pt", "BR"), p.price)}", fontWeight = FontWeight.Bold) }; Spacer(Modifier.height(6.dp)); if (selectedPlan == p.id) Button(onClick = {}, Modifier.fillMaxWidth()) { Text("PLANO SELECIONADO") } else OutlinedButton(onClick = { selectedPlan = p.id }, Modifier.fillMaxWidth()) { Text("ESCOLHER") } } } } }; if (error.isNotBlank()) { Spacer(Modifier.height(8.dp)); Text(error, color = MaterialTheme.colorScheme.error) }; if (status.isNotBlank()) { Spacer(Modifier.height(8.dp)); Text(status, fontSize = 13.sp) }; Spacer(Modifier.height(8.dp)); if (signupId == null) Button(onClick = { startPayment() }, Modifier.fillMaxWidth(), enabled = !busy && plans.isNotEmpty()) { Text(if (busy) "CRIANDO CHECKOUT…" else "CONTINUAR PARA PAGAMENTO") } else { Button(onClick = { verifyPayment() }, Modifier.fillMaxWidth(), enabled = !busy) { Text(if (busy) "VERIFICANDO…" else "JÁ PAGUEI — VERIFICAR PAGAMENTO") }; Spacer(Modifier.height(4.dp)); OutlinedButton(onClick = { startPayment() }, Modifier.fillMaxWidth(), enabled = !busy) { Text("GERAR NOVO CHECKOUT") } } }
}

@Composable private fun PermissionSetupScreen(context: Context, onRefresh: () -> Unit) {
    val activity = context as? Activity; var notificationGranted by remember { mutableStateOf(Build.VERSION.SDK_INT < 33 || androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED) }; val accessibility = accessibilityEnabled(context); val lifecycle = LocalLifecycleOwner.current
    LaunchedEffect(Unit) { if (Build.VERSION.SDK_INT >= 33 && !notificationGranted && activity != null) ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101) }
    DisposableEffect(lifecycle) { val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) { notificationGranted = Build.VERSION.SDK_INT < 33 || androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED; onRefresh() } }; lifecycle.lifecycle.addObserver(observer); onDispose { lifecycle.lifecycle.removeObserver(observer) } }
    Column(Modifier.fillMaxSize().padding(22.dp), verticalArrangement = Arrangement.Center) { Text("CONFIGURAÇÃO NECESSÁRIA", fontSize = 27.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.height(12.dp)); Text("O VÉRTICE precisa das permissões abaixo para operar neste aparelho."); Spacer(Modifier.height(16.dp)); PermissionCard("Notificações", notificationGranted) { if (Build.VERSION.SDK_INT >= 33 && activity != null) ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4101) }; Spacer(Modifier.height(10.dp)); PermissionCard("OPERAÇÃO — Acessibilidade", accessibility) { openAccessibilitySettings(context) }; Spacer(Modifier.height(14.dp)); Text(if (accessibility) "✅ Acessibilidade pronta." else "⚠️ Ative \"VÉRTICE Operação\" na tela de Acessibilidade e volte para o aplicativo.", fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(12.dp)); Button(onClick = onRefresh, Modifier.fillMaxWidth(), enabled = accessibility) { Text("VERIFICAR NOVAMENTE") } }
}
@Composable private fun PermissionCard(title: String, ready: Boolean, onClick: () -> Unit) { Card(Modifier.fillMaxWidth()) { Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween) { Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.Bold); Text(if (ready) "Pronta" else "Pendente", fontSize = 12.sp) }; OutlinedButton(onClick, enabled = !ready) { Text(if (ready) "ATIVA" else "ATIVAR") } } } }
@Composable private fun ModeSelectionScreen(api: VerticeApi, token: String, owner: Boolean, session: VerticeSession, onSelected: (String) -> Unit) { val scope = rememberCoroutineScope(); var busy by remember { mutableStateOf<String?>(null) }; var error by remember { mutableStateOf("") }; fun selectMode(selected: String) { busy = selected; scope.launch { val r = withContext(Dispatchers.IO) { api.registerDevice(token, session.deviceId, selected, "Android • ${selected.uppercase()}", owner) }; if (r.isSuccess) onSelected(selected) else error = r.exceptionOrNull()?.message ?: "Falha ao registrar o terminal."; busy = null } }; Column(Modifier.fillMaxSize().padding(22.dp), verticalArrangement = Arrangement.Center) { Text("ESCOLHA O MODO", fontSize = 27.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.height(16.dp)); ModeCard("COMANDO", "Decisão, estratégia e conversa", busy == "comando") { selectMode("comando") }; Spacer(Modifier.height(10.dp)); ModeCard("OPERAÇÃO", "Execução real no Android", busy == "operacao") { selectMode("operacao") }; Spacer(Modifier.height(10.dp)); ModeCard("MONITORAMENTO", "Acompanhamento e indicadores", busy == "monitoramento") { selectMode("monitoramento") }; if (error.isNotBlank()) { Spacer(Modifier.height(10.dp)); Text(error, color = MaterialTheme.colorScheme.error) } } }
@Composable private fun ModeCard(title: String, subtitle: String, busy: Boolean, onClick: () -> Unit) { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(15.dp)) { Text(title, fontWeight = FontWeight.Bold, fontSize = 18.sp); Text(subtitle, fontSize = 13.sp); Spacer(Modifier.height(8.dp)); Button(onClick, Modifier.fillMaxWidth(), enabled = !busy) { Text(if (busy) "CONFIGURANDO…" else "USAR ESTE MODO") } } } }

@Composable private fun CommandCenter(api: VerticeApi, token: String, role: String, mode: String, session: VerticeSession, onModeChange: (String) -> Unit, onLogout: () -> Unit) {
    val context = LocalContext.current; val scope = rememberCoroutineScope(); val history = remember(token) { ConversationHistory(context, session.email.ifBlank { token.take(16) }) }; var input by remember { mutableStateOf("") }; var chat by remember { mutableStateOf(emptyList<ChatLine>()) }; var busy by remember { mutableStateOf(false) }; var status by remember { mutableStateOf("") }; var showHistory by remember { mutableStateOf(false) }; var emergency by remember { mutableStateOf(session.emergencyStop) }
    LaunchedEffect(token, mode) { val stored = withContext(Dispatchers.IO) { history.load() }; chat = if (stored.isEmpty()) listOf(ChatLine(false, "VÉRTICE ativo. Diga o que precisa decidir, pesquisar, estruturar ou executar.")) else stored.map { ChatLine(it.fromUser, it.text) }; withContext(Dispatchers.IO) { api.registerDevice(token, session.deviceId, mode, "Android • ${mode.uppercase()}", role == "OWNER") } }
    fun save(line: ChatLine) { history.append(StoredChatLine(line.fromUser, line.text, System.currentTimeMillis())) }
    fun toggleEmergency() { emergency = !emergency; session.emergencyStop = emergency; status = if (emergency) "EMERGÊNCIA ATIVADA • autonomia bloqueada." else "AUTONOMIA RETOMADA."; val a = ChatLine(false, status); chat = chat + a; save(a) }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Column(Modifier.weight(1f)) { Text("VÉRTICE", fontSize = 27.sp, fontWeight = FontWeight.Bold); Text("$role • ${mode.uppercase()}", fontSize = 12.sp) }; TextButton(onClick = { showHistory = !showHistory }) { Text("HISTÓRICO") }; TextButton(onClick = onLogout) { Text("Sair") } }
        Spacer(Modifier.height(6.dp)); Button(onClick = { toggleEmergency() }, Modifier.fillMaxWidth()) { Text(if (emergency) "▶ RETOMAR AUTONOMIA" else "■ EMERGÊNCIA • PARAR AUTONOMIA") }
        Text(if (emergency) "Estado: AUTONOMIA BLOQUEADA" else "Estado: AUTONOMIA ATIVA", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        if (showHistory) Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(10.dp)) { Text("Histórico salvo", fontWeight = FontWeight.Bold); Text("As conversas e comandos ficam salvos neste aparelho."); TextButton(onClick = { history.clear(); chat = listOf(ChatLine(false, "Histórico limpo. VÉRTICE ativo.")); showHistory = false }) { Text("LIMPAR HISTÓRICO") } } }
        Spacer(Modifier.height(8.dp)); Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) { MODES.forEach { current -> if (current == mode) Button(onClick = {}) { Text(current.uppercase()) } else OutlinedButton(onClick = { onModeChange(current) }) { Text(current.uppercase()) } } }
        Spacer(Modifier.height(8.dp)); LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) { items(chat) { line -> Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(10.dp)) { Text(if (line.fromUser) "VOCÊ" else "VÉRTICE", fontSize = 11.sp, fontWeight = FontWeight.Bold); Text(line.text) } } } }
        OutlinedTextField(input, { input = it }, Modifier.fillMaxWidth(), label = { Text("Fale com o VÉRTICE") }, maxLines = 4); Spacer(Modifier.height(6.dp))
        Button(onClick = { val text = input.trim(); if (text.isEmpty()) return@Button; input = ""; val u = ChatLine(true, text); chat = chat + u; save(u); busy = true; scope.launch { val reply = withContext(Dispatchers.IO) { api.chat(token, text, mode) }; if (reply.isSuccess) { val ai = reply.getOrThrow(); val b = ChatLine(false, ai.answer); chat = chat + b; save(b); if (mode == "operacao" && ai.shouldExecute && !session.emergencyStop) { val command = withContext(Dispatchers.IO) { api.sendCommand(token, text, mode, session.deviceId, owner = role == "OWNER") }; status = if (command.isSuccess) "Execução iniciada • ${command.getOrThrow().status}" else command.exceptionOrNull()?.message ?: "Falha ao enfileirar comando."; val a = ChatLine(false, status); chat = chat + a; save(a) } else if (mode == "operacao") { status = if (session.emergencyStop) "Execução bloqueada: emergência ativada." else "Análise concluída. Nenhuma execução foi autorizada pela IA."; val a = ChatLine(false, status); chat = chat + a; save(a) } } else { status = reply.exceptionOrNull()?.message ?: "Falha ao consultar o VÉRTICE."; val e = ChatLine(false, status); chat = chat + e; save(e) }; busy = false } }, Modifier.fillMaxWidth(), enabled = !busy) { Text(if (busy) "ENVIANDO…" else "ENVIAR") }
        if (status.isNotBlank()) { Spacer(Modifier.height(6.dp)); Text(status, fontSize = 12.sp) }
    }
}
