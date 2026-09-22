import crypto from "node:crypto";
import { query, withTransaction } from "../db";
import { decryptSecret, encryptSecret } from "./secretVault";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/,"").toUpperCase().replace(/[^A-Z2-7]/g,"");
  let bits = "";
  for (const c of clean) bits += BASE32.indexOf(c).toString(2).padStart(5,"0");
  const bytes: number[] = [];
  for (let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2));
  return Buffer.from(bytes);
}
function totp(secret: string, counter: number): string {
  const msg=Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h=crypto.createHmac("sha1",base32Decode(secret)).update(msg).digest();
  const o=h[h.length-1]&15; const n=(h.readUInt32BE(o)&0x7fffffff)%1000000;
  return String(n).padStart(6,"0");
}
export function generateTotpSecret(): string {
  const bytes=crypto.randomBytes(20); let bits="";
  for(const b of bytes) bits+=b.toString(2).padStart(8,"0");
  let out=""; for(let i=0;i<bits.length;i+=5) out+=BASE32[parseInt(bits.slice(i,i+5).padEnd(5,"0"),2)];
  return out;
}
export function verifyTotp(secret: string, code: string, window=1): boolean {
  if(!/^\d{6}$/.test(code)) return false;
  const now=Math.floor(Date.now()/30000);
  return Array.from({length:2*window+1},(_,i)=>now+i-window).some(c=>crypto.timingSafeEqual(Buffer.from(totp(secret,c)),Buffer.from(code)));
}
export async function enrollMfa(userId: string, tenantId: string): Promise<{secret:string; otpauthUrl:string}> {
  const secret=generateTotpSecret();
  const encrypted=encryptSecret(secret);
  await withTransaction(async client=>{
    await client.query("insert into mfa_credentials(user_id,tenant_id,secret_ciphertext,enabled,created_at,updated_at) values($1,$2,$3,false,now(),now()) on conflict(user_id,tenant_id) do update set secret_ciphertext=excluded.secret_ciphertext,enabled=false,updated_at=now()",[userId,tenantId,encrypted]);
  });
  const issuer=encodeURIComponent("VÉRTICE");
  const label=encodeURIComponent(userId);
  return {secret,otpauthUrl:"otpauth://totp/"+issuer+":"+label+"?secret="+secret+"&issuer="+issuer+"&algorithm=SHA1&digits=6&period=30"};
}
export async function enableMfa(userId:string,tenantId:string,code:string):Promise<boolean>{
  const row=(await query("select secret_ciphertext from mfa_credentials where user_id=$1 and tenant_id=$2",[userId,tenantId])).rows[0];
  if(!row) return false;
  const ok=verifyTotp(decryptSecret(row.secret_ciphertext),code);
  if(ok) await query("update mfa_credentials set enabled=true,updated_at=now() where user_id=$1 and tenant_id=$2",[userId,tenantId]);
  return ok;
}
export async function verifyEnabledMfa(userId:string,tenantId:string,code:string):Promise<boolean>{
  const row=(await query("select secret_ciphertext,enabled from mfa_credentials where user_id=$1 and tenant_id=$2",[userId,tenantId])).rows[0];
  return Boolean(row?.enabled && verifyTotp(decryptSecret(row.secret_ciphertext),code));
}
