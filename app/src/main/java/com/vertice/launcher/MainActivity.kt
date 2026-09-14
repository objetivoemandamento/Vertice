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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vertice.launcher.network.AuthResult
import com.vertice.launcher.network.SaleItem
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

@Composable
private fun VerticeApp() {
    val context = LocalContext.current
    val session = remember { VerticeSession(context) }
    val api = remember { VerticeApi(VERTICE_BASE_URL) }
    var token by remember { mutableStateOf(session.sessionToken) }
    var role by remember { mutableStateOf(session.role) }

    MaterialTheme(colorScheme = darkColorScheme()) {
        Surface(modifier = Modifier.fillMaxSize()) {
            if (token.isNullOrBlank()) {
                LoginScreen(api = api) { result ->
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
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(text = "VÉRTICE", fontSize = 36.sp, fontWeight = FontWeight.Bold)
        Text(text = "Inteligência Autônoma de Negócios")
        Spacer(modifier = Modifier.height(28.dp))
        OutlinedTextField(
            value = login,
            onValueChange = { login = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Login ou e-mail") },
            singleLine = true
        )
        Spacer(modifier = Modifier.height(10.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Senha") },
            singleLine = true
        )
        if (error.isNotBlank()) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(text = error, color = MaterialTheme.colorScheme.error)
        }
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = {
                loading = true
                scope.launch {
                    val result = withContext(Dispatchers.IO) {
                        api.login(login.trim(), password)
                    }
                    loading = false
                    result
                        .onSuccess(onSuccess)
                        .onFailure { error = it.message ?: "Não foi possível entrar." }
                }
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = !loading
        ) {
            Text(text = if (loading) "ENTRANDO…" else "ENTRAR")
        }
    }
}

@Composable
private fun Dashboard(
    api: VerticeApi,
    token: String,
    role: String,
    email: String,
    onLogout: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var sales by remember { mutableStateOf<SalesList?>(null) }
    var message by remember { mutableStateOf("Carregando…") }
    var product by remember { mutableStateOf("Produto de teste") }
    var amount by remember { mutableStateOf("10,00") }
    var loading by remember { mutableStateOf(false) }

    fun reload() {
        scope.launch {
            val result = withContext(Dispatchers.IO) { api.sales(token) }
            result
                .onSuccess {
                    sales = it
                    message = ""
                }
                .onFailure {
                    message = it.message ?: "Falha ao carregar vendas."
                }
        }
    }

    LaunchedEffect(token) { reload() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(18.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = "VÉRTICE", fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text(text = if (role == "OWNER") "👑 PROPRIETÁRIO" else "🤖 OPERADOR")
                Text(text = email, fontSize = 12.sp)
            }
            TextButton(onClick = onLogout) { Text(text = "Sair") }
        }

        Spacer(modifier = Modifier.height(14.dp))
        Text(text = "💰 MINHAS VENDAS", fontSize = 21.sp, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(8.dp))

        sales?.let { data ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Card(modifier = Modifier.weight(1f)) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(text = "Recebido", fontSize = 12.sp)
                        Text(text = "R$ %.2f".format(data.grossRevenue), fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    }
                }
                Card(modifier = Modifier.weight(1f)) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(text = "Pagas", fontSize = 12.sp)
                        Text(text = data.paidCount.toString(), fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(10.dp))
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text(text = "Nova cobrança de teste", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = product,
                    onValueChange = { product = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Produto") },
                    singleLine = true
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Valor em R$") },
                    singleLine = true
                )
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = {
                        val value = amount.replace(".", "").replace(",", ".").toDoubleOrNull()
                        if (value == null || value <= 0) {
                            message = "Informe um valor válido."
                            return@Button
                        }
                        loading = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) {
                                api.createSaleOrder(token, product, value)
                            }
                            loading = false
                            result
                                .onSuccess {
                                    context.startActivity(
                                        Intent(Intent.ACTION_VIEW, Uri.parse(it.checkoutUrl))
                                    )
                                    message = "Checkout aberto."
                                    reload()
                                }
                                .onFailure {
                                    message = it.message ?: "Falha ao criar cobrança."
                                }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !loading
                ) {
                    Text(text = if (loading) "CRIANDO…" else "GERAR COBRANÇA")
                }
            }
        }

        Spacer(modifier = Modifier.height(10.dp))
        Text(text = message, fontSize = 12.sp)
        Spacer(modifier = Modifier.height(10.dp))
        Button(onClick = { reload() }, modifier = Modifier.fillMaxWidth()) {
            Text(text = "ATUALIZAR VENDAS")
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Transações de teste são controladas pelo Mercado Pago; nunca coloque Access Token no aplicativo.",
            fontSize = 11.sp
        )
        Spacer(modifier = Modifier.height(12.dp))

        sales?.let { data ->
            LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(data.sales) { sale: SaleItem ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(text = sale.product, fontWeight = FontWeight.SemiBold)
                            Text(text = "R$ %.2f • ${sale.status}".format(sale.amount), fontSize = 12.sp)
                            if (sale.status != "paid" && sale.checkoutUrl.isNotBlank()) {
                                TextButton(
                                    onClick = {
                                        context.startActivity(
                                            Intent(Intent.ACTION_VIEW, Uri.parse(sale.checkoutUrl))
                                        )
                                    }
                                ) { Text(text = "Abrir checkout") }
                            }
                        }
                    }
                }
            }
        }
    }
}
