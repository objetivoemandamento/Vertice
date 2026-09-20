package com.vertice.launcher.network

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.math.min

class VerticeApi(private val baseUrl:String){
 private val http=OkHttpClient.Builder().connectTimeout(12,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).build()
 private val json="application/json; charset=utf-8".toMediaType()
 var onAuthError:(()->Unit)?=null
 var onSubscriptionError:(()->Unit)?=null
 fun login(login:String,password:String):Result<AuthResult> = requestResult{val b=JSONObject().put("login",login).put("email",login).put("password",password).toString().toRequestBody(json);val q=Request.Builder().url("${clean()}/auth/login").post(b).build();http.newCall(q).execute().use{r->if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty());val c=o.optJSONObject("customer")?:error("Resposta de login inválida.");AuthResult(o.getString("token"),c.getString("id"),c.optString("email",login),o.optString("role","CUSTOMER"))}}
 fun plans():Result<List<PlanInfo>> = getWithRetry{val q=Request.Builder().url("${clean()}/public/plans").get().build();http.newCall(q).execute().use{r->if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val a=JSONObject(r.body?.string().orEmpty()).optJSONArray("plans")?:error("Planos indisponíveis.");buildList{for(i in 0 until a.length()){val o=a.getJSONObject(i);add(PlanInfo(o.optString("id"),o.optString("name"),o.optDouble("price"),o.optString("description")))}}}}
 fun startSignup(email:String,password:String,plan:String):Result<SignupCheckout> = requestResult{
   val b=JSONObject().put("email",email).put("password",password).put("plan",plan)
     .put("countryCode","BR").put("locale","pt-BR").put("currencyCode","BRL").toString().toRequestBody(json)
   val q=Request.Builder().url("${clean()}/public/signup/checkout").post(b).build()
   http.newCall(q).execute().use{r->
     val body=r.body?.string().orEmpty()
     if(!r.isSuccessful) error(readError(r.code,body))
     val o=JSONObject(body)
     val checkoutUrl=o.optString("checkoutUrl")
     if(checkoutUrl.isBlank()) error("O VÉRTICE não recebeu o link de pagamento.")
     SignupCheckout(o.optString("paymentId"),"",o.optString("plan",plan),o.optDouble("amount"),checkoutUrl)
   }
 }
 fun signupStatus(signupId:String,signupToken:String):Result<SignupStatus> = getWithRetry{
   val q=Request.Builder().url("${clean()}/public/payment/status?paymentId=${URLEncoder.encode(signupId,"UTF-8")}").get().build()
   http.newCall(q).execute().use{r->if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty());SignupStatus(o.optString("status"),null,null,null,"")}
 }
 fun status(token:String):Result<SubscriptionStatus> = getWithRetry{val q=authorized("/me",token).get().build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty());val s=o.optJSONObject("subscription");SubscriptionStatus(s?.optString("plan","basic")?:"basic",s?.optString("status","blocked")?:"blocked",s?.optString("currentPeriodEnd","")?:"")}}
 fun registerDevice(token:String,deviceId:String,mode:String,deviceName:String,owner:Boolean=false):Result<Unit> = getPostWithRetry{val b=JSONObject().put("deviceId",deviceId).put("mode",mode).put("deviceName",deviceName).toString().toRequestBody(json);val endpoint=if(owner)"/owner/devices/register" else "/devices/register";val q=authorized(endpoint,token).post(b).build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()))}}
 fun chat(token:String,message:String,mode:String):Result<AiReply> = requestResult{val b=JSONObject().put("message",message).put("mode",mode).toString().toRequestBody(json);val q=authorized("/ai/agent/chat",token).post(b).build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty());val a=o.optJSONArray("actions");val actions=buildList<String>{if(a!=null)for(i in 0 until a.length()){val x=a.opt(i);if(x is JSONObject)add(x.optString("label").ifBlank{x.optString("type")})else add(x.toString())}};AiReply(o.optString("answer"),actions,o.optBoolean("shouldExecute",false))}}
 fun aiHistory(token:String):Result<List<AiHistoryItem>> = getWithRetry{val q=authorized("/ai/agent/history",token).get().build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val a=JSONObject(r.body?.string().orEmpty()).optJSONArray("history")?:return@use emptyList();buildList{for(i in 0 until a.length()){val o=a.getJSONObject(i);add(AiHistoryItem(o.optString("role"),o.optString("content"),o.optString("mode"),o.optString("createdAt")))}}}}
 fun sendCommand(token:String,command:String,mode:String,deviceId:String,imageBase64:String?=null,owner:Boolean=false):Result<CommandResult> = requestResult{val b=JSONObject().put("command",command).put("mode",mode).put("deviceId",deviceId).put("scope","somente_o_solicitado").put("preservar_demais_configuracoes",true).apply{if(imageBase64!=null)put("imageBase64",imageBase64)}.toString().toRequestBody(json);val endpoint=if(owner)"/owner/commands" else "/commands";val q=authorized(endpoint,token).post(b).build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty());val id=o.optString("id");if(id.isBlank())error("Backend não retornou o ID do comando.");CommandResult(id,o.optString("status"),o.optString("message"))}}
 fun commands(token:String):Result<List<CommandResult>> = getWithRetry{val q=authorized("/commands",token).get().build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val a=JSONObject(r.body?.string().orEmpty()).optJSONArray("commands")?:return@use emptyList();buildList{for(i in 0 until a.length()){val o=a.getJSONObject(i);add(CommandResult(o.optString("id"),o.optString("status"),o.optString("message",o.optString("command",""))))}}}}
 fun nextCommand(token:String,deviceId:String):Result<QueuedCommand?> = getWithRetry{val q=authorized("/commands/next?deviceId=${URLEncoder.encode(deviceId,"UTF-8")}",token).get().build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty()).optJSONObject("command")?:return@use null;QueuedCommand(o.getString("id"),o.optString("command"),o.optString("mode"),o.optString("status"))}}
 fun updateCommandStatus(token:String,id:String,status:String,message:String,deviceId:String):Result<Unit> = requestResult{val b=JSONObject().put("status",status).put("message",message).put("deviceId",deviceId).toString().toRequestBody(json);val q=authorized("/commands/$id/status",token).post(b).build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()))}}
 fun monthlyReport(token:String):Result<SalesReport> = getWithRetry{val q=authorized("/reports/monthly",token).get().build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty()).optJSONObject("report")?:error("Relatório inválido.");SalesReport(o.optString("month"),o.optDouble("grossRevenue"),o.optDouble("netRevenue"),o.optInt("salesCount"),o.optInt("activeSubscriptions"),o.optInt("cancellations"),o.optInt("delinquent"),o.optDouble("ticketAverage"))}}
 fun ranking(token:String):Result<RankingInfo> = getWithRetry{val q=authorized("/ranking",token).get().build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty());val x=o.optJSONObject("ranking")?:error("Ranking inválido.");RankingInfo(if(x.isNull("position"))null else x.optInt("position"),x.optInt("total"),x.optInt("score"),o.optJSONObject("benchmark")?.optInt("topScore")?:0)}}
 fun adminOverview(token:String):Result<AdminOverview> = getWithRetry{val q=authorized("/admin/overview",token).get().build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty());AdminOverview(o.optInt("customers"),o.optInt("activeSubscriptions"),o.optInt("devices"),o.optInt("commandsToday"),o.optDouble("salesMonth"))}}
 fun adminCustomers(token:String):Result<List<AdminCustomer>> = getWithRetry{val q=authorized("/admin/customers",token).get().build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val a=JSONObject(r.body?.string().orEmpty()).optJSONArray("customers")?:return@use emptyList();buildList{for(i in 0 until a.length()){val o=a.getJSONObject(i);add(AdminCustomer(o.optString("id"),o.optString("email"),o.optString("createdAt"),o.optString("subscriptionStatus"),o.optString("plan"),o.optInt("devices"),o.optInt("commands")))}}}}
 fun createSaleOrder(token:String,product:String,amount:Double,description:String?=null):Result<SaleCheckout> = requestResult{val b=JSONObject().put("product",product).put("amount",amount).apply{if(!description.isNullOrBlank())put("description",description)}.toString().toRequestBody(json);val q=authorized("/sales/orders",token).post(b).build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty());SaleCheckout(o.getString("saleId"),o.optString("orderId"),o.optString("status"),o.getString("checkoutUrl"))}}
 fun sales(token:String,month:String?=null):Result<SalesList> = getWithRetry{val suffix=if(month.isNullOrBlank())"" else "?month=${URLEncoder.encode(month,"UTF-8")}";val q=authorized("/sales$suffix",token).get().build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));val o=JSONObject(r.body?.string().orEmpty());val s=o.optJSONObject("summary")?:JSONObject();val a=o.optJSONArray("sales")?:return@use SalesList(o.optString("month"),s.optDouble("grossRevenue"),s.optInt("paidCount"),s.optInt("totalCount"),emptyList());val items=buildList{for(i in 0 until a.length()){val x=a.getJSONObject(i);add(SaleItem(x.optString("id"),x.optDouble("amount"),x.optString("product"),x.optString("status"),x.optString("checkoutUrl"),x.optString("paidAt"),x.optString("createdAt")))}};SalesList(o.optString("month"),s.optDouble("grossRevenue"),s.optInt("paidCount"),s.optInt("totalCount"),items)}}
 fun syncSale(token:String,saleId:String):Result<String> = requestResult{val q=authorized("/sales/orders/$saleId/sync",token).post("{}".toRequestBody(json)).build();http.newCall(q).execute().use{r->requireAuthState(r);if(!r.isSuccessful)error(readError(r.code,r.body?.string()));JSONObject(r.body?.string().orEmpty()).optString("status","pending")}}
 private fun clean()=baseUrl.trimEnd('/')
 private fun authorized(path:String,token:String)=Request.Builder().url("${clean()}$path").header("Authorization","Bearer $token")
 private fun requireAuthState(r:okhttp3.Response){when(r.code){401->{onAuthError?.invoke();error("Sessão expirada. Por favor, faça login novamente.")};402->{onSubscriptionError?.invoke();error("Assinatura não está ativa.")}}}
 private fun <T> requestResult(block:()->T):Result<T> = runCatching(block)
 private fun <T> retry(block:()->T):Result<T>{var last:Result<T> = Result.failure(Exception("Falha de rede."));var wait=150L;repeat(3){i->last=runCatching(block);if(last.isSuccess)return last;val m=last.exceptionOrNull()?.message.orEmpty();if(m.contains("Sessão expirada")||m.contains("Assinatura não está ativa"))return last;if(i<2){Thread.sleep(wait);wait=min(wait*3,1500L)}};return last}
 private fun <T> getWithRetry(block:()->T):Result<T> = retry(block)
 private fun <T> getPostWithRetry(block:()->T):Result<T> = retry(block)
 private fun readError(code:Int,body:String?):String=try{JSONObject(body?:"{}").optString("error").ifBlank{when{code==401->"Não autenticado";code==402->"Assinatura não está ativa";code==403->"Acesso negado";code==404->"Recurso não encontrado";code>=500->"Erro no servidor. Tente novamente.";else->"Erro HTTP $code"}}}catch(_:Exception){"Erro HTTP $code"}
}
data class AuthResult(val token:String,val customerId:String,val email:String,val role:String)
data class PlanInfo(val id:String,val name:String,val price:Double,val description:String)
data class SignupCheckout(val signupId:String,val signupToken:String,val plan:String,val amount:Double,val checkoutUrl:String)
data class SignupStatus(val status:String,val token:String?,val customerId:String?,val email:String?,val plan:String)
data class AiReply(val answer:String,val actions:List<String>,val shouldExecute:Boolean)
data class AiHistoryItem(val role:String,val content:String,val mode:String,val createdAt:String)
data class SubscriptionStatus(val plan:String,val status:String,val currentPeriodEnd:String)
data class CommandResult(val id:String,val status:String,val message:String)
data class QueuedCommand(val id:String,val command:String,val mode:String,val status:String)
data class SalesReport(val month:String,val grossRevenue:Double,val netRevenue:Double,val salesCount:Int,val activeSubscriptions:Int,val cancellations:Int,val delinquent:Int,val ticketAverage:Double)
data class RankingInfo(val position:Int?,val total:Int,val score:Int,val topScore:Int)
data class AdminOverview(val customers:Int,val activeSubscriptions:Int,val devices:Int,val commandsToday:Int,val salesMonth:Double)
data class AdminCustomer(val id:String,val email:String,val createdAt:String,val subscriptionStatus:String,val plan:String,val devices:Int,val commands:Int)
data class SaleCheckout(val saleId:String,val orderId:String,val status:String,val checkoutUrl:String)
data class SaleItem(val id:String,val amount:Double,val product:String,val status:String,val checkoutUrl:String,val paidAt:String,val createdAt:String)
data class SalesList(val month:String,val grossRevenue:Double,val paidCount:Int,val totalCount:Int,val sales:List<SaleItem>)
