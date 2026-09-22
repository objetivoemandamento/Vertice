import { z } from "zod";

export const riskSchema = z.enum(["automatic","approval","mfa"]);
export const actionSchema = z.object({
  actionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  type: z.string().min(1).max(120),
  resource: z.string().min(1).max(200),
  operation: z.enum(["read","create","update","delete","execute","publish","charge","refund","credential_change"]),
  payload: z.record(z.string(), z.unknown()).default({}),
  requestedRisk: riskSchema.optional(),
  idempotencyKey: z.string().min(16).max(200)
}).strict();

export type ActionIntent = z.infer<typeof actionSchema>;

export const aiProposalSchema = z.object({
  type: z.literal("action_proposal"),
  tenantId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  action: actionSchema.omit({tenantId:true, actorUserId:true}).extend({
    tenantId: z.string().uuid(),
    actorUserId: z.string().uuid()
  })
}).strict();

export type AIProposal = z.infer<typeof aiProposalSchema>;
