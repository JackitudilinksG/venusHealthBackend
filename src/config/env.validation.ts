import * as Joi from 'joi';
import { ENV, ENV_DEFAULTS, type EnvKey } from './env.constants';

const envKeys = [
  ENV.NODE_ENV,
  ENV.PORT,
  // ENV.DATABASE_URL,
  // ENV.JWT_SECRET,
  // ENV.JWT_REFRESH_SECRET,
  ENV.JWT_EXPIRY,
  // ENV.REDIS_URL,
  ENV.BCRYPT_ROUNDS,
  ENV.ALLOWED_ORIGINS,
  ENV.LOG_LEVEL,
  ENV.RATE_LIMIT_WINDOW_MS,
  ENV.RATE_LIMIT_MAX,
] as const satisfies readonly EnvKey[];

export const envValidationSchema = Joi.object({
  [ENV.NODE_ENV]: Joi.string().valid('development', 'test', 'production').required(),
  [ENV.PORT]: Joi.number().min(1024).max(65535).default(ENV_DEFAULTS.PORT),
  // [ENV.DATABASE_URL]: Joi.string().uri().required(),
  // [ENV.JWT_SECRET]: Joi.string().min(32).required(),
  // [ENV.JWT_REFRESH_SECRET]: Joi.string().min(32).required(),
  [ENV.JWT_EXPIRY]: Joi.string().default(ENV_DEFAULTS.JWT_EXPIRY),
  // [ENV.REDIS_URL]: Joi.string().uri().required(),
  [ENV.BCRYPT_ROUNDS]: Joi.number().min(10).max(14).default(ENV_DEFAULTS.BCRYPT_ROUNDS),
  [ENV.ALLOWED_ORIGINS]: Joi.string().required(),
  [ENV.LOG_LEVEL]: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug')
    .default(ENV_DEFAULTS.LOG_LEVEL),
  [ENV.RATE_LIMIT_WINDOW_MS]: Joi.number().default(ENV_DEFAULTS.RATE_LIMIT_WINDOW_MS),
  [ENV.RATE_LIMIT_MAX]: Joi.number().default(ENV_DEFAULTS.RATE_LIMIT_MAX),
}).options({ allowUnknown: false });

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const selected: Record<string, unknown> = {};

  for (const key of envKeys) {
    if (config[key] !== undefined) {
      selected[key] = config[key];
    }
  }

  const { error, value } = envValidationSchema.validate(selected, {
    abortEarly: false,
  }) as { error?: Joi.ValidationError; value: Record<string, unknown> };

  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }

  return { ...config, ...value };
}
