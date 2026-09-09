// The real `server-only` package throws on import outside a Server Component.
// Vitest runs in plain Node, so it is aliased to this no-op for tests.
export {};
