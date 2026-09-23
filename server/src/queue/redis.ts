import IORedis from "ioredis";
import { env } from "../config/runtime";

export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: 20,
  enableOfflineQueue: true,
  retryStrategy(times) { return Math.min(1000 * 2 ** Math.min(times, 5), 20000); }
});

export const workerRedis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy(times) { return Math.min(1000 * 2 ** Math.min(times, 5), 20000); }
});
