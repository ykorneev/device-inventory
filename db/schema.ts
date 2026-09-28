import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const employees = sqliteTable(
  "employees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_employees_name").on(table.name)],
);

export const devices = sqliteTable(
  "devices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    model: text("model").notNull(),
    category: text("category").notNull().default("mobile"),
    osVersion: text("os_version"),
    gpu: text("gpu"),
    soc: text("soc"),
    tier: text("tier").notNull(),
    quantity: integer("quantity").notNull().default(1),
    assetCode: text("asset_code"),
    comment: text("comment"),
    photoKey: text("photo_key"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_devices_asset_code").on(table.assetCode)],
);

export const loans = sqliteTable(
  "loans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deviceId: integer("device_id")
      .notNull()
      .references(() => devices.id),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id),
    checkedOutAt: text("checked_out_at").notNull(),
    returnedAt: text("returned_at"),
  },
  (table) => [
    index("idx_loans_employee_id").on(table.employeeId),
    index("idx_loans_device_id").on(table.deviceId),
  ],
);
