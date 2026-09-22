import type { ActionIntent } from "./schemas";

export type PolicyDecision =
  | { risk: "automatic"; allowed: true; reason: string; policyVersion: string }
  | { risk: "approval"; allowed: true; reason: string; policyVersion: string }
  | { risk: "mfa"; allowed: true; reason: string; policyVersion: string }
  | { risk: "deny"; allowed: false; reason: string; policyVersion: string };

const VERSION = "2026-09-22.1";
const CRITICAL = new Set(["charge","refund","credential_change","delete"]);
const APPROVAL = new Set(["publish","execute","update","create"]);

export function evaluatePolicy(input: ActionIntent): PolicyDecision {
  if (!input.tenantId || !input.actorUserId) return { risk:"deny", allowed:false, reason:"Identidade incompleta.", policyVersion:VERSION };
  if (input.idempotencyKey.length < 16) return { risk:"deny", allowed:false, reason:"Idempotency key inválida.", policyVersion:VERSION };
  if (CRITICAL.has(input.operation)) return { risk:"mfa", allowed:true, reason:"Operação crítica exige aprovação e MFA.", policyVersion:VERSION };
  if (APPROVAL.has(input.operation)) return { risk:"approval", allowed:true, reason:"Operação mutável exige aprovação.", policyVersion:VERSION };
  if (input.operation === "read") return { risk:"automatic", allowed:true, reason:"Leitura sem mutação.", policyVersion:VERSION };
  return { risk:"deny", allowed:false, reason:"Operação não permitida pela allowlist.", policyVersion:VERSION };
}
