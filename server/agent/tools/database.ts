import { DatabaseSync } from "node:sqlite";

/**
 * A real SQLite database in memory, seeded with a small shop dataset, so the
 * database tool runs genuine SQL. Only read statements are accepted.
 */
export const DATABASE_SCHEMA = `customers(id INTEGER, name TEXT, country TEXT, signed_up TEXT)
products(id INTEGER, name TEXT, category TEXT, unit_price REAL)
orders(id INTEGER, customer_id INTEGER, ordered_at TEXT, status TEXT)
order_items(order_id INTEGER, product_id INTEGER, quantity INTEGER)`;

const SEED = `
CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT, country TEXT, signed_up TEXT);
CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT, category TEXT, unit_price REAL);
CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER, ordered_at TEXT, status TEXT);
CREATE TABLE order_items(order_id INTEGER, product_id INTEGER, quantity INTEGER);
INSERT INTO customers VALUES
 (1,'Amina Rahman','PK','2025-11-03'),(2,'Jonas Weber','DE','2025-12-14'),(3,'Sofia Rossi','IT','2026-01-22'),
 (4,'Liu Wei','CN','2026-02-09'),(5,'Maya Cohen','IL','2026-03-01'),(6,'Diego Alvarez','MX','2026-03-18'),
 (7,'Priya Nair','IN','2026-04-05'),(8,'Tom Becker','US','2026-05-12');
INSERT INTO products VALUES
 (1,'Mechanical keyboard','Hardware',129.00),(2,'USB-C dock','Hardware',89.50),(3,'Noise-cancelling headset','Audio',199.00),
 (4,'Desk microphone','Audio',149.00),(5,'Monitor arm','Furniture',79.00),(6,'Standing desk','Furniture',549.00),
 (7,'Team plan (annual)','Software',480.00),(8,'Pro plan (annual)','Software',240.00),(9,'Webcam 4K','Hardware',119.00);
INSERT INTO orders VALUES
 (101,1,'2026-06-02','shipped'),(102,2,'2026-06-04','shipped'),(103,3,'2026-06-07','shipped'),(104,4,'2026-06-11','cancelled'),
 (105,5,'2026-06-15','shipped'),(106,6,'2026-06-20','shipped'),(107,7,'2026-07-01','shipped'),(108,8,'2026-07-03','shipped'),
 (109,1,'2026-07-09','shipped'),(110,2,'2026-07-15','returned'),(111,3,'2026-07-22','shipped'),(112,4,'2026-08-02','shipped'),
 (113,5,'2026-08-10','shipped'),(114,6,'2026-08-19','shipped'),(115,7,'2026-09-01','shipped'),(116,8,'2026-09-14','shipped');
INSERT INTO order_items VALUES
 (101,1,1),(101,2,1),(102,3,1),(103,7,1),(104,6,1),(105,4,1),(105,9,1),(106,5,2),(107,8,3),(108,1,2),
 (109,3,1),(109,2,1),(110,9,1),(111,6,1),(112,7,2),(113,8,1),(113,4,1),(114,1,1),(114,5,1),(115,3,2),(116,7,1),(116,2,2);
`;

const MAX_ROWS = 50;

export interface QueryOutput {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  ms: number;
}

let shared: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (!shared) {
    shared = new DatabaseSync(":memory:");
    shared.exec(SEED);
  }
  return shared;
}

/** Accepts SELECT / WITH / EXPLAIN only; anything that could write is refused before it reaches SQLite. */
export function assertReadOnlySql(sql: string): void {
  const s = sql.trim().replace(/;\s*$/, "");
  if (!s) throw new Error("The SQL statement is empty.");
  if (s.includes(";")) throw new Error("One statement at a time.");
  if (!/^(select|with|explain)\b/i.test(s)) throw new Error("Only SELECT queries are allowed on this database.");
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|pragma)\b/i.test(s)) throw new Error("The query contains a write or schema keyword; only reads are allowed.");
}

export function runReadOnlyQuery(sql: string): QueryOutput {
  assertReadOnlySql(sql);
  const started = Date.now();
  const stmt = db().prepare(sql.trim().replace(/;\s*$/, ""));
  const all = stmt.all() as Record<string, unknown>[];
  const rows = all.slice(0, MAX_ROWS);
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return { columns, rows, rowCount: all.length, truncated: all.length > rows.length, ms: Date.now() - started };
}
