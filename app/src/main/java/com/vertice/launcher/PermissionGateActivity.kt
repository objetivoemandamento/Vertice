package com.vertice.launcher

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class PermissionGateActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                var update by remember { mutableStateOf<UpdateManager.UpdateInfo?>(null) }
                LaunchedEffect(Unit) {
                    update = withContext(Dispatchers.IO) { UpdateManager.check(this@PermissionGateActivity) }
                }
                PermissionGuide(
                    update = update,
                    onInstallUpdate = { info -> UpdateManager.downloadAndInstall(this@PermissionGateActivity, info) },
                    onContinue = {
                        getSharedPreferences("vertice_session", MODE_PRIVATE)
                            .edit()
                            .putBoolean("permission_guide_seen", true)
                            .apply()
                        startActivity(Intent(this, MainActivity::class.java))
                        finish()
                    }
                )
            }
        }
    }

    private fun openAppDetails() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
        startActivity(intent)
    }

    private fun openAccessibility() {
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    @Composable
    private fun PermissionGuide(
        update: UpdateManager.UpdateInfo?,
        onInstallUpdate: (UpdateManager.UpdateInfo) -> Unit,
        onContinue: () -> Unit
    ) {
        var dismissed by remember { mutableStateOf(false) }
        val needsRestrictedSettings = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().padding(22.dp), verticalArrangement = Arrangement.Center) {
                Text("PREPARAR VÉRTICE", fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                Text("Para o VÉRTICE operar no celular, é necessário ativar o serviço de acessibilidade.")
                Spacer(Modifier.height(16.dp))
                if (needsRestrictedSettings) {
                    Text("1. Abra as informações do aplicativo.", fontWeight = FontWeight.SemiBold)
                    Text("2. No menu ⋮, procure “Permitir configurações restritas” e ative.")
                    Text("3. Depois abra Acessibilidade e ative “VÉRTICE Operação”.")
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = { openAppDetails() }, modifier = Modifier.fillMaxWidth()) { Text("1 — ABRIR INFORMAÇÕES DO APP") }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { openAccessibility() }, modifier = Modifier.fillMaxWidth()) { Text("2 — ABRIR ACESSIBILIDADE") }
                } else {
                    Text("1. Abra Acessibilidade.", fontWeight = FontWeight.SemiBold)
                    Text("2. Entre em Serviços instalados e ative “VÉRTICE Operação”.")
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = { openAccessibility() }, modifier = Modifier.fillMaxWidth()) { Text("ABRIR ACESSIBILIDADE") }
                }
                Spacer(Modifier.height(14.dp))
                Button(onClick = onContinue, modifier = Modifier.fillMaxWidth()) { Text("CONTINUAR PARA O VÉRTICE") }
            }

            if (update != null && !dismissed) {
                AlertDialog(
                    onDismissRequest = { dismissed = true },
                    title = { Text("ATUALIZAÇÃO DO VÉRTICE") },
                    text = { Text("Uma nova versão (${update.versionName}) está disponível. ${update.notes}") },
                    confirmButton = {
                        Button(onClick = { dismissed = true; onInstallUpdate(update) }) { Text("ATUALIZAR AGORA") }
                    },
                    dismissButton = {
                        OutlinedButton(onClick = { dismissed = true }) { Text("AGORA NÃO") }
                    }
                )
            }
        }
    }
}
