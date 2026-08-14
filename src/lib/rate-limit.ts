const WINDOW_MS = 60 * 1000;
const MAX_LOOKBACK = 10 * 60 * 1000;

type Bucket = {
  timestamps: number[];
};

const buckets = new Map<string, Bucket>();

function prune() {
  const cutoff = Date.now() - MAX_LOOKBACK;
  for (const [key, bucket] of buckets) {
    if (bucket.timestamps.length === 0 || bucket.timestamps[bucket.timestamps.length - 1] < cutoff) {
      buckets.delete(key);
    }
  }
}

export function rateLimit(key: string, max: number, windowMs: number = WINDOW_MS) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }

  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= max) {
    const oldest = bucket.timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }

  bucket.timestamps.push(now);
  if (buckets.size > 10_000) prune();
  return { allowed: true, retryAfter: 0 };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function isRateLimited(request: Request, max: number, windowMs: number = WINDOW_MS) {
  const ip = getClientIp(request);
  const result = rateLimit(`rl:${ip}`, max, windowMs);
  return { ip, ...result };
}

export function rateLimitResponse(request: Request, max: number, windowMs: number = WINDOW_MS) {
  const { allowed, retryAfter } = isRateLimited(request, max, windowMs);
  if (allowed) return null;
  return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
    },
  });
}
