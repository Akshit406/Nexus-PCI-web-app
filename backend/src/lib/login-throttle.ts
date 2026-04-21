type LoginAttemptState = {
  attempts: number;
  firstFailedAt: number;
  blockedUntil?: number;
};

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

const attemptStore = new Map<string, LoginAttemptState>();

function getNow() {
  return Date.now();
}

function getState(key: string) {
  const state = attemptStore.get(key);
  if (!state) {
    return null;
  }

  const now = getNow();
  if (state.blockedUntil && state.blockedUntil <= now) {
    attemptStore.delete(key);
    return null;
  }

  if (!state.blockedUntil && now - state.firstFailedAt > WINDOW_MS) {
    attemptStore.delete(key);
    return null;
  }

  return state;
}

export function getLoginThrottle(key: string) {
  const state = getState(key);
  if (!state?.blockedUntil) {
    return null;
  }

  return {
    blockedUntil: state.blockedUntil,
    retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil - getNow()) / 1000)),
  };
}

export function registerLoginFailure(key: string) {
  const existing = getState(key);
  const now = getNow();

  if (!existing) {
    attemptStore.set(key, {
      attempts: 1,
      firstFailedAt: now,
    });
    return;
  }

  const attempts = existing.attempts + 1;
  attemptStore.set(key, {
    attempts,
    firstFailedAt: existing.firstFailedAt,
    blockedUntil: attempts >= MAX_ATTEMPTS ? now + BLOCK_MS : existing.blockedUntil,
  });
}

export function clearLoginThrottle(key: string) {
  attemptStore.delete(key);
}
