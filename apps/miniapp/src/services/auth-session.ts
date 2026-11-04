let authSessionVersion = 0;
const listeners = new Set<() => void>();

export function getAuthSessionVersion(): number {
  return authSessionVersion;
}

export function notifyAuthSessionChanged(): void {
  authSessionVersion += 1;
  for (const listener of listeners) listener();
}

export function subscribeAuthSessionChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
