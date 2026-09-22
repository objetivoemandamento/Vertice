import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development","test","production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default("vertice"),
  JWT_ACCESS_TTL: z.string().default("10m"),
  CORS_ORIGINS: z.string().min(1),
  DB_SSL_REJECT_UNAUTHORIZED: z.string().default("true"),
  DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(10)
});

export const env = envSchema.parse(process.env);
export const corsOrigins = env.CORS_ORIGINS.split(",").map(v => v.trim()).filter(Boolean);
