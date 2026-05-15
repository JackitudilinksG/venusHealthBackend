import { pgTable, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('employees', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  firstName: varchar('first_name', { length: 255 }),
});