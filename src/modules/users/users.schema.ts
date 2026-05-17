import { boolean, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// Role Enum
export const userRoleEnum = pgEnum('user_role', [
  'admin',
  'receptionist',
  'doctor',
  'lab_technician',
]);

// Users Table
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),

  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),

  email: varchar('email', { length: 255 }).notNull().unique(),
  phoneNumber: varchar('phone_number', { length: 20 }).notNull().unique(),

  passwordHash: varchar('password_hash', { length: 255 }).notNull(),

  role: userRoleEnum('role').notNull(),
  salary: varchar('salary', {length: 20}).notNull(),

  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});