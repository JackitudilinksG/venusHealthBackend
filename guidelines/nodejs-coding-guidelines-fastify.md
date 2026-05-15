# Node.js Coding Guidelines — Fastify
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
Fastify's plugin system is its most powerful feature — and the most commonly misused one. Understanding the plugin encapsulation model up front prevents the two most common mistakes: registering everything on the root instance (losing encapsulation) and creating circular plugin dependencies.

### 1.1 Folder Layout

```
my-service/
├── src/
│   ├── config/
│   │   ├── env.ts               # Zod-validated env schema
│   │   └── app-options.ts       # Fastify instance options
│   ├── plugins/                 # Shared infrastructure — registered on root instance
│   │   ├── db.ts                # Database pool decorator
│   │   ├── redis.ts             # Redis client decorator
│   │   ├── auth.ts              # JWT verify decorator + preHandler
│   │   ├── error-handler.ts     # setErrorHandler + setNotFoundHandler
│   │   ├── sensible.ts          # @fastify/sensible — adds reply helpers
│   │   └── request-id.ts        # X-Request-ID propagation
│   ├── modules/
│   │   └── orders/
│   │       ├── order.routes.ts      # Fastify plugin — register routes here
│   │       ├── order.schema.ts      # TypeBox schemas (request + response)
│   │       ├── order.service.ts     # Business logic
│   │       ├── order.repository.ts  # Data access
│   │       └── order.types.ts       # TypeScript-only types
│   ├── utils/
│   │   ├── pagination.ts
│   │   └── crypto.ts
│   └── app.ts                   # buildApp() factory — exported for testing
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── scripts/
│   └── audit-guidelines.ts
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── tsconfig.json
├── jest.config.ts
└── package.json
```

### 1.2 The Plugin System — Encapsulation Model

This is the most important architectural concept in Fastify. Plugins registered with `fastify-plugin` (fp) share scope with the parent. Plugins registered without fp create an isolated child scope.

```ts
// ✅ Infrastructure plugins — use fp() to share decorators with entire app
// src/plugins/db.ts
import fp from 'fastify-plugin';
import { Pool } from 'pg';

export default fp(async (app) => {
  const pool = new Pool({ connectionString: app.config.DATABASE_URL });
  app.decorate('db', pool);                          // visible to all plugins
  app.addHook('onClose', () => pool.end());          // clean shutdown
}, { name: 'db' });                                  // name for dependency tracking

// ✅ Feature modules — NO fp() so routes are scoped (prefix isolation works)
// src/modules/orders/order.routes.ts
import { FastifyPluginAsync } from 'fastify';

const orderRoutes: FastifyPluginAsync = async (app) => {
  const service = new OrderService(app.db); // app.db available — db plugin uses fp()

  app.post<{ Body: CreateOrderBodyType }>('/', {
    schema: { body: CreateOrderBody, response: { 201: OrderResponse } },
    preHandler: [app.authenticate],
  }, async (request) => {
    return service.create(request.body);
  });
};

export default orderRoutes;

// Registered in app.ts with prefix:
await app.register(orderRoutes, { prefix: '/api/v1/orders' });
```

### 1.3 App Factory

```ts
// src/app.ts
import Fastify, { FastifyInstance } from 'fastify';
import { env } from './config/env';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level:    env.LOG_LEVEL,
      redact:   { paths: ['req.headers.authorization', 'body.password'], censor: '[REDACTED]' },
      serializers: { ...require('pino').stdSerializers },
      transport: env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
    },
    requestIdHeader:    'x-request-id',
    requestIdLogLabel:  'requestId',
    genReqId:           () => require('crypto').randomUUID(),
    bodyLimit:          100 * 1024, // 100 KB
    ajv: {
      customOptions: {
        removeAdditional: 'all',  // strip unknown request fields
        coerceTypes:      true,   // query string '20' → number 20
        useDefaults:      true,   // apply schema defaults
      },
    },
  });

  // Shared plugins — order matters (auth depends on db)
  await app.register(import('./plugins/db'));
  await app.register(import('./plugins/redis'));
  await app.register(import('./plugins/auth'));
  await app.register(import('./plugins/error-handler'));
  await app.register(import('@fastify/helmet'));
  await app.register(import('@fastify/cors'), {
    origin:  env.ALLOWED_ORIGINS.split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(import('@fastify/rate-limit'), {
    global:     true,
    max:        100,
    timeWindow: '1 minute',
    redis:      app.redis,     // distributed rate limiting
    skipOnError: false,
  });

  // Feature modules
  await app.register(import('./modules/orders/order.routes'),  { prefix: '/api/v1/orders' });
  await app.register(import('./modules/products/product.routes'), { prefix: '/api/v1/products' });

  return app;
}
```

### 1.4 Layer Responsibilities & Boundaries

| Layer | Owns | Must NOT |
|---|---|---|
| `routes/` | Register routes, define schemas, attach preHandlers, delegate to service | Contain business logic, access DB directly |
| `services/` | Business rules, orchestration | Know about Fastify types, `request`, `reply` |
| `repositories/` | All DB / cache I/O | Contain business logic, return raw ORM models upward |
| `plugins/` | Decorators, hooks, shared infrastructure | Contain domain logic |
| `modules/*/schema.ts` | TypeBox schemas — runtime + TypeScript types from one definition | Import from other modules |
| `config/` | Env loading and validation | Be imported by modules other than app bootstrap |
| `utils/` | Pure stateless functions | Import from any src layer |

### 1.5 Decorator Pattern for Dependencies

```ts
// Augment FastifyInstance type for full type safety on decorators
declare module 'fastify' {
  interface FastifyInstance {
    db:           Pool;
    redis:        Redis;
    config:       AppConfig;
    authenticate: preHandlerHookHandler;
  }
  interface FastifyRequest {
    user?: { id: string; roles: string[] };
  }
}

// Access in route handlers — fully typed, no imports needed
app.get('/profile', { preHandler: [app.authenticate] }, async (request) => {
  const orders = await orderRepository.findByCustomer(request.user!.id, app.db);
  return orders;
});
```

### 1.6 Naming Conventions

| Construct | Convention | Example |
|---|---|---|
| Files | kebab-case with type suffix | `order.routes.ts`, `auth.plugin.ts` |
| Classes | PascalCase | `OrderService`, `NotFoundError` |
| Fastify plugins | Async function + default export | `export default fp(async (app) => {...})` |
| Decorators | camelCase | `app.db`, `app.authenticate` |
| Routes | kebab-case plural nouns | `/api/v1/order-items` |
| Schema constants | PascalCase TypeBox | `CreateOrderBody`, `OrderResponse` |

---

## 2. Code Style & Formatting

### Why this matters
Style debates are a waste of review time. Automated formatting removes the debate entirely. In Fastify projects specifically, consistent schema definition style is especially important because schemas serve double duty as both validators and TypeScript types.

### 2.1 Toolchain

| Tool | Purpose | Config file |
|---|---|---|
| Prettier | Formatting | `.prettierrc` |
| ESLint | Linting + custom rules | `.eslintrc.js` |
| Husky | Git hooks | `.husky/` |
| lint-staged | Run only on staged files | `package.json` |
| `eslint-plugin-boundaries` | Enforce layer separation | via ESLint config |

### 2.2 Prettier Config

```json
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

### 2.3 ESLint Config

```js
module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: { project: './tsconfig.json' },
  extends: [
    "airbnb-base",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ],
  rules: {
    "no-console":                                    "error",  // use request.log or app.log
    "no-await-in-loop":                              "error",
    "@typescript-eslint/no-explicit-any":            "error",
    "@typescript-eslint/no-floating-promises":       "error",
    "@typescript-eslint/explicit-function-return-type": ["warn", { allowExpressions: true }],

    // Fastify-specific
    // reply.send() and return are both fine — but not both in same handler
    "consistent-return": "off",
  },
};
```

### 2.4 Fastify-Specific Style Rules

**Always define response schemas — this is not optional**
```ts
// ❌ no response schema — slow JSON.stringify, no output validation
app.get('/orders/:id', async (request, reply) => {
  const order = await service.getById(request.params.id);
  reply.send(order);
});

// ✅ response schema — fast-json-stringify, strips unlisted fields, documents contract
app.get<{ Params: IdParam }>('/orders/:id', {
  schema: {
    params:   IdParamSchema,
    response: { 200: OrderResponse, 404: ErrorResponse },
  },
}, async (request) => {
  return service.getById(request.params.id); // return is fine — Fastify calls reply.send()
});
```

**Use `return` OR `reply.send()` — never both**
```ts
// ❌ both — double-send error
async function handler(request, reply) {
  const data = await service.get();
  reply.send(data);
  return data; // will trigger "Reply already sent" warning
}

// ✅ return — cleaner, Fastify handles send
async function handler(request) {
  return service.get();
}

// ✅ reply.send() — useful when you need to set status code
async function handler(request, reply) {
  const order = await service.create(request.body);
  reply.status(201).send(order);
}
```

**Plugin registration order is significant**
```ts
// ❌ using app.db before db plugin is registered
await app.register(orderRoutes);  // tries to use app.db
await app.register(dbPlugin);     // db registered too late

// ✅ register infrastructure first, features second
await app.register(dbPlugin);
await app.register(redisPlugin);
await app.register(authPlugin);    // auth needs db
await app.register(orderRoutes);   // routes need auth + db
```

### 2.5 Anti-patterns Checklist

| Anti-pattern | Problem | Fix |
|---|---|---|
| Decorating root instance with domain logic | Pollutes global namespace | Use plugin scoping without `fp()` |
| Missing `fp()` on infrastructure plugins | Decorators not visible to child scopes | Wrap with `fp()` |
| `console.log` in handlers | Loses request context | `request.log.info()` |
| Schema defined inline in route | Can't reuse across routes | Define in `schema.ts`, import |
| `any` type on request generics | Loses type inference | `FastifyRequest<{ Body: CreateOrderBodyType }>` |
| Not awaiting plugin registration | Race conditions at startup | Always `await app.register()` |

---

## 3. Error Handling & Logging

### Why this matters
Fastify's error handling model is different from Express — there's no `next(err)` pattern. All errors flow through `setErrorHandler`, whether thrown, returned, or from schema validation failures. Understanding this model prevents errors from being silently swallowed.

### 3.1 Error Hierarchy

```ts
// src/utils/errors.ts
export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
    public readonly isOperational: boolean = true,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError    extends AppError {
  constructor(resource: string, id?: string) {
    super(`${resource}${id ? ` '${id}'` : ''} not found`, 404, 'NOT_FOUND', true, { resource, id });
  }
}
export class ValidationError  extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 422, 'VALIDATION_ERROR', true, context);
  }
}
export class UnauthorizedError extends AppError {
  constructor(msg = 'Authentication required') { super(msg, 401, 'UNAUTHORIZED'); }
}
export class ForbiddenError    extends AppError {
  constructor(msg = 'Insufficient permissions') { super(msg, 403, 'FORBIDDEN'); }
}
export class ConflictError     extends AppError {
  constructor(resource: string) { super(`${resource} already exists`, 409, 'CONFLICT'); }
}
export class BusinessError     extends AppError {
  constructor(message: string, code = 'BUSINESS_RULE_VIOLATION') {
    super(message, 422, code, true);
  }
}
export class ExternalServiceError extends AppError {
  constructor(service: string, cause?: Error) {
    super(`External service '${service}' failed`, 502, 'EXTERNAL_SERVICE_ERROR', false);
    if (cause) this.stack += `\nCaused by: ${cause.stack}`;
  }
}
```

### 3.2 Global Error Handler Plugin

```ts
// src/plugins/error-handler.ts
import fp from 'fastify-plugin';

export default fp(async (app) => {
  app.setErrorHandler((err, request, reply) => {
    // Fastify's own validation errors (AJV) — normalise to our format
    if (err.validation) {
      return reply.status(422).send({
        error: {
          code:      'VALIDATION_ERROR',
          message:   'Request validation failed',
          requestId: request.id,
          fields:    err.validation.map((v) => ({
            field:   v.instancePath.replace(/^\//, '') || v.params?.missingProperty,
            message: v.message,
          })),
        },
      });
    }

    if (err instanceof AppError) {
      if (err.isOperational) {
        request.log.warn({ err, context: err.context }, err.message);
      } else {
        request.log.error({ err }, 'Non-operational AppError');
      }
      return reply.status(err.statusCode).send({
        error: {
          code:      err.code,
          message:   err.message,
          requestId: request.id,
          ...(process.env.NODE_ENV !== 'production' && { context: err.context }),
        },
      });
    }

    // Completely unexpected
    request.log.error({ err }, 'Unhandled error');
    reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: request.id },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    request.log.info({ url: request.url }, 'Route not found');
    reply.status(404).send({
      error: {
        code:      'NOT_FOUND',
        message:   `Route ${request.method} ${request.url} not found`,
        requestId: request.id,
      },
    });
  });
});
```

### 3.3 Built-in Logging

Fastify ships Pino built in. There is no setup required — configure it once on the instance.

```ts
// request.log is the right logger inside handlers — inherits requestId automatically
app.post('/orders', { schema: { ... } }, async (request, reply) => {
  request.log.info({ customerId: request.body.customerId }, 'Creating order');

  try {
    const order = await orderService.create(request.body);
    request.log.info({ orderId: order.id }, 'Order created');
    reply.status(201).send(order);
  } catch (err) {
    // Re-throw — let setErrorHandler handle it
    // ❌ don't: reply.status(500).send(err) — leaks internals, bypasses error handler
    throw err;
  }
});

// app.log for context outside a request (startup, shutdown, background tasks)
app.log.info({ port: env.PORT }, 'Server starting');
app.log.warn({ retries }, 'DB connection slow — retrying');
```

### 3.4 Request Lifecycle Hooks for Observability

```ts
// src/plugins/observability.ts
import fp from 'fastify-plugin';

export default fp(async (app) => {
  // Log every request start
  app.addHook('onRequest', async (request) => {
    request.log.debug({ method: request.method, url: request.url }, 'Request received');
  });

  // Log every response with timing
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({
      method:         request.method,
      url:            request.url,
      statusCode:     reply.statusCode,
      responseTimeMs: reply.elapsedTime,
    }, 'Request completed');
  });

  // Catch errors not handled by setErrorHandler (rare — mostly hook errors)
  app.addHook('onError', async (request, reply, err) => {
    request.log.error({ err }, 'Hook error');
  });
});
```

### 3.5 Log Level Standards

| Level | When | Example |
|---|---|---|
| `fatal` | Process cannot continue | Port already in use at startup |
| `error` | Unexpected failure, investigation needed | Non-operational AppError, DB connection lost |
| `warn` | Recoverable — worth monitoring | Retry attempt, deprecated route called |
| `info` | Significant business events | Order placed, user authenticated |
| `debug` | Development diagnostics | Cache miss, schema validation details |
| `trace` | Very fine-grained — never in production | Every hook execution |

### 3.6 Logging Anti-patterns

```ts
// ❌ Using console instead of request.log — loses requestId context
console.log('Order created:', order.id);

// ❌ Logging then re-throwing — results in double log entries
try {
  await service.create(dto);
} catch (err) {
  request.log.error({ err }, 'Failed');
  throw err; // setErrorHandler will log it again
}

// ✅ Just throw — setErrorHandler logs appropriately
await service.create(dto); // throws on failure — setErrorHandler catches + logs

// ❌ Swallowing errors silently
try { await sendNotification(order); } catch {}

// ✅ Log and continue intentionally
try {
  await sendNotification(order);
} catch (err) {
  request.log.warn({ err, orderId: order.id }, 'Notification failed — non-critical');
}
```

---

## 4. TypeScript Usage

### Why this matters
Fastify is built with TypeScript generics throughout. Using them correctly means the compiler validates your route schemas, request bodies, params, and response shapes. Skipping them means runtime surprises that type safety was supposed to prevent.

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
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### 4.2 TypeBox — Single Definition for Schema + Types

TypeBox generates both the JSON Schema (used by Fastify's AJV for validation) and the TypeScript type. Never write them separately.

```ts
// src/modules/orders/order.schema.ts
import { Type, Static } from '@sinclair/typebox';

// ── Request schemas ──────────────────────────────────────────────────────────

export const CreateOrderBody = Type.Object({
  customerId:   Type.String({ format: 'uuid', description: 'Customer UUID' }),
  items: Type.Array(Type.Object({
    productId: Type.String({ format: 'uuid' }),
    quantity:  Type.Integer({ minimum: 1, maximum: 999 }),
    notes:     Type.Optional(Type.String({ maxLength: 500 })),
  }), { minItems: 1, maxItems: 50 }),
  deliveryDate: Type.String({ format: 'date', description: 'ISO date string' }),
  priority:     Type.Union([
    Type.Literal('STANDARD'),
    Type.Literal('EXPRESS'),
    Type.Literal('OVERNIGHT'),
  ], { default: 'STANDARD' }),
}, { additionalProperties: false });

export const OrderParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const OrderQuerystring = Type.Object({
  limit:  Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  cursor: Type.Optional(Type.String()),
  status: Type.Optional(Type.Union([
    Type.Literal('PENDING'), Type.Literal('CONFIRMED'), Type.Literal('SHIPPED'),
  ])),
});

// ── Response schemas (controls serialisation output) ────────────────────────

export const OrderResponse = Type.Object({
  id:          Type.String(),
  customerId:  Type.String(),
  status:      Type.String(),
  priority:    Type.String(),
  createdAt:   Type.String({ format: 'date-time' }),
});

export const PaginatedOrdersResponse = Type.Object({
  data:       Type.Array(OrderResponse),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  hasMore:    Type.Boolean(),
});

// ── TypeScript types inferred from schemas ───────────────────────────────────
export type CreateOrderBodyType    = Static<typeof CreateOrderBody>;
export type OrderParamsType        = Static<typeof OrderParams>;
export type OrderQuerystringType   = Static<typeof OrderQuerystring>;
export type OrderResponseType      = Static<typeof OrderResponse>;

// ── Route interface combining all parts ─────────────────────────────────────
export interface GetOrderRoute {
  Params:      OrderParamsType;
}
export interface CreateOrderRoute {
  Body:        CreateOrderBodyType;
}
export interface ListOrdersRoute {
  Querystring: OrderQuerystringType;
}
```

```ts
// src/modules/orders/order.routes.ts — fully typed, zero `any`
import { FastifyPluginAsync } from 'fastify';
import {
  CreateOrderBody, OrderParams, OrderQuerystring,
  OrderResponse, PaginatedOrdersResponse,
  CreateOrderRoute, GetOrderRoute, ListOrdersRoute,
} from './order.schema';

const orderRoutes: FastifyPluginAsync = async (app) => {
  const service = new OrderService(app.db, app.redis);

  app.get<ListOrdersRoute>('/', {
    schema: {
      querystring: OrderQuerystring,
      response:    { 200: PaginatedOrdersResponse },
    },
    preHandler: [app.authenticate],
  }, async (request) => service.list(request.query));

  app.get<GetOrderRoute>('/:id', {
    schema: {
      params:   OrderParams,
      response: { 200: OrderResponse },
    },
    preHandler: [app.authenticate],
  }, async (request) => {
    const order = await service.getById(request.params.id);
    if (!order) throw new NotFoundError('Order', request.params.id);
    return order;
  });

  app.post<CreateOrderRoute>('/', {
    schema: {
      body:     CreateOrderBody,
      response: { 201: OrderResponse },
    },
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const order = await service.create(request.body, request.user!.id);
    reply.status(201).send(order);
  });
};

export default orderRoutes;
```

### 4.3 Type Rules

- Never use `any` in schema generics — `FastifyRequest<{ Body: any }>` defeats the purpose
- Use `Type.Strict()` wrapper on TypeBox schemas to catch non-serialisable types
- Use `readonly` on interfaces that represent data fetched from DB or external services
- Prefer `Type.Optional()` over `Type.Union([T, Type.Undefined()])` — cleaner schema output
- Always type Fastify decorators via module augmentation — not type assertions

### 4.4 Module Augmentation for Decorators

```ts
// src/types/fastify.d.ts
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    db:           Pool;
    redis:        Redis;
    config:       AppConfig;
    authenticate: preHandlerHookHandler;
    requireRole:  (role: string) => preHandlerHookHandler;
  }
  interface FastifyRequest {
    user?: AuthUser;
  }
}
```

---

## 5. Security Best Practices

### Why this matters
Fastify's plugin model makes it easy to apply security middleware globally or scope it to specific route groups. Use that power intentionally — defaulting to "secure everything, opt out explicitly" rather than "unsecured by default, add auth per route."

### 5.1 Environment & Secrets

```ts
// src/config/env.ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV:           z.enum(['development', 'test', 'production']),
  PORT:               z.coerce.number().min(1024).max(65535).default(3000),
  DATABASE_URL:       z.string().url(),
  JWT_SECRET:         z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  REDIS_URL:          z.string().url(),
  ALLOWED_ORIGINS:    z.string().default('http://localhost:3000'),
  LOG_LEVEL:          z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
  BCRYPT_ROUNDS:      z.coerce.number().min(10).default(12),
}).strict();

export const env = (() => {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment:');
    result.error.errors.forEach(e => console.error(`  ${e.path.join('.')}: ${e.message}`));
    process.exit(1);
  }
  return result.data;
})();
```

### 5.2 Security Plugins

```ts
// All registered in app.ts
await app.register(import('@fastify/helmet'), {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
    },
  },
});

await app.register(import('@fastify/cors'), {
  origin:      env.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge:      86400,
});

await app.register(import('@fastify/rate-limit'), {
  global:         true,
  max:            100,
  timeWindow:     '1 minute',
  redis:          app.redis,         // use Redis for distributed limiting across instances
  errorResponseBuilder: () => ({
    error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down' },
  }),
  keyGenerator: (request) =>
    request.user?.id ?? request.ip, // rate limit by user if authenticated, by IP otherwise
});

// Slow down before hard rate-limit — gives legitimate clients a degraded experience
await app.register(import('@fastify/throttle'), {
  bytesPerSecond: 1024 * 100, // 100KB/s — prevents bandwidth abuse
});
```

### 5.3 JWT Authentication Plugin

```ts
// src/plugins/auth.ts
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';

export default fp(async (app) => {
  await app.register(jwt, {
    secret:    { private: env.JWT_SECRET, public: env.JWT_SECRET },
    sign:      { algorithm: 'HS256', expiresIn: '15m', issuer: 'my-service', audience: 'my-service' },
    verify:    { algorithms: ['HS256'], issuer: 'my-service', audience: 'my-service' },
    // Decode request — available as request.user after jwtVerify()
    decode:    { complete: false },
  });

  // Reusable preHandler — attach to routes that need authentication
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Valid Bearer token required', requestId: request.id },
      });
    }
  });

  // Role-based access — returns a preHandler for the given role
  app.decorate('requireRole', (role: string) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(request, reply);
      if (!request.user?.roles.includes(role)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: `Role '${role}' required`, requestId: request.id },
        });
      }
    }
  );
});
```

### 5.4 Input Sanitisation

Fastify's AJV integration handles most of this automatically with the right configuration:

```ts
// In buildApp() ajv config:
ajv: {
  customOptions: {
    removeAdditional: 'all',    // strip unknown fields — security + data hygiene
    coerceTypes:      true,     // safely coerce query string types
    useDefaults:      true,     // apply schema defaults
    allErrors:        false,    // stop on first error — prevents ReDoS on complex schemas
  },
},

// Add custom AJV formats if needed:
import addFormats from 'ajv-formats';
// Fastify applies addFormats automatically when using TypeBox

// ✅ additionalProperties: false on all request body schemas
const CreateOrderBody = Type.Object({...}, { additionalProperties: false });
// With removeAdditional: 'all' in AJV options, this is enforced automatically
```

### 5.5 Security Anti-patterns

| Anti-pattern | Risk | Fix |
|---|---|---|
| No `additionalProperties: false` on schemas | Unvalidated extra fields pass through | Use `Type.Object({...})` — TypeBox sets this by default |
| Rate limiting by IP only | Authenticated users can bypass with proxies | Rate limit by `request.user?.id ?? request.ip` |
| JWT algorithm not whitelisted | Algorithm confusion attack | `verify: { algorithms: ['HS256'] }` |
| Missing `setNotFoundHandler` | Default Fastify 404 leaks route structure | Always define a custom handler |
| Logging full request body | PII exposure in log aggregators | `redact` config in logger options |
| Skipping error handler | Stack traces leak to clients on unhandled errors | Always `setErrorHandler` |

---

## 6. Testing Standards

### Why this matters
`app.inject()` is Fastify's superpower for testing. It fires requests directly through the router without opening a TCP socket — tests are fast, parallelisable, and never fail due to port conflicts. Use it for all route-level tests.

### 6.1 Test Pyramid

| Layer | Target % | Tools | What to mock |
|---|---|---|---|
| Unit | 70% | Jest, ts-jest | All I/O — DB, Redis, external HTTP |
| Integration | 20% | Jest, real DB | External HTTP only |
| E2E | 10% | Jest, `app.inject()` | Nothing — full stack, real plugin graph |

### 6.2 Project Setup

```ts
// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  projects: [
    { displayName: 'unit',        testMatch: ['<rootDir>/tests/unit/**/*.test.ts'] },
    { displayName: 'integration', testMatch: ['<rootDir>/tests/integration/**/*.test.ts'] },
    { displayName: 'e2e',         testMatch: ['<rootDir>/tests/e2e/**/*.test.ts'] },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts', '!src/**/*.d.ts'],
  coverageThreshold: {
    global: { branches: 80, functions: 85, lines: 85, statements: 85 },
  },
};
export default config;
```

### 6.3 Test Fixtures

```ts
// tests/fixtures/order.factory.ts
import { CreateOrderBodyType } from '../../src/modules/orders/order.schema';
import { randomUUID } from 'crypto';

export const buildCreateOrderBody = (
  overrides: Partial<CreateOrderBodyType> = {}
): CreateOrderBodyType => ({
  customerId:   randomUUID(),
  items:        [{ productId: randomUUID(), quantity: 2 }],
  deliveryDate: new Date(Date.now() + 86_400_000).toISOString().split('T')[0],
  priority:     'STANDARD',
  ...overrides,
});
```

### 6.4 Unit Tests (Service)

```ts
// tests/unit/order.service.test.ts
describe('OrderService.createOrder', () => {
  let service:      OrderService;
  let mockDb:       jest.Mocked<Pool>;
  let mockRedis:    jest.Mocked<Redis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb    = createMockPool();
    mockRedis = createMockRedis();
    service   = new OrderService(mockDb, mockRedis);
  });

  it('persists and returns a new order', async () => {
    const body     = buildCreateOrderBody();
    const expected = buildOrder({ customerId: body.customerId });
    jest.spyOn(orderRepository, 'save').mockResolvedValue(expected);

    const result = await service.create(body, body.customerId);

    expect(result.id).toBe(expected.id);
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: body.customerId })
    );
  });

  it('throws BusinessError when customer has reached order limit', async () => {
    jest.spyOn(orderRepository, 'countByCustomer').mockResolvedValue(50);
    await expect(service.create(buildCreateOrderBody(), randomUUID()))
      .rejects.toThrow(BusinessError);
  });
});
```

### 6.5 E2E Tests with app.inject()

```ts
// tests/e2e/orders.test.ts
import { buildApp } from '../../src/app';
import { FastifyInstance } from 'fastify';

describe('Orders API (e2e)', () => {
  let app:   FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app   = await buildApp();
    await app.ready(); // ensures all plugins are fully registered
    token = generateTestJwt({ sub: randomUUID(), roles: ['user'] });
  });

  afterAll(() => app.close());

  describe('POST /api/v1/orders', () => {
    it('returns 201 with created order on valid input', async () => {
      const response = await app.inject({
        method:  'POST',
        url:     '/api/v1/orders',
        headers: { authorization: `Bearer ${token}` },
        payload: buildCreateOrderBody(),
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        id:     expect.any(String),
        status: 'PENDING',
      });
    });

    it('returns 422 when items array is empty', async () => {
      const response = await app.inject({
        method:  'POST',
        url:     '/api/v1/orders',
        headers: { authorization: `Bearer ${token}` },
        payload: buildCreateOrderBody({ items: [] }),
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
      expect(response.json().error.requestId).toBeDefined();
    });

    it('returns 401 when no token provided', async () => {
      const response = await app.inject({
        method:  'POST',
        url:     '/api/v1/orders',
        payload: buildCreateOrderBody(),
      });
      expect(response.statusCode).toBe(401);
    });

    it('strips unknown fields from request body', async () => {
      const response = await app.inject({
        method:  'POST',
        url:     '/api/v1/orders',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...buildCreateOrderBody(), internalField: 'hack', adminOverride: true },
      });
      // AJV removeAdditional strips unknown fields — request succeeds
      expect(response.statusCode).toBe(201);
    });
  });

  describe('GET /api/v1/orders/:id', () => {
    it('returns 404 for non-existent order', async () => {
      const response = await app.inject({
        method:  'GET',
        url:     `/api/v1/orders/${randomUUID()}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });
  });
});
```

### 6.6 Testing Anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Starting a real server in tests | Port conflicts, slow, stateful | Use `app.inject()` — no TCP socket |
| Not calling `await app.ready()` | Race condition — plugins may not be registered | Always `await app.ready()` before inject |
| Not calling `app.close()` in afterAll | Open handles — Jest warns, CI may hang | Always close in `afterAll` |
| Asserting only on status code | Doesn't verify response shape | Also assert on `response.json()` structure |
| Sharing app instance between test files | State leakage between suites | One `buildApp()` per test file |

---

## 7. Performance & Scalability

### Why this matters
Fastify's performance advantage (2–3× faster than Express on raw throughput) is easily lost if you don't use its features correctly. Response schemas and fast-json-stringify are the biggest wins; blocking the event loop is the biggest risk.

### 7.1 Response Schema Serialisation

This is Fastify's single biggest performance feature — use it on every route.

```ts
// Without response schema:
// → JSON.stringify() — slower, no output validation, may leak unexpected fields

// With response schema:
// → fast-json-stringify — 2–3× faster, strips extra fields, validates output shape

// ❌ missing response schema — slower + unsafe
app.get('/orders/:id', {
  schema: { params: OrderParams }, // only validates input
}, async (request) => service.getById(request.params.id));

// ✅ response schema — full pipeline optimisation
app.get<GetOrderRoute>('/orders/:id', {
  schema: {
    params:   OrderParams,
    response: {
      200: OrderResponse,    // happy path
      404: ErrorResponse,    // typed error responses too
    },
  },
}, async (request) => {
  const order = await service.getById(request.params.id);
  if (!order) throw new NotFoundError('Order', request.params.id);
  return order; // serialised by fast-json-stringify using OrderResponse schema
});
```

### 7.2 Plugin Loading — Startup Performance

```ts
// ❌ synchronous requires — delay startup
const dbPlugin = require('./plugins/db');
app.register(dbPlugin);

// ✅ dynamic imports — enables parallel loading + tree-shaking
await app.register(import('./plugins/db'));
await app.register(import('./plugins/redis'));

// For parallel plugin registration when there are no inter-dependencies:
await Promise.all([
  app.register(import('./plugins/metrics')),
  app.register(import('./plugins/health')),
]);
```

### 7.3 Streaming Large Responses

```ts
// ❌ loads entire result set into memory before sending
app.get('/reports/export', async (request, reply) => {
  const rows = await db.query('SELECT * FROM orders'); // potentially millions of rows
  return rows;
});

// ✅ stream directly from DB cursor to response
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

app.get('/reports/export', async (request, reply) => {
  const cursor = db.query(new Cursor('SELECT * FROM orders'));
  reply.type('application/x-ndjson');

  const transform = new Transform({
    objectMode: true,
    transform(row, _, cb) {
      cb(null, JSON.stringify(row) + '\n');
    },
  });

  reply.send(cursor.stream({ batchSize: 100 }).pipe(transform));
});
```

### 7.4 Caching

```ts
// src/utils/cache.ts
export async function cached<T>(
  redis:      Redis,
  key:        string,
  ttlSeconds: number,
  fetchFn:    () => Promise<T>,
): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;
  const value = await fetchFn();
  await redis.setex(key, ttlSeconds, JSON.stringify(value));
  return value;
}

// Route-level caching with @fastify/caching:
await app.register(import('@fastify/caching'), {
  privacy: 'private',
  expiresIn: 300,
});

app.get('/products/:id', {
  schema: { params: ProductParams, response: { 200: ProductResponse } },
  config: { cache: { expiresIn: 300 } }, // Cache-Control: private, max-age=300
}, async (request) => {
  return cached(app.redis, `product:${request.params.id}`, 300,
    () => productService.getById(request.params.id));
});
```

### 7.5 Graceful Shutdown

```ts
// src/server.ts
import { buildApp } from './app';

const start = async () => {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Graceful shutdown initiated');
    try {
      await app.close(); // drains connections, calls onClose hooks registered in plugins
      app.log.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Hard timeout — don't let shutdown hang forever
  process.on('SIGTERM', () => {
    setTimeout(() => {
      app.log.error('Shutdown timeout — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
};

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
```

---

## 8. CI/CD & Deployment

*(CI/CD pipeline, Dockerfile, and deployment rules are identical to the Express variant — see that document. Fastify-specific notes below.)*

### 8.1 Fastify-Specific Build Considerations

```dockerfile
# Fastify's dynamic imports require the full dist/ to be present
# Ensure tsconfig compiles all plugin files, not just entry point
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --include=dev
COPY src ./src
RUN npm run build
# Verify plugins compiled correctly
RUN node -e "require('./dist/app')" && echo "✅ App loads successfully"
```

### 8.2 Health Check

```ts
// src/plugins/health.ts
import fp from 'fastify-plugin';

export default fp(async (app) => {
  app.get('/health', {
    logLevel: 'silent', // suppress health check noise in logs
    schema: {
      response: {
        200: Type.Object({
          status:    Type.String(),
          version:   Type.String(),
          uptime:    Type.Number(),
          timestamp: Type.String(),
          checks:    Type.Object({
            db:    Type.String(),
            redis: Type.String(),
          }),
        }),
      },
    },
  }, async (_request, reply) => {
    const checks = await Promise.allSettled([
      app.db.query('SELECT 1'),
      app.redis.ping(),
    ]);
    const status = {
      db:    checks[0].status === 'fulfilled' ? 'ok' : 'degraded',
      redis: checks[1].status === 'fulfilled' ? 'ok' : 'degraded',
    };
    const ok = Object.values(status).every(s => s === 'ok');

    reply.status(ok ? 200 : 503).send({
      status:    ok ? 'ok' : 'degraded',
      version:   process.env.npm_package_version ?? 'unknown',
      uptime:    process.uptime(),
      timestamp: new Date().toISOString(),
      checks:    status,
    });
  });
});
```

### 8.3 Deployment Rules

- Never deploy directly to production — always promote from staging
- Use semantic versioning for images — not `:latest` in production
- Store k8s/Helm config in the repo alongside application code
- Set `--max-old-space-size` on Node.js to ~75% of container memory limit
- Blue-green or canary deployments for zero-downtime releases
- All env config via environment variables — never baked into the image

> ✅ **Best Practice:** Fastify's `app.ready()` validates all plugin registrations before the server starts accepting traffic. Add a startup readiness check that calls `app.ready()` and fails fast if any plugin fails to load — better to crash at startup than to serve requests with a broken dependency graph.

---

*Questions? Raise a PR against the guidelines repo or ping #engineering-standards in Slack.*

---

## 9. `.gitignore` and `.dockerignore`

### Why this matters
`.gitignore` and `.dockerignore` are security and hygiene boundaries. A missing `.gitignore` entry is how credentials get committed. A missing `.dockerignore` entry bloats images, leaks secrets into the build context, and breaks layer caching. Both files are first-class project files — reviewed, maintained, and committed on day one.

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

# ── Fastify-specific ──────────────────────────────────────────────────────────
# Fastify generates a .fastify-swagger.json during dev swagger generation
.fastify-swagger.json

# ── Misc tooling ──────────────────────────────────────────────────────────────
.clinic/
.clinic-*
*.heapsnapshot
*.cpuprofile
.eslintcache
.prettiercache
.turbo/
```

**Fastify-specific notes:**

- `.fastify-swagger.json` — generated by `@fastify/swagger` during local development. Never commit it — it should be regenerated from source schemas each time.
- TypeBox schemas compile to plain JS objects — no generated artefacts to ignore. However if you use `@sinclair/typebox/compiler` for pre-compiled validators, ignore `typebox-compiled/`.

---

### 9.2 `.dockerignore`

```dockerignore
# ── Version control ───────────────────────────────────────────────────────────
.git/
.gitignore
.gitattributes
.github/

# ── Node dependencies ─────────────────────────────────────────────────────────
node_modules/
.npm/
.pnp*
.yarn/cache

# ── Build artefacts ───────────────────────────────────────────────────────────
# Fastify uses dynamic imports (import('./plugins/db')) which resolve at runtime
# from dist/ — must be built inside the image, not copied from host
dist/
build/
*.tsbuildinfo

# ── Test files ────────────────────────────────────────────────────────────────
tests/
**/*.test.ts
**/__mocks__/
coverage/
jest.config.*
junit.xml

# ── Environment & secrets ─────────────────────────────────────────────────────
.env
.env.*
!.env.example

# ── Docs & non-runtime files ──────────────────────────────────────────────────
docs/
*.md
!README.md
LICENSE
CHANGELOG*

# ── CI/CD ─────────────────────────────────────────────────────────────────────
.github/
.gitlab-ci.yml
.circleci/
Jenkinsfile

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

**Fastify-specific `.dockerignore` considerations:**

| Concern | Detail |
|---|---|
| Dynamic plugin imports | Fastify uses `await app.register(import('./plugins/db'))` — the `dist/` must be built *inside* the image. Never copy host `dist/` — it may contain dev-mode builds or wrong-arch native modules. |
| TypeBox pre-compiled validators | If using `@sinclair/typebox/compiler`, the compiled validator cache (`typebox-compiled/`) is generated at startup — exclude it from the build context. |
| Swagger spec file | `.fastify-swagger.json` if generated locally — not needed in the image. |
| Pino transport targets | `pino-pretty` is a dev dependency. The production image uses `npm ci --omit=dev` — confirm pino's production transport is not relying on `pino-pretty`. |

### 9.3 Verifying Plugin Resolution in the Image

Because Fastify uses dynamic imports, verify all plugins resolve after build:

```dockerfile
# In the builder stage — catch missing plugins before shipping the image
FROM node:20-alpine AS builder
# ... build steps ...
RUN node -e "
  const { buildApp } = require('./dist/app');
  buildApp().then(app => {
    console.log('✅ All plugins registered');
    app.close();
  }).catch(err => {
    console.error('❌ Plugin registration failed:', err.message);
    process.exit(1);
  });
"
```

### 9.4 The `.env` Security Rule

```bash
# ❌ .env copied into a layer is permanently readable — even if deleted later
COPY . .        # .env enters the layer here
RUN rm .env     # too late — the previous layer still contains it

# ✅ Exclude via .dockerignore — never enters build context at all
# ✅ Pass secrets at runtime:
#    docker run -e DATABASE_URL=... -e JWT_SECRET=... my-service:latest
#    k8s: secretKeyRef in pod spec
#    AWS: secrets injected via ECS task definition

# ✅ Audit every build:
docker run --rm my-service:latest printenv | grep -iE "secret|password|key|token"
# Must return nothing
```

### 9.5 Layer Cache Optimisation

The build context hash invalidates the cache for `COPY . .`. Keep the context small to maximise cache hits:

```dockerfile
# ✅ Copy package files first — this layer is cached until dependencies change
COPY package*.json ./
RUN npm ci --include=dev

# ✅ Only then copy src — cache miss here only when source changes
COPY src ./src
COPY tsconfig*.json ./

# With a tight .dockerignore, COPY src is only invalidated when src/** actually changes
# Without it, changing README.md or a test file breaks the cache here too
```

