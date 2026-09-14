package com.vertice.launcher

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vertice.launcher.network.*
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

@Composable
private fun VerticeApp() {
    val context = LocalContext.current
    val session = remember { VerticeSession(context) }
    val api = remember { VerticeApi(VERTICE_BASE_URL) }
    var token by remember { mutableStateOf(session.sessionToken) }
    var role by remember { mutableStateOf(session.role) }
    MaterialTheme(colorScheme = darkColorScheme()) {
        Surface(Modifier.fillMaxSize()) {
            if (token.isNullOrBlank()) {
                LoginScreen(api) { result ->
                    session.sessionToken = result.token
                    session.email = result.email
                    session.role = result.role
                    token = result.token
                    role = result.role
                }
            } else {
                Dashboard(
                    api = api,
                    token = token!!,
                    role = role ?: "CUSTOMER",
                    email = session.email,
                    onLogout = {
                        session.clearLogin()
                        token = null
                        role = null
                    }
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
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("VÉRTICE", 36.sp, fontWeight = FontWeight.Bold)
        Text("Inteligência Autônoma de Negócios")
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(login, { login = it }, Modifier.fillMaxWidth(), label = { Text("Login ou e-mail") }, singleLine = true)
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Senha") }, singleLine = true)
        if (error.isNotBlank()) { Spacer(Modifier.height(8.dp)); Text(error, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(16.dp))
        Button(
            enabled = !loading,
            onClick = {
                loading = true
                scope.launch {
                    val result = withContext(Dispatchers.IO) { api.login(login.trim(), password) }
                    loading = false
                    result.onSuccess(onSuccess).onFailure { error = it.message ?: "Não foi possível entrar." }
                }
            },
            Modifier.fillMaxWidth()
        ) { Text(if (loading) "ENTRANDO…" else "ENTRAR") }
    }
}

@Composable
private fun Dashboard(api: VerticeApi, token: String, role: String, email: String, onLogout: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var sales by remember { mutableStateOf<SalesList?>(null) }
    var message by remember { mutableStateOf("Carregando…") }
    var product by remember { mutableStateOf("Produto de teste") }
    var amount by remember { mutableStateOf("10,00") }
    var loading by remember { mutableStateOf(false) }

    fun reload() {
        scope.launch {
            withContext(Dispatchers.IO) { api.sales(token) }
                .onSuccess { sales = it; message = "" }
                .onFailure { message = it.message ?: "Falha ao carregar vendas." }
        }
    }
    LaunchedEffect(token) { reload() }

    Column(Modifier.fillMaxSize().padding(18.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("VÉRTICE", 28.sp, fontWeight = FontWeight.Bold)
                Text(if (role == "OWNER") "👑 PROPRIETÁRIO" else "🤖 OPERADOR")
                Text(email, 12.sp)
            }
            TextButton(onClick = onLogout) { Text("Sair") }
        }
        Spacer(Modifier.height(14.dp))
        Text("💰 MINHAS VENDAS", 21.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        sales?.let {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Card(Modifier.weight(1f)) { Column(Modifier.padding(12.dp)) { Text("Recebido", 12.sp); Text("R$ %.2f".format(it.grossRevenue), 18.sp, fontWeight = FontWeight.Bold) } }
                Card(Modifier.weight(1f)) { Column(Modifier.padding(12.dp)) { Text("Pagas", 12.sp); Text(it.paidCount.toString(), 18.sp, fontWeight = FontWeight.Bold) } }
            }
        }
        Spacer(Modifier.height(10.dp))
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp)) {
                Text("Nova cobrança de teste", 16.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(product, { product = it }, Modifier.fillMaxWidth(), label = { Text("Produto") }, singleLine = true)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(amount, { amount = it }, Modifier.fillMaxWidth(), label = { Text("Valor em R$") }, singleLine = true)
                Spacer(Modifier.height(8.dp))
                Button(enabled = !loading, onClick = {
                    val value = amount.replace(".", "").replace(",", ".").toDoubleOrNull()
                    if (value == null || value <= 0) { message = "Informe um valor válido."; return@Button }
                    loading = true
                    scope.launch {
                        val r = withContext(Dispatchers.IO) { api.createSaleOrder(token, product, value) }
                        loading = false
                        r.onSuccess {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it.checkoutUrl)))
                            message = "Checkout aberto."
                            reload()
                        }.onFailure { message = it.message ?: "Falha ao criar cobrança." }
                    }
                }, Modifier.fillMaxWidth()) { Text(if (loading) "CRIANDO…" else "GERAR COBRANÇA") }
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(message, 12.sp)
        Spacer(Modifier.height(10.dp))
        Button(onClick = { reload() }, Modifier.fillMaxWidth()) { Text("ATUALIZAR VENDAS") }
        Spacer(Modifier.height(8.dp))
        Text("Transações de teste são controladas pelo Mercado Pago; nunca coloque Access Token no aplicativo.", 11.sp)
        Spacer(Modifier.height(12.dp))
        sales?.let {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(it.sales) { sale ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(10.dp)) {
                            Text(sale.product, fontWeight = FontWeight.SemiBold)
                            Text("R$ %.2f • ${sale.status}".format(sale.amount), 12.sp)
                            if (sale.status != "paid" && sale.checkoutUrl.isNotBlank()) {
                                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(sale.checkoutUrl))) }) { Text("Abrir checkout") }
                            }
                        }
                    }
                }
            }
        }
    }
}
