import { ENV, ENV_DEFAULTS } from '../src/config/env.constants';

process.env[ENV.NODE_ENV] ??= 'test';
process.env[ENV.PORT] ??= String(ENV_DEFAULTS.PORT);
process.env[ENV.DATABASE_URL] ??= 'postgresql://postgres:postgres@localhost:5432/omni_health';
process.env[ENV.JWT_SECRET] ??= 'test-jwt-secret-with-at-least-32-characters';
process.env[ENV.JWT_REFRESH_SECRET] ??= 'test-jwt-refresh-secret-with-32-chars';
process.env[ENV.JWT_EXPIRY] ??= ENV_DEFAULTS.JWT_EXPIRY;
process.env[ENV.REDIS_URL] ??= 'redis://localhost:6379';
process.env[ENV.BCRYPT_ROUNDS] ??= String(ENV_DEFAULTS.BCRYPT_ROUNDS);
process.env[ENV.ALLOWED_ORIGINS] ??= 'http://localhost:3000';
process.env[ENV.LOG_LEVEL] ??= 'error';
process.env[ENV.RATE_LIMIT_WINDOW_MS] ??= String(ENV_DEFAULTS.RATE_LIMIT_WINDOW_MS);
process.env[ENV.RATE_LIMIT_MAX] ??= String(ENV_DEFAULTS.RATE_LIMIT_MAX);
