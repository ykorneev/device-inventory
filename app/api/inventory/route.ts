import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getD1, getR2 } from "@/db";

export const dynamic = "force-dynamic";

const addEmployeeSchema = z.object({
  action: z.literal("addEmployee"),
  name: z.string().trim().min(2).max(80),
});

const checkoutSchema = z.object({
  action: z.literal("checkout"),
  deviceId: z.number().int().positive(),
  employeeId: z.number().int().positive(),
});

const returnSchema = z.object({
  action: z.literal("return"),
  loanId: z.number().int().positive(),
});

const deleteDeviceSchema = z.object({
  action: z.literal("deleteDevice"),
  deviceId: z.number().int().positive(),
});

const deleteEmployeeSchema = z.object({
  action: z.literal("deleteEmployee"),
  employeeId: z.number().int().positive(),
});

const actionSchema = z.discriminatedUnion("action", [
  addEmployeeSchema,
  checkoutSchema,
  returnSchema,
  deleteDeviceSchema,
  deleteEmployeeSchema,
]);

const addDeviceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  model: z.string().trim().min(1).max(100),
  osVersion: z.string().trim().max(100).optional(),
  gpu: z.string().trim().max(120).optional(),
  soc: z.string().trim().max(120).optional(),
  tier: z.enum(["Лоу", "Медиум", "Хай"]),
  quantity: z.coerce.number().int().min(1).max(100),
  assetCode: z.string().trim().max(60).optional(),
  comment: z.string().trim().max(300).optional(),
});

type ActiveLoan = {
  id: number;
  deviceId: number;
  employeeId: number;
  employeeName: string;
  checkedOutAt: string;
};

async function readInventory() {
  const db = getD1();
  const [devicesResult, activeLoansResult, employeesResult, historyResult] = await Promise.all([
    db.prepare(`
      SELECT
        id,
        name,
        model,
        os_version AS osVersion,
        gpu,
        soc,
        tier,
        quantity,
        asset_code AS assetCode,
        comment,
        photo_key AS photoKey
      FROM devices
      WHERE active = 1
      ORDER BY name, model
    `).all(),
    db.prepare(`
      SELECT
        l.id,
        l.device_id AS deviceId,
        e.id AS employeeId,
        e.name AS employeeName,
        l.checked_out_at AS checkedOutAt
      FROM loans l
      JOIN employees e ON e.id = l.employee_id
      WHERE l.returned_at IS NULL
      ORDER BY l.checked_out_at
    `).all(),
    db.prepare(`
      SELECT id, name
      FROM employees
      WHERE active = 1
      ORDER BY name
    `).all(),
    db.prepare(`
      SELECT
        l.id,
        d.name AS deviceName,
        d.model AS deviceModel,
        d.asset_code AS assetCode,
        e.name AS employeeName,
        l.checked_out_at AS checkedOutAt,
        l.returned_at AS returnedAt
      FROM loans l
      JOIN devices d ON d.id = l.device_id
      JOIN employees e ON e.id = l.employee_id
      ORDER BY l.checked_out_at DESC
      LIMIT 100
    `).all(),
  ]);

  const activeLoans = activeLoansResult.results as unknown as ActiveLoan[];
  const devices = devicesResult.results.map((row) => {
    const device = row as Record<string, unknown>;
    const photoKey = typeof device.photoKey === "string" ? device.photoKey : null;
    return {
      ...device,
      photoUrl: photoKey ? `/api/photo?key=${encodeURIComponent(photoKey)}` : null,
      loans: activeLoans.filter((loan) => loan.deviceId === device.id),
    };
  });

  return {
    devices,
    employees: employeesResult.results,
    history: historyResult.results,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await readInventory());
  } catch (error) {
    console.error("inventory_read_failed", error);
    return NextResponse.json(
      { error: "Could not load the device list" },
      { status: 503 },
    );
  }
}

function parseDeviceForm(formData: FormData) {
  const parsed = addDeviceSchema.safeParse({
    name: formData.get("name"),
    model: formData.get("model"),
    osVersion: formData.get("osVersion") || undefined,
    gpu: formData.get("gpu") || undefined,
    soc: formData.get("soc") || undefined,
    tier: formData.get("tier"),
    quantity: formData.get("quantity"),
    assetCode: formData.get("assetCode") || undefined,
    comment: formData.get("comment") || undefined,
  });
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

async function uploadPhoto(photo: FormDataEntryValue | null) {
  if (!(photo instanceof File) || photo.size === 0) return null;

  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(photo.type)) {
    throw new Error("INVALID_PHOTO_TYPE");
  }
  if (photo.size > 5 * 1024 * 1024) throw new Error("PHOTO_TOO_LARGE");

  const extension = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
  const photoKey = `${crypto.randomUUID()}.${extension}`;
  await getR2().put(photoKey, await photo.arrayBuffer(), {
    httpMetadata: { contentType: photo.type },
  });
  return photoKey;
}

async function addDevice(formData: FormData) {
  const input = parseDeviceForm(formData);
  if (!input) {
    return NextResponse.json({ error: "Please check the completed fields" }, { status: 400 });
  }

  const photoKey = await uploadPhoto(formData.get("photo"));

  try {
    await getD1()
      .prepare(`
        INSERT INTO devices (
          name, model, os_version, gpu, soc, tier, quantity, asset_code, comment, photo_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        input.name,
        input.model,
        input.osVersion || null,
        input.gpu || null,
        input.soc || null,
        input.tier,
        input.quantity,
        input.assetCode || null,
        input.comment || null,
        photoKey,
      )
      .run();
    return NextResponse.json(await readInventory());
  } catch (error) {
    if (photoKey) {
      await getR2().delete(photoKey).catch(() => undefined);
    }
    throw error;
  }
}

async function updateDevice(formData: FormData) {
  const input = parseDeviceForm(formData);
  const deviceId = Number(formData.get("deviceId"));
  if (!input || !Number.isInteger(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "Please check the completed fields" }, { status: 400 });
  }

  const db = getD1();
  const existing = await db
    .prepare("SELECT photo_key AS photoKey FROM devices WHERE id = ? AND active = 1")
    .bind(deviceId)
    .first<{ photoKey: string | null }>();
  if (!existing) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const newPhotoKey = await uploadPhoto(formData.get("photo"));
  try {
    const result = await db
      .prepare(`
        UPDATE devices
        SET
          name = ?,
          model = ?,
          os_version = ?,
          gpu = ?,
          soc = ?,
          tier = ?,
          quantity = ?,
          asset_code = ?,
          comment = ?,
          photo_key = COALESCE(?, photo_key)
        WHERE id = ?
          AND active = 1
          AND (
            SELECT COUNT(*)
            FROM loans l
            WHERE l.device_id = devices.id AND l.returned_at IS NULL
          ) <= ?
      `)
      .bind(
        input.name,
        input.model,
        input.osVersion || null,
        input.gpu || null,
        input.soc || null,
        input.tier,
        input.quantity,
        input.assetCode || null,
        input.comment || null,
        newPhotoKey,
        deviceId,
        input.quantity,
      )
      .run();

    if (!result.meta.changes) {
      if (newPhotoKey) await getR2().delete(newPhotoKey).catch(() => undefined);
      return NextResponse.json(
        { error: "Quantity cannot be lower than the number of checked-out units" },
        { status: 409 },
      );
    }

    if (newPhotoKey && existing.photoKey) {
      await getR2().delete(existing.photoKey).catch(() => undefined);
    }
    return NextResponse.json(await readInventory());
  } catch (error) {
    if (newPhotoKey) await getR2().delete(newPhotoKey).catch(() => undefined);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      return formData.get("action") === "updateDevice"
        ? await updateDevice(formData)
        : await addDevice(formData);
    } catch (error) {
      console.error("device_create_failed", error);
      const message = error instanceof Error ? error.message : "";
      if (message === "INVALID_PHOTO_TYPE") {
        return NextResponse.json({ error: "Only JPG, PNG, and WebP images are supported" }, { status: 400 });
      }
      if (message === "PHOTO_TOO_LARGE") {
        return NextResponse.json({ error: "The image must not exceed 5 MB" }, { status: 400 });
      }
      return NextResponse.json(
        { error: message.includes("UNIQUE") ? "This asset ID already exists" : "Could not save the device" },
        { status: message.includes("UNIQUE") ? 409 : 500 },
      );
    }
  }

  let input: z.infer<typeof actionSchema>;
  try {
    input = actionSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Please check the completed fields" }, { status: 400 });
  }

  const db = getD1();
  const now = new Date().toISOString();

  try {
    if (input.action === "addEmployee") {
      const result = await db
        .prepare(`
          INSERT INTO employees (name, active)
          VALUES (?, 1)
          ON CONFLICT(name) DO UPDATE SET active = 1
          WHERE employees.active = 0
        `)
        .bind(input.name)
        .run();
      if (!result.meta.changes) {
        return NextResponse.json({ error: "This employee is already in the list" }, { status: 409 });
      }
    }

    if (input.action === "checkout") {
      const result = await db
        .prepare(`
          INSERT INTO loans (device_id, employee_id, checked_out_at)
          SELECT d.id, ?, ?
          FROM devices d
          WHERE d.id = ?
            AND d.active = 1
            AND (
              SELECT COUNT(*)
              FROM loans l
              WHERE l.device_id = d.id AND l.returned_at IS NULL
            ) < d.quantity
        `)
        .bind(input.employeeId, now, input.deviceId)
        .run();
      if (!result.meta.changes) {
        return NextResponse.json(
          { error: "All units of this device are already checked out" },
          { status: 409 },
        );
      }
    }

    if (input.action === "return") {
      const result = await db
        .prepare(`
          UPDATE loans
          SET returned_at = ?
          WHERE id = ? AND returned_at IS NULL
        `)
        .bind(now, input.loanId)
        .run();
      if (!result.meta.changes) {
        return NextResponse.json(
          { error: "This unit has already been marked as returned" },
          { status: 409 },
        );
      }
    }

    if (input.action === "deleteDevice") {
      const device = await db
        .prepare("SELECT photo_key AS photoKey FROM devices WHERE id = ? AND active = 1")
        .bind(input.deviceId)
        .first<{ photoKey: string | null }>();
      if (!device) {
        return NextResponse.json({ error: "The device was deleted or could not be found" }, { status: 404 });
      }

      const result = await db
        .prepare(`
          UPDATE devices
          SET active = 0
          WHERE id = ?
            AND active = 1
            AND NOT EXISTS (
              SELECT 1
              FROM loans l
              WHERE l.device_id = devices.id AND l.returned_at IS NULL
            )
        `)
        .bind(input.deviceId)
        .run();
      if (!result.meta.changes) {
        return NextResponse.json(
          { error: "Return all units of this device before deleting it" },
          { status: 409 },
        );
      }

      if (device.photoKey) await getR2().delete(device.photoKey).catch(() => undefined);
    }

    if (input.action === "deleteEmployee") {
      const result = await db
        .prepare(`
          UPDATE employees
          SET active = 0
          WHERE id = ?
            AND active = 1
            AND NOT EXISTS (
              SELECT 1
              FROM loans l
              WHERE l.employee_id = employees.id AND l.returned_at IS NULL
            )
        `)
        .bind(input.employeeId)
        .run();
      if (!result.meta.changes) {
        const employee = await db
          .prepare("SELECT id FROM employees WHERE id = ? AND active = 1")
          .bind(input.employeeId)
          .first();
        return NextResponse.json(
          { error: employee ? "Return all devices assigned to this employee first" : "The employee was deleted or could not be found" },
          { status: employee ? 409 : 404 },
        );
      }
    }

    return NextResponse.json(await readInventory());
  } catch (error) {
    console.error("inventory_write_failed", error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) {
      return NextResponse.json({ error: "This record already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not save the changes" }, { status: 500 });
  }
}
