package com.vertice.launcher

import android.content.Intent
import android.net.Uri
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
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class PermissionGateActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                PermissionGuide(onContinue = {
                    getSharedPreferences("vertice_session", MODE_PRIVATE)
                        .edit()
                        .putBoolean("permission_guide_seen", true)
                        .apply()
                    startActivity(Intent(this, MainActivity::class.java))
                    finish()
                })
            }
        }
    }

    private fun openAppDetails() {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:$packageName")
        )
        startActivity(intent)
    }

    private fun openAccessibility() {
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    @Composable
    private fun PermissionGuide(onContinue: () -> Unit) {
        Surface(Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxSize().padding(22.dp),
                verticalArrangement = Arrangement.Center
            ) {
                Text("PREPARAR VÉRTICE", fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                Text(
                    "Para o modo OPERAÇÃO, o Android pode bloquear o acesso de Acessibilidade para aplicativos instalados por APK. " +
                        "Isso é uma proteção do próprio sistema e não pode ser liberado silenciosamente pelo aplicativo."
                )
                Spacer(Modifier.height(16.dp))
                Text("1. Abra as informações do aplicativo.", fontWeight = FontWeight.SemiBold)
                Text("2. Toque em ⋮ e procure “Permitir configurações restritas”.")
                Text("3. Ative essa opção.")
                Text("4. Depois abra Acessibilidade e ative “VÉRTICE Operação”.")
                Spacer(Modifier.height(16.dp))

                Button(
                    onClick = { openAppDetails() },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("1 — ABRIR INFORMAÇÕES DO APP") }

                Spacer(Modifier.height(8.dp))

                OutlinedButton(
                    onClick = { openAccessibility() },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("2 — ABRIR ACESSIBILIDADE") }

                Spacer(Modifier.height(14.dp))

                Button(
                    onClick = onContinue,
                    modifier = Modifier.fillMaxWidth()
                ) { Text("CONTINUAR PARA O VÉRTICE") }
            }
        }
    }
}
