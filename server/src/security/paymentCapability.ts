import crypto from "node:crypto";
import jwt from "jsonwebtoken";
const issuer="vertice-payment-capability";
function secret(): string { const s=String(process.env.PAYMENT_CAPABILITY_SECRET||""); if(s.length<32) throw new Error("PAYMENT_CAPABILITY_SECRET_REQUIRED"); return s; }
export function issuePaymentCapability(paymentId:string,userId:string,ttlSeconds=900):string {
  return jwt.sign({sub:userId,payment_id:paymentId,scope:"payment:status",type:"capability"},secret(),{algorithm:"HS256",issuer,expiresIn:ttlSeconds});
}
export function verifyPaymentCapability(token:string):{paymentId:string;userId:string} {
  const p=jwt.verify(token,secret(),{algorithms:["HS256"],issuer}) as jwt.JwtPayload;
  if(p.type!=="capability"||p.scope!=="payment:status"||typeof p.payment_id!=="string"||typeof p.sub!=="string") throw new Error("INVALID_PAYMENT_CAPABILITY");
  return {paymentId:p.payment_id,userId:p.sub};
}
export function timingSafeEqualHex(a:string,b:string):boolean { const aa=Buffer.from(a,"hex"),bb=Buffer.from(b,"hex"); return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb); }
