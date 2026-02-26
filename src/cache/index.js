class MemoryCache {
  #entries = new Map();
  #timer;

  constructor(cleanupIntervalMs = 5 * 60 * 1000) {
    this.#timer = setInterval(() => this.#evict(), cleanupIntervalMs);
    this.#timer.unref();
  }

  #evict() {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (entry.exp > 0 && now > entry.exp) {
        this.#entries.delete(key);
      }
    }
  }

  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.exp > 0 && Date.now() > entry.exp) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.val;
  }

  set(key, value, ttlMs = 0) {
    this.#entries.set(key, { val: value, exp: ttlMs > 0 ? Date.now() + ttlMs : 0 });
    return this;
  }

  del(key) {
    return this.#entries.delete(key);
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  invalidatePrefix(prefix) {
    let n = 0;
    for (const key of this.#entries.keys()) {
      if (key.startsWith(prefix)) {
        this.#entries.delete(key);
        n++;
      }
    }
    return n;
  }

  flush() {
    this.#entries.clear();
  }

  get size() {
    return this.#entries.size;
  }

  destroy() {
    clearInterval(this.#timer);
    this.#entries.clear();
  }
}

async function tryRedis(url) {
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    await client.ping();
    console.log('[cache] Redis conectado');
    return client;
  } catch (err) {
    console.log('[cache] Redis indisponível, usando memória:', err.message);
    return null;
  }
}

export const mem = new MemoryCache();

let redisClient = null;

if (process.env.REDIS_URL) {
  tryRedis(process.env.REDIS_URL).then((c) => {
    redisClient = c;
  });
}

function redisGet(key) {
  if (!redisClient) return Promise.resolve(undefined);
  return redisClient
    .get(key)
    .then((raw) => (raw != null ? JSON.parse(raw) : undefined))
    .catch(() => undefined);
}

function redisSet(key, value, ttlMs) {
  if (!redisClient) return;
  const s = JSON.stringify(value);
  const ttlSec = Math.ceil(ttlMs / 1000);
  (ttlSec > 0 ? redisClient.setex(key, ttlSec, s) : redisClient.set(key, s)).catch(() => {});
}

function redisDel(key) {
  if (!redisClient) return;
  redisClient.del(key).catch(() => {});
}

export function cached(key, ttlMs, computeFn) {
  const hit = mem.get(key);
  if (hit !== undefined) return hit;
  const value = computeFn();
  mem.set(key, value, ttlMs);
  redisSet(key, value, ttlMs);
  return value;
}

export async function cachedAsync(key, ttlMs, computeFn) {
  const hit = mem.get(key);
  if (hit !== undefined) return hit;
  const l2 = await redisGet(key);
  if (l2 !== undefined) {
    mem.set(key, l2, ttlMs);
    return l2;
  }
  const value = await computeFn();
  mem.set(key, value, ttlMs);
  redisSet(key, value, ttlMs);
  return value;
}

export function invalidate(key) {
  mem.del(key);
  redisDel(key);
}

export function invalidatePrefix(prefix) {
  mem.invalidatePrefix(prefix);
  if (redisClient) {
    redisClient
      .keys(`${prefix}*`)
      .then((keys) => {
        if (keys.length > 0) redisClient.del(...keys);
      })
      .catch(() => {});
  }
}
