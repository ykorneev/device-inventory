import { env } from "cloudflare:workers";

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error("База данных временно недоступна");
  }
  return env.DB;
}

export function getR2(): R2Bucket {
  if (!env.BUCKET) {
    throw new Error("Хранилище изображений временно недоступно");
  }
  return env.BUCKET;
}
