export type HttpResult<T>={status:number;data:T;headers:Headers};
export async function httpJson<T>(url:string,init:RequestInit,timeoutMs=15000):Promise<HttpResult<T>>{
 const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeoutMs);
 try{const r=await fetch(url,{...init,signal:c.signal,headers:{"Content-Type":"application/json",...(init.headers||{})}}); const raw=await r.text(); let data:unknown={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw:raw.slice(0,2000)}}
 if(!r.ok){const e=Object.assign(new Error("PROVIDER_HTTP_"+r.status),{status:r.status,retryAfter:r.headers.get("retry-after")});throw e}
 return {status:r.status,data:data as T,headers:r.headers};
 }finally{clearTimeout(t)}
}
