package com.vertice.launcher

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
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
import com.vertice.launcher.network.VerticeApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val MODES=listOf("comando","operacao","monitoramento")
data class ChatLine(val fromUser:Boolean,val text:String)
class MainActivity:ComponentActivity(){override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent{VerticeApp()}}}
private fun accessibilityEnabled(context:Context):Boolean{val enabled=Settings.Secure.getString(context.contentResolver,Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)?:return false;val expected=android.content.ComponentName(context,OperationAccessibilityService::class.java).flattenToString();return enabled.split(':').any{TextUtils.equals(it,expected)}}
private fun openAccessibilitySettings(context:Context){runCatching{context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}}
@Composable private fun VerticeApp(){val context=LocalContext.current;val session=remember{VerticeSession(context)};val api=remember{VerticeApi(BuildConfig.VERTICE_API_URL)};var token by remember{mutableStateOf(session.sessionToken)};var role by remember{mutableStateOf(session.role)};var mode by remember{mutableStateOf(session.mode)};var ready by remember{mutableStateOf(mode!="operacao"||accessibilityEnabled(context))};LaunchedEffect(api){api.onAuthError={session.clearLogin();token=null;role=null;mode=null}};DisposableEffect(Unit){val lifecycle=(context as? ComponentActivity)?.lifecycle;val observer=LifecycleEventObserver{_,e->if(e==Lifecycle.Event.ON_RESUME)ready=mode!="operacao"||accessibilityEnabled(context)};lifecycle?.addObserver(observer);onDispose{lifecycle?.removeObserver(observer)}};MaterialTheme(colorScheme=darkColorScheme()){Surface(Modifier.fillMaxSize()){when{token.isNullOrBlank()->LoginScreen(api){r->session.sessionToken=r.token;session.email=r.email;session.role=r.role;token=r.token;role=r.role;mode=session.mode;ready=mode!="operacao"||accessibilityEnabled(context)}};!ready->PermissionSetup(context){ready=mode!="operacao"||accessibilityEnabled(context)};mode.isNullOrBlank()->ModeScreen(api,token!!,role=="OWNER",session){mode=it;session.mode=it;ready=it!="operacao"||accessibilityEnabled(context)};else->CommandScreen(api,token!!,role?:"CUSTOMER",mode!!,session,{mode=it;session.mode=it;ready=it!="operacao"||accessibilityEnabled(context)},{session.clearLogin();token=null;role=null;mode=null;ready=true})}}}}
@Composable private fun PermissionSetup(context:Context,onRefresh:()->Unit){val activity=context as? Activity;var notification by remember{mutableStateOf(Build.VERSION.SDK_INT<33||androidx.core.content.ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)==android.content.pm.PackageManager.PERMISSION_GRANTED)};val access=accessibilityEnabled(context);LaunchedEffect(Unit){if(Build.VERSION.SDK_INT>=33&&!notification&&activity!=null)ActivityCompat.requestPermissions(activity,arrayOf(Manifest.permission.POST_NOTIFICATIONS),4101)};val lifecycle=LocalLifecycleOwner.current;DisposableEffect(lifecycle){val observer=LifecycleEventObserver{_,e->if(e==Lifecycle.Event.ON_RESUME){notification=Build.VERSION.SDK_INT<33||androidx.core.content.ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)==android.content.pm.PackageManager.PERMISSION_GRANTED;onRefresh()}};lifecycle.lifecycle.addObserver(observer);onDispose{lifecycle.lifecycle.removeObserver(observer)}};Column(Modifier.fillMaxSize().padding(22.dp),verticalArrangement=Arrangement.Center){Text("CONFIGURAÇÃO NECESSÁRIA",fontSize=27.sp,fontWeight=FontWeight.Bold);Spacer(Modifier.height(12.dp));Text("O VÉRTICE precisa das permissões abaixo para operar neste aparelho.");Spacer(Modifier.height(16.dp));PermissionCard("Notificações",notification){if(Build.VERSION.SDK_INT>=33&&activity!=null)ActivityCompat.requestPermissions(activity,arrayOf(Manifest.permission.POST_NOTIFICATIONS),4101)};Spacer(Modifier.height(10.dp));PermissionCard("OPERAÇÃO — Acessibilidade",access){openAccessibilitySettings(context)};Spacer(Modifier.height(14.dp));Text(if(access)"✅ Acessibilidade pronta." else "⚠️ Ative \"VÉRTICE Operação\" na tela de Acessibilidade e volte para o aplicativo.",fontWeight=FontWeight.SemiBold);Spacer(Modifier.height(12.dp));Button(onClick=onRefresh,Modifier.fillMaxWidth(),enabled=access){Text("VERIFICAR NOVAMENTE")}}}
@Composable private fun PermissionCard(title:String,ready:Boolean,onClick:()->Unit){Card(Modifier.fillMaxWidth()){Row(Modifier.fillMaxWidth().padding(14.dp),horizontalArrangement=Arrangement.SpaceBetween){Column(Modifier.weight(1f)){Text(title,fontWeight=FontWeight.Bold);Text(if(ready)"Pronta" else "Pendente",fontSize=12.sp)};OutlinedButton(onClick=onClick,enabled=!ready){Text(if(ready)"ATIVA" else "ATIVAR")}}}}
@Composable private fun LoginScreen(api:VerticeApi,onSuccess:(AuthResult)->Unit){val scope=rememberCoroutineScope();var login by remember{mutableStateOf("")};var password by remember{mutableStateOf("")};var error by remember{mutableStateOf("")};var loading by remember{mutableStateOf(false)};Column(Modifier.fillMaxSize().padding(24.dp),verticalArrangement=Arrangement.Center){Text("VÉRTICE",fontSize=38.sp,fontWeight=FontWeight.Bold);Text("Inteligência Autônoma de Negócios");Spacer(Modifier.height(24.dp));OutlinedTextField(login,{login=it},Modifier.fillMaxWidth(),label={Text("Login ou e-mail")},singleLine=true);Spacer(Modifier.height(8.dp));OutlinedTextField(password,{password=it},Modifier.fillMaxWidth(),label={Text("Senha")},singleLine=true);if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error);Spacer(Modifier.height(12.dp));Button(onClick={loading=true;scope.launch{val r=withContext(Dispatchers.IO){api.login(login.trim(),password)};loading=false;r.onSuccess(onSuccess).onFailure{error=it.message?:"Falha no login."}}},Modifier.fillMaxWidth(),enabled=!loading){Text(if(loading)"ENTRANDO…" else "ENTRAR")}}}
@Composable private fun ModeScreen(api:VerticeApi,token:String,owner:Boolean,session:VerticeSession,onSelected:(String)->Unit){val scope=rememberCoroutineScope();var busy by remember{mutableStateOf<String?>(null)};var error by remember{mutableStateOf("")};fun choose(selected:String){busy=selected;scope.launch{val r=withContext(Dispatchers.IO){api.registerDevice(token,session.deviceId,selected,"Android • ${selected.uppercase()}",owner)};r.onSuccess{onSelected(selected)}.onFailure{error=it.message?:"Falha"};busy=null}};Column(Modifier.fillMaxSize().padding(22.dp),verticalArrangement=Arrangement.Center){Text("ESCOLHA O MODO",fontSize=27.sp,fontWeight=FontWeight.Bold);Spacer(Modifier.height(16.dp));ModeCard("COMANDO","Decisão, estratégia e conversa",busy=="comando"){choose("comando")};Spacer(Modifier.height(10.dp));ModeCard("OPERAÇÃO","Execução real no Android",busy=="operacao"){choose("operacao")};Spacer(Modifier.height(10.dp));ModeCard("MONITORAMENTO","Acompanhamento e indicadores",busy=="monitoramento"){choose("monitoramento")};if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error)}}
@Composable private fun ModeCard(title:String,subtitle:String,busy:Boolean,onClick:()->Unit){Card(Modifier.fillMaxWidth()){Column(Modifier.padding(15.dp)){Text(title,fontWeight=FontWeight.Bold,fontSize=18.sp);Text(subtitle,fontSize=13.sp);Spacer(Modifier.height(8.dp));Button(onClick,Modifier.fillMaxWidth(),enabled=!busy){Text(if(busy)"CONFIGURANDO…" else "USAR ESTE MODO")}}}}
@Composable private fun CommandScreen(api:VerticeApi,token:String,role:String,mode:String,session:VerticeSession,onModeChange:(String)->Unit,onLogout:()->Unit){val scope=rememberCoroutineScope();var input by remember{mutableStateOf("")};var chat by remember{mutableStateOf(listOf(ChatLine(false,"VÉRTICE ativo. Diga o que precisa decidir, pesquisar, estruturar ou executar.")))};var busy by remember{mutableStateOf(false)};var status by remember{mutableStateOf("")};LaunchedEffect(mode){withContext(Dispatchers.IO){api.registerDevice(token,session.deviceId,mode,"Android • ${mode.uppercase()}",role=="OWNER")}};Column(Modifier.fillMaxSize().padding(16.dp)){Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Column(Modifier.weight(1f)){Text("VÉRTICE",fontSize=27.sp,fontWeight=FontWeight.Bold);Text("${role} • ${mode.uppercase()}",fontSize=12.sp)};TextButton(onClick=onLogout){Text("Sair")}};Spacer(Modifier.height(8.dp));Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(5.dp)){MODES.forEach{m->if(m==mode)Button(onClick={}){Text(m.uppercase())}else OutlinedButton(onClick={onModeChange(m)}){Text(m.uppercase())}}};Spacer(Modifier.height(8.dp));LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(7.dp)){items(chat){line->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(10.dp)){Text(if(line.fromUser)"VOCÊ" else "VÉRTICE",fontSize=11.sp,fontWeight=FontWeight.Bold);Text(line.text)}}}};OutlinedTextField(input,{input=it},Modifier.fillMaxWidth(),label={Text("Fale com o VÉRTICE")},maxLines=4);Spacer(Modifier.height(6.dp));Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={val text=input.trim();if(text.isBlank())return@Button;input="";chat=chat+ChatLine(true,text);busy=true;scope.launch{val reply=withContext(Dispatchers.IO){api.chat(token,text,mode)};reply.onSuccess{chat=chat+ChatLine(false,it.answer)}.onFailure{chat=chat+ChatLine(false,it.message?:"Falha")};if(mode=="operacao"&&reply.isSuccess){val cmd=withContext(Dispatchers.IO){api.sendCommand(token,text,mode,session.deviceId,owner=role=="OWNER")};cmd.onSuccess{status="Execução iniciada • ${it.status}"}.onFailure{status=it.message?:"Falha ao enfileirar"}};busy=false}},Modifier.weight(1f),enabled=!busy){Text(if(busy)"ENVIANDO…" else "ENVIAR")};OutlinedButton(onClick={chat=listOf(ChatLine(false,"Conversa reiniciada."));status=""},enabled=!busy){Text("LIMPAR")}};if(status.isNotBlank()){Spacer(Modifier.height(6.dp));Text(status,fontSize=12.sp)}}}
