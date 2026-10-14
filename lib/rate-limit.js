// Counts actions per visitor (IP address) in fixed time windows.

class RateLimitError extends Error {
    constructor(message, retryAfterSeconds) {
        super(message);
        this.status = 429;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

function createLimiter({ max, windowMs, message }) {
    const usage = new Map(); // ip -> { count, resetAt }

    // Forget visitors whose window has ended so the map doesn't grow forever
    setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of usage) {
            if (entry.resetAt <= now) usage.delete(ip);
        }
    }, windowMs).unref();

    // Records one action for `ip`, throwing a RateLimitError once the limit is reached
    function use(ip) {
        const now = Date.now();
        let entry = usage.get(ip);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            usage.set(ip, entry);
        }
        if (entry.count >= max) {
            const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
            throw new RateLimitError(message(retryAfterSeconds), retryAfterSeconds);
        }
        entry.count++;
    }

    return { use };
}

module.exports = { createLimiter, RateLimitError };
