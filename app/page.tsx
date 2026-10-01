"use client";

import confetti from "canvas-confetti";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  Download,
  History,
  ImageIcon,
  Laptop,
  List,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";

type Loan = {
  id: number;
  deviceId: number;
  employeeId: number;
  employeeName: string;
  checkedOutAt: string;
  checkoutComment: string | null;
};

type Device = {
  id: number;
  name: string;
  model: string;
  category: "mobile" | "laptop";
  osVersion: string | null;
  gpu: string | null;
  soc: string | null;
  tier: "Лоу" | "Медиум" | "Хай";
  quantity: number;
  assetCode: string | null;
  comment: string | null;
  photoUrl: string | null;
  loans: Loan[];
};

type Employee = { id: number; name: string };
type HistoryEntry = {
  id: number;
  deviceName: string;
  deviceModel: string;
  assetCode: string | null;
  employeeName: string;
  checkedOutAt: string;
  returnedAt: string | null;
};
type InventoryState = { devices: Device[]; employees: Employee[]; history: HistoryEntry[] };
type InventoryAction =
  | { action: "checkout"; deviceId: number; employeeId: number; checkoutComment?: string }
  | { action: "return"; loanId: number }
  | { action: "addEmployee"; name: string }
  | { action: "deleteDevice"; deviceId: number }
  | { action: "deleteEmployee"; employeeId: number };

type DeviceDraft = {
  name: string;
  model: string;
  category: Device["category"];
  osVersion: string;
  gpu: string;
  soc: string;
  tier: Device["tier"];
  quantity: string;
  assetCode: string;
  comment: string;
};

const emptyDeviceDraft: DeviceDraft = {
  name: "",
  model: "",
  category: "mobile",
  osVersion: "",
  gpu: "",
  soc: "",
  tier: "Медиум",
  quantity: "1",
  assetCode: "",
  comment: "",
};

const emptyState: InventoryState = { devices: [], employees: [], history: [] };

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function tierClass(tier: Device["tier"]) {
  if (tier === "Хай") return "border-violet-200 bg-violet-50 text-violet-700";
  if (tier === "Медиум") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function tierLabel(tier: Device["tier"]) {
  if (tier === "Хай") return "High";
  if (tier === "Медиум") return "Medium";
  return "Low";
}

function escapeExcelXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

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

function createXlsxArchive(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const checksum = crc32(data);
    const localHeader = new Uint8Array([
      ...uint32(0x04034b50), ...uint16(20), ...uint16(0), ...uint16(0),
      ...uint16(0), ...uint16(0), ...uint32(checksum), ...uint32(data.length),
      ...uint32(data.length), ...uint16(name.length), ...uint16(0),
    ]);
    localParts.push(localHeader, name, data);

    const centralHeader = new Uint8Array([
      ...uint32(0x02014b50), ...uint16(20), ...uint16(20), ...uint16(0), ...uint16(0),
      ...uint16(0), ...uint16(0), ...uint32(checksum), ...uint32(data.length),
      ...uint32(data.length), ...uint16(name.length), ...uint16(0), ...uint16(0),
      ...uint16(0), ...uint16(0), ...uint32(0), ...uint32(localOffset),
    ]);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array([
    ...uint32(0x06054b50), ...uint16(0), ...uint16(0), ...uint16(files.length),
    ...uint16(files.length), ...uint32(centralSize), ...uint32(localOffset), ...uint16(0),
  ]);
  const parts = [...localParts, ...centralParts, endRecord];
  const archive = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    archive.set(part, offset);
    offset += part.length;
  }
  return new Blob([archive.buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function exportDevicesToExcel(devices: Device[]) {
  const headers = [
    "Name",
    "Model",
    "Category",
    "OS Version",
    "Tier",
    "GPU",
    "SoC",
    "Quantity",
    "Asset ID",
    "Comment",
    "Available",
    "Status",
    "Checked Out To",
  ];

  const columnName = (index: number) => String.fromCharCode(65 + index);
  const cell = (value: string | number, column: number, row: number, style: number, numeric = false) =>
    numeric
      ? `<c r="${columnName(column)}${row}" s="${style}"><v>${value}</v></c>`
      : `<c r="${columnName(column)}${row}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeExcelXml(String(value))}</t></is></c>`;

  const headerRow = `<row r="1" ht="24" customHeight="1">${headers.map((header, index) => cell(header, index, 1, 1)).join("")}</row>`;
  const dataRows = devices.map((device, deviceIndex) => {
    const row = deviceIndex + 2;
    const availableUnits = device.quantity - device.loans.length;
    const status = availableUnits > 0 ? "Available in office" : "All units checked out";
    const assignedTo = device.loans.map((loan) => loan.employeeName).join(", ");
    return `<row r="${row}">${[
      cell(device.name, 0, row, 2),
      cell(device.model, 1, row, 2),
      cell(device.osVersion || "", 2, row, 2),
      cell(tierLabel(device.tier), 3, row, 2),
      cell(device.gpu || "", 4, row, 2),
      cell(device.soc || "", 5, row, 2),
      cell(device.quantity, 6, row, 3, true),
      cell(device.assetCode || "", 7, row, 2),
      cell(device.comment || "", 8, row, 2),
      cell(availableUnits, 9, row, 3, true),
      cell(status, 10, row, 2),
      cell(assignedTo, 11, row, 2),
    ].join("")}</row>`;
  }).join("");

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/><col min="4" max="4" width="16" customWidth="1"/><col min="5" max="5" width="11" customWidth="1"/><col min="6" max="7" width="22" customWidth="1"/><col min="8" max="8" width="10" customWidth="1"/><col min="9" max="9" width="16" customWidth="1"/><col min="10" max="10" width="32" customWidth="1"/><col min="11" max="11" width="11" customWidth="1"/><col min="12" max="12" width="21" customWidth="1"/><col min="13" max="13" width="25" customWidth="1"/></cols><sheetData>${headerRow}${dataRows}</sheetData><autoFilter ref="A1:M${Math.max(1, devices.length + 1)}"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1768E4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const blob = createXlsxArchive([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Devices" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: styles },
    { name: "xl/worksheets/sheet1.xml", content: worksheet },
  ]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `device-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Home() {
  const [data, setData] = useState<InventoryState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupConfirmOpen, setBackupConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("devices");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [checkoutDevice, setCheckoutDevice] = useState<Device | null>(null);
  const [returnDevice, setReturnDevice] = useState<Device | null>(null);
  const [detailDeviceId, setDetailDeviceId] = useState<number | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<Device | null>(null);
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null);
  const [editValues, setEditValues] = useState<DeviceDraft>(emptyDeviceDraft);
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null);
  const [editPhotoInputKey, setEditPhotoInputKey] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const [checkoutComment, setCheckoutComment] = useState("");
  const [loanId, setLoanId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [deviceCategory, setDeviceCategory] = useState<Device["category"]>("mobile");
  const [osVersion, setOsVersion] = useState("");
  const [gpu, setGpu] = useState("");
  const [soc, setSoc] = useState("");
  const [deviceTier, setDeviceTier] = useState<Device["tier"]>("Медиум");
  const [quantity, setQuantity] = useState("1");
  const [assetCode, setAssetCode] = useState("");
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoInputKey, setPhotoInputKey] = useState(0);

  const fetchState = useCallback(async () => {
    const response = await fetch("/api/inventory", { cache: "no-store" });
    const body = (await response.json()) as InventoryState & { error?: string };
    if (!response.ok) throw new Error(body.error || "Could not load the data");
    setData(body);
    setError(null);
    return body;
  }, []);

  const sendAction = useCallback(async (action: InventoryAction) => {
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    const body = (await response.json()) as InventoryState & { error?: string };
    if (!response.ok) throw new Error(body.error || "Could not save the changes");
    setData(body);
    setError(null);
    return body;
  }, []);

  useEffect(() => {
    fetchState()
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, [fetchState]);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const preview = URL.createObjectURL(photo);
    setPhotoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [photo]);

  useEffect(() => {
    if (!editPhoto) {
      setEditPhotoPreview(editingDevice?.photoUrl || null);
      return;
    }
    const preview = URL.createObjectURL(editPhoto);
    setEditPhotoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [editPhoto, editingDevice]);

  useEffect(() => {
    type WebMcpContext = {
      registerTool: (
        tool: {
          name: string;
          title: string;
          description: string;
          inputSchema: Record<string, unknown>;
          annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
          execute: (input: unknown) => Promise<unknown>;
        },
        options?: { signal: AbortSignal },
      ) => void | Promise<void>;
    };
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<WebMcpContext["registerTool"]>[0]) => {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(
        () => undefined,
      );
    };
    register({
      name: "get_device_inventory",
      title: "Show device inventory",
      description: "Returns device availability, active checkouts, and history.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => fetchState(),
    });
    register({
      name: "checkout_device",
      title: "Check out a device",
      description: "Assigns one available unit to the selected employee.",
      inputSchema: {
        type: "object",
        properties: {
          deviceId: { type: "number" },
          employeeId: { type: "number" },
          checkoutComment: { type: "string", maxLength: 500 },
        },
        required: ["deviceId", "employeeId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        const value = input as {
          deviceId?: unknown;
          employeeId?: unknown;
          checkoutComment?: unknown;
        };
        if (typeof value.deviceId !== "number" || typeof value.employeeId !== "number") {
          throw new Error("deviceId and employeeId must be numbers");
        }
        if (value.checkoutComment !== undefined && typeof value.checkoutComment !== "string") {
          throw new Error("checkoutComment must be a string");
        }
        return sendAction({
          action: "checkout",
          deviceId: value.deviceId,
          employeeId: value.employeeId,
          checkoutComment: typeof value.checkoutComment === "string"
            ? value.checkoutComment.trim() || undefined
            : undefined,
        });
      },
    });
    register({
      name: "return_device",
      title: "Return a device unit",
      description: "Closes a specific active checkout by its loanId.",
      inputSchema: {
        type: "object",
        properties: { loanId: { type: "number" } },
        required: ["loanId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        const value = input as { loanId?: unknown };
        if (typeof value.loanId !== "number") throw new Error("loanId must be a number");
        return sendAction({ action: "return", loanId: value.loanId });
      },
    });
    return () => lifecycle.abort();
  }, [fetchState, sendAction]);

  const filteredDevices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.devices.filter((device) => {
      const available = device.quantity - device.loans.length;
      const matchesSearch =
        !query ||
        [
          device.name,
          device.model,
          device.osVersion,
          device.gpu,
          device.soc,
          device.assetCode,
          ...device.loans.flatMap((loan) => [loan.employeeName, loan.checkoutComment]),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "available" && available > 0) ||
        (statusFilter === "out" && device.loans.length > 0);
      return matchesSearch && matchesStatus;
    });
  }, [data.devices, search, statusFilter]);

  const mobileDevices = useMemo(
    () => data.devices.filter((device) => device.category === "mobile"),
    [data.devices],
  );
  const filteredLaptopDevices = useMemo(
    () => filteredDevices.filter((device) => device.category === "laptop"),
    [filteredDevices],
  );
  const hasLaptopDevices = useMemo(
    () => data.devices.some((device) => device.category === "laptop"),
    [data.devices],
  );

  const totalUnits = data.devices.reduce((sum, device) => sum + device.quantity, 0);
  const checkedOut = data.devices.reduce((sum, device) => sum + device.loans.length, 0);
  const available = totalUnits - checkedOut;
  const detailDevice = detailDeviceId
    ? data.devices.find((device) => device.id === detailDeviceId) || null
    : null;
  const deletingEmployeeLoanCount = deletingEmployee
    ? data.devices.reduce(
        (sum, device) => sum + device.loans.filter((loan) => loan.employeeId === deletingEmployee.id).length,
        0,
      )
    : 0;

  async function runAction(action: InventoryAction, successMessage: string) {
    setSaving(true);
    try {
      await sendAction(action);
      toast.success(successMessage);
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the changes");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function confirmCheckout() {
    if (!checkoutDevice || !employeeId) {
      return toast.error("Select an employee");
    }

    const ok = await runAction(
      {
        action: "checkout",
        deviceId: checkoutDevice.id,
        employeeId: Number(employeeId),
        checkoutComment: checkoutComment.trim() || undefined,
      },
      "Device checked out",
    );

    if (ok) {
      setCheckoutDevice(null);
      setEmployeeId("");
      setCheckoutComment("");
    }
  }

  function celebrateReturn() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  confetti({
    particleCount: 70,
    spread: 70,
    origin: { y: 0.65 },
  });
}

  async function confirmReturn() {
  if (!returnDevice || !loanId) return toast.error("Select an employee");

  const ok = await runAction(
    { action: "return", loanId: Number(loanId) },
    "Device returned to the office",
  );

  if (ok) {
    celebrateReturn();
    setReturnDevice(null);
    setLoanId("");
  }
}

  function openReturn(device: Device) {
    setReturnDevice(device);
    setLoanId(device.loans.length === 1 ? String(device.loans[0].id) : "");
  }

  function openEdit(device: Device) {
    setEditValues({
      name: device.name,
      model: device.model,
      category: device.category,
      osVersion: device.osVersion || "",
      gpu: device.gpu || "",
      soc: device.soc || "",
      tier: device.tier,
      quantity: String(device.quantity),
      assetCode: device.assetCode || "",
      comment: device.comment || "",
    });
    setEditPhoto(null);
    setEditPhotoInputKey((value) => value + 1);
    setDetailDeviceId(null);
    setEditingDevice(device);
  }

  function openDelete(device: Device) {
    setDetailDeviceId(null);
    setDeletingDevice(device);
  }

  async function addEmployee(event: FormEvent) {
    event.preventDefault();
    const ok = await runAction({ action: "addEmployee", name: employeeName }, "Employee added");
    if (ok) setEmployeeName("");
  }

  async function addDevice(event: FormEvent) {
    event.preventDefault();
    const form = new FormData();
    form.set("name", deviceName);
    form.set("model", deviceModel);
    form.set("category", deviceCategory);
    form.set("osVersion", osVersion);
    form.set("gpu", gpu);
    form.set("soc", soc);
    form.set("tier", deviceTier);
    form.set("quantity", quantity);
    form.set("assetCode", assetCode);
    form.set("comment", comment);
    if (photo) form.set("photo", photo);
    setSaving(true);
    try {
      const response = await fetch("/api/inventory", { method: "POST", body: form });
      const body = (await response.json()) as InventoryState & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not add the device");
      setData(body);
      setDeviceName("");
      setDeviceModel("");
      setDeviceCategory("mobile");
      setOsVersion("");
      setGpu("");
      setSoc("");
      setDeviceTier("Медиум");
      setQuantity("1");
      setAssetCode("");
      setComment("");
      setPhoto(null);
      setPhotoInputKey((value) => value + 1);
      toast.success("Device added");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not add the device");
    } finally {
      setSaving(false);
    }
  }

  async function updateDevice(event: FormEvent) {
    event.preventDefault();
    if (!editingDevice) return;
    const form = new FormData();
    form.set("action", "updateDevice");
    form.set("deviceId", String(editingDevice.id));
    form.set("name", editValues.name);
    form.set("model", editValues.model);
    form.set("category", editValues.category);
    form.set("osVersion", editValues.osVersion);
    form.set("gpu", editValues.gpu);
    form.set("soc", editValues.soc);
    form.set("tier", editValues.tier);
    form.set("quantity", editValues.quantity);
    form.set("assetCode", editValues.assetCode);
    form.set("comment", editValues.comment);
    if (editPhoto) form.set("photo", editPhoto);

    setSaving(true);
    try {
      const response = await fetch("/api/inventory", { method: "POST", body: form });
      const body = (await response.json()) as InventoryState & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not update the device");
      setData(body);
      setEditingDevice(null);
      setEditPhoto(null);
      toast.success("Device card updated");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update the device");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deletingDevice || deletingDevice.loans.length > 0) return;
    const ok = await runAction(
      { action: "deleteDevice", deviceId: deletingDevice.id },
      "Device deleted",
    );
    if (ok) setDeletingDevice(null);
  }

  async function confirmDeleteEmployee() {
    if (!deletingEmployee || deletingEmployeeLoanCount > 0) return;
    const ok = await runAction(
      { action: "deleteEmployee", employeeId: deletingEmployee.id },
      "Employee removed from the list",
    );
    if (ok) setDeletingEmployee(null);
  }

  async function downloadFullBackup() {
    setBackupLoading(true);
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Could not create the full backup");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1]
        || `device-inventory-full-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBackupConfirmOpen(false);
      toast.success("Full backup downloaded");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not create the full backup");
    } finally {
      setBackupLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f3f6fb] text-slate-950">
      <Toaster richColors position="top-right" />
      <header className="border-b border-white/10 bg-[#071a33] text-white">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-[#2f7df4] shadow-[0_10px_30px_rgba(47,125,244,.35)]"><Laptop className="size-6" /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Office inventory</p>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Test Devices</h1>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm text-blue-100 sm:flex"><span className="size-2 rounded-full bg-emerald-400" />Internal tool</div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
        <section className="mb-5 grid grid-cols-2 gap-3 sm:mb-7 xl:grid-cols-4">
          <MetricCard icon={Boxes} label="Total units" value={totalUnits} tone="blue" />
          <MetricCard icon={CheckCircle2} label="In office" value={available} tone="green" />
          <MetricCard icon={UserRound} label="Checked out" value={checkedOut} tone="orange" />
          <MetricCard icon={Users} label="Employees" value={data.employees.length} tone="slate" />
        </section>

        {error && <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-800"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void fetchState()}>Retry</Button></div>}

        <Tabs value={tab} onValueChange={setTab} className="mx-auto w-full gap-5">
          <TabsList className="device-tabs-list mx-auto grid w-full max-w-4xl grid-cols-2 gap-1.5 rounded-2xl border border-slate-300 bg-white p-1.5 shadow-sm sm:grid-cols-5">
            <TabsTrigger value="devices" className="device-tabs-trigger min-w-0 max-w-full gap-1.5 overflow-hidden rounded-xl border border-slate-300 bg-slate-50 px-1.5 text-center text-[13px] font-semibold shadow-none data-[state=active]:border-blue-500 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-800 data-[state=active]:shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)] sm:gap-2 sm:px-3 sm:text-sm"><Laptop className="size-4" /> <span className="truncate">Checkout</span></TabsTrigger>
            <TabsTrigger value="device-list" className="device-tabs-trigger min-w-0 max-w-full gap-1.5 overflow-hidden rounded-xl border border-slate-300 bg-slate-50 px-1.5 text-center text-[13px] font-semibold shadow-none data-[state=active]:border-blue-500 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-800 data-[state=active]:shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)] sm:gap-2 sm:px-3 sm:text-sm"><List className="size-4" /> <span className="truncate">Mobile devices</span></TabsTrigger>
            <TabsTrigger value="laptops" className="device-tabs-trigger min-w-0 max-w-full gap-1.5 overflow-hidden rounded-xl border border-slate-300 bg-slate-50 px-1.5 text-center text-[13px] font-semibold shadow-none data-[state=active]:border-blue-500 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-800 data-[state=active]:shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)] sm:gap-2 sm:px-3 sm:text-sm"><Laptop className="size-4" /> <span className="truncate">Laptops</span></TabsTrigger>
            <TabsTrigger value="history" className="device-tabs-trigger min-w-0 max-w-full gap-1.5 overflow-hidden rounded-xl border border-slate-300 bg-slate-50 px-1.5 text-center text-[13px] font-semibold shadow-none data-[state=active]:border-blue-500 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-800 data-[state=active]:shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)] sm:gap-2 sm:px-3 sm:text-sm"><History className="size-4" /> <span className="truncate">History</span></TabsTrigger>
            <TabsTrigger value="settings" className="device-tabs-trigger min-w-0 max-w-full gap-1.5 overflow-hidden rounded-xl border border-slate-300 bg-slate-50 px-1.5 text-center text-[13px] font-semibold shadow-none data-[state=active]:border-blue-500 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-800 data-[state=active]:shadow-[inset_0_0_0_1px_rgba(37,99,235,0.12)] sm:gap-2 sm:px-3 sm:text-sm"><Settings2 className="size-4" /> <span className="truncate">Add</span></TabsTrigger>
          </TabsList>

          <TabsContent
            value="devices"
              className="min-w-0 max-w-full overflow-hidden"
>
            <Card className="min-w-0 max-w-full overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="gap-4 border-b border-slate-200 bg-white sm:flex-row sm:items-center sm:justify-between">
                <div><CardTitle className="text-xl">Device Inventory</CardTitle><p className="mt-1 text-sm text-slate-500">Availability, active checkouts, and device information.</p></div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Model, OS, asset ID, or employee" className="h-10 w-full pl-9 sm:w-80" /></div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-10 w-full bg-white sm:w-44"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="available">Available in office</SelectItem><SelectItem value="out">Checked out</SelectItem></SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? <div className="grid min-h-64 place-items-center text-slate-500"><Loader2 className="size-7 animate-spin" /></div> : filteredDevices.length ? (
                  <>
                    <div className="grid min-w-0 max-w-full gap-3 overflow-hidden bg-slate-50 p-3 md:hidden">
                      {filteredDevices.map((device) => (
                        <MobileDeviceCard
                          key={device.id}
                          device={device}
                          employeesAvailable={Boolean(data.employees.length)}
                          onOpen={() => setDetailDeviceId(device.id)}
                          onCheckout={() => setCheckoutDevice(device)}
                          onReturn={() => openReturn(device)}
                        />
                      ))}
                    </div>
                    <div className="hidden md:block">
                  <Table>
                    <TableHeader className="bg-slate-50"><TableRow><TableHead className="px-5 text-center">Device</TableHead><TableHead className="text-center">Tier</TableHead><TableHead className="text-center">Stock</TableHead><TableHead className="text-center">Assigned to</TableHead><TableHead className="px-5 text-center">Action</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {filteredDevices.map((device) => {
                        const free = device.quantity - device.loans.length;
                        return (
                          <TableRow key={device.id} className="bg-white">
                            <TableCell className="px-5 py-4">
                              <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
                                <button
                                  type="button"
                                  onClick={() => setDetailDeviceId(device.id)}
                                  className="group flex min-w-72 flex-1 items-center gap-3 text-left"
                                  aria-label={`Open ${device.name} ${device.model} details`}
                                >
                                  <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-400 transition group-hover:border-blue-400 group-hover:ring-2 group-hover:ring-blue-100">
                                    {device.photoUrl ? (
                                      <img src={device.photoUrl} alt={device.name} className="h-full w-full object-cover" />
                                    ) : (
                                      <Laptop className="size-6" />
                                    )}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block font-semibold text-slate-900 transition group-hover:text-blue-700 group-hover:underline">{device.name}</span>
                                    <span className="mt-0.5 block text-sm text-slate-500 transition group-hover:text-blue-600">
                                      {device.model}{device.osVersion ? ` · ${device.osVersion}` : ""}{device.assetCode ? ` · ${device.assetCode}` : ""}
                                    </span>
                                    {device.comment && <span className="mt-1 block max-w-md whitespace-normal text-xs text-slate-400">{device.comment}</span>}
                                  </span>
                                </button>
                                <CheckoutCommentList loans={device.loans} className="w-full xl:max-w-72" />
                              </div>
                            </TableCell>
                            <TableCell className="text-center"><Badge variant="outline" className={tierClass(device.tier)}>{tierLabel(device.tier)}</Badge></TableCell>
                            <TableCell className="text-center">
                              <div className="font-semibold text-slate-800">{free} of {device.quantity}</div>
                              <div className="mx-auto mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${device.quantity ? (free / device.quantity) * 100 : 0}%` }} /></div>
                            </TableCell>
                            <TableCell className="text-center">
                              {device.loans.length ? <div className="space-y-1.5">{device.loans.map((loan) => <div key={loan.id}><div className="font-medium text-slate-700">{loan.employeeName}</div><div className="text-xs text-slate-400">since {formatDate(loan.checkedOutAt)}</div></div>)}</div> : <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"><CheckCircle2 /> All in office</Badge>}
                            </TableCell>
                            <TableCell className="px-5 text-center">
                              <div className="flex justify-center gap-2">
                                {device.loans.length > 0 && <Button variant="outline" size="sm" onClick={() => openReturn(device)}><RotateCcw /> Return</Button>}
                                {free > 0 && <Button size="sm" className="bg-[#1768e4] hover:bg-[#1058c8]" disabled={!data.employees.length} onClick={() => setCheckoutDevice(device)}><PackageCheck /> Check out</Button>}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                    </div>
                  </>
                ) : <EmptyState hasDevices={Boolean(data.devices.length)} onOpenSettings={() => setTab("settings")} />}
                {!loading && (
                  <div className="flex flex-col justify-center gap-2 border-t border-slate-200 bg-white p-4 sm:flex-row sm:justify-end sm:px-5">
                    {data.devices.length > 0 && <Button type="button" variant="outline" className="w-full bg-white sm:w-auto" onClick={() => { exportDevicesToExcel(data.devices); toast.success("Excel file exported"); }}><Download /> Export</Button>}
                    <Button type="button" className="w-full bg-[#071a33] text-white hover:bg-[#102b4d] sm:w-auto" onClick={() => setBackupConfirmOpen(true)}><Download /> Full backup</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="device-list">
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-200 bg-white">
                <CardTitle className="text-xl">Mobile devices</CardTitle>
                <p className="text-sm text-slate-500">All mobile device cards with complete device information.</p>
              </CardHeader>
              <CardContent className="bg-slate-50 p-3 sm:p-5">
                {loading ? (
                  <div className="grid min-h-64 place-items-center text-slate-500"><Loader2 className="size-7 animate-spin" /></div>
                ) : mobileDevices.length ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {mobileDevices.map((device) => (
                      <FullDeviceCard
                        key={device.id}
                        device={device}
                        onEdit={() => openEdit(device)}
                        onDelete={() => openDelete(device)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState hasDevices={false} onOpenSettings={() => setTab("settings")} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="laptops">
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="gap-4 border-b border-slate-200 bg-white sm:flex-row sm:items-center sm:justify-between">
                <div><CardTitle className="text-xl">Laptops</CardTitle><p className="mt-1 text-sm text-slate-500">Laptop availability, active checkouts, and device information.</p></div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Model, OS, asset ID, or employee" className="h-10 w-full pl-9 sm:w-80" /></div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-10 w-full bg-white sm:w-44"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="available">Available in office</SelectItem><SelectItem value="out">Checked out</SelectItem></SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? <div className="grid min-h-64 place-items-center text-slate-500"><Loader2 className="size-7 animate-spin" /></div> : filteredLaptopDevices.length ? (
                  <>
                    <div className="grid min-w-0 max-w-full gap-3 overflow-hidden bg-slate-50 p-3 md:hidden">
                      {filteredLaptopDevices.map((device) => (
                        <MobileDeviceCard
                          key={device.id}
                          device={device}
                          employeesAvailable={Boolean(data.employees.length)}
                          onOpen={() => setDetailDeviceId(device.id)}
                          onCheckout={() => setCheckoutDevice(device)}
                          onReturn={() => openReturn(device)}
                        />
                      ))}
                    </div>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader className="bg-slate-50"><TableRow><TableHead className="px-5 text-center">Device</TableHead><TableHead className="text-center">Tier</TableHead><TableHead className="text-center">Stock</TableHead><TableHead className="text-center">Assigned to</TableHead><TableHead className="px-5 text-center">Action</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {filteredLaptopDevices.map((device) => {
                            const free = device.quantity - device.loans.length;
                            return (
                              <TableRow key={device.id} className="bg-white">
                                <TableCell className="px-5 py-4">
                                  <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
                                    <button
                                      type="button"
                                      onClick={() => setDetailDeviceId(device.id)}
                                      className="group flex min-w-72 flex-1 items-center gap-3 text-left"
                                      aria-label={`Open ${device.name} ${device.model} details`}
                                    >
                                      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-400 transition group-hover:border-blue-400 group-hover:ring-2 group-hover:ring-blue-100">
                                        {device.photoUrl ? (
                                          <img src={device.photoUrl} alt={device.name} className="h-full w-full object-cover" />
                                        ) : (
                                          <Laptop className="size-6" />
                                        )}
                                      </span>
                                      <span className="min-w-0">
                                        <span className="block font-semibold text-slate-900 transition group-hover:text-blue-700 group-hover:underline">{device.name}</span>
                                        <span className="mt-0.5 block text-sm text-slate-500 transition group-hover:text-blue-600">
                                          {device.model}{device.osVersion ? ` · ${device.osVersion}` : ""}{device.assetCode ? ` · ${device.assetCode}` : ""}
                                        </span>
                                        {device.comment && <span className="mt-1 block max-w-md whitespace-normal text-xs text-slate-400">{device.comment}</span>}
                                      </span>
                                    </button>
                                    <CheckoutCommentList loans={device.loans} className="w-full xl:max-w-72" />
                                  </div>
                                </TableCell>
                                <TableCell className="text-center"><Badge variant="outline" className={tierClass(device.tier)}>{tierLabel(device.tier)}</Badge></TableCell>
                                <TableCell className="text-center">
                                  <div className="font-semibold text-slate-800">{free} of {device.quantity}</div>
                                  <div className="mx-auto mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${device.quantity ? (free / device.quantity) * 100 : 0}%` }} /></div>
                                </TableCell>
                                <TableCell className="text-center">
                                  {device.loans.length ? <div className="space-y-1.5">{device.loans.map((loan) => <div key={loan.id}><div className="font-medium text-slate-700">{loan.employeeName}</div><div className="text-xs text-slate-400">since {formatDate(loan.checkedOutAt)}</div></div>)}</div> : <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"><CheckCircle2 /> All in office</Badge>}
                                </TableCell>
                                <TableCell className="px-5 text-center">
                                  <div className="flex justify-center gap-2">
                                    {device.loans.length > 0 && <Button variant="outline" size="sm" onClick={() => openReturn(device)}><RotateCcw /> Return</Button>}
                                    {free > 0 && <Button size="sm" className="bg-[#1768e4] hover:bg-[#1058c8]" disabled={!data.employees.length} onClick={() => setCheckoutDevice(device)}><PackageCheck /> Check out</Button>}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                ) : <EmptyState hasDevices={hasLaptopDevices} onOpenSettings={() => setTab("settings")} />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-200 bg-white"><CardTitle className="text-xl">Checkout and Return History</CardTitle><p className="text-sm text-slate-500">The latest 100 device transactions.</p></CardHeader>
              <CardContent className="p-0">
                {data.history.length ? <>
                  <div className="grid min-w-0 max-w-full gap-3 overflow-hidden bg-slate-50 p-3 md:hidden">
                    {data.history.map((entry) => <MobileHistoryCard key={entry.id} entry={entry} />)}
                  </div>
                  <div className="hidden md:block"><Table><TableHeader className="bg-slate-50"><TableRow><TableHead className="px-5">Device</TableHead><TableHead>Employee</TableHead><TableHead>Checked out</TableHead><TableHead>Returned</TableHead><TableHead className="px-5">Status</TableHead></TableRow></TableHeader><TableBody>{data.history.map((entry) => <TableRow key={entry.id} className="bg-white"><TableCell className="px-5 py-4"><div className="font-semibold">{entry.deviceName}</div><div className="text-sm text-slate-500">{entry.deviceModel}{entry.assetCode ? ` · ${entry.assetCode}` : ""}</div></TableCell><TableCell className="font-medium">{entry.employeeName}</TableCell><TableCell className="text-slate-500">{formatDate(entry.checkedOutAt)}</TableCell><TableCell className="text-slate-500">{formatDate(entry.returnedAt)}</TableCell><TableCell className="px-5"><Badge variant="outline" className={entry.returnedAt ? "border-slate-200 bg-slate-50 text-slate-600" : "border-orange-200 bg-orange-50 text-orange-700"}>{entry.returnedAt ? "Returned" : "Checked out"}</Badge></TableCell></TableRow>)}</TableBody></Table></div>
                </> : <div className="grid min-h-64 place-items-center px-6 text-center text-slate-500">History will appear after the first device checkout.</div>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
              <Card className="border-slate-200 shadow-sm">
                <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Plus className="size-5 text-blue-600" /> Add Device</CardTitle><p className="text-sm text-slate-500">For identical devices, enter the total number of units.</p></CardHeader>
                <CardContent>
                  <form onSubmit={addDevice} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Device type"><Select value={deviceCategory} onValueChange={(value) => setDeviceCategory(value as Device["category"])}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="mobile">Mobile</SelectItem><SelectItem value="laptop">Laptop</SelectItem></SelectContent></Select></Field>
                    <Field label="Name"><Input required minLength={2} value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="For example, iPhone" /></Field>
                    <Field label="Model"><Input required value={deviceModel} onChange={(event) => setDeviceModel(event.target.value)} placeholder="For example, 15 Pro" /></Field>
                    <Field label="OS version"><Input value={osVersion} onChange={(event) => setOsVersion(event.target.value)} placeholder="For example, iOS 18.2" /></Field>
                    <Field label="GPU"><Input value={gpu} onChange={(event) => setGpu(event.target.value)} placeholder="For example, Apple 6-core GPU" /></Field>
                    <Field label="SoC"><Input value={soc} onChange={(event) => setSoc(event.target.value)} placeholder="For example, Apple A17 Pro" /></Field>
                    <Field label="Tier"><Select value={deviceTier} onValueChange={(value) => setDeviceTier(value as Device["tier"])}><SelectTrigger className="w-full bg-white"><SelectValue>{tierLabel(deviceTier)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="Лоу">Low</SelectItem><SelectItem value="Медиум">Medium</SelectItem><SelectItem value="Хай">High</SelectItem></SelectContent></Select></Field>
                    <Field label="Quantity"><Input required type="number" min={1} max={100} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
                    <Field label="Asset ID"><Input value={assetCode} onChange={(event) => setAssetCode(event.target.value)} placeholder="Optional" /></Field>
                    <div className="sm:col-span-2 lg:col-span-3"><Field label="Comment"><Input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Accessories, condition, or an important note" /></Field></div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="grid gap-1.5 text-sm font-medium text-slate-700">Device photo
                        <span className="flex min-h-28 cursor-pointer flex-col items-start gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-blue-400 hover:bg-blue-50/50 sm:flex-row sm:items-center">
                          <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-400">{photoPreview ? <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" /> : <ImageIcon className="size-7" />}</span>
                          <span><span className="flex items-center gap-2 font-semibold text-blue-700"><Upload className="size-4" /> Choose photo</span><span className="mt-1 block text-xs font-normal text-slate-500">JPG, PNG, or WebP up to 5 MB</span>{photo && <span className="mt-1 block max-w-xs truncate text-xs font-normal text-slate-700">{photo.name}</span>}</span>
                          <input key={photoInputKey} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setPhoto(event.target.files?.[0] || null)} />
                        </span>
                      </label>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3"><Button disabled={saving} type="submit" className="w-full bg-[#1768e4] hover:bg-[#1058c8] sm:w-auto">{saving ? <Loader2 className="animate-spin" /> : <Plus />}Add device</Button></div>
                  </form>
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Users className="size-5 text-blue-600" /> Employees</CardTitle></CardHeader>
                <CardContent className="space-y-5">
                  <form onSubmit={addEmployee} className="flex gap-2"><Input required minLength={2} value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} placeholder="First and last name" /><Button disabled={saving} type="submit" aria-label="Add employee">{saving ? <Loader2 className="animate-spin" /> : <Plus />}</Button></form>
                  {data.employees.length ? (
                    <div className="grid max-h-[27.5rem] gap-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]" aria-label="Employee list">
                      {data.employees.map((employee) => {
                        const activeLoans = data.devices.reduce(
                          (sum, device) => sum + device.loans.filter((loan) => loan.employeeId === employee.id).length,
                          0,
                        );
                        return (
                          <div key={employee.id} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-slate-500 shadow-sm"><UserRound className="size-4" /></span>
                              <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{employee.name}</p>{activeLoans > 0 && <p className="text-xs text-orange-700">Checked out: {activeLoans}</p>}</div>
                            </div>
                            <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 text-slate-400 hover:bg-red-50 hover:text-red-700" aria-label={`Delete employee ${employee.name}`} title="Delete employee" onClick={() => setDeletingEmployee(employee)}><Trash2 /></Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="text-sm text-slate-500">Add employees so they can select their name when checking out a device.</p>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={Boolean(detailDevice)} onOpenChange={(open) => !open && setDetailDeviceId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Device Details</DialogTitle>
            <DialogDescription>Detailed information about the selected device.</DialogDescription>
          </DialogHeader>
          {detailDevice && (
            <>
              <div className="grid aspect-[16/9] w-full place-items-center overflow-hidden rounded-t-lg bg-slate-100 text-slate-400">
                {detailDevice.photoUrl ? (
                  <img src={detailDevice.photoUrl} alt={detailDevice.name} className="h-full w-full object-contain" />
                ) : (
                  <div className="grid justify-items-center gap-2"><ImageIcon className="size-14" /><span className="text-sm">No photo added</span></div>
                )}
              </div>
              <div className="p-5 sm:p-6">
                <dl className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <DetailRow label="Name">{detailDevice.name}</DetailRow>
                  <DetailRow label="Model">{detailDevice.model}</DetailRow>
                  <DetailRow label="Tier"><Badge variant="outline" className={tierClass(detailDevice.tier)}>{tierLabel(detailDevice.tier)}</Badge></DetailRow>
                  <DetailRow label="OS version">{detailDevice.osVersion || "Not specified"}</DetailRow>
                  <DetailRow label="Device type">{detailDevice.category === "laptop" ? "Laptop" : "Mobile"}</DetailRow>
                  <DetailRow label="GPU">{detailDevice.gpu || "Not specified"}</DetailRow>
                  <DetailRow label="SoC">{detailDevice.soc || "Not specified"}</DetailRow>
                  <DetailRow label="Status">
                    <div>
                      <Badge className={detailDevice.quantity - detailDevice.loans.length > 0 ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50"}>
                        {detailDevice.quantity - detailDevice.loans.length > 0 ? `${detailDevice.quantity - detailDevice.loans.length} of ${detailDevice.quantity} in office` : `All ${detailDevice.quantity} checked out`}
                      </Badge>
                      {detailDevice.loans.length > 0 && <p className="mt-2 text-sm text-slate-500">Checked out to: {detailDevice.loans.map((loan) => loan.employeeName).join(", ")}</p>}
                    </div>
                  </DetailRow>
                  {detailDevice.assetCode && <DetailRow label="Asset ID">{detailDevice.assetCode}</DetailRow>}
                  {detailDevice.comment && <DetailRow label="Comment">{detailDevice.comment}</DetailRow>}
                </dl>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => openEdit(detailDevice)}><Pencil /> Edit</Button>
                  <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => openDelete(detailDevice)}><Trash2 /> Delete</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingDevice)} onOpenChange={(open) => { if (!open && !saving) { setEditingDevice(null); setEditPhoto(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Device</DialogTitle>
            <DialogDescription>Update the device information and save the card.</DialogDescription>
          </DialogHeader>
          <form onSubmit={updateDevice} className="grid gap-4 sm:grid-cols-2">
            <Field label="Device type"><Select value={editValues.category} onValueChange={(category) => setEditValues((value) => ({ ...value, category: category as Device["category"] }))}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="mobile">Mobile</SelectItem><SelectItem value="laptop">Laptop</SelectItem></SelectContent></Select></Field>
            <Field label="Name"><Input required minLength={2} value={editValues.name} onChange={(event) => setEditValues((value) => ({ ...value, name: event.target.value }))} /></Field>
            <Field label="Model"><Input required value={editValues.model} onChange={(event) => setEditValues((value) => ({ ...value, model: event.target.value }))} /></Field>
            <Field label="OS version"><Input value={editValues.osVersion} onChange={(event) => setEditValues((value) => ({ ...value, osVersion: event.target.value }))} /></Field>
            <Field label="GPU"><Input value={editValues.gpu} onChange={(event) => setEditValues((value) => ({ ...value, gpu: event.target.value }))} /></Field>
            <Field label="SoC"><Input value={editValues.soc} onChange={(event) => setEditValues((value) => ({ ...value, soc: event.target.value }))} /></Field>
            <Field label="Tier"><Select value={editValues.tier} onValueChange={(tier) => setEditValues((value) => ({ ...value, tier: tier as Device["tier"] }))}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Лоу">Low</SelectItem><SelectItem value="Медиум">Medium</SelectItem><SelectItem value="Хай">High</SelectItem></SelectContent></Select></Field>
            <Field label="Quantity"><Input required type="number" min={Math.max(1, editingDevice?.loans.length || 0)} max={100} value={editValues.quantity} onChange={(event) => setEditValues((value) => ({ ...value, quantity: event.target.value }))} /></Field>
            <Field label="Asset ID"><Input value={editValues.assetCode} onChange={(event) => setEditValues((value) => ({ ...value, assetCode: event.target.value }))} placeholder="Optional" /></Field>
            <div className="sm:col-span-2"><Field label="Comment"><Textarea rows={3} value={editValues.comment} onChange={(event) => setEditValues((value) => ({ ...value, comment: event.target.value }))} placeholder="Accessories, condition, or an important note" /></Field></div>
            <div className="sm:col-span-2">
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">Photo
                <span className="flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-blue-400 hover:bg-blue-50/50">
                  <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-400">{editPhotoPreview ? <img src={editPhotoPreview} alt="Preview" className="h-full w-full object-cover" /> : <ImageIcon className="size-7" />}</span>
                  <span className="min-w-0"><span className="flex items-center gap-2 font-semibold text-blue-700"><Upload className="size-4" /> Replace photo</span><span className="mt-1 block text-xs font-normal text-slate-500">JPG, PNG, or WebP up to 5 MB</span>{editPhoto && <span className="mt-1 block max-w-xs truncate text-xs font-normal text-slate-700">{editPhoto.name}</span>}</span>
                  <input key={editPhotoInputKey} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setEditPhoto(event.target.files?.[0] || null)} />
                </span>
              </label>
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setEditingDevice(null)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-[#1768e4] hover:bg-[#1058c8]">{saving ? <Loader2 className="animate-spin" /> : <Pencil />}Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deletingDevice)} onOpenChange={(open) => { if (!open && !saving) setDeletingDevice(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deletingDevice?.loans.length ? "This checked-out device cannot be deleted" : "Delete device?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingDevice?.loans.length
                ? `Return all units of ${deletingDevice.name} ${deletingDevice.model} first.`
                : `${deletingDevice?.name || "Device"} ${deletingDevice?.model || ""} will be removed from the list. Previous checkout history will be preserved.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{deletingDevice?.loans.length ? "Got it" : "Cancel"}</AlertDialogCancel>
            {!deletingDevice?.loans.length && <AlertDialogAction variant="destructive" disabled={saving} onClick={(event) => { event.preventDefault(); void confirmDelete(); }}>{saving ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete</AlertDialogAction>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deletingEmployee)} onOpenChange={(open) => { if (!open && !saving) setDeletingEmployee(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deletingEmployeeLoanCount ? "This employee cannot be deleted" : "Delete employee?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingEmployeeLoanCount
                ? `${deletingEmployee?.name || "This employee"} has ${deletingEmployeeLoanCount} checked-out device(s). Return them first.`
                : `${deletingEmployee?.name || "The employee"} will be removed from the selection list. Previous checkout history will be preserved.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{deletingEmployeeLoanCount ? "Got it" : "Cancel"}</AlertDialogCancel>
            {!deletingEmployeeLoanCount && <AlertDialogAction variant="destructive" disabled={saving} onClick={(event) => { event.preventDefault(); void confirmDeleteEmployee(); }}>{saving ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete</AlertDialogAction>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={backupConfirmOpen} onOpenChange={(open) => { if (!backupLoading) setBackupConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Download full backup?</AlertDialogTitle>
            <AlertDialogDescription>
              The ZIP archive includes every device and employee record, the complete checkout history, removed records, and all stored photos. Keep it private.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={backupLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={backupLoading} onClick={(event) => { event.preventDefault(); void downloadFullBackup(); }}>
              {backupLoading ? <Loader2 className="animate-spin" /> : <Download />}
              {backupLoading ? "Creating backup…" : "Download backup"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

<Dialog
  open={Boolean(checkoutDevice)}
  onOpenChange={(open) => {
    if (!open) {
      setCheckoutDevice(null);
      setEmployeeId("");
      setCheckoutComment("");
    }
  }}
>
  <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md overflow-hidden p-4 sm:p-6">
    <DialogHeader className="min-w-0 text-left">
      <DialogTitle className="pr-6">
        Who is checking out this device?
      </DialogTitle>

      <DialogDescription className="min-w-0">
        <span className="block truncate">
          {checkoutDevice?.name} {checkoutDevice?.model}
        </span>
        <span className="block">
          Available:{" "}
          {checkoutDevice
            ? checkoutDevice.quantity - checkoutDevice.loans.length
            : 0}
        </span>
      </DialogDescription>
    </DialogHeader>

    <Select value={employeeId} onValueChange={setEmployeeId}>
      <SelectTrigger className="h-11 w-full min-w-0 bg-white [&>span]:min-w-0 [&>span]:truncate">
        <SelectValue placeholder="Select an employee" />
      </SelectTrigger>

      <SelectContent
        position="popper"
        className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1.5rem)] overflow-x-hidden"
      >
        {data.employees.map((employee) => (
          <SelectItem
            key={employee.id}
            value={String(employee.id)}
            className="min-w-0 max-w-full overflow-hidden"
          >
            <span className="block max-w-full truncate pr-2">
              {employee.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>

    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-slate-700">
          Comment <span className="font-normal text-slate-400">(optional)</span>
        </label>

        <span className="text-xs text-slate-400">
          {checkoutComment.length}/500
        </span>
      </div>

      <Textarea
        value={checkoutComment}
        onChange={(event) => setCheckoutComment(event.target.value)}
        maxLength={500}
        rows={4}
        placeholder="Add a comment (max 500 characters)..."
        className="min-h-24 w-full resize-none bg-white"
      />
    </div>

    <DialogFooter className="gap-2">
      <Button
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => {
          setCheckoutDevice(null);
          setEmployeeId("");
          setCheckoutComment("");
        }}
      >
        Cancel
      </Button>

      <Button
        disabled={saving || !employeeId}
        onClick={() => void confirmCheckout()}
        className="w-full bg-[#1768e4] hover:bg-[#1058c8] sm:w-auto"
      >
        {saving ? (
          <Loader2 className="animate-spin" />
        ) : (
          <PackageCheck />
        )}
        Confirm checkout
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

<Dialog
  open={Boolean(returnDevice)}
  onOpenChange={(open) => {
    if (!open) {
      setReturnDevice(null);
      setLoanId("");
    }
  }}
>
  <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md overflow-hidden p-4 sm:p-6">
    <DialogHeader className="min-w-0 text-left">
      <DialogTitle className="pr-6">
        Who is returning this device?
      </DialogTitle>

      <DialogDescription className="min-w-0">
        <span className="block truncate">
          {returnDevice?.name} {returnDevice?.model}
        </span>
        <span className="block">Select an active checkout.</span>
      </DialogDescription>
    </DialogHeader>

    <Select value={loanId} onValueChange={setLoanId}>
      <SelectTrigger className="h-11 w-full min-w-0 bg-white [&>span]:min-w-0 [&>span]:truncate">
        <SelectValue placeholder="Select an employee" />
      </SelectTrigger>

      <SelectContent
        position="popper"
        className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1.5rem)] overflow-x-hidden"
      >
        {returnDevice?.loans.map((loan) => (
          <SelectItem
            key={loan.id}
            value={String(loan.id)}
            className="min-w-0 max-w-full overflow-hidden"
          >
            <span className="block max-w-full truncate pr-2">
              {loan.employeeName} · since {formatDate(loan.checkedOutAt)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>

    <DialogFooter className="gap-2">
      <Button
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => {
          setReturnDevice(null);
          setLoanId("");
        }}
      >
        Cancel
      </Button>

      <Button
        disabled={saving || !loanId}
        onClick={() => void confirmReturn()}
        className="w-full sm:w-auto"
      >
        {saving ? (
          <Loader2 className="animate-spin" />
        ) : (
          <RotateCcw />
        )}
        Confirm return
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
    </main>
  );
}

function MetricCard({ icon: Icon, label, value, tone }: { icon: typeof Boxes; label: string; value: number; tone: "blue" | "green" | "orange" | "slate" }) {
  const tones = { blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700", orange: "bg-orange-50 text-orange-700", slate: "bg-slate-100 text-slate-700" };
  return <Card className="border-slate-200 bg-white shadow-sm"><CardContent className="flex min-h-28 flex-col justify-between gap-3 p-4 sm:min-h-0 sm:flex-row sm:items-center sm:p-5"><div><p className="text-xs font-medium leading-tight text-slate-500 sm:text-sm">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{value}</p></div><div className={`grid size-9 place-items-center self-end rounded-xl sm:size-11 sm:self-auto sm:rounded-2xl ${tones[tone]}`}><Icon className="size-4 sm:size-5" /></div></CardContent></Card>;
}

function CheckoutCommentList({ loans, className = "" }: { loans: Loan[]; className?: string }) {
  const commentedLoans = loans.filter((loan) => loan.checkoutComment?.trim());
  if (!commentedLoans.length) return null;

  return (
    <div className={`min-w-0 space-y-2 ${className}`}>
      {commentedLoans.map((loan) => (
        <div
          key={loan.id}
          className="min-w-0 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-left"
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">
              Checkout comment
            </span>
            {commentedLoans.length > 1 && (
              <span className="min-w-0 truncate text-[11px] text-orange-600">
                {loan.employeeName}
              </span>
            )}
          </div>
          <p
            className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-5 text-slate-700"
            title={loan.checkoutComment || undefined}
          >
            {loan.checkoutComment}
          </p>
        </div>
      ))}
    </div>
  );
}

function MobileDeviceCard({
  device,
  employeesAvailable,
  onOpen,
  onCheckout,
  onReturn,
}: {
  device: Device;
  employeesAvailable: boolean;
  onOpen: () => void;
  onCheckout: () => void;
  onReturn: () => void;
}) {
  const free = device.quantity - device.loans.length;
  return (
    <article className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <button type="button" onClick={onOpen} className="flex min-w-0 w-full items-start gap-3 text-left" aria-label={`Open ${device.name} ${device.model} details`}>
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-400">
          {device.photoUrl ? <img src={device.photoUrl} alt={device.name} className="h-full w-full object-cover" /> : <Laptop className="size-7" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-slate-950">{device.name}</span>
          <span className="mt-0.5 block min-w-0 truncate text-sm text-slate-500">{device.model}{device.osVersion ? ` · ${device.osVersion}` : ""}</span>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={tierClass(device.tier)}>{tierLabel(device.tier)}</Badge>
            <span className={`text-xs font-semibold ${free > 0 ? "text-emerald-700" : "text-orange-700"}`}>{free} of {device.quantity} in office</span>
          </span>
        </span>
      </button>

      {device.comment && <p className="mt-3 line-clamp-2 text-sm text-slate-500">{device.comment}</p>}
      {device.loans.length > 0 && (
        <div className="mt-3 min-w-0 overflow-hidden rounded-xl bg-orange-50 px-3 py-2.5 text-sm text-orange-900">
          <div className="min-w-0 truncate">
            <span className="font-semibold">Checked out to:</span>{" "}
            {device.loans.map((loan) => loan.employeeName).join(", ")}
          </div>
        </div>
      )}
      <CheckoutCommentList loans={device.loans} className="mt-2" />
      <div className="mt-4 grid min-w-0 max-w-full grid-cols-2 gap-2 overflow-hidden">
        {device.loans.length > 0 && (
          <Button variant="outline" className={`${free > 0 ? "w-full" : "col-span-2 w-full"} min-w-0`} onClick={onReturn}>
            <RotateCcw />
            <span className="truncate">Return</span>
          </Button>
        )}
        {free > 0 && (
          <Button
            className={`${device.loans.length ? "" : "col-span-2"} min-w-0 w-full bg-[#1768e4] hover:bg-[#1058c8]`}
            disabled={!employeesAvailable}
            onClick={onCheckout}
          >
            <PackageCheck />
            <span className="truncate">Check out</span>
          </Button>
        )}
      </div>
    </article>
  );
}

function FullDeviceCard({ device, onEdit, onDelete }: { device: Device; onEdit: () => void; onDelete: () => void }) {
  const free = device.quantity - device.loans.length;
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-4 border-b border-slate-100 p-4 sm:p-5">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-400 sm:size-24">
          {device.photoUrl ? <img src={device.photoUrl} alt={device.name} className="h-full w-full object-cover" /> : <Laptop className="size-8" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="break-words text-lg font-semibold text-slate-950">{device.name}</h3>
              <p className="break-words text-sm text-slate-500">{device.model}</p>
            </div>
            <Badge variant="outline" className={tierClass(device.tier)}>{tierLabel(device.tier)}</Badge>
          </div>
          <Badge className={free > 0 ? "mt-3 border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "mt-3 border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-50"}>
            {free > 0 ? `${free} of ${device.quantity} in office` : `All ${device.quantity} checked out`}
          </Badge>
        </div>
      </div>
      <dl className="divide-y divide-slate-100 text-sm">
        <ListRow label="Device type" value={device.category === "laptop" ? "Laptop" : "Mobile"} />
        <ListRow label="OS version" value={device.osVersion || "Not specified"} />
        <ListRow label="GPU" value={device.gpu || "Not specified"} />
        <ListRow label="SoC" value={device.soc || "Not specified"} />
        <ListRow label="Asset ID" value={device.assetCode || "Not specified"} />
        <ListRow label="Quantity" value={`${device.quantity}`} />
        <ListRow label="Available" value={`${free}`} />
        <ListRow label="Comment" value={device.comment || "No comment"} />
        <div className="grid gap-2 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:px-5">
          <dt className="font-medium text-slate-500">Checked out to</dt>
          <dd className="text-slate-800">
            {device.loans.length ? (
              <div className="space-y-2">
                {device.loans.map((loan) => (
                  <div key={loan.id}>
                    <span className="font-medium">{loan.employeeName}</span>
                    <span className="block text-xs text-slate-500">since {formatDate(loan.checkedOutAt)}</span>
                    {loan.checkoutComment?.trim() && (
                      <p className="mt-1 max-w-xl whitespace-pre-wrap break-words text-sm text-slate-700">
                        {loan.checkoutComment}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : "No one — all units are in the office"}
          </dd>
        </div>
      </dl>
      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:p-4">
        <Button variant="outline" className="bg-white" onClick={onEdit}><Pencil /> Edit</Button>
        <Button variant="outline" className="border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800" onClick={onDelete}><Trash2 /> Delete</Button>
      </div>
    </article>
  );
}

function ListRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:px-5"><dt className="font-medium text-slate-500">{label}</dt><dd className="break-words text-slate-800">{value}</dd></div>;
}

function MobileHistoryCard({ entry }: { entry: HistoryEntry }) {
  return (
    <article className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-950">
            {entry.deviceName}
          </p>

          <p className="truncate text-sm text-slate-500">
            {entry.deviceModel}
            {entry.assetCode ? ` · ${entry.assetCode}` : ""}
          </p>
        </div>

        <Badge
          variant="outline"
          className={`shrink-0 ${
            entry.returnedAt
              ? "border-slate-200 bg-slate-50 text-slate-600"
              : "border-orange-200 bg-orange-50 text-orange-700"
          }`}
        >
          {entry.returnedAt ? "Returned" : "Checked out"}
        </Badge>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 border-t border-slate-100 pt-3 text-sm">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="shrink-0 text-slate-500">
            Employee
          </span>

          <span
            className="min-w-0 flex-1 truncate text-right font-medium text-slate-800"
            title={entry.employeeName}
          >
            {entry.employeeName}
          </span>
        </div>

        <div className="flex min-w-0 items-start justify-between gap-3">
          <span className="shrink-0 text-slate-500">
            Checked out
          </span>

          <span
            className="min-w-0 flex-1 truncate text-right text-slate-700"
            title={formatDate(entry.checkedOutAt)}
          >
            {formatDate(entry.checkedOutAt)}
          </span>
        </div>

        {entry.returnedAt && (
          <div className="flex min-w-0 items-start justify-between gap-3">
            <span className="shrink-0 text-slate-500">
              Returned
            </span>

            <span
              className="min-w-0 flex-1 truncate text-right text-slate-700"
              title={formatDate(entry.returnedAt)}
            >
              {formatDate(entry.returnedAt)}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium text-slate-700">{label}{children}</label>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1 border-b border-slate-100 px-4 py-3.5 last:border-b-0 sm:grid-cols-[170px_1fr] sm:gap-5"><dt className="text-sm font-medium text-slate-500">{label}</dt><dd className="min-w-0 font-medium text-slate-900">{children}</dd></div>;
}

function EmptyState({ hasDevices, onOpenSettings }: { hasDevices: boolean; onOpenSettings: () => void }) {
  return <div className="grid min-h-72 place-items-center px-6 py-12 text-center"><div><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-600">{hasDevices ? <Search className="size-6" /> : <Laptop className="size-6" />}</div><h2 className="mt-4 text-lg font-semibold">{hasDevices ? "No results found" : "Add your first device"}</h2><p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{hasDevices ? "Change the search query or selected filter." : "After you add a device, it will appear in the inventory and become available for checkout."}</p>{!hasDevices && <Button className="mt-5" onClick={onOpenSettings}><Settings2 /> Go to Add</Button>}</div></div>;
}
