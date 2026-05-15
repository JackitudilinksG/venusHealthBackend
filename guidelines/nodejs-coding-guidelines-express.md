# Node.js Coding Guidelines — Express
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
Inconsistent structure is the leading cause of onboarding friction and accidental coupling. When every service looks the same, a developer can navigate any repo on day one. When structure is left to individual taste, knowledge silos form and "only Alice knows where that lives" becomes a team liability.

### 1.1 Folder Layout

```
my-service/
├── src/
│   ├── config/
│   │   ├── env.ts               # Zod-validated env schema — single source of truth
│   │   ├── database.ts          # DB pool/ORM configuration
│   │   └── logger.ts            # Pino logger instance
│   ├── controllers/
│   │   └── order.controller.ts  # HTTP in/out only — no business logic
│   ├── services/
│   │   └── order.service.ts     # Business rules, orchestration
│   ├── repositories/
│   │   └── order.repository.ts  # All DB/cache I/O
│   ├── models/
│   │   ├── order.entity.ts      # DB schema / ORM model
│   │   └── order.dto.ts         # Request/response shapes + Zod schemas
│   ├── middlewares/
│   │   ├── auth.middleware.ts
│   │   ├── request-id.middleware.ts
│   │   └── error-handler.middleware.ts
│   ├── routes/
│   │   ├── index.ts             # mounts all routers
│   │   └── order.routes.ts
│   ├── utils/
│   │   ├── pagination.ts
│   │   └── crypto.ts
│   └── app.ts                   # Express factory — exported for testing
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/                # shared test data factories
├── scripts/
│   └── audit-guidelines.ts
├── .env.example                 # committed; no real values
├── docker-compose.yml           # local dev + test DB
├── Dockerfile
├── tsconfig.json
├── jest.config.ts
└── package.json
```

### 1.2 Layer Responsibilities & Boundaries

| Layer | Owns | Must NOT |
|---|---|---|
| `controllers/` | Parse HTTP, validate input, call one service method, return response | Contain business logic, call repositories, touch DB |
| `services/` | Business rules, orchestration across repositories | Know about HTTP, req/res objects, Express types |
| `repositories/` | All DB and cache I/O | Contain business logic, return raw ORM entities to callers |
| `middlewares/` | Cross-cutting HTTP concerns: auth, logging, rate limiting | Contain domain logic |
| `models/` | TypeScript interfaces, Zod schemas, ORM entities | Have methods, import Express or DB drivers |
| `config/` | Load, validate, and export env-derived config | Be imported by anything other than app bootstrap and tests |
| `utils/` | Pure functions with no side effects | Import from any other src layer |

### 1.3 The App Factory Pattern

Always export the Express app from a factory function, not as a module-level singleton. This is the single most important structural decision for testability.

```ts
// src/app.ts  ✅ correct
import express from 'express';
import helmet from 'helmet';
import { orderRouter } from './routes/order.routes';
import { errorHandler } from './middlewares/error-handler.middleware';
import { requestId } from './middlewares/request-id.middleware';

export function buildApp() {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(requestId());

  app.use('/api/v1/orders', orderRouter);
  app.use(errorHandler); // must be last

  return app;
}

// src/server.ts — entry point only, never imported by tests
import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';

const app = buildApp();
app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'Server started'));
```

```ts
// ❌ wrong — impossible to test without starting a real server
import express from 'express';
export const app = express();
app.listen(3000);
```

**Why:** Tests import `buildApp()` and get a fresh instance every run. No port conflicts, no shared state, parallelisable.

### 1.4 Naming Conventions

| Construct | Convention | Example |
|---|---|---|
| Files | kebab-case with type suffix | `order-service.ts`, `auth.middleware.ts` |
| Classes | PascalCase | `OrderService`, `NotFoundError` |
| Functions | camelCase | `getOrderById`, `buildPaginationMeta` |
| Variables | camelCase | `totalAmount`, `isExpired` |
| Constants | SCREAMING_SNAKE | `MAX_RETRY_COUNT`, `DEFAULT_PAGE_SIZE` |
| Env vars | SCREAMING_SNAKE | `DATABASE_URL`, `JWT_SECRET` |
| Routes | kebab-case plural nouns | `/api/v1/order-items`, `/api/v1/user-accounts` |
| Boolean vars | is/has/can prefix | `isActive`, `hasPermission`, `canRetry` |

### 1.5 Module Boundaries — What to Avoid

```ts
// ❌ Controller importing repository directly — skips service layer
import { OrderRepository } from '../repositories/order.repository';
class OrderController {
  async create(req, res) {
    const order = await this.repo.save(req.body); // business logic leak
  }
}

// ❌ Service importing Express types — couples business logic to HTTP
import { Request } from 'express';
class OrderService {
  async create(req: Request) { // never — services don't know about HTTP
    const { customerId } = req.body;
  }
}

// ✅ correct — clean boundary
class OrderController {
  async create(req: Request, res: Response) {
    const dto = CreateOrderSchema.parse(req.body);
    const order = await this.orderService.create(dto); // plain DTO in
    res.status(201).json(order);                       // plain object out
  }
}
```

### 1.6 Feature Flags & Configuration

Never scatter feature flag checks through the codebase. Centralise them in config:

```ts
// src/config/features.ts
import { env } from './env';

export const features = {
  newPricingEngine: env.FEATURE_NEW_PRICING === 'true',
  bulkOrderLimit:   parseInt(env.BULK_ORDER_LIMIT ?? '100', 10),
} as const;

// Usage:
if (features.newPricingEngine) { ... }
```

---

## 2. Code Style & Formatting

### Why this matters
Style debates waste review cycles and create noisy diffs. Automated formatting eliminates the debate entirely — no one argues with a machine. Consistent style also reduces cognitive load when reading unfamiliar code.

### 2.1 Toolchain

| Tool | Purpose | Config file |
|---|---|---|
| Prettier | Formatting | `.prettierrc` |
| ESLint | Linting + custom rules | `.eslintrc.js` |
| Husky | Git hooks | `.husky/` |
| lint-staged | Run tools only on staged files | `lint-staged` in `package.json` |
| `@typescript-eslint` | TS-aware lint rules | via ESLint config |
| `eslint-plugin-boundaries` | Enforce layer architecture | via ESLint config |

### 2.2 Prettier Config

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always",
  "bracketSpacing": true,
  "endOfLine": "lf"
}
```

**Why `trailingComma: "all"`:** Minimises diff noise when adding array/object entries — the previous last line doesn't change.

**Why `endOfLine: "lf"`:** Prevents Windows/Mac line-ending conflicts in cross-platform teams.

### 2.3 ESLint Config

```js
// .eslintrc.js
module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: { project: './tsconfig.json' },
  extends: [
    "airbnb-base",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:import/typescript",
  ],
  plugins: ["@typescript-eslint", "import", "boundaries"],
  rules: {
    // Core
    "no-console":                              "error",   // use structured logger
    "no-await-in-loop":                        "error",   // use Promise.all instead
    "no-param-reassign":                       "error",
    "prefer-destructuring":                    "warn",

    // TypeScript
    "@typescript-eslint/no-explicit-any":      "error",
    "@typescript-eslint/explicit-function-return-type": ["warn", {
      allowExpressions: true,
      allowTypedFunctionExpressions: true,
    }],
    "@typescript-eslint/no-floating-promises": "error",  // must await or .catch
    "@typescript-eslint/no-misused-promises":  "error",
    "@typescript-eslint/prefer-nullish-coalescing": "warn",
    "@typescript-eslint/prefer-optional-chain":     "warn",

    // Imports
    "import/prefer-default-export":            "off",
    "import/order": ["warn", {
      groups: ["builtin", "external", "internal", "parent", "sibling"],
      "newlines-between": "always",
    }],

    // Layer boundaries
    "boundaries/element-types": ["error", {
      default: "disallow",
      rules: [
        { from: "controllers", allow: ["services", "models"] },
        { from: "services",    allow: ["repositories", "models", "utils", "config"] },
        { from: "repositories",allow: ["models", "utils", "config"] },
        { from: "routes",      allow: ["controllers", "middlewares"] },
        { from: "middlewares", allow: ["config", "utils", "models"] },
        { from: "utils",       allow: [] },
        { from: "config",      allow: [] },
      ],
    }],
  },
  settings: {
    "boundaries/elements": [
      { type: "controllers",  pattern: "src/controllers/*" },
      { type: "services",     pattern: "src/services/*" },
      { type: "repositories", pattern: "src/repositories/*" },
      { type: "routes",       pattern: "src/routes/*" },
      { type: "middlewares",  pattern: "src/middlewares/*" },
      { type: "models",       pattern: "src/models/*" },
      { type: "utils",        pattern: "src/utils/*" },
      { type: "config",       pattern: "src/config/*" },
    ],
  },
};
```

### 2.4 Git Hooks

```json
// package.json
{
  "lint-staged": {
    "src/**/*.ts": [
      "eslint --max-warnings 0 --fix",
      "prettier --write"
    ],
    "tests/**/*.ts": [
      "eslint --max-warnings 0",
      "prettier --write"
    ]
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged

# .husky/pre-push
npm run type-check && npm run test -- --passWithNoTests
```

### 2.5 Key Style Rules with Rationale

**Async/await over callbacks and raw Promises**
```ts
// ❌ raw Promise chain — harder to read, error handling fragmented
getUserById(id)
  .then(user => getOrdersByUser(user.id))
  .then(orders => res.json(orders))
  .catch(err => next(err));

// ✅ async/await — linear reading, single try/catch
try {
  const user   = await getUserById(id);
  const orders = await getOrdersByUser(user.id);
  res.json(orders);
} catch (err) {
  next(err);
}
```

**No await in loops — use Promise.all**
```ts
// ❌ sequential — 10 items × 50ms = 500ms total
for (const id of orderIds) {
  const order = await orderService.getById(id); // blocks each iteration
  results.push(order);
}

// ✅ parallel — 10 items × 50ms = ~50ms total
const results = await Promise.all(orderIds.map(id => orderService.getById(id)));
```

**Early returns over deep nesting**
```ts
// ❌ arrow anti-pattern — rightward drift
async function processOrder(dto: CreateOrderDto) {
  if (dto.customerId) {
    const customer = await customerService.getById(dto.customerId);
    if (customer) {
      if (customer.isActive) {
        // actual logic buried 3 levels deep
      }
    }
  }
}

// ✅ early returns — flat and readable
async function processOrder(dto: CreateOrderDto): Promise<Order> {
  if (!dto.customerId) throw new ValidationError('customerId required');
  const customer = await customerService.getById(dto.customerId);
  if (!customer)        throw new NotFoundError('Customer');
  if (!customer.isActive) throw new BusinessError('Customer account is inactive');

  // actual logic at the top level
  return orderRepository.save(dto);
}
```

**Destructure at function entry**
```ts
// ❌ repeated dot access
function formatAddress(address: Address): string {
  return `${address.line1}, ${address.city}, ${address.postcode}`;
}

// ✅ destructure once
function formatAddress({ line1, city, postcode }: Address): string {
  return `${line1}, ${city}, ${postcode}`;
}
```

### 2.6 Anti-patterns Checklist

| Anti-pattern | Why it's harmful | Fix |
|---|---|---|
| `any` type | Defeats TypeScript entirely; errors surface at runtime | `unknown` + type narrowing |
| `console.log` in src | Unstructured, not redactable, lost in production | Pino logger |
| `process.env` outside config | Scattered, unvalidated, untestable | `config/env.ts` with Zod |
| Magic numbers/strings | Intent unclear; change in one place misses others | Named constants |
| `// TODO` comments | Good intentions, never actioned | File a ticket instead |
| Commented-out code | Confusing noise — is this intentional? | Delete it; Git has history |
| Deeply nested callbacks | Hard to read, hard to test | `async/await` + early returns |

---

## 3. Error Handling & Logging

### Why this matters
Poor error handling has two failure modes: swallowing errors silently (bugs invisible in production) and leaking internals to clients (security risk + poor UX). Poor logging means debugging production issues with guesswork. Both are fixable with a small amount of upfront structure.

### 3.1 Error Hierarchy

```ts
// src/utils/errors.ts

/**
 * Base for all application errors.
 * isOperational = true  → expected business error (4xx); log at warn level
 * isOperational = false → programmer error or unexpected state (5xx); log at error level, may need restart
 */
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
    Object.setPrototypeOf(this, new.target.prototype); // needed for instanceof checks after transpilation
    Error.captureStackTrace(this, this.constructor);
  }
}

// 4xx — operational, expected
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 422, 'VALIDATION_ERROR', true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(`${resource}${id ? ` '${id}'` : ''} not found`, 404, 'NOT_FOUND', true, { resource, id });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED', true);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN', true);
  }
}

export class ConflictError extends AppError {
  constructor(resource: string, detail?: string) {
    super(`${resource} already exists${detail ? `: ${detail}` : ''}`, 409, 'CONFLICT', true);
  }
}

export class BusinessError extends AppError {
  constructor(message: string, code = 'BUSINESS_RULE_VIOLATION') {
    super(message, 422, code, true);
  }
}

// 5xx — non-operational, unexpected
export class ExternalServiceError extends AppError {
  constructor(service: string, cause?: Error) {
    super(`External service '${service}' failed`, 502, 'EXTERNAL_SERVICE_ERROR', false, { service });
    if (cause) this.stack += `\nCaused by: ${cause.stack}`;
  }
}
```

### 3.2 Global Error Handler Middleware

```ts
// src/middlewares/error-handler.middleware.ts
import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, ValidationError } from '../utils/errors';
import { logger } from '../config/logger';

export const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, _next: NextFunction) => {
  // Normalise Zod validation errors into our error format
  if (err instanceof ZodError) {
    const message = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    return res.status(422).json({
      error: {
        code:      'VALIDATION_ERROR',
        message,
        requestId: req.id,
        fields:    err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
      },
    });
  }

  if (err instanceof AppError) {
    // Operational errors — expected, warn-level
    if (err.isOperational) {
      logger.warn({ err, requestId: req.id, context: err.context }, err.message);
    } else {
      // Non-operational — unexpected, may need attention
      logger.error({ err, requestId: req.id }, 'Non-operational error');
    }

    return res.status(err.statusCode).json({
      error: {
        code:      err.code,
        message:   err.message,
        requestId: req.id,
        ...(process.env.NODE_ENV !== 'production' && { context: err.context }),
      },
    });
  }

  // Completely unexpected error — hide internals from client
  logger.error({ err, requestId: req.id }, 'Unhandled error');
  res.status(500).json({
    error: {
      code:      'INTERNAL_ERROR',
      message:   'An unexpected error occurred',
      requestId: req.id,
    },
  });
};
```

### 3.3 Async Error Wrapper

Express doesn't catch async errors by default. Wrap every async route handler:

```ts
// src/utils/async-handler.ts
import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void | Response>;

export const asyncHandler = (fn: AsyncRequestHandler): RequestHandler =>
  (req, res, next) => fn(req, res, next).catch(next);

// Usage:
router.post('/orders', asyncHandler(orderController.create));

// Alternative: use 'express-async-errors' package and skip the wrapper entirely
// import 'express-async-errors'; // patches Express globally — add to app.ts top
```

**Why:** Without this, a thrown error inside an async handler silently hangs the request. Always one of the two approaches above.

### 3.4 Unhandled Rejection & Uncaught Exception Handlers

```ts
// src/server.ts
process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ reason }, 'Unhandled promise rejection — shutting down');
  process.exit(1); // let the process manager restart cleanly
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});
```

**Why exit(1):** After an uncaught exception, the process may be in an inconsistent state. A restart by the process manager (Docker, PM2, k8s) is safer than attempting to continue.

### 3.5 Structured Logging with Pino

```ts
// src/config/logger.ts
import pino, { Logger } from 'pino';
import { env } from './env';

export const logger: Logger = pino({
  level: env.LOG_LEVEL,

  // Strip sensitive fields from all log output — applies recursively
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.token',
      'body.creditCard',
      '*.ssn',
    ],
    censor: '[REDACTED]',
  },

  serializers: {
    ...pino.stdSerializers,
    err: pino.stdSerializers.err, // serialises Error.stack properly
  },

  // Human-readable in dev, JSON in production
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});
```

### 3.6 Request ID Propagation

Every log line must carry the request ID so you can trace a full request across log lines:

```ts
// src/middlewares/request-id.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

declare global {
  namespace Express {
    interface Request { id: string; log: pino.Logger; }
  }
}

export function requestId() {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.id  = (req.headers['x-request-id'] as string) ?? randomUUID();
    req.log = logger.child({ requestId: req.id }); // child logger inherits requestId
    next();
  };
}

// In handlers — use req.log, not the root logger:
async function createOrder(req: Request, res: Response) {
  req.log.info({ customerId: dto.customerId }, 'Creating order');
  const order = await orderService.create(dto);
  req.log.info({ orderId: order.id }, 'Order created');
  res.status(201).json(order);
}
```

### 3.7 Log Level Standards

| Level | When | Example |
|---|---|---|
| `fatal` | Process about to die | Uncaught exception, out of memory |
| `error` | Unexpected failure needing investigation | DB connection lost, non-operational AppError |
| `warn` | Recoverable problem — worth monitoring | Retry attempt, deprecated endpoint called, slow query |
| `info` | Key business events — what happened | Order placed, user authenticated, job completed |
| `debug` | Diagnostic detail for development | Function entered, cache miss, query params |
| `trace` | Very fine-grained — almost never in production | Every middleware step, loop iterations |

### 3.8 What NOT to Log

```ts
// ❌ PII and secrets — even at debug level
logger.info({ password: user.password }, 'User login');
logger.debug({ token: jwtToken }, 'Token generated');
logger.info({ ssn: customer.ssn }, 'Processing customer');

// ❌ Redundant noise — framework already logs this
logger.info(`GET /api/v1/orders`); // Express/Pino HTTP logs this automatically

// ❌ Swallowed errors — the silent killer
try {
  await sendEmail(user);
} catch {
  // nothing here — email failure is invisible in production
}

// ✅ Always log caught errors, even if you handle them
try {
  await sendEmail(user);
} catch (err) {
  logger.warn({ err, userId: user.id }, 'Email delivery failed — continuing');
}
```

---

## 4. TypeScript Usage

### Why this matters
TypeScript's value is proportional to how strictly you use it. A codebase full of `any` has the syntax of TypeScript with none of the safety. Strict mode catches entire classes of bugs — null dereferences, wrong argument types, missing cases — before they reach production.

### 4.1 tsconfig

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",

    // Strict mode — non-negotiable
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,  // catch (err) → err is unknown, not any

    // Additional safety
    "noUncheckedIndexedAccess": true,    // arr[0] is T | undefined, not T
    "exactOptionalPropertyTypes": true,  // { a?: string } ≠ { a: string | undefined }
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,           // all code paths must return
    "noFallthroughCasesInSwitch": true,

    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### 4.2 Type Rules with Examples

**Never use `any` — use `unknown` and narrow**
```ts
// ❌ defeats type safety entirely
function parseConfig(input: any): any {
  return JSON.parse(input);
}

// ✅ use unknown and validate at the boundary
function parseConfig(input: unknown): AppConfig {
  const result = AppConfigSchema.parse(input); // Zod throws on invalid
  return result;
}

// ✅ narrowing in catch blocks
try {
  await riskyOperation();
} catch (err: unknown) {
  if (err instanceof AppError) logger.warn({ err }, err.message);
  else if (err instanceof Error) logger.error({ err }, 'Unexpected error');
  else logger.error({ err }, 'Unknown throw value');
}
```

**Use `interface` for shapes, `type` for unions and computed types**
```ts
// ✅ interface for object shapes — extendable, clear in error messages
interface Order {
  readonly id:         string;
  readonly customerId: string;
  status:              OrderStatus;
  items:               readonly OrderItem[];
  createdAt:           Date;
}

// ✅ type for unions, intersections, mapped types
type OrderStatus = 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
type PartialOrder = Partial<Pick<Order, 'status' | 'items'>>;
type OrderWithCustomer = Order & { customer: Customer };
```

**Leverage discriminated unions for state machines**
```ts
// ❌ nullable fields — caller must always check
interface PaymentResult {
  success:      boolean;
  chargeId?:    string; // only present if success
  errorCode?:   string; // only present if !success
}

// ✅ discriminated union — TypeScript narrows correctly in each branch
type PaymentResult =
  | { success: true;  chargeId: string }
  | { success: false; errorCode: string; retryable: boolean };

function handleResult(result: PaymentResult) {
  if (result.success) {
    // TypeScript knows result.chargeId exists here
    logger.info({ chargeId: result.chargeId }, 'Payment succeeded');
  } else {
    // TypeScript knows result.errorCode and result.retryable exist here
    if (result.retryable) scheduleRetry();
  }
}
```

**Branded types for IDs and domain primitives**
```ts
// ❌ plain strings are interchangeable — compiler won't catch passing orderId where customerId expected
function getOrder(orderId: string, customerId: string) {}
getOrder(customerId, orderId); // compiles — silent bug

// ✅ branded types — caught at compile time
type OrderId    = string & { readonly __brand: 'OrderId' };
type CustomerId = string & { readonly __brand: 'CustomerId' };

function getOrder(orderId: OrderId, customerId: CustomerId) {}
getOrder(customerId, orderId); // TS error — wrong brand

// Factory functions to create branded values at the validated boundary
function toOrderId(id: string): OrderId {
  if (!isUUID(id)) throw new ValidationError('Invalid order ID format');
  return id as OrderId;
}
```

**`readonly` by default**
```ts
// ❌ mutable by default — mutated accidentally deep in call stack
interface OrderItem { quantity: number; price: number; }

// ✅ readonly — mutation requires explicit new object
interface OrderItem { readonly quantity: number; readonly price: number; }
const items: readonly OrderItem[] = [...];

// For deep readonly on complex objects:
type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };
```

### 4.3 Zod — Runtime Validation at Boundaries

TypeScript types are erased at runtime. Any data entering the service from outside (HTTP requests, env vars, DB results from untyped drivers, message queue payloads) must be validated at runtime.

```ts
// src/models/order.dto.ts
import { z } from 'zod';

export const CreateOrderSchema = z.object({
  customerId:   z.string().uuid('Must be a valid UUID'),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity:  z.number().int().positive().max(999),
    notes:     z.string().max(500).optional(),
  })).min(1, 'Order must have at least one item').max(50, 'Max 50 items per order'),
  deliveryDate: z.coerce.date().min(
    new Date(), 'Delivery date must be in the future'
  ),
  priority:     z.enum(['STANDARD', 'EXPRESS', 'OVERNIGHT']).default('STANDARD'),
}).strict(); // reject unknown fields — important security rule

export type CreateOrderDto = z.infer<typeof CreateOrderSchema>;

// Validation middleware — apply per-route
export function validate(schema: z.ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error); // ZodError caught by global handler
    req.body = result.data; // replace with parsed/coerced/defaulted values
    next();
  };
}

// In routes:
router.post('/orders', validate(CreateOrderSchema), asyncHandler(orderController.create));
```

### 4.4 Utility Types — Use Them

```ts
// Don't redefine what TypeScript gives you for free
type UpdateOrderDto = Partial<Pick<Order, 'status' | 'deliveryDate' | 'notes'>>;
type OrderSummary   = Pick<Order, 'id' | 'status' | 'createdAt'>;
type OrderWithoutId = Omit<Order, 'id' | 'createdAt'>;

// Return type inference — let TypeScript infer where it's obvious
const getStatus = (order: Order) => order.status; // inferred as OrderStatus

// Explicitly annotate public API return types — documents the contract
export async function createOrder(dto: CreateOrderDto): Promise<Order> { ... }
export async function listOrders(filter: OrderFilter): Promise<PaginatedResult<Order>> { ... }
```

---

## 5. Security Best Practices

### Why this matters
Security vulnerabilities are uniquely costly: they're often discovered by attackers before your team, the blast radius can be enormous, and the reputational damage is lasting. Most common vulnerabilities are entirely preventable with standard patterns applied consistently.

### 5.1 Environment & Secrets

```ts
// src/config/env.ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV:          z.enum(['development', 'test', 'production']),
  PORT:              z.coerce.number().min(1024).max(65535).default(3000),
  DATABASE_URL:      z.string().url(),
  JWT_SECRET:        z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET:z.string().min(32),
  REDIS_URL:         z.string().url(),
  BCRYPT_ROUNDS:     z.coerce.number().min(10).max(14).default(12),
  ALLOWED_ORIGINS:   z.string().default('http://localhost:3000'),
  LOG_LEVEL:         z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
}).strict();

// Crash at startup with a clear message rather than silently misconfigured
export const env = (() => {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    result.error.errors.forEach(e => console.error(`  ${e.path.join('.')}: ${e.message}`));
    process.exit(1);
  }
  return result.data;
})();
```

```bash
# .env.example — commit this; never commit .env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/mydb
JWT_SECRET=change-me-to-a-random-32-char-minimum-string
JWT_REFRESH_SECRET=another-random-32-char-minimum-string
REDIS_URL=redis://localhost:6379
BCRYPT_ROUNDS=12
ALLOWED_ORIGINS=http://localhost:3000
LOG_LEVEL=debug
```

### 5.2 HTTP Security Middleware Stack

```ts
// src/app.ts — order matters
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { env } from './config/env';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

app.use(cors({
  origin: env.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  credentials: true,
  maxAge: 86400, // cache preflight for 24h
}));

// Slow down before hard limit — gives legitimate clients a chance
app.use(slowDown({
  windowMs:         15 * 60 * 1000,
  delayAfter:       50,
  delayMs:          (hits) => (hits - 50) * 100, // +100ms per request over 50
}));

app.use(rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              100,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
  skip:             (req) => req.path === '/health', // don't rate-limit health checks
}));

app.use(express.json({ limit: '100kb' }));    // reject oversized JSON
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
```

### 5.3 Authentication — JWT Best Practices

```ts
// src/middlewares/auth.middleware.ts
import jwt from 'jsonwebtoken';

interface JwtPayload {
  sub:   string;   // user ID
  roles: string[];
  iat:   number;
  exp:   number;
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Bearer token required'));
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],   // whitelist algorithm — prevent algorithm confusion attack
      issuer:     'my-service',
      audience:   'my-service',
    }) as JwtPayload;

    req.user = { id: payload.sub, roles: payload.roles };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError)  return next(new UnauthorizedError('Token expired'));
    if (err instanceof jwt.JsonWebTokenError)  return next(new UnauthorizedError('Invalid token'));
    next(err);
  }
}

// Token generation
export function generateTokens(userId: string, roles: string[]) {
  const payload = { sub: userId, roles, iss: 'my-service', aud: 'my-service' };
  return {
    accessToken:  jwt.sign(payload, env.JWT_SECRET,         { expiresIn: '15m' }),
    refreshToken: jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '7d' }),
  };
}
```

### 5.4 Password Handling

```ts
import bcrypt from 'bcrypt';

// Hashing — at registration/password change
export async function hashPassword(plaintext: string): Promise<string> {
  // env.BCRYPT_ROUNDS = 12 in production — balance of security and latency (~300ms)
  return bcrypt.hash(plaintext, env.BCRYPT_ROUNDS);
}

// Verification — at login
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
  // bcrypt.compare is time-constant — prevents timing attacks
}

// ❌ never compare passwords with === or manual hashing
// ❌ never log plaintext passwords, even at debug level
// ❌ never use MD5 or SHA1 for passwords — they're not designed for it
```

### 5.5 SQL Injection Prevention

```ts
// ❌ string interpolation — SQL injection vector
const orders = await db.query(
  `SELECT * FROM orders WHERE customer_id = '${customerId}'`
);

// ✅ parameterised query — always
const orders = await db.query(
  'SELECT id, status, created_at FROM orders WHERE customer_id = $1',
  [customerId]
);

// ✅ ORM — parameterises automatically
const orders = await orderRepository.findBy({ customerId });

// ❌ even with ORM — watch for raw query escapes
const orders = await repo.query(`SELECT * FROM orders WHERE notes LIKE '%${search}%'`);
// ✅ correct ORM raw query
const orders = await repo.query('SELECT * FROM orders WHERE notes ILIKE $1', [`%${search}%`]);
```

### 5.6 Security Anti-patterns

| Anti-pattern | Risk | Fix |
|---|---|---|
| Secrets in code or `.env` committed | Credential leak | Secrets manager + `.gitignore` |
| `algorithm: 'none'` in JWT verify | Auth bypass | Whitelist `['HS256']` explicitly |
| `SELECT *` queries | Over-exposure of data | Explicit column list |
| Error stack traces in API responses | Internal info leak | Strip in production |
| `eval()` or `new Function(str)` | Remote code execution | Never use on user input |
| Unvalidated redirects | Open redirect attacks | Whitelist allowed redirect URLs |
| HTTP (non-TLS) internal traffic | Eavesdropping | TLS everywhere, even internal |

---

## 6. Testing Standards

### Why this matters
Tests are the only reliable way to refactor with confidence. A service with 85% coverage and fast tests moves faster long-term than a service with no tests, because every change in the untested service requires manual verification. Tests are also the best documentation of intended behaviour — they never go stale the way comments do.

### 6.1 Test Pyramid

| Layer | Target % | Tools | What to mock |
|---|---|---|---|
| Unit | 70% | Jest, ts-jest | All I/O — DB, HTTP, filesystem, time |
| Integration | 20% | Jest, real DB via Docker | External HTTP only |
| E2E | 10% | Jest, Supertest | Nothing — full stack |

### 6.2 Project Setup

```ts
// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],

  // Separate test suites so integration/e2e don't run on every save
  projects: [
    { displayName: 'unit',        testMatch: ['<rootDir>/tests/unit/**/*.test.ts'] },
    { displayName: 'integration', testMatch: ['<rootDir>/tests/integration/**/*.test.ts'] },
    { displayName: 'e2e',         testMatch: ['<rootDir>/tests/e2e/**/*.test.ts'] },
  ],

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/server.ts',         // entry point — not testable in isolation
    '!src/config/logger.ts',  // infrastructure — tested implicitly
  ],

  coverageThreshold: {
    global: { branches: 80, functions: 85, lines: 85, statements: 85 },
  },

  // Fake timers for time-sensitive tests
  fakeTimers: { enableGlobally: false }, // opt in per-test
};
export default config;
```

### 6.3 Test Data Factories

Never inline raw objects in tests — use factories. They make tests resilient to model changes and communicate intent.

```ts
// tests/fixtures/order.factory.ts
import { CreateOrderDto, Order } from '../../src/models/order.dto';
import { randomUUID } from 'crypto';

export function buildCreateOrderDto(overrides: Partial<CreateOrderDto> = {}): CreateOrderDto {
  return {
    customerId:   randomUUID(),
    items:        [{ productId: randomUUID(), quantity: 2 }],
    deliveryDate: new Date(Date.now() + 86_400_000),
    priority:     'STANDARD',
    ...overrides,
  };
}

export function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id:          randomUUID(),
    customerId:  randomUUID(),
    status:      'PENDING',
    items:       [{ productId: randomUUID(), quantity: 2, price: 19.99 }],
    createdAt:   new Date(),
    ...overrides,
  };
}
```

### 6.4 Unit Tests

```ts
// tests/unit/order.service.test.ts
import { OrderService } from '../../src/services/order.service';
import { NotFoundError, BusinessError } from '../../src/utils/errors';
import { buildCreateOrderDto, buildOrder } from '../fixtures/order.factory';

// Mock at the module level — replaced before any import resolution
jest.mock('../../src/repositories/order.repository');
jest.mock('../../src/repositories/customer.repository');

describe('OrderService', () => {
  let service: OrderService;
  let mockOrderRepo: jest.Mocked<OrderRepository>;
  let mockCustomerRepo: jest.Mocked<CustomerRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOrderRepo    = jest.mocked(new OrderRepository());
    mockCustomerRepo = jest.mocked(new CustomerRepository());
    service          = new OrderService(mockOrderRepo, mockCustomerRepo);
  });

  describe('createOrder', () => {
    it('returns created order on valid input', async () => {
      // Arrange
      const dto      = buildCreateOrderDto();
      const expected = buildOrder({ customerId: dto.customerId });
      mockCustomerRepo.findById.mockResolvedValue(buildCustomer({ id: dto.customerId, isActive: true }));
      mockOrderRepo.save.mockResolvedValue(expected);

      // Act
      const result = await service.createOrder(dto);

      // Assert
      expect(result).toEqual(expected);
      expect(mockOrderRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        customerId: dto.customerId,
      }));
    });

    it('throws NotFoundError when customer does not exist', async () => {
      mockCustomerRepo.findById.mockResolvedValue(null);
      await expect(service.createOrder(buildCreateOrderDto()))
        .rejects.toThrow(NotFoundError);
      expect(mockOrderRepo.save).not.toHaveBeenCalled();
    });

    it('throws BusinessError when customer account is inactive', async () => {
      mockCustomerRepo.findById.mockResolvedValue(buildCustomer({ isActive: false }));
      await expect(service.createOrder(buildCreateOrderDto()))
        .rejects.toThrow(BusinessError);
    });

    it('does not call save when validation fails upstream', async () => {
      mockCustomerRepo.findById.mockResolvedValue(null);
      await expect(service.createOrder(buildCreateOrderDto())).rejects.toThrow();
      expect(mockOrderRepo.save).not.toHaveBeenCalled();
    });
  });
});
```

### 6.5 Integration Tests

```ts
// tests/integration/order.repository.test.ts
// Runs against a real PostgreSQL instance (Docker Compose)

describe('OrderRepository (integration)', () => {
  let repo: OrderRepository;
  let db:   Pool;

  beforeAll(async () => {
    db   = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    repo = new OrderRepository(db);
    await db.query('BEGIN'); // wrap all tests in a transaction
  });

  afterAll(async () => {
    await db.query('ROLLBACK'); // undo all writes
    await db.end();
  });

  it('persists and retrieves an order', async () => {
    const dto   = buildCreateOrderDto();
    const saved = await repo.save(dto);

    expect(saved.id).toBeDefined();
    const found = await repo.findById(saved.id);
    expect(found).toMatchObject({ customerId: dto.customerId, status: 'PENDING' });
  });

  it('returns null for non-existent order', async () => {
    expect(await repo.findById(randomUUID())).toBeNull();
  });
});
```

### 6.6 E2E Tests

```ts
// tests/e2e/orders.test.ts
import request from 'supertest';
import { buildApp } from '../../src/app';

describe('Orders API (e2e)', () => {
  const app = buildApp();
  let authToken: string;

  beforeAll(async () => {
    authToken = await getTestToken(); // helper that calls /auth/login
  });

  it('POST /api/v1/orders → 201 with valid payload', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildCreateOrderDto())
      .expect(201);

    expect(res.body).toMatchObject({
      id:     expect.any(String),
      status: 'PENDING',
    });
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('POST /api/v1/orders → 422 when items array is empty', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send(buildCreateOrderDto({ items: [] }))
      .expect(422);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.requestId).toBeDefined();
  });

  it('POST /api/v1/orders → 401 without token', async () => {
    await request(app).post('/api/v1/orders').send(buildCreateOrderDto()).expect(401);
  });
});
```

### 6.7 Testing Anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Testing implementation details | Brittle — breaks on refactor | Test observable behaviour (inputs/outputs) |
| `expect(fn).toHaveBeenCalled()` as the only assertion | Doesn't verify correctness | Also assert on the return value or state change |
| Shared mutable state between tests | Flaky ordering-dependent tests | `beforeEach` to reset, never `beforeAll` for mutable state |
| `setTimeout` / `Date.now()` in tests | Slow, flaky, CI-dependent | `jest.useFakeTimers()` |
| Tests that require specific test order | Hidden coupling | Each test must be independently runnable |
| Asserting on error message strings | Brittle to message changes | Assert on error type and code |
| Testing private methods | Couples tests to implementation | Test via public interface only |

---

## 7. Performance & Scalability

### Why this matters
Node.js is single-threaded. One blocked event loop affects every concurrent request. Understanding what blocks the event loop — and designing around it — is fundamental to building services that stay fast under load.

### 7.1 The Event Loop — What Blocks It

```ts
// ❌ These block the event loop — never in a request handler
const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512'); // synchronous crypto
const data = fs.readFileSync('/large-file.csv');                         // synchronous I/O
JSON.parse(veryLargeJsonString);                                         // CPU on large payloads
someHeavyComputation();                                                  // pure CPU work

// ✅ async alternatives
const hash = await bcrypt.hash(password, 12);              // async — yields to event loop
const data = await fs.promises.readFile('/large-file.csv');
// For CPU-heavy work — offload to worker thread
const { Worker } = require('worker_threads');
```

### 7.2 Connection Pooling

```ts
// ❌ creates a new connection per request — exhausts DB connections under load
app.get('/orders', async (req, res) => {
  const client = new Pool({ connectionString: env.DATABASE_URL }); // wrong
  const result = await client.query('SELECT ...');
});

// ✅ one shared pool for the lifetime of the process
// src/config/database.ts
import { Pool } from 'pg';
export const db = new Pool({
  connectionString: env.DATABASE_URL,
  max:              20,     // max pool size — tune to DB connection limit
  idleTimeoutMillis:30_000, // release idle connections after 30s
  connectionTimeoutMillis: 2_000, // fail fast if no connection available in 2s
});

// Expose health of pool for monitoring
export function getPoolStats() {
  return { total: db.totalCount, idle: db.idleCount, waiting: db.waitingCount };
}
```

### 7.3 Pagination — Never Return Unbounded Results

```ts
// ❌ returns all rows — OOM risk on large tables
router.get('/orders', async (req, res) => {
  const orders = await orderRepository.findAll();
  res.json(orders);
});

// ✅ cursor-based pagination for large, frequently-updated datasets
interface CursorPage<T> {
  data:       T[];
  nextCursor: string | null;
  hasMore:    boolean;
}

async function listOrders(cursor?: string, limit = 20): Promise<CursorPage<Order>> {
  const safeLimit = Math.min(limit, 100); // enforce max
  const rows = await db.query(
    `SELECT * FROM orders
     WHERE ($1::uuid IS NULL OR id < $1)
     ORDER BY id DESC
     LIMIT $2`,
    [cursor ?? null, safeLimit + 1], // fetch one extra to detect hasMore
  );
  const hasMore = rows.length > safeLimit;
  const data    = hasMore ? rows.slice(0, safeLimit) : rows;
  return {
    data,
    hasMore,
    nextCursor: hasMore ? data[data.length - 1].id : null,
  };
}
```

### 7.4 Caching Strategy

```ts
// src/utils/cache.ts
import Redis from 'ioredis';
import { env } from '../config/env';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck:     true,
  lazyConnect:          true,
});

export async function cached<T>(
  key:     string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;

  const value = await fetchFn();
  await redis.setex(key, ttlSeconds, JSON.stringify(value));
  return value;
}

// Usage — transparently cached
async function getProduct(id: string): Promise<Product> {
  return cached(`product:${id}`, 300, () => productRepository.findById(id));
}

// Cache invalidation on write
async function updateProduct(id: string, dto: UpdateProductDto): Promise<Product> {
  const updated = await productRepository.update(id, dto);
  await redis.del(`product:${id}`); // invalidate immediately
  return updated;
}
```

### 7.5 Graceful Shutdown

```ts
// src/server.ts
import { buildApp } from './app';
import { db }        from './config/database';
import { redis }     from './config/cache';
import { logger }    from './config/logger';
import { env }       from './config/env';

const app    = buildApp();
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'Server started'));

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');

  // 1. Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      // 2. Drain in-flight requests, close DB pool, disconnect Redis
      await Promise.all([
        db.end(),
        redis.quit(),
      ]);
      logger.info('Connections closed — exiting cleanly');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown — forcing exit');
      process.exit(1);
    }
  });

  // 3. Force exit after 10s — don't let shutdown hang forever
  setTimeout(() => {
    logger.error('Shutdown timeout exceeded — forcing exit');
    process.exit(1);
  }, 10_000).unref(); // .unref() so this timer doesn't keep the process alive on its own
};

process.on('SIGTERM', () => shutdown('SIGTERM')); // k8s sends this before killing pod
process.on('SIGINT',  () => shutdown('SIGINT'));  // Ctrl+C in development
```

### 7.6 Performance Anti-patterns

| Anti-pattern | Impact | Fix |
|---|---|---|
| `await` inside a `for` loop | Sequential I/O — N × latency | `Promise.all()` |
| `SELECT *` | Over-fetches data, breaks if schema changes | Explicit column list |
| N+1 queries | 1 query to list + N queries per item | JOIN or `IN (...)` batch query |
| No connection pool | New TCP handshake per request | Shared pool with sensible limits |
| Unbounded result sets | OOM on large tables | Cursor or offset pagination |
| Synchronous blocking in handlers | Stalls all concurrent requests | `worker_threads` or async alternatives |
| No index on filtered/sorted columns | Full table scans | Index FK, `WHERE`, `ORDER BY` columns |

---

## 8. CI/CD & Deployment

### Why this matters
Manual deployments are slow, error-prone, and don't scale to a team. A robust pipeline is a force multiplier — it gives every developer confidence to merge and ship, and it catches problems before they reach users.

### 8.1 Pipeline Stages & Gates

Each stage gates the next. A failure stops the pipeline and notifies the team immediately.

```
┌─────────────┐   ┌─────────────┐   ┌──────────────┐   ┌─────────────┐
│ 1. Lint &   │──▶│ 2. Type     │──▶│ 3. Unit      │──▶│ 4. Integr.  │
│ Format      │   │ Check       │   │ Tests +      │   │ Tests       │
│             │   │             │   │ Coverage     │   │ (real DB)   │
└─────────────┘   └─────────────┘   └──────────────┘   └─────────────┘
                                                               │
┌─────────────┐   ┌─────────────┐   ┌──────────────┐          │
│ 7. Deploy   │◀──│ 6. Build &  │◀──│ 5. Security  │◀─────────┘
│ Staging →   │   │ Push Image  │   │ Scan         │
│ Production  │   │             │   │              │
└─────────────┘   └─────────────┘   └──────────────┘
```

### 8.2 GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npx prettier --check "src/**/*.ts"
      - run: npm run type-check

  test-unit:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: npm }
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - uses: actions/upload-artifact@v4
        with: { name: coverage-report, path: coverage/ }

  test-integration:
    needs: lint
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB:       test_db
          POSTGRES_USER:     test
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports: ['5432:5432']
      redis:
        image: redis:7-alpine
        options: --health-cmd "redis-cli ping" --health-interval 10s
        ports: ['6379:6379']
    env:
      TEST_DATABASE_URL: postgresql://test:test@localhost:5432/test_db
      TEST_REDIS_URL:    redis://localhost:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: npm }
      - run: npm ci
      - run: npm run test:integration

  security:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: npm }
      - run: npm ci
      - run: npm audit --audit-level=high
      - uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          severity: HIGH,CRITICAL
          exit-code: '1'

  build:
    needs: [test-unit, test-integration, security]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=sha-
            type=semver,pattern={{version}}
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to:   type=gha,mode=max
          target: production
```

### 8.3 Dockerfile

```dockerfile
# ---- Dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev

# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run type-check

# ---- Production ----
FROM node:20-alpine AS production
# Create non-root user — never run as root in production
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs appuser

WORKDIR /app

# Install only prod dependencies in the final image
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder --chown=appuser:nodejs /app/dist ./dist

USER appuser
EXPOSE 3000
ENV NODE_ENV=production

# Healthcheck using wget (smaller than curl on Alpine)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
```

### 8.4 Health Check Endpoint

```ts
// src/routes/health.routes.ts
router.get('/health', async (req, res) => {
  const checks = await Promise.allSettled([
    db.query('SELECT 1'),
    redis.ping(),
  ]);

  const status = {
    db:    checks[0].status === 'fulfilled' ? 'ok' : 'degraded',
    redis: checks[1].status === 'fulfilled' ? 'ok' : 'degraded',
  };
  const isHealthy = Object.values(status).every(s => s === 'ok');

  res
    .status(isHealthy ? 200 : 503)
    .set('Cache-Control', 'no-store') // never cache health check responses
    .json({
      status:     isHealthy ? 'ok' : 'degraded',
      version:    process.env.npm_package_version,
      uptime:     process.uptime(),
      timestamp:  new Date().toISOString(),
      checks:     status,
    });
});
```

### 8.5 Deployment Checklist

Before every production deployment:

- [ ] All CI stages green on the commit being deployed
- [ ] Image tagged with semantic version — not `:latest`
- [ ] Secrets rotated if this deploy touches auth/crypto
- [ ] DB migrations reviewed and tested on staging first
- [ ] Rollback plan documented (previous image tag noted)
- [ ] Feature flags configured for new features
- [ ] Runbook updated if operational behaviour changes
- [ ] On-call engineer notified of deployment window

### 8.6 Twelve-Factor Compliance Checklist

| Factor | Requirement |
|---|---|
| Codebase | One repo per service; no shared code via copy-paste — use packages |
| Dependencies | All declared in `package.json`; no global installs assumed |
| Config | All config from environment variables; nothing environment-specific in code |
| Backing services | DB, Redis, queues treated as attached resources via URL config |
| Build/release/run | Strict separation — build produces image, deploy configures via env |
| Processes | Stateless — no local file storage, no in-process session state |
| Port binding | Service exports via port; `app.listen(env.PORT)` |
| Concurrency | Scale via multiple process instances, not threads |
| Disposability | Fast startup (< 5s), graceful shutdown on SIGTERM |
| Dev/prod parity | Same Docker image from dev through production |
| Logs | Treated as event streams — stdout only, never written to files |
| Admin processes | One-off tasks (migrations, scripts) run as separate processes |

---

*Questions? Raise a PR against the guidelines repo or ping #engineering-standards in Slack.*

---

## 9. `.gitignore` and `.dockerignore`

### Why this matters
`.gitignore` and `.dockerignore` are security and hygiene boundaries. A missing `.gitignore` entry is how credentials get committed and end up in breach databases. A missing `.dockerignore` entry bloats images, leaks secrets into the build context, and invalidates layer caches on every edit of an unrelated file. Both files should be treated as first-class project files — reviewed, maintained, and committed on day one.

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
# NEVER commit real env files — only .env.example (with placeholder values) is committed
.env
.env.*
!.env.example           # explicitly allow the example file
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
playwright-report/

# ── Logs ──────────────────────────────────────────────────────────────────────
logs/
*.log
*.log.*

# ── OS artefacts ──────────────────────────────────────────────────────────────
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
Thumbs.db
ehthumbs.db
Desktop.ini

# ── Editor & IDE ──────────────────────────────────────────────────────────────
.vscode/*
!.vscode/extensions.json   # allow sharing recommended extensions
!.vscode/settings.json     # allow sharing workspace settings
!.vscode/launch.json       # allow sharing debug configs
.idea/
*.swp
*.swo
*~
.project
.classpath
.settings/
*.sublime-workspace

# ── Docker ────────────────────────────────────────────────────────────────────
# Don't commit local override compose files that may contain real credentials
docker-compose.override.yml
docker-compose.local.yml

# ── Misc tooling ──────────────────────────────────────────────────────────────
.clinic/
.clinic-*
*.heapsnapshot
*.cpuprofile
.eslintcache
.stylelintcache
.prettiercache
.turbo/
.nx/cache/
```

**Common `.gitignore` mistakes to avoid:**

| Mistake | Risk | Fix |
|---|---|---|
| Not ignoring `.env` | Credentials committed and pushed | Add `.env` and `.env.*`, explicitly allow `.env.example` |
| Ignoring `dist/` but not `*.tsbuildinfo` | Stale incremental build metadata committed | Add `*.tsbuildinfo` |
| Committing `node_modules/` | Huge repo, platform-specific binaries, CI failures | Always ignore — never commit |
| Ignoring `docker-compose.override.yml` in some repos but not others | Inconsistent — one engineer leaks DB password | Add to every repo's `.gitignore` |
| Using a global `~/.gitignore` only | New team members miss project-specific ignores | Always commit a project-level `.gitignore` |

---

### 9.2 `.dockerignore`

The `.dockerignore` file controls what gets sent to the Docker daemon as the **build context**. Every file sent is hashed to check layer cache validity — sending unnecessary files means cache misses on code changes unrelated to the build.

```dockerignore
# ── Version control ───────────────────────────────────────────────────────────
.git/
.gitignore
.gitattributes
.github/

# ── Node dependencies ─────────────────────────────────────────────────────────
# Installed fresh inside the image via npm ci — never copy from host
node_modules/
.npm/
.pnp*
.yarn/cache

# ── Build artefacts ──────────────────────────────────────────────────────────
# Built inside image — should not be copied from host (wrong platform binaries)
dist/
build/
*.tsbuildinfo

# ── Test files ────────────────────────────────────────────────────────────────
# Tests are not needed in the production image
tests/
test/
**/*.test.ts
**/*.spec.ts
**/__mocks__/
coverage/
junit.xml
jest.config.*

# ── Environment & secrets ─────────────────────────────────────────────────────
# CRITICAL — never let real .env files into the build context
.env
.env.*
!.env.example         # allow example — it contains no real secrets
secrets/

# ── Docs & non-runtime files ──────────────────────────────────────────────────
docs/
*.md
!README.md            # optionally keep README for image metadata
LICENSE
CHANGELOG*
CONTRIBUTING*

# ── CI/CD ─────────────────────────────────────────────────────────────────────
.github/
.gitlab-ci.yml
.circleci/
Jenkinsfile
.travis.yml
.drone.yml

# ── Editor & OS ───────────────────────────────────────────────────────────────
.vscode/
.idea/
.DS_Store
Thumbs.db
*.swp
*.swo

# ── Docker ────────────────────────────────────────────────────────────────────
# Don't include compose files — they're for orchestration, not the image
docker-compose*.yml
Dockerfile*            # optional — Dockerfile not needed inside the image itself

# ── Logs & debugging ──────────────────────────────────────────────────────────
logs/
*.log
*.heapsnapshot
*.cpuprofile
.clinic/

# ── Scripts ───────────────────────────────────────────────────────────────────
# Audit/dev scripts are not needed in the production image
scripts/
```

**Why each exclusion matters:**

| Excluded path | Why |
|---|---|
| `.git/` | Contains full commit history — adds hundreds of MB to build context; also leaks history into image layers |
| `node_modules/` | Must be installed inside the image (`npm ci`) for correct platform binaries; host modules are wrong arch on CI runners |
| `dist/` | Must be built inside the image — copying host dist risks shipping a stale or dev build |
| `tests/`, `*.spec.ts` | Not needed at runtime; reduces final image size and attack surface |
| `.env`, `.env.*` | **Critical** — any `.env` file copied into a layer is readable from the image, even if deleted in a later layer |
| `.github/`, CI files | Pure overhead — not used at runtime |
| `*.md`, `docs/` | Documentation increases image size with zero runtime value |

### 9.3 Verifying Your `.dockerignore` Works

```bash
# See exactly what Docker will include in the build context
# (dry-run — doesn't actually build)
docker buildx build --no-cache --progress=plain . 2>&1 | grep "^#1"

# Or use a dedicated tool:
npx dockerignore-cli list

# Check final image for accidentally included files:
docker run --rm my-service:latest find /app -name "*.env" -o -name "*.test.ts"
# Should return nothing — if it returns files, fix .dockerignore

# Check image size layers to find bloat:
docker history my-service:latest
docker image inspect my-service:latest --format='{{.Size}}' | numfmt --to=iec
```

### 9.4 The `.env` Security Rule

This deserves emphasis because the consequences are severe and the mistake is common:

```bash
# ❌ This exposes your production secrets in the image layer — even if you add
#    a later RUN rm .env, the secret is still readable from the layer history
COPY . .          # copies .env if .dockerignore doesn't exclude it
RUN rm .env       # too late — it's already in the previous layer

# ✅ .dockerignore excludes .env entirely — it never enters the build context
# ✅ Secrets reach the container via environment variables at runtime:
#    docker run -e DATABASE_URL=... my-service
#    or via k8s Secrets / AWS Secrets Manager / Vault

# ✅ Verify no secrets are baked in after every build:
docker run --rm my-service:latest printenv | grep -iE "password|secret|key|token"
# Should return nothing
```

