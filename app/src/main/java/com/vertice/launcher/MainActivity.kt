package com.vertice.launcher

import android.content.Intent
import android.net.Uri
import android.os.Bundle
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import com.vertice.launcher.network.AdminOverview
import com.vertice.launcher.network.AiReply
import com.vertice.launcher.network.AuthResult
import com.vertice.launcher.network.SalesList
import com.vertice.launcher.network.VerticeApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val VERTICE_BASE_URL = "https://vertice-backend-8gj5.onrender.com"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { VerticeApp() }
    }
}

private data class ChatLine(val fromUser: Boolean, val text: String)
private val modes = listOf("comando", "operacao", "monitoramento")

@Composable
private fun VerticeApp() {
    val context = LocalContext.current
    val session = remember { VerticeSession(context) }
    val api = remember { VerticeApi(VERTICE_BASE_URL) }
    var token by remember { mutableStateOf(session.sessionToken) }
    var role by remember { mutableStateOf(session.role) }
    var mode by remember { mutableStateOf(session.mode) }

    MaterialTheme(colorScheme = darkColorScheme()) {
        Surface(modifier = Modifier.fillMaxSize()) {
            when {
                token.isNullOrBlank() -> LoginScreen(api) { result ->
                    session.sessionToken = result.token
                    session.email = result.email
                    session.role = result.role
                    token = result.token
                    role = result.role
                    mode = session.mode
                }
                mode.isNullOrBlank() -> ModeSelectionScreen(api, token!!, role == "OWNER", session) {
                    session.mode = it
                    mode = it
                }
                else -> CommandCenter(
                    api = api,
                    token = token!!,
                    role = role ?: "CUSTOMER",
                    mode = mode!!,
                    session = session,
                    onModeChange = { session.mode = it; mode = it },
                    onLogout = { session.clearLogin(); token = null; role = null; mode = null },
                    context = context
                )
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
    Column(modifier = Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("VÉRTICE", fontSize = 38.sp, fontWeight = FontWeight.Bold)
        Text("Inteligência Autônoma de Negócios", fontSize = 15.sp)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(login, { login = it }, Modifier.fillMaxWidth(), label = { Text("Login ou e-mail") }, singleLine = true)
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Senha") }, singleLine = true)
        Spacer(Modifier.height(8.dp))
        Text("Proprietário: admchefe", fontSize = 12.sp)
        Text("Senha inicial: coringa", fontSize = 12.sp)
        if (error.isNotBlank()) { Spacer(Modifier.height(8.dp)); Text(error, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(16.dp))
        Button(onClick = {
            loading = true
            scope.launch {
                val result = withContext(Dispatchers.IO) { api.login(login.trim(), password) }
                loading = false
                result.onSuccess(onSuccess).onFailure { error = it.message ?: "Não foi possível entrar." }
            }
        }, Modifier.fillMaxWidth(), enabled = !loading) { Text(if (loading) "ENTRANDO…" else "ENTRAR") }
    }
}

@Composable
private fun ModeSelectionScreen(api: VerticeApi, token: String, owner: Boolean, session: VerticeSession, onSelected: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf("") }
    Column(modifier = Modifier.fillMaxSize().padding(22.dp), verticalArrangement = Arrangement.Center) {
        Text("CONFIGURAÇÃO DO TERMINAL", fontSize = 25.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("Escolha a função deste aparelho. A mesma instalação pode operar em qualquer modo.")
        Spacer(Modifier.height(18.dp))
        ModeCard("🧠 COMANDO", "Decisão, estratégia e conversa com o VÉRTICE", "comando") { choose("comando") }
        Spacer(Modifier.height(10.dp))
        ModeCard("📣 OPERAÇÃO", "Execução de comandos e rotinas externas", "operacao") { choose("operacao") }
        Spacer(Modifier.height(10.dp))
        ModeCard("📊 MONITORAMENTO", "Status, métricas e acompanhamento", "monitoramento") { choose("monitoramento") }
        if (message.isNotBlank()) { Spacer(Modifier.height(10.dp)); Text(message) }
    }
    fun dummy() = Unit
    @Suppress("UNUSED_VARIABLE") val unused = dummy
}

@Composable
private fun ModeCard(title:String, subtitle:String, value:String, onClick:()->Unit) {
    Card(modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(15.dp)) { Text(title, fontWeight = FontWeight.Bold, fontSize = 18.sp); Text(subtitle, fontSize = 13.sp); Spacer(Modifier.height(8.dp)); Button(onClick=onClick, Modifier.fillMaxWidth()) { Text("USAR ESTE MODO") } } }
}

private fun chooseMode(api: VerticeApi, token:String, owner:Boolean, session:VerticeSession, mode:String, onSelected:(String)->Unit, onError:(String)->Unit) {
    onError("")
    kotlinx.coroutines.GlobalScope.launch(Dispatchers.IO) {
        val result = api.registerDevice(token, session.deviceId, mode, "Android • ${mode.uppercase()}", owner)
        withContext(Dispatchers.Main) { result.onSuccess { onSelected(mode) }.onFailure { onError(it.message ?: "Falha ao registrar terminal.") } }
    }
}

@Composable
private fun CommandCenter(
    api: VerticeApi,
    token:String,
    role:String,
    mode:String,
    session:VerticeSession,
    onModeChange:(String)->Unit,
    onLogout:()->Unit,
    context:android.content.Context
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var input by remember { mutableStateOf("") }
    var chat by remember { mutableStateOf(listOf(ChatLine(false, "VÉRTICE ativo. Diga o que precisa decidir, pesquisar, estruturar ou executar."))) }
    var busy by remember { mutableStateOf(false) }
    var lastCommand by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var sales by remember { mutableStateOf<SalesList?>(null) }
    var admin by remember { mutableStateOf<AdminOverview?>(null) }

    LaunchedEffect(mode) {
        api.registerDevice(token, session.deviceId, mode, "Android • ${mode.uppercase()}", role == "OWNER")
    }
    LaunchedEffect(chat.size) { if (chat.isNotEmpty()) listState.animateScrollToItem(chat.lastIndex) }
    LaunchedEffect(mode) {
        if (mode == "monitoramento" || mode == "comando") {
            withContext(Dispatchers.IO) { api.sales(token) }.onSuccess { sales = it }
            if (role == "OWNER") withContext(Dispatchers.IO) { api.adminOverview(token) }.onSuccess { admin = it }
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
            modes.forEach { value ->
                if (value == mode) Button(onClick={}) { Text(value.uppercase()) }
                else OutlinedButton(onClick={ { onModeChange(value) } }) { Text(value.uppercase()) }
            }
        }
        Spacer(Modifier.height(10.dp))

        if (mode == "comando" || mode == "operacao") {
            Text("CENTRO DE DECISÃO", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Spacer(Modifier.height(6.dp))
            LazyColumn(Modifier.weight(1f), state=listState, verticalArrangement=Arrangement.spacedBy(7.dp)) {
                items(chat) { line ->
                    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(10.dp)) { Text(if(line.fromUser) "VOCÊ" else "VÉRTICE", fontSize=11.sp, fontWeight=FontWeight.Bold); Text(line.text) } }
                }
                if (lastCommand.isNotBlank()) {
                    item { Button(onClick={
                        busy=true
                        scope.launch {
                            val r=withContext(Dispatchers.IO){api.sendCommand(token,lastCommand,mode,session.deviceId,owner=role=="OWNER")}
                            busy=false
                            r.onSuccess { message="Comando enfileirado: ${it.id}"; chat=chat+ChatLine(false,"Executado no escopo solicitado. Status: ${it.status}.") }.onFailure { message=it.message?:"Falha ao executar." }
                        }
                    }, Modifier.fillMaxWidth(), enabled=!busy) { Text(if(busy) "ENVIANDO…" else "▶ EXECUTAR ÚLTIMO COMANDO") } }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(input,{input=it},Modifier.fillMaxWidth(),label={Text("Fale com o VÉRTICE")},maxLines=4)
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Button(onClick={
                    val text=input.trim(); if(text.isBlank()) return@Button
                    input=""; lastCommand=text; chat=chat+ChatLine(true,text); busy=true
                    scope.launch {
                        val r=withContext(Dispatchers.IO){api.chat(token,text,mode)}
                        busy=false
                        r.onSuccess { reply:AiReply -> chat=chat+ChatLine(false,reply.answer) }.onFailure { chat=chat+ChatLine(false,it.message?:"Falha ao consultar o VÉRTICE.") }
                    }
                },Modifier.weight(1f),enabled=!busy){Text("ENVIAR")}
                OutlinedButton(onClick={chat=listOf(ChatLine(false,"Conversa reiniciada."));lastCommand=""},enabled=!busy){Text("LIMPAR")}
            }
        } else {
            MonitorPanel(sales, admin, onRefresh={
                scope.launch {
                    withContext(Dispatchers.IO){api.sales(token)}.onSuccess{sales=it}
                    if(role=="OWNER") withContext(Dispatchers.IO){api.adminOverview(token)}.onSuccess{admin=it}
                }
            }, context=context)
        }

        if(message.isNotBlank()){ Spacer(Modifier.height(6.dp)); Text(message,fontSize=12.sp) }
        Text("🛡 Adaptação controlada: alterar somente o que foi solicitado e preservar o restante.",fontSize=10.sp)
    }
}

@Composable
private fun MonitorPanel(sales:SalesList?, admin:AdminOverview?, onRefresh:()->Unit, context:android.content.Context) {
    Column(Modifier.fillMaxSize()) {
        if(admin!=null){
            Text("PAINEL DO PROPRIETÁRIO",fontWeight=FontWeight.Bold,fontSize=18.sp)
            Spacer(Modifier.height(6.dp))
            Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text("Clientes: ${admin.customers}");Text("Assinaturas ativas: ${admin.activeSubscriptions}");Text("Terminais: ${admin.devices}");Text("Comandos hoje: ${admin.commandsToday}");Text("Vendas no mês: R$ %.2f".format(admin.salesMonth))}}
            Spacer(Modifier.height(10.dp))
        }
        Text("VENDAS",fontWeight=FontWeight.Bold,fontSize=18.sp)
        sales?.let { data ->
            Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text("Recebido: R$ %.2f".format(data.grossRevenue),fontWeight=FontWeight.Bold);Text("Pagas: ${data.paidCount} • Total: ${data.totalCount}")}}
            Spacer(Modifier.height(8.dp))
            LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(6.dp)){
                items(data.sales){ sale -> Card(Modifier.fillMaxWidth()){Column(Modifier.padding(10.dp)){Text(sale.product,fontWeight=FontWeight.SemiBold);Text("R$ %.2f • ${sale.status}".format(sale.amount));if(sale.status!="paid"&&sale.checkoutUrl.isNotBlank())TextButton(onClick={context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(sale.checkoutUrl)))}){Text("Abrir checkout")}}}}
            }
        } ?: Text("Carregando vendas…")
        HorizontalDivider(Modifier.padding(vertical=8.dp))
        Button(onClick=onRefresh,Modifier.fillMaxWidth()){Text("ATUALIZAR PAINEL")}
    }
}
