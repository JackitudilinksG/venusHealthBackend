# Node.js Coding Guidelines — NestJS
### REST APIs & Microservices Edition
*For medium teams (6–20 engineers) · Version 2.0*

---

## Table of Contents
1. [Project Structure & Architecture](#1-project-structure--architecture)
2. [Code Style & Formatting](#2-code-style--formatting)
3. [Error Handling & Logging](#3-error-handling--logging)
4. [TypeScript Usage](#4-typescript-usage)
5. [Security Best Practices](#5-security-best-practices)
6. [Testing Standards](#6-testing-standards)
7. [Performance & Scalability](#7-performance--scalability)
8. [CI/CD & Deployment](#8-cicd--deployment)

---

## 1. Project Structure & Architecture

### Why this matters
NestJS's module system is an explicit dependency graph — every provider must be declared in a module, and every cross-module dependency must be exported and imported. This enforced structure is NestJS's greatest strength and most commonly misunderstood feature. Fighting it (e.g., making everything global) eliminates the safety it provides.

### 1.1 Folder Layout

```
my-service/
├── src/
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts   # @CurrentUser() param decorator
│   │   │   └── roles.decorator.ts          # @Roles(...) metadata decorator
│   │   ├── exceptions/
│   │   │   ├── app.exception.ts            # base AppException extending HttpException
│   │   │   └── domain.exceptions.ts        # NotFoundEx, ConflictEx, BusinessEx, etc.
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts  # @Catch() — normalises all errors
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts      # request/response timing
│   │   │   └── transform.interceptor.ts    # normalise response envelope
│   │   ├── pipes/
│   │   │   └── parse-uuid.pipe.ts          # validate + transform UUID params
│   │   └── dto/
│   │       ├── pagination.dto.ts           # shared cursor/offset pagination DTOs
│   │       └── paginated-response.dto.ts
│   ├── config/
│   │   ├── env.validation.ts               # Joi schema for ConfigModule
│   │   ├── database.config.ts              # TypeORM / Prisma config factory
│   │   └── redis.config.ts
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.module.ts
│   │   │   ├── strategies/
│   │   │   │   └── jwt.strategy.ts
│   │   │   └── dto/
│   │   │       ├── login.dto.ts
│   │   │       └── token-response.dto.ts
│   │   └── orders/
│   │       ├── orders.controller.ts
│   │       ├── orders.service.ts
│   │       ├── orders.repository.ts
│   │       ├── orders.module.ts
│   │       ├── entities/
│   │       │   └── order.entity.ts
│   │       └── dto/
│   │           ├── create-order.dto.ts
│   │           ├── update-order.dto.ts
│   │           └── order-response.dto.ts
│   ├── app.module.ts        # root module — imports all feature modules
│   └── main.ts              # bootstrap — wires global pipes, filters, interceptors
├── test/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── scripts/
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── tsconfig.json
├── jest.config.ts
└── package.json
```

### 1.2 Module Design Principles

**Each module owns a single domain boundary.** Never put two unrelated domains in one module.

```ts
// ✅ correct — OrdersModule owns everything related to orders
@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem]),
    CustomersModule,   // imported because OrdersService needs CustomerService
    CacheModule,
  ],
  controllers: [OrdersController],
  providers:   [OrdersService, OrdersRepository],
  exports:     [OrdersService], // only export what other modules actually need
})
export class OrdersModule {}

// ❌ wrong — God module, impossible to test or reuse independently
@Module({
  controllers: [OrdersController, ProductsController, UsersController],
  providers:   [OrdersService, ProductsService, UsersService],
})
export class AppModule {}
```

**Avoid `@Global()` for domain services.** Use it only for truly universal infrastructure (logger, config, cache).

```ts
// ✅ @Global() is appropriate for infrastructure
@Global()
@Module({
  imports:  [LoggerModule.forRoot(...)],
  exports:  [LoggerModule],
})
export class CoreModule {}

// ❌ @Global() for domain services — hides dependencies, makes testing hard
@Global()
@Module({ providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {} // now any module can inject OrdersService invisibly
```

### 1.3 Layer Responsibilities & Boundaries

| Layer | Owns | Must NOT |
|---|---|---|
| `*.controller.ts` | Map HTTP to service calls. `@Body()`, `@Param()`, `@Query()`. Return DTOs. | Contain business logic, call repositories directly, throw domain errors |
| `*.service.ts` | Business rules, cross-repository orchestration, events | Know about HTTP, `Request`/`Response`, NestJS decorators (except `@Injectable`) |
| `*.repository.ts` | All DB/cache I/O. Wraps TypeORM/Prisma | Contain business logic, return raw entities beyond the module boundary |
| `dto/` | Input/output shapes. `class-validator` decorators. | Have methods, import services, reference entities |
| `entities/` | ORM entity definitions | Leak past the repository layer to controllers or services |
| `common/` | Framework-level cross-cuts: guards, interceptors, filters, pipes | Contain domain logic |
| `config/` | `ConfigModule` integration, config factories | Be accessed with `process.env` outside of config files |

> ⚠️ **Warning:** If a service method exceeds 50 lines or calls more than 3 repositories, it is doing too much. Extract a sub-service or domain service.

### 1.4 The main.ts Bootstrap

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Swap default logger with Pino before anything else
  app.useLogger(app.get(Logger));

  // Security
  app.use(helmet());
  app.enableCors({
    origin:      process.env.ALLOWED_ORIGINS?.split(',') ?? [],
    credentials: true,
  });

  // API versioning — /api/v1/...
  app.enableVersioning({ type: VersioningType.URI });
  app.setGlobalPrefix('api');

  // Global validation — applied to every endpoint
  app.useGlobalPipes(new ValidationPipe({
    whitelist:              true,   // strip unknown properties
    forbidNonWhitelisted:   true,   // reject requests with unknown properties
    transform:              true,   // auto-transform to DTO class instances
    transformOptions:       { enableImplicitConversion: true },
    stopAtFirstError:       false,  // collect all validation errors at once
  }));

  // Global exception filter — normalises all errors
  app.useGlobalFilters(app.get(GlobalExceptionFilter));

  // Global interceptors
  app.useGlobalInterceptors(
    app.get(LoggingInterceptor),
    app.get(TransformInterceptor),
  );

  // Swagger — dev/staging only
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('My Service API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
```

### 1.5 Naming Conventions

| Construct | Convention | Example |
|---|---|---|
| Files | kebab-case with type suffix | `orders.service.ts`, `create-order.dto.ts` |
| Classes | PascalCase with type suffix | `OrdersService`, `CreateOrderDto`, `OrdersModule` |
| Decorators | PascalCase | `@CurrentUser()`, `@Roles('admin')` |
| Injection tokens | SCREAMING_SNAKE const | `ORDER_REPOSITORY`, `CACHE_MANAGER` |
| Module imports order | Infrastructure → shared → feature | `TypeOrmModule`, `SharedModule`, `OrdersModule` |
| Route controllers | `@Controller('orders')` | kebab-case plural, no `/api/v1` prefix (set globally) |

---

## 2. Code Style & Formatting

### Why this matters
NestJS uses class-based patterns heavily — decorators, DI, inheritance. Consistent style in this paradigm means predictable decorator ordering, consistent DTO structure, and uniform module layout that the NestJS CLI enforces when generating files.

### 2.1 Always Use the CLI

```bash
# Never create NestJS files manually — always use the CLI
# It names correctly, registers in the module, and adds boilerplate

nest g module  orders
nest g service orders --no-spec  # add --no-spec if you write tests separately
nest g controller orders
nest g guard   jwt-auth --no-spec
nest g filter  global-exception --no-spec
nest g interceptor logging --no-spec
```

### 2.2 Prettier + ESLint Config

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

```js
// .eslintrc.js
module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: { project: './tsconfig.json' },
  extends: [
    "airbnb-base",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ],
  rules: {
    "no-console":                                    "error",  // use NestJS Logger
    "@typescript-eslint/no-explicit-any":            "error",
    "@typescript-eslint/no-floating-promises":       "error",
    "@typescript-eslint/explicit-function-return-type": ["warn", { allowExpressions: true }],

    // NestJS-specific relaxations
    "import/prefer-default-export":                  "off",    // modules always have named exports
    "class-methods-use-this":                        "off",    // service methods don't always use this
    "max-classes-per-file":                          "off",    // DTOs often group related classes
  },
};
```

### 2.3 Decorator Ordering Convention

Consistent decorator order makes code scannable and avoids subtle bugs from order-dependent decorators.

```ts
// ✅ Controller decorator ordering:
// 1. HTTP method decorator
// 2. Path / version
// 3. Swagger/OpenAPI
// 4. Auth/roles guards
// 5. Rate limiting
// 6. Response transformation
// 7. Parameter decorators (last)

@Post()
@Version('1')
@ApiOperation({ summary: 'Create order' })
@ApiResponse({ status: 201, type: OrderResponseDto })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('user')
@HttpCode(201)
async create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthUser): Promise<OrderResponseDto> {
  return this.ordersService.create(dto, user.id);
}
```

### 2.4 Key Style Rules

- No `console.log` — inject `Logger` from `@nestjs/common` or `nestjs-pino`
- Access configuration only via `ConfigService` — never `process.env` in services/controllers
- One DTO class per file — name the file after the DTO (`create-order.dto.ts`)
- Controller methods should be ≤ 10 lines — one service call + return
- Never inject `Request` or `Response` objects into services — pass plain data only
- Use `@ApiProperty()` on all DTO fields in any service that exposes Swagger

### 2.5 Anti-patterns Checklist

| Anti-pattern | Problem | Fix |
|---|---|---|
| Business logic in controllers | Hard to test, violates SRP | Move to service |
| Injecting repositories into controllers | Skips service layer | Always go through service |
| `process.env` in services | Untestable, unvalidated | `ConfigService.getOrThrow()` |
| `@Global()` on feature modules | Hidden dependencies, untestable | Import explicitly |
| Circular module dependencies | App crashes at startup | Extract shared logic to a `SharedModule` |
| `any` return type on service methods | Defeats type safety | Explicit return type `Promise<OrderResponseDto>` |
| Fat controllers | Logic everywhere, untestable | Max 10 lines per controller method |
| Entities returned from controllers | Leaks DB schema, tight coupling | Map to DTOs in service or interceptor |

---

## 3. Error Handling & Logging

### Why this matters
NestJS's exception layer is one of its most powerful features. A well-designed exception hierarchy means you throw meaningful domain errors anywhere in the codebase and they're automatically transformed into correct HTTP responses — no manual `res.status(404).json(...)` anywhere.

### 3.1 Exception Hierarchy

```ts
// src/common/exceptions/app.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

interface AppExceptionOptions {
  code:         string;
  message:      string;
  statusCode:   HttpStatus;
  context?:     Record<string, unknown>;
  isOperational?: boolean;
}

export class AppException extends HttpException {
  public readonly code:          string;
  public readonly context?:      Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor({ code, message, statusCode, context, isOperational = true }: AppExceptionOptions) {
    super({ code, message }, statusCode);
    this.code          = code;
    this.context       = context;
    this.isOperational = isOperational;
  }
}

// src/common/exceptions/domain.exceptions.ts
import { HttpStatus } from '@nestjs/common';

export class NotFoundException extends AppException {
  constructor(resource: string, id?: string) {
    super({
      code:       'NOT_FOUND',
      message:    `${resource}${id ? ` '${id}'` : ''} not found`,
      statusCode: HttpStatus.NOT_FOUND,
      context:    { resource, id },
    });
  }
}

export class ValidationException extends AppException {
  constructor(message: string, context?: Record<string, unknown>) {
    super({ code: 'VALIDATION_ERROR', message, statusCode: HttpStatus.UNPROCESSABLE_ENTITY, context });
  }
}

export class ConflictException extends AppException {
  constructor(resource: string, detail?: string) {
    super({
      code:       'CONFLICT',
      message:    `${resource} already exists${detail ? `: ${detail}` : ''}`,
      statusCode: HttpStatus.CONFLICT,
    });
  }
}

export class BusinessException extends AppException {
  constructor(message: string, code = 'BUSINESS_RULE_VIOLATION') {
    super({ code, message, statusCode: HttpStatus.UNPROCESSABLE_ENTITY });
  }
}

export class ForbiddenException extends AppException {
  constructor(message = 'Insufficient permissions') {
    super({ code: 'FORBIDDEN', message, statusCode: HttpStatus.FORBIDDEN });
  }
}

export class ExternalServiceException extends AppException {
  constructor(service: string, cause?: Error) {
    super({
      code:         'EXTERNAL_SERVICE_ERROR',
      message:      `External service '${service}' failed`,
      statusCode:   HttpStatus.BAD_GATEWAY,
      isOperational: false,
      context:      { service },
    });
    if (cause) this.stack += `\nCaused by: ${cause.stack}`;
  }
}
```

### 3.2 Global Exception Filter

```ts
// src/common/filters/global-exception.filter.ts
import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppException } from '../exceptions/app.exception';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx        = host.switchToHttp();
    const request    = ctx.getRequest<Request>();
    const response   = ctx.getResponse<Response>();
    const requestId  = (request as any).id as string;

    // NestJS built-in HttpException (includes class-validator errors from ValidationPipe)
    if (exception instanceof HttpException) {
      const status   = exception.getStatus();
      const body     = exception.getResponse();

      // class-validator errors come as { message: string[] } from ValidationPipe
      if (typeof body === 'object' && 'message' in body && Array.isArray((body as any).message)) {
        return response.status(status).json({
          error: {
            code:      'VALIDATION_ERROR',
            message:   'Request validation failed',
            requestId,
            fields:    (body as any).message,
          },
        });
      }

      const isOperational = exception instanceof AppException ? exception.isOperational : true;
      if (!isOperational) {
        this.logger.error({ exception, requestId }, 'Non-operational AppException');
      }

      return response.status(status).json({
        error: {
          code:      exception instanceof AppException ? exception.code : 'HTTP_ERROR',
          message:   typeof body === 'string' ? body : (body as any).message,
          requestId,
          ...(process.env.NODE_ENV !== 'production' &&
              exception instanceof AppException && { context: exception.context }),
        },
      });
    }

    // Completely unexpected — hide internals
    this.logger.error({ exception, requestId }, 'Unhandled exception');
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code:      'INTERNAL_ERROR',
        message:   'An unexpected error occurred',
        requestId,
      },
    });
  }
}
```

### 3.3 Structured Logging with nestjs-pino

```ts
// Install: npm install nestjs-pino pino-http pino-pretty

// src/app.module.ts
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level:   config.getOrThrow('LOG_LEVEL'),
          redact:  {
            paths:  ['req.headers.authorization', 'req.body.password', '*.ssn', '*.creditCard'],
            censor: '[REDACTED]',
          },
          serializers: { ...require('pino').stdSerializers },
          genReqId:    (req) => req.headers['x-request-id'] ?? require('crypto').randomUUID(),
          customLogLevel: (_req, res) => {
            if (res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
          transport: config.get('NODE_ENV') !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}

// src/main.ts — swap logger before app starts
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
```

### 3.4 Using the Logger in Services

```ts
// src/modules/orders/orders.service.ts
import { Injectable, Logger } from '@nestjs/common';
// OR: import { PinoLogger, InjectPinoLogger } from 'nestjs-pino'; ← gives structured child logger

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  async createOrder(dto: CreateOrderDto, userId: string): Promise<OrderResponseDto> {
    this.logger.log(`Creating order for customer ${dto.customerId}`);

    const customer = await this.customerRepository.findById(dto.customerId);
    if (!customer) {
      // NotFoundException is caught by GlobalExceptionFilter — no manual logging needed
      throw new NotFoundException('Customer', dto.customerId);
    }
    if (!customer.isActive) {
      throw new BusinessException('Customer account is inactive');
    }

    try {
      const order = await this.orderRepository.save({ ...dto, createdBy: userId });
      this.logger.log({ orderId: order.id, userId }, 'Order created successfully');
      this.eventEmitter.emit('order.created', new OrderCreatedEvent(order));
      return OrderResponseDto.fromEntity(order);
    } catch (err) {
      // Unexpected DB error — log with full context, let filter handle response
      this.logger.error({ err, dto, userId }, 'Failed to persist order');
      throw err;
    }
  }
}
```

### 3.5 Log Level Standards

| Level | NestJS method | When |
|---|---|---|
| `fatal` | `logger.fatal()` | Process-level failure |
| `error` | `logger.error()` | Unexpected failures, DB errors, non-operational exceptions |
| `warn` | `logger.warn()` | Recoverable issues: retries, deprecated APIs called |
| `log` | `logger.log()` | Key business events (maps to Pino `info`) |
| `debug` | `logger.debug()` | Development diagnostics — off in staging/production |
| `verbose` | `logger.verbose()` | Very fine-grained — off in all environments except local dev |

---

## 4. TypeScript Usage

### Why this matters
NestJS's DI system uses TypeScript's `emitDecoratorMetadata` to reflect types at runtime. Using `any`, skipping return types, or misusing generics can cause silent DI failures. Strict TypeScript prevents an entire class of "provider not found" runtime errors before they happen.

### 4.1 tsconfig

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "useUnknownInCatchVariables": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,    // required — NestJS is decorator-based
    "emitDecoratorMetadata": true,     // required — DI type reflection
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### 4.2 DTO Design with class-validator

```ts
// src/modules/orders/dto/create-order.dto.ts
import {
  IsUUID, IsArray, ValidateNested, IsInt, Min, Max,
  IsDateString, IsEnum, IsOptional, IsString, MaxLength,
  ArrayMinSize, ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OrderPriority {
  STANDARD  = 'STANDARD',
  EXPRESS   = 'EXPRESS',
  OVERNIGHT = 'OVERNIGHT',
}

export class OrderItemDto {
  @ApiProperty({ description: 'Product UUID' })
  @IsUUID()
  productId: string;

  @ApiProperty({ minimum: 1, maximum: 999 })
  @IsInt()
  @Min(1)
  @Max(999)
  quantity: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateOrderDto {
  @ApiProperty({ description: 'Customer UUID' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ type: [OrderItemDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1, { message: 'Order must contain at least one item' })
  @ArrayMaxSize(50, { message: 'Order cannot contain more than 50 items' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiProperty({ example: '2025-12-31' })
  @IsDateString({}, { message: 'deliveryDate must be a valid ISO date string' })
  deliveryDate: string;

  @ApiPropertyOptional({ enum: OrderPriority, default: OrderPriority.STANDARD })
  @IsOptional()
  @IsEnum(OrderPriority)
  priority?: OrderPriority = OrderPriority.STANDARD;
}
```

```ts
// src/modules/orders/dto/order-response.dto.ts
import { Expose, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { Order } from '../entities/order.entity';

export class OrderItemResponseDto {
  @Expose() @ApiProperty() productId: string;
  @Expose() @ApiProperty() quantity:  number;
  @Expose() @ApiProperty() price:     number;
}

export class OrderResponseDto {
  @Expose() @ApiProperty() id:          string;
  @Expose() @ApiProperty() customerId:  string;
  @Expose() @ApiProperty() status:      string;
  @Expose() @ApiProperty() priority:    string;
  @Expose() @ApiProperty() createdAt:   Date;

  @Expose()
  @Type(() => OrderItemResponseDto)
  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  // Factory method — centralise entity-to-DTO mapping
  static fromEntity(entity: Order): OrderResponseDto {
    return plainToInstance(OrderResponseDto, entity, { excludeExtraneousValues: true });
  }

  static fromEntities(entities: Order[]): OrderResponseDto[] {
    return entities.map(OrderResponseDto.fromEntity);
  }
}
```

### 4.3 Generic Paginated Response

```ts
// src/common/dto/paginated-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class PaginationMeta {
  @ApiProperty() total:      number;
  @ApiProperty() page:       number;
  @ApiProperty() limit:      number;
  @ApiProperty() totalPages: number;
}

export class PaginatedResponseDto<T> {
  @ApiProperty({ isArray: true })
  data: T[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;

  static of<T>(data: T[], total: number, page: number, limit: number): PaginatedResponseDto<T> {
    const dto      = new PaginatedResponseDto<T>();
    dto.data       = data;
    dto.meta       = { total, page, limit, totalPages: Math.ceil(total / limit) };
    return dto;
  }
}
```

### 4.4 Custom Decorators

```ts
// src/common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../interfaces/auth-user.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);

// Usage — clean controller method signatures
@Get('profile')
@UseGuards(JwtAuthGuard)
async getProfile(@CurrentUser() user: AuthUser): Promise<ProfileDto> {
  return this.usersService.getProfile(user.id);
}
```

### 4.5 Type Rules

- Never use `any` — when you're tempted, define an interface or use `unknown`
- Always declare explicit return types on public service and controller methods
- Use `readonly` on entity fields that should never be mutated after creation
- Use `class-transformer`'s `@Exclude()` on sensitive entity fields (passwords, tokens)
- Use `@ApiProperty()` on all DTO fields — it doubles as documentation and forces you to think about the contract

---

## 5. Security Best Practices

### Why this matters
NestJS's guard system makes it easy to apply auth at any granularity — globally, per controller, or per method. The risk is inconsistency: some routes protected, others forgotten. The safest default is a global `JwtAuthGuard` with an explicit `@Public()` decorator to opt out.

### 5.1 Environment Validation

```ts
// src/config/env.validation.ts
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV:              Joi.string().valid('development', 'test', 'production').required(),
  PORT:                  Joi.number().min(1024).max(65535).default(3000),
  DATABASE_URL:          Joi.string().uri().required(),
  JWT_SECRET:            Joi.string().min(32).required(),
  JWT_REFRESH_SECRET:    Joi.string().min(32).required(),
  JWT_EXPIRY:            Joi.string().default('15m'),
  REDIS_URL:             Joi.string().uri().required(),
  BCRYPT_ROUNDS:         Joi.number().min(10).max(14).default(12),
  ALLOWED_ORIGINS:       Joi.string().required(),
  LOG_LEVEL:             Joi.string().valid('fatal','error','warn','info','debug').default('info'),
  RATE_LIMIT_WINDOW_MS:  Joi.number().default(60000),
  RATE_LIMIT_MAX:        Joi.number().default(100),
}).options({ allowUnknown: false }); // reject undeclared env vars

// app.module.ts
ConfigModule.forRoot({
  isGlobal:          true,
  validationSchema:  envValidationSchema,
  validationOptions: { abortEarly: false },
}),
```

### 5.2 Global JWT Guard with Public Opt-out

This is the safest pattern — every route is protected by default. Use `@Public()` to explicitly mark routes that don't need auth.

```ts
// src/common/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// src/common/guards/jwt-auth.guard.ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) { super(); }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

// app.module.ts / providers
{ provide: APP_GUARD, useClass: JwtAuthGuard }, // applied globally to every route

// Usage — opt individual routes out:
@Post('auth/login')
@Public()  // ← this route doesn't need a JWT
async login(@Body() dto: LoginDto) { ... }
```

### 5.3 JWT Strategy

```ts
// src/modules/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub:   string;
  roles: string[];
  iat:   number;
  exp:   number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      config.getOrThrow<string>('JWT_SECRET'),
      issuer:           'my-service',
      audience:         'my-service',
      algorithms:       ['HS256'], // whitelist — prevents algorithm confusion attacks
    });
  }

  // Return value becomes request.user
  validate(payload: JwtPayload): AuthUser {
    if (!payload.sub || !payload.roles) {
      throw new UnauthorizedException('Malformed token payload');
    }
    return { id: payload.sub, roles: payload.roles };
  }
}
```

### 5.4 Roles Guard

```ts
// src/common/guards/roles.guard.ts
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';
export const Roles    = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user: AuthUser }>();
    const hasRole   = requiredRoles.some(role => user.roles.includes(role));

    if (!hasRole) throw new ForbiddenException(`Required roles: ${requiredRoles.join(', ')}`);
    return true;
  }
}

// Register globally alongside JWT guard:
{ provide: APP_GUARD, useClass: RolesGuard },

// Usage:
@Delete(':id')
@Roles('admin')
async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
  await this.ordersService.delete(id);
}
```

### 5.5 Rate Limiting

```ts
// npm install @nestjs/throttler

// app.module.ts
ThrottlerModule.forRootAsync({
  useFactory: (config: ConfigService) => ([{
    ttl:   config.get('RATE_LIMIT_WINDOW_MS', 60000),
    limit: config.get('RATE_LIMIT_MAX', 100),
  }]),
  inject: [ConfigService],
}),

// Register globally:
{ provide: APP_GUARD, useClass: ThrottlerGuard },

// Override per controller or method:
@Throttle({ default: { ttl: 60000, limit: 5 } }) // stricter for auth endpoints
@Post('auth/login')
async login() { ... }

@SkipThrottle()                                    // skip for health checks
@Get('health')
healthCheck() { ... }
```

### 5.6 Security Anti-patterns

| Anti-pattern | Risk | Fix |
|---|---|---|
| Forgetting `@UseGuards(JwtAuthGuard)` on a route | Unauthenticated access | Global `APP_GUARD` + `@Public()` opt-out |
| Returning entity objects from controllers | DB schema leakage | Map to DTO with `@Exclude()` on sensitive fields |
| `ConfigService.get()` vs `getOrThrow()` | Returns `undefined` silently | Always use `getOrThrow()` for required config |
| Missing `@ApiProperty()` on DTO fields | Broken Swagger docs, validation skipped | Decorate every field |
| `process.env` in controllers/services | Unvalidated, untestable | `ConfigService` only |
| Shared entity objects across modules | Tight coupling, circular deps | Each module owns its entity; export only DTOs |

---

## 6. Testing Standards

### Why this matters
NestJS's `Test.createTestingModule()` creates a mini DI container for tests. Used correctly, it means you test your service exactly as it runs in production — with real dependency injection, real pipes, and real guards — but with mocked I/O providers. This catches entire classes of bugs that simple unit tests miss.

### 6.1 Test Pyramid

| Layer | Target % | Tools | What to mock |
|---|---|---|---|
| Unit | 70% | Jest, `Test.createTestingModule()`, `@golevelup/ts-jest` | All repositories, external services |
| Integration | 20% | Jest, real DB via Docker | External HTTP, message queues |
| E2E | 10% | Jest, Supertest, full `AppModule` | Nothing |

### 6.2 Project Setup

```ts
// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir:              'src',
  testRegex:            '.*\\.spec\\.ts$',
  transform:            { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom:  ['**/*.(t|j)s', '!**/main.ts', '!**/*.module.ts'],
  coverageDirectory:    '../coverage',
  testEnvironment:      'node',
  coverageThreshold: {
    global: { branches: 80, functions: 85, lines: 85, statements: 85 },
  },
};
export default config;
```

### 6.3 Unit Tests with createTestingModule

```ts
// src/modules/orders/orders.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { createMock }          from '@golevelup/ts-jest';
import { EventEmitter2 }       from '@nestjs/event-emitter';
import { OrdersService }       from './orders.service';
import { OrdersRepository }    from './orders.repository';
import { CustomersRepository } from '../customers/customers.repository';

describe('OrdersService', () => {
  let service:         OrdersService;
  let ordersRepo:      jest.Mocked<OrdersRepository>;
  let customersRepo:   jest.Mocked<CustomersRepository>;
  let eventEmitter:    jest.Mocked<EventEmitter2>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: OrdersRepository,    useValue: createMock<OrdersRepository>() },
        { provide: CustomersRepository, useValue: createMock<CustomersRepository>() },
        { provide: EventEmitter2,       useValue: createMock<EventEmitter2>() },
        {
          provide:  ConfigService,
          useValue: { get: jest.fn(), getOrThrow: jest.fn().mockReturnValue('test-value') },
        },
      ],
    }).compile();

    service       = module.get(OrdersService);
    ordersRepo    = module.get(OrdersRepository);
    customersRepo = module.get(CustomersRepository);
    eventEmitter  = module.get(EventEmitter2);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createOrder', () => {
    it('creates order and emits event when customer is active', async () => {
      // Arrange
      const dto      = buildCreateOrderDto();
      const customer = buildCustomer({ id: dto.customerId, isActive: true });
      const order    = buildOrder({ customerId: dto.customerId });

      customersRepo.findById.mockResolvedValue(customer);
      ordersRepo.save.mockResolvedValue(order);

      // Act
      const result = await service.createOrder(dto, customer.id);

      // Assert — verify output AND side effects
      expect(result).toMatchObject({ id: order.id, customerId: customer.id });
      expect(ordersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: dto.customerId })
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'order.created',
        expect.objectContaining({ orderId: order.id })
      );
    });

    it('throws NotFoundException when customer does not exist', async () => {
      customersRepo.findById.mockResolvedValue(null);
      await expect(service.createOrder(buildCreateOrderDto(), randomUUID()))
        .rejects.toThrow(NotFoundException);
      expect(ordersRepo.save).not.toHaveBeenCalled();
    });

    it('throws BusinessException when customer is inactive', async () => {
      customersRepo.findById.mockResolvedValue(buildCustomer({ isActive: false }));
      await expect(service.createOrder(buildCreateOrderDto(), randomUUID()))
        .rejects.toThrow(BusinessException);
    });
  });
});
```

### 6.4 E2E Tests

```ts
// test/e2e/orders.e2e-spec.ts
import { Test, TestingModule }  from '@nestjs/testing';
import { INestApplication }     from '@nestjs/common';
import { ValidationPipe }       from '@nestjs/common';
import * as request             from 'supertest';
import { AppModule }            from '../../src/app.module';

describe('Orders (e2e)', () => {
  let app:        INestApplication;
  let authToken:  string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror main.ts setup — tests must match production bootstrap
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
    }));
    app.useGlobalFilters(app.get(GlobalExceptionFilter));
    app.useGlobalInterceptors(app.get(LoggingInterceptor));
    app.setGlobalPrefix('api');

    await app.init();

    // Authenticate once and reuse token
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'test-password' });
    authToken = loginResponse.body.accessToken;
  });

  afterAll(() => app.close());

  describe('POST /api/orders', () => {
    it('creates order → 201', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(buildCreateOrderDto())
        .expect(201);

      expect(body).toMatchObject({ id: expect.any(String), status: 'PENDING' });
    });

    it('rejects empty items array → 422', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(buildCreateOrderDto({ items: [] }))
        .expect(422);

      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown fields → 400 (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ...buildCreateOrderDto(), adminOverride: true })
        .expect(400);
    });

    it('returns 401 without token', async () => {
      await request(app.getHttpServer())
        .post('/api/orders')
        .send(buildCreateOrderDto())
        .expect(401);
    });
  });
});
```

### 6.5 Testing Anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| `new ServiceClass()` directly | Bypasses DI, missing deps | Always use `Test.createTestingModule()` |
| Not mirroring main.ts in e2e | Different behaviour in tests vs production | Copy all `useGlobal*` calls to beforeAll |
| Mocking the service in e2e tests | Tests your mocks, not your code | E2E uses real services — mock only external I/O |
| Testing `private` methods directly | Couples tests to implementation | Test via the public `service.publicMethod()` |
| `jest.spyOn(service, 'privateMethod')` | Implementation detail | Test the public outcome instead |
| Not clearing mocks between tests | State bleeds between tests | `afterEach(() => jest.clearAllMocks())` |

---

## 7. Performance & Scalability

### Why this matters
NestJS runs on top of Express (or Fastify) and inherits their event loop model. Its additional overhead — dependency injection, interceptors, pipes — is negligible in practice. The real performance risks are the same as any Node.js service: blocking I/O, unbounded queries, and missing caching.

### 7.1 Switch to Fastify Adapter for Higher Throughput

If raw throughput is a priority, swap the HTTP adapter with zero code changes:

```ts
// main.ts
import { NestFactory }    from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ logger: false }), // NestJS manages logging
);
// All existing guards, interceptors, pipes, filters work unchanged
await app.listen(3000, '0.0.0.0');
```

### 7.2 Caching with @nestjs/cache-manager

```ts
// app.module.ts
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore }  from 'cache-manager-ioredis-yet';

CacheModule.registerAsync({
  isGlobal: true,
  useFactory: async (config: ConfigService) => ({
    store:   redisStore,
    url:     config.getOrThrow('REDIS_URL'),
    ttl:     config.get('CACHE_TTL_SECONDS', 60) * 1000, // cache-manager v5 uses ms
  }),
  inject: [ConfigService],
}),

// Route-level caching — apply with @CacheKey + @CacheTTL
@Get(':id')
@UseInterceptors(CacheInterceptor)
@CacheKey('order')
@CacheTTL(300_000) // 5 minutes in ms
async getOrder(@Param('id', ParseUUIDPipe) id: string): Promise<OrderResponseDto> {
  return this.ordersService.getById(id);
}

// Manual cache control in service — for conditional caching
@Injectable()
export class OrdersService {
  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  async getById(id: string): Promise<OrderResponseDto> {
    const key    = `order:${id}`;
    const cached = await this.cache.get<OrderResponseDto>(key);
    if (cached) return cached;

    const order  = await this.orderRepository.findById(id);
    if (!order)  throw new NotFoundException('Order', id);

    const dto = OrderResponseDto.fromEntity(order);
    await this.cache.set(key, dto, 300_000);
    return dto;
  }

  async update(id: string, dto: UpdateOrderDto): Promise<OrderResponseDto> {
    const order = await this.orderRepository.update(id, dto);
    await this.cache.del(`order:${id}`); // invalidate on write
    return OrderResponseDto.fromEntity(order);
  }
}
```

### 7.3 Interceptors for Cross-Cutting Performance Concerns

```ts
// src/common/interceptors/logging.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req   = context.switchToHttp().getRequest();
    const start = Date.now();
    const label = `${req.method} ${req.url}`;

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          if (ms > 1000) this.logger.warn({ ms, url: req.url }, 'Slow request');
          else           this.logger.log(`${label} — ${ms}ms`);
        },
        error: (err) => {
          this.logger.error({ err, ms: Date.now() - start }, `${label} failed`);
        },
      }),
    );
  }
}
```

### 7.4 Graceful Shutdown with Lifecycle Hooks

```ts
// main.ts
app.enableShutdownHooks(); // listens for SIGTERM, SIGINT, SIGHUP

// Any provider can hook into lifecycle events:
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  async onModuleInit(): Promise<void> {
    this.pool = new Pool({ connectionString: this.config.getOrThrow('DATABASE_URL') });
    await this.pool.query('SELECT 1'); // fail fast if DB unreachable
    this.logger.log('Database pool connected');
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing database pool');
    await this.pool.end();
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

// NestJS calls onModuleDestroy on all providers in reverse dependency order
// then closes the HTTP server — guaranteed clean shutdown
```

---

## 8. CI/CD & Deployment

*(CI/CD pipeline, Dockerfile structure, and deployment rules are identical to the Express variant. NestJS-specific notes below.)*

### 8.1 NestJS Build Considerations

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig*.json nest-cli.json ./
RUN npm ci --include=dev
COPY src ./src
RUN npm run build
# NestJS build output is in dist/ — verify it loads before shipping the image
RUN node -e "const {AppModule} = require('./dist/app.module'); console.log('✅ Module loads')"
```

### 8.2 Health Check with @nestjs/terminus

```ts
// src/modules/health/health.module.ts
import { TerminusModule, TypeOrmHealthIndicator, HealthCheckService } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports:     [TerminusModule, HttpModule],
  controllers: [HealthController],
})
export class HealthModule {}

// src/modules/health/health.controller.ts
@Controller('health')
@Public()         // no auth on health checks
@SkipThrottle()   // no rate limiting on health checks
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db:     TypeOrmHealthIndicator,
    private redis:  MicroserviceHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 2000 }),
      () => this.redis.pingCheck('redis', {
        transport: Transport.REDIS,
        options:   { host: 'localhost', port: 6379 },
        timeout:   2000,
      }),
    ]);
  }
}
```

### 8.3 Deployment Rules

- Never deploy directly to production — always promote from staging
- Use semantic versioning for images — not `:latest` in production
- Store k8s/Helm config in the repo alongside application code
- `app.enableShutdownHooks()` must be in main.ts — k8s sends SIGTERM on pod termination
- Set `--max-old-space-size` to ~75% of container memory limit to allow GC before OOM kill
- Blue-green or canary deployments for zero-downtime releases

> ✅ **Best Practice:** NestJS's `onModuleInit()` hooks run before the server starts accepting traffic. Use them to validate DB connectivity, warm caches, and register consumers — a service that fails its init hooks never starts, which is far better than starting and silently failing on the first real request.

---

*Questions? Raise a PR against the guidelines repo or ping #engineering-standards in Slack.*

---

## 9. `.gitignore` and `.dockerignore`

### Why this matters
`.gitignore` and `.dockerignore` are security and hygiene boundaries. A missing `.gitignore` entry is how credentials get committed. A missing `.dockerignore` entry bloats images, leaks secrets into the build context, and breaks Docker layer caching. NestJS generates several artefact types (compiled decorators, Swagger specs, migration files) that need specific handling beyond a generic Node.js `.gitignore`.

---

### 9.1 `.gitignore`

```gitignore
# ── Node ─────────────────────────────────────────────────────────────────────
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
.npm
.yarn/cache
.yarn/unplugged
.yarn/build-state.yml
.pnp.*

# ── Build output ─────────────────────────────────────────────────────────────
dist/
build/
out/
*.tsbuildinfo
.cache/

# ── Environment & secrets ─────────────────────────────────────────────────────
.env
.env.*
!.env.example
*.pem
*.key
*.p12
*.pfx
secrets/
.secrets/

# ── Test & coverage ───────────────────────────────────────────────────────────
coverage/
.nyc_output/
junit.xml
test-results/

# ── Logs ──────────────────────────────────────────────────────────────────────
logs/
*.log
*.log.*

# ── OS artefacts ──────────────────────────────────────────────────────────────
.DS_Store
.DS_Store?
._*
Thumbs.db
Desktop.ini

# ── Editor & IDE ──────────────────────────────────────────────────────────────
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
!.vscode/launch.json
.idea/
*.swp
*.swo
*~

# ── Docker ────────────────────────────────────────────────────────────────────
docker-compose.override.yml
docker-compose.local.yml

# ── NestJS-specific ───────────────────────────────────────────────────────────
# Swagger JSON spec generated by @nestjs/swagger — regenerated at startup
swagger-spec.json
swagger.json
openapi.json
openapi.yaml

# TypeORM migration artefacts generated by the CLI during development
# Keep migration source files; ignore auto-generated SQL exports
*.migration.sql

# Compiled decorator metadata cache (some ts-jest configs write this)
.decorator-cache/

# NestJS debug log written by the framework on unhandled errors in dev
nest-debug.log

# ── Misc tooling ──────────────────────────────────────────────────────────────
.clinic/
.clinic-*
*.heapsnapshot
*.cpuprofile
.eslintcache
.prettiercache
.turbo/
```

**NestJS-specific `.gitignore` notes:**

| Entry | Why |
|---|---|
| `swagger-spec.json` / `openapi.json` | Auto-generated by `@nestjs/swagger` — always regenerated from `@ApiProperty()` decorators. Committing it causes noisy diffs on every DTO change. |
| `nest-debug.log` | Written by NestJS when the process crashes in development. Never commit — it contains stack traces and may contain env var values. |
| `*.migration.sql` | TypeORM CLI can export SQL for migrations; these are generated artefacts. The `.ts` migration files themselves *should* be committed. |

---

### 9.2 `.dockerignore`

```dockerignore
# ── Version control ───────────────────────────────────────────────────────────
.git/
.gitignore
.gitattributes
.github/

# ── Node dependencies ─────────────────────────────────────────────────────────
# Must be installed inside the image — host modules have wrong-arch native bindings
node_modules/
.npm/
.pnp*
.yarn/cache

# ── Build artefacts ───────────────────────────────────────────────────────────
# NestJS must be compiled inside the image with emitDecoratorMetadata=true
# Copying host dist/ risks shipping a dev build or stale decorator metadata
dist/
build/
*.tsbuildinfo

# ── Test files ────────────────────────────────────────────────────────────────
# NestJS co-locates .spec.ts files next to source — explicitly exclude them
**/*.spec.ts
**/*.e2e-spec.ts
test/
tests/
**/__mocks__/
coverage/
jest.config.*
junit.xml

# ── Environment & secrets ─────────────────────────────────────────────────────
# CRITICAL — ConfigModule reads process.env; .env files must never be baked in
.env
.env.*
!.env.example

# ── Generated files ───────────────────────────────────────────────────────────
swagger-spec.json
openapi.json
openapi.yaml
nest-debug.log
*.migration.sql

# ── Docs & non-runtime files ──────────────────────────────────────────────────
docs/
*.md
!README.md
LICENSE
CHANGELOG*
CONTRIBUTING*

# ── CI/CD ─────────────────────────────────────────────────────────────────────
.github/
.gitlab-ci.yml
.circleci/
Jenkinsfile
.travis.yml

# ── Editor & OS ───────────────────────────────────────────────────────────────
.vscode/
.idea/
.DS_Store
Thumbs.db
*.swp

# ── Docker ────────────────────────────────────────────────────────────────────
docker-compose*.yml
Dockerfile*

# ── Logs & profiling ──────────────────────────────────────────────────────────
logs/
*.log
*.heapsnapshot
*.cpuprofile
.clinic/

# ── Scripts ───────────────────────────────────────────────────────────────────
scripts/
```

**NestJS-specific `.dockerignore` considerations:**

| Concern | Detail |
|---|---|
| `**/*.spec.ts` pattern | NestJS CLI places spec files *alongside* source (e.g., `orders.service.spec.ts`). A simple `tests/` exclusion misses these — you need the glob pattern. |
| `emitDecoratorMetadata` | NestJS's DI relies on TypeScript decorator metadata emitted during compilation. Always build inside the image with the project's `tsconfig.json` — never copy pre-built `dist/` from a host that may have different compiler options. |
| `nest-debug.log` | Written to the working directory on crash — may contain env var dumps. Exclude it. |
| Migration files | TypeORM `.ts` migration files **should** be included (they run at startup). Only exclude generated `.sql` exports. |
| Swagger spec | Generated at app startup by `SwaggerModule.createDocument()`. Not needed in the image — it's created at runtime from `@ApiProperty()` decorators. |

### 9.3 Handling NestJS Migration Files Correctly

TypeORM migrations are a common source of `.dockerignore` confusion:

```dockerignore
# ── TypeORM migrations ────────────────────────────────────────────────────────
# ✅ INCLUDE — these are source files that must run inside the container
# (do NOT add src/migrations/ to .dockerignore)

# ❌ EXCLUDE — generated SQL exports, not needed at runtime
*.migration.sql
migrations-export/
```

```ts
// src/config/database.config.ts
// Migrations run automatically at startup in production
export const databaseConfig: TypeOrmModuleOptions = {
  // ...
  migrations:         ['dist/migrations/*.js'],  // compiled migrations
  migrationsRun:      true,                      // auto-run on startup
  migrationsTableName: 'migrations_history',
};
```

### 9.4 The `.env` Security Rule

NestJS uses `ConfigModule` which reads `process.env`. This makes the `.env`-in-image risk especially subtle — the app *looks* like it reads config from environment variables, but if `.env` is baked into the image, Docker's ENV layer sets those values before your runtime environment does.

```bash
# ❌ .env baked into image — ConfigModule picks it up even in production
COPY . .         # .env is now in this layer forever
RUN rm .env      # too late — previous layer still has it

# ✅ .dockerignore excludes .env — ConfigModule reads only runtime environment
# Pass secrets at runtime:

# Docker run:
docker run \
  -e DATABASE_URL="postgresql://..." \
  -e JWT_SECRET="..." \
  my-service:latest

# Kubernetes — reference a Secret:
# env:
#   - name: DATABASE_URL
#     valueFrom:
#       secretKeyRef:
#         name: my-service-secrets
#         key: database-url

# ✅ Verify no secrets are baked in after every build:
docker run --rm my-service:latest printenv | grep -iE "secret|password|key|token"
# Must return nothing — if it returns values, check .dockerignore and Dockerfile COPY order
```

### 9.5 Validating `.spec.ts` Exclusion

Because NestJS co-locates spec files with source, verify they're excluded from the built image:

```bash
# After building the image, check no test files made it into dist/
docker run --rm my-service:latest find /app -name "*.spec.js" -o -name "*.spec.ts"
# Must return nothing

# Also verify node_modules doesn't contain devDependencies
docker run --rm my-service:latest \
  node -e "require('@nestjs/testing')" 2>&1 | grep -q "Cannot find module" \
  && echo "✅ Dev deps excluded" \
  || echo "❌ Dev deps present in production image"
```

### 9.6 Layer Cache Optimisation

```dockerfile
# ── Deps layer — cached until package.json changes ────────────────────────────
COPY package*.json ./
RUN npm ci --include=dev

# ── Config layer — cached until tsconfig / nest-cli changes ───────────────────
COPY tsconfig*.json nest-cli.json ./

# ── Source layer — only busted when src/** changes ────────────────────────────
# With .dockerignore excluding tests, docs, .git: this layer is only busted
# when actual application source changes, not when you edit a README or test
COPY src ./src
RUN npm run build

# Without proper .dockerignore, editing any file (even README.md) in the repo
# root invalidates this layer and triggers a full rebuild
```

