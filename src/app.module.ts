import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ENV, ENV_DEFAULTS } from './config/env.constants';
import { validateEnv } from './config/env.validation';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { DatabaseModule } from './core/database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>(ENV.NODE_ENV) === 'production';
        return {
          pinoHttp: {
            level: config.getOrThrow<string>(ENV.LOG_LEVEL),
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
                'req.headers["x-auth-token"]',
                'req.body.password',
                'req.body.currentPassword',
                'req.body.newPassword',
                'req.body.confirmPassword',
                'req.body.token',
                'req.body.accessToken',
                'req.body.refreshToken',
                'req.body.secret',
                'req.body.apiKey',
                '*.password',
                '*.pin',
                '*.secret',
                '*.token',
                '*.ssn',
                '*.creditCard',
                '*.cardNumber',
                '*.cvv',
                '*.accountNumber',
                '*.routingNumber',
                '*.iban',
                '*.dateOfBirth',
                '*.dob',
              ],
              censor: '[REDACTED]',
            },
            genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
              const header = req.headers['x-request-id'];
              return typeof header === 'string' ? header : randomUUID();
            },
            customLogLevel: (
              _req: unknown,
              res: { statusCode: number },
              err?: Error,
            ): 'error' | 'warn' | 'info' => {
              if (err || res.statusCode >= 500) {
                return 'error';
              }
              if (res.statusCode >= 400) {
                return 'warn';
              }
              return 'info';
            },
            ...(isProduction
              ? {}
              : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
          },
        };
      },
      inject: [ConfigService],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>(ENV.RATE_LIMIT_WINDOW_MS, ENV_DEFAULTS.RATE_LIMIT_WINDOW_MS),
          limit: config.get<number>(ENV.RATE_LIMIT_MAX, ENV_DEFAULTS.RATE_LIMIT_MAX),
        },
      ],
      inject: [ConfigService],
    }),
    HealthModule,
    AuthModule,
    DatabaseModule,
  ],
  providers: [
    GlobalExceptionFilter,
    LoggingInterceptor,
    TransformInterceptor,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
