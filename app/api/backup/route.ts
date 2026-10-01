import { NextResponse } from "next/server";
import { getD1, getR2 } from "@/db";

export const dynamic = "force-dynamic";

type DatabaseRow = Record<string, string | number | null>;
type BackupFile = { name: string; data: Uint8Array };
type CentralEntry = {
  name: Uint8Array;
  checksum: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

const encoder = new TextEncoder();

function uint16(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function uint32(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(value: Date) {
  const year = Math.max(1980, value.getUTCFullYear());
  const date = ((year - 1980) << 9) | ((value.getUTCMonth() + 1) << 5) | value.getUTCDate();
  const time = (value.getUTCHours() << 11) | (value.getUTCMinutes() << 5) | Math.floor(value.getUTCSeconds() / 2);
  return { date, time };
}

function concatBytes(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function textFile(name: string, content: string): BackupFile {
  return { name, data: encoder.encode(content) };
}

function sqlValue(value: string | number | null) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function insertStatements(table: string, columns: string[], rows: DatabaseRow[]) {
  if (!rows.length) return `-- No rows in ${table}\n`;
  return rows
    .map((row) => `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => sqlValue(row[column])).join(", ")});`)
    .join("\n");
}

function createSqlDump(employees: DatabaseRow[], devices: DatabaseRow[], loans: DatabaseRow[]) {
  return `-- Test Devices full backup
-- Generated for SQLite-compatible databases.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER DEFAULT 1 NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_name ON employees (name);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  category TEXT DEFAULT 'mobile' NOT NULL,
  os_version TEXT,
  gpu TEXT,
  soc TEXT,
  tier TEXT NOT NULL,
  quantity INTEGER DEFAULT 1 NOT NULL,
  asset_code TEXT,
  comment TEXT,
  photo_key TEXT,
  active INTEGER DEFAULT 1 NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_asset_code ON devices (asset_code);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  checked_out_at TEXT NOT NULL,
  returned_at TEXT,
  checkout_comment TEXT
);
CREATE INDEX IF NOT EXISTS idx_loans_employee_id ON loans (employee_id);
CREATE INDEX IF NOT EXISTS idx_loans_device_id ON loans (device_id);

${insertStatements("employees", ["id", "name", "active", "created_at"], employees)}

${insertStatements("devices", ["id", "name", "model", "category", "os_version", "gpu", "soc", "tier", "quantity", "asset_code", "comment", "photo_key", "active", "created_at"], devices)}

${insertStatements("loans", ["id", "device_id", "employee_id", "checked_out_at", "returned_at", "checkout_comment"], loans)}

COMMIT;
PRAGMA foreign_keys=ON;
`;
}

function createReadme(generatedAt: string) {
  return `TEST DEVICES — FULL BACKUP

Created: ${generatedAt}
Format version: 3

CONTENTS
- manifest.json: backup version, counts, and photo metadata.
- inventory-backup.json: complete structured copy of all database rows.
- database.sql: SQLite-compatible schema and data import script.
- photos/: all image objects currently stored by the application.

IMPORTANT
- The backup includes active and removed employees/devices, the complete checkout and return history including checkout comments, and photos.
- Keep this archive private because it can contain employee names and operational history.
- ZIP integrity checksums are included for every file.

RESTORE OVERVIEW
1. Create the destination database.
2. Import database.sql, or use inventory-backup.json when migrating to a non-SQLite database.
3. Upload every file from photos/ to the destination object storage without changing its filename.
4. Configure the application to use the new database and object storage.
5. Verify the record counts in manifest.json before switching users to the new site.

The exact deployment commands depend on the destination hosting provider.
`;
}

function createZipStream(files: AsyncGenerator<BackupFile>) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const centralEntries: CentralEntry[] = [];
      let offset = 0;
      let fileCount = 0;
      try {
        for await (const file of files) {
          const name = encoder.encode(file.name);
          if (name.length > 0xffff || file.data.length > 0xffffffff || fileCount >= 0xffff) {
            throw new Error("BACKUP_TOO_LARGE");
          }
          const checksum = crc32(file.data);
          const { date, time } = zipDateTime(new Date());
          const header = new Uint8Array([
            ...uint32(0x04034b50), ...uint16(20), ...uint16(0x0800), ...uint16(0),
            ...uint16(time), ...uint16(date), ...uint32(checksum), ...uint32(file.data.length),
            ...uint32(file.data.length), ...uint16(name.length), ...uint16(0),
          ]);
          centralEntries.push({ name, checksum, size: file.data.length, offset, time, date });
          controller.enqueue(header);
          controller.enqueue(name);
          controller.enqueue(file.data);
          offset += header.length + name.length + file.data.length;
          fileCount += 1;
        }

        const centralStart = offset;
        for (const entry of centralEntries) {
          const header = new Uint8Array([
            ...uint32(0x02014b50), ...uint16(20), ...uint16(20), ...uint16(0x0800), ...uint16(0),
            ...uint16(entry.time), ...uint16(entry.date), ...uint32(entry.checksum),
            ...uint32(entry.size), ...uint32(entry.size), ...uint16(entry.name.length), ...uint16(0),
            ...uint16(0), ...uint16(0), ...uint16(0), ...uint32(0), ...uint32(entry.offset),
          ]);
          controller.enqueue(header);
          controller.enqueue(entry.name);
          offset += header.length + entry.name.length;
        }
        const centralSize = offset - centralStart;
        controller.enqueue(new Uint8Array([
          ...uint32(0x06054b50), ...uint16(0), ...uint16(0), ...uint16(fileCount),
          ...uint16(fileCount), ...uint32(centralSize), ...uint32(centralStart), ...uint16(0),
        ]));
        controller.close();
      } catch (error) {
        console.error("backup_stream_failed", error);
        controller.error(error);
      }
    },
  });
}

async function listPhotoObjects(bucket: R2Bucket) {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function GET() {
  try {
    const db = getD1();
    const bucket = getR2();
    const [employeesResult, devicesResult, loansResult, photoObjects] = await Promise.all([
      db.prepare("SELECT id, name, active, created_at FROM employees ORDER BY id").all(),
      db.prepare("SELECT id, name, model, category, os_version, gpu, soc, tier, quantity, asset_code, comment, photo_key, active, created_at FROM devices ORDER BY id").all(),
      db.prepare("SELECT id, device_id, employee_id, checked_out_at, returned_at, checkout_comment FROM loans ORDER BY id").all(),
      listPhotoObjects(bucket),
    ]);

    const employees = employeesResult.results as unknown as DatabaseRow[];
    const devices = devicesResult.results as unknown as DatabaseRow[];
    const loans = loansResult.results as unknown as DatabaseRow[];
    const generatedAt = new Date().toISOString();
    const photoMetadata = photoObjects.map((photo) => ({
      key: photo.key,
      size: photo.size,
      uploadedAt: photo.uploaded.toISOString(),
      etag: photo.httpEtag,
    }));
    const manifest = {
      format: "test-devices-full-backup",
      version: 3,
      generatedAt,
      counts: {
        employees: employees.length,
        devices: devices.length,
        loans: loans.length,
        photos: photoObjects.length,
      },
      photos: photoMetadata,
    };
    const inventory = {
      format: manifest.format,
      version: manifest.version,
      generatedAt,
      tables: { employees, devices, loans },
    };

    async function* backupFiles(): AsyncGenerator<BackupFile> {
      yield textFile("README.txt", createReadme(generatedAt));
      yield textFile("manifest.json", JSON.stringify(manifest, null, 2));
      yield textFile("inventory-backup.json", JSON.stringify(inventory, null, 2));
      yield textFile("database.sql", createSqlDump(employees, devices, loans));
      for (const photo of photoObjects) {
        const object = await bucket.get(photo.key);
        if (!object) throw new Error(`PHOTO_NOT_FOUND:${photo.key}`);
        yield { name: `photos/${photo.key}`, data: new Uint8Array(await object.arrayBuffer()) };
      }
    }

    const date = generatedAt.slice(0, 10);
    return new Response(createZipStream(backupFiles()), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="device-inventory-full-backup-${date}.zip"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("backup_create_failed", error);
    return NextResponse.json({ error: "Could not create the full backup" }, { status: 500 });
  }
}
