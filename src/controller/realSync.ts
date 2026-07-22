import { prisma } from "../barrel/prisma";
import {
  generatePrescriptionRef,
  generateStorageRef,
} from "../middleware/handler";
import { createUserNotification } from "../service/notificationEvents";
import { assertStorageAccess } from "./storageAccessController";

/**
 * Maps the desktop's local rows onto the REAL web tables (Patient, Medicine, …)
 * so that data synced from the Gasan Pharmacy desktop app actually shows up in
 * the web app, and vice-versa. The desktop's client-generated UUID is used as
 * the real record id, so a re-push is an idempotent upsert (no duplicates).
 *
 * Tables handled here bypass the generic SyncRecord store. Tables not listed
 * fall back to SyncRecord (see syncController).
 */

type Row = Record<string, unknown>;

const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * PSGC address ids (region/province/municipal/barangay) are FKs into lookup
 * tables that are only partially seeded — they're filled in on demand (see
 * lineController) as codes are used. A desktop patient carries both the PSGC
 * codes AND the resolved names (from the same public PSGC API the web uses), so
 * we create any missing lookup rows here (parent-first) instead of letting an
 * unseeded code fail the whole patient upsert. If the lookup itself can't be
 * written for some reason, we fall back to keeping only codes that already
 * exist, so the patient still syncs either way.
 */
async function resolveAddressIds(row: Row) {
  const rId = s(row.region_id);
  const pId = s(row.province_id);
  const mId = s(row.municipal_id);
  const bId = s(row.barangay_id);
  try {
    if (rId)
      await prisma.region.upsert({
        where: { id: rId },
        create: { id: rId, name: s(row.region_name) ?? rId },
        update: {},
      });
    if (pId)
      await prisma.province.upsert({
        where: { id: pId },
        create: { id: pId, name: s(row.province_name) ?? pId, regionId: rId ?? undefined },
        update: {},
      });
    if (mId)
      await prisma.municipal.upsert({
        where: { id: mId },
        create: { id: mId, name: s(row.municipal_name) ?? mId, provinceId: pId ?? undefined },
        update: {},
      });
    if (bId)
      await prisma.barangay.upsert({
        where: { id: bId },
        create: { id: bId, name: s(row.barangay_name) ?? bId, municipalId: mId ?? undefined },
        update: {},
      });
    return { regionId: rId, provinceId: pId, municipalId: mId, barangayId: bId };
  } catch {
    const keep = async (
      find: (id: string) => Promise<{ id: string } | null>,
      id: string | null,
    ): Promise<string | null> => (id && (await find(id)) ? id : null);
    return {
      regionId: await keep((id) => prisma.region.findUnique({ where: { id }, select: { id: true } }), rId),
      provinceId: await keep((id) => prisma.province.findUnique({ where: { id }, select: { id: true } }), pId),
      municipalId: await keep((id) => prisma.municipal.findUnique({ where: { id }, select: { id: true } }), mId),
      barangayId: await keep((id) => prisma.barangay.findUnique({ where: { id }, select: { id: true } }), bId),
    };
  }
}

// caller context resolved server-side from the auth token
export type PushCtx = { lineId: string | null; userId: string | null };

/**
 * Write the same MedicineLogs audit entry the web writes for a pharmacy action.
 * action codes match the web: 0 remove, 1 add, 2 update, 3/4 dispense. Logging
 * is best-effort and never blocks the sync. Skipped without a User id.
 */
async function audit(action: number, message: string, ctx: PushCtx) {
  if (!ctx.userId) return;
  try {
    await prisma.medicineLogs.create({
      data: { action, message, userId: ctx.userId, lineId: ctx.lineId },
    });
  } catch {
    /* audit log is best-effort */
  }
}

/**
 * Fire the same notifications the web's createPrescriptions does when a NEW
 * prescription first syncs: a real-time MedicineNotification (pharmacy feed) and
 * a bell Notification for every pharmacy-module user on the line (except the
 * prescriber). Best-effort — never blocks the sync.
 */
// "Lastname, Firstname" of whoever performed the action (the prescriber /
// dispenser), or a sensible fallback.
async function actorName(ctx: PushCtx): Promise<string> {
  if (!ctx.userId) return "Pharmacy Desktop";
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { firstName: true, lastName: true },
  });
  return user ? `${user.lastName}, ${user.firstName}` : "Pharmacy Desktop";
}

/**
 * Core notifier shared by the prescribe + dispense events. Creates the realtime
 * MedicineNotification (→ socket + wakes desktop long-polls) and a per-user bell
 * notification for every OTHER pharmacy user on the line (the actor is skipped,
 * and the long-poll excludes `userId==caller` too — so nobody is notified about
 * their own action, but their teammates are).
 */
async function sendPrescriptionNotification(opts: {
  prescriptionId: string;
  title: string;
  medMessage: string;
  bellContent: string;
  ctx: PushCtx;
}) {
  const { prescriptionId, title, medMessage, bellContent, ctx } = opts;
  if (!ctx.userId || !ctx.lineId) return;
  try {
    const medNotif = await prisma.medicineNotification.create({
      data: {
        userId: ctx.userId,
        view: 0,
        path: `prescription/${prescriptionId}`,
        message: medMessage,
        title,
        lineId: ctx.lineId,
      },
      select: {
        id: true, userId: true, title: true, message: true, lineId: true,
        path: true, timestamp: true, type: true, view: true,
      },
    });
    try {
      const { notificationSocket } = await import("..");
      notificationSocket.emitMedicineNotification(medNotif.lineId, {
        id: medNotif.id,
        userId: medNotif.userId,
        title: medNotif.title,
        message: medNotif.message,
        lineId: medNotif.lineId,
        path: medNotif.path ?? undefined,
        timestamp:
          typeof medNotif.timestamp === "string"
            ? medNotif.timestamp
            : medNotif.timestamp.toISOString(),
        type: medNotif.type,
        view: medNotif.view,
      });
    } catch (e) {
      console.warn("[realSync] medicine notif emit failed:", e);
    }

    // bell notification for the line's pharmacy users (skip the actor)
    const pharmacyUsers = await prisma.module.findMany({
      where: {
        lineId: ctx.lineId,
        OR: [
          { moduleName: { equals: "medicine", mode: "insensitive" } },
          { moduleName: { equals: "Pharmacy", mode: "insensitive" } },
        ],
      },
      select: { userId: true },
    });
    const ids = [...new Set(pharmacyUsers.map((m) => m.userId))].filter(
      (id) => id && id !== ctx.userId,
    );
    for (const recipientId of ids) {
      await createUserNotification(prisma, {
        recipientId,
        title,
        content: bellContent,
        path: `/${ctx.lineId}/medicine/prescription/${prescriptionId}`,
        senderId: ctx.userId,
      });
    }
  } catch (e) {
    console.warn("[realSync] prescription notify failed:", e);
  }
}

async function notifyNewPrescription(
  prescriptionId: string,
  patientLabel: string,
  ctx: PushCtx,
) {
  if (!ctx.userId || !ctx.lineId) return;
  const who = await actorName(ctx);
  await sendPrescriptionNotification({
    prescriptionId,
    title: "New Prescription",
    medMessage: `${who} - submitted prescription for ${patientLabel}`,
    bellContent: `${who} submitted a prescription for ${patientLabel}.`,
    ctx,
  });
}

// When a prescription is dispensed, tell the rest of the line (the prescriber
// especially) — the dispenser themselves is skipped by the per-user rule.
async function notifyPrescriptionDispensed(
  prescriptionId: string,
  patientLabel: string,
  ctx: PushCtx,
) {
  if (!ctx.userId || !ctx.lineId) return;
  const who = await actorName(ctx);
  await sendPrescriptionNotification({
    prescriptionId,
    title: "Prescription Dispensed",
    medMessage: `${who} - dispensed prescription for ${patientLabel}`,
    bellContent: `${who} dispensed the prescription for ${patientLabel}.`,
    ctx,
  });
}

/**
 * Fire the "New Prescription" alert only once the prescription AND at least one
 * prescribed medicine both exist on the server.
 *
 * The desktop pushes the prescription and its `prescription_item` rows as two
 * SEPARATE sync requests (prescription first, for the FK). Notifying on the
 * prescription push alone raced the items: a pharmacist who tapped the bell
 * immediately opened `prescription/{id}` before the medicines had synced and
 * saw "No Medicines Found". So both handlers call this; whichever lands last
 * sends the alert, and the notification's `path` is the natural dedup key so it
 * only ever fires once.
 */
async function maybeNotifyPrescription(
  prescriptionId: string | null,
  ctx: PushCtx,
) {
  if (!prescriptionId || !ctx.userId || !ctx.lineId) return;
  // already alerted for this prescription?
  const already = await prisma.medicineNotification.findFirst({
    where: { path: `prescription/${prescriptionId}` },
    select: { id: true },
  });
  if (already) return;
  // items haven't landed yet — defer; the prescription_item push calls back
  // here once at least one row exists
  const item = await prisma.precribeMedicine.findFirst({
    where: { prescriptionId },
    select: { id: true },
  });
  if (!item) return;
  const presc = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    select: { firstname: true, lastname: true },
  });
  if (!presc) return;
  const patientLabel =
    [presc.lastname, presc.firstname]
      .filter((x) => x && String(x).trim())
      .join(", ") || "a patient";
  await notifyNewPrescription(prescriptionId, patientLabel, ctx);
}

async function medName(medicineId: string | null): Promise<string> {
  if (!medicineId) return "Unknown Medicine";
  const m = await prisma.medicine.findUnique({
    where: { id: medicineId },
    select: { name: true, serialNumber: true },
  });
  return m ? `${m.name} (${m.serialNumber})` : "Unknown Medicine";
}

// ── PUSH: desktop row -> real table (idempotent upsert by id) ───────────────
export const REAL_PUSH: Record<
  string,
  (row: Row, ctx: PushCtx) => Promise<void>
> = {
  async patient(row, ctx) {
    const lineId = ctx.lineId;
    const id = s(row.id);
    if (!id) return;
    if (s(row.deleted_at)) {
      await prisma.patient.deleteMany({ where: { id } });
      return;
    }
    if (!lineId) throw new Error("This account is not assigned to a line; cannot sync.");
    const addr = await resolveAddressIds(row);
    const data = {
      firstname: s(row.firstname) ?? "",
      lastname: s(row.lastname) ?? "",
      middlename: s(row.middlename),
      email: s(row.email),
      phoneNumber: s(row.phone),
      philHealthNo: s(row.philhealth_no),
      barangayId: addr.barangayId,
      municipalId: addr.municipalId,
      provinceId: addr.provinceId,
      regionId: addr.regionId,
      birthday: s(row.birthday) ? new Date(String(row.birthday)) : null,
      illi: row.illi === 1 || row.illi === true,
      lineId,
    };
    await prisma.patient.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  },

  async medicine(row, ctx) {
    const lineId = ctx.lineId;
    const id = s(row.id);
    if (!id) return;
    if (s(row.deleted_at)) {
      const existed = await prisma.medicine.findUnique({ where: { id }, select: { name: true, serialNumber: true } });
      await prisma.medicine.deleteMany({ where: { id } });
      if (existed)
        await audit(0, `Removed medicine — ${existed.name} (${existed.serialNumber})`, ctx);
      return;
    }
    if (!lineId) throw new Error("This account is not assigned to a line; cannot sync.");
    const name = s(row.name) ?? "Unnamed";
    const desc = s(row.descr) ?? "None";
    const barcode = s(row.barcode);
    const serialNumber = s(row.serial_number) ?? "MED-" + id.slice(0, 8);
    const isNew = !(await prisma.medicine.findUnique({ where: { id }, select: { id: true } }));
    await prisma.medicine.upsert({
      where: { id },
      create: { id, name, desc, serialNumber, barcode, lineId },
      update: { name, desc, barcode },
    });
    if (isNew)
      await audit(1, `Added new medicine in the list; Med. Serial Ref.: ${serialNumber} - Label: ${name}`, ctx);
  },

  // A storage location (mirrors the web StorageList "Add Storage Location").
  // The refNumber is generated once server-side and preserved on re-push, so
  // syncing is idempotent. departmentId is a required FK — use the one the
  // desktop provides when valid, else default to the line's first department.
  async medicine_storage(row, ctx) {
    const lineId = ctx.lineId;
    const id = s(row.id);
    if (!id) return;
    if (s(row.deleted_at)) {
      const existed = await prisma.medicineStorage.findUnique({
        where: { id },
        select: { name: true, refNumber: true },
      });
      await prisma.medicineStorage.deleteMany({ where: { id } });
      if (existed)
        await audit(0, `STORAGE: ${existed.name}-${existed.refNumber}, has been removed`, ctx);
      return;
    }
    if (!lineId) throw new Error("This account is not assigned to a line; cannot sync.");

    // resolve a valid department for the required FK
    let departmentId = s(row.department_id);
    if (departmentId) {
      const d = await prisma.department.findFirst({
        where: { id: departmentId, lineId },
        select: { id: true },
      });
      if (!d) departmentId = null;
    }
    if (!departmentId) {
      const d = await prisma.department.findFirst({
        where: { lineId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!d)
        throw new Error(
          "No unit/department exists for this line; create one on the web first.",
        );
      departmentId = d.id;
    }

    const existing = await prisma.medicineStorage.findUnique({
      where: { id },
      select: { refNumber: true },
    });
    const refNumber = existing?.refNumber ?? (await generateStorageRef());
    const name = s(row.name) ?? "Storage";
    const desc = s(row.descr) ?? "";
    const timestamp = s(row.timestamp) ?? new Date().toISOString();

    await prisma.medicineStorage.upsert({
      where: { id },
      create: { id, refNumber, name, desc, lineId, departmentId, timestamp },
      update: { name, desc, departmentId },
    });
    if (!existing)
      await audit(1, `Added new Storage location: ${name}, Ref. number: ${refNumber}`, ctx);
  },

  async medicine_stock(row, ctx) {
    const lineId = ctx.lineId;
    const id = s(row.id);
    if (!id) return;
    if (s(row.deleted_at)) {
      // storage access: deleting a batch counts as touching that storage
      const victim = await prisma.medicineStock.findUnique({
        where: { id },
        select: { medicineStorageId: true },
      });
      if (victim)
        await assertStorageAccess(
          ctx.userId,
          [victim.medicineStorageId],
          "remove stock",
        );
      const med = await medName(s(row.medicine_id));
      await prisma.medicineStock.deleteMany({ where: { id } });
      await audit(0, `REMOVE: stock batch — ${med}`, ctx);
      return;
    }
    if (!lineId) throw new Error("This account is not assigned to a line; cannot sync.");
    const existing = await prisma.medicineStock.findUnique({ where: { id } });
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    };
    // don't let a not-yet-synced storage's FK block the insert; re-links on a
    // later push once the storage exists in the cloud
    let storageId = s(row.medicine_storage_id);
    if (storageId) {
      const st = await prisma.medicineStorage.findUnique({
        where: { id: storageId },
        select: { id: true },
      });
      if (!st) storageId = null;
    }

    const data = {
      medicineId: s(row.medicine_id),
      medicineStorageId: storageId,
      quarter: Math.floor(new Date().getMonth() / 3) + 1, // current quarter
      quality: s(row.unit_of_measure) ?? "box", // web stores unit in `quality`
      perQuantity: num(row.per_unit) || 1,
      quantity: num(row.quantity) || 1,
      actualStock: num(row.actual_stock),
      threshold: num(row.threshold),
      expiration: s(row.expiration) ? new Date(String(row.expiration)) : null,
      manufacturingDate: s(row.manufacturing_date)
        ? new Date(String(row.manufacturing_date))
        : null,
      addressRoom: s(row.address_room),
      addressCol: s(row.address_col),
      addressRow: s(row.address_row),
      addressSec: s(row.address_sec),
      container: s(row.container),
      lineId,
    };

    // Unchanged replay (e.g. the desktop's "force full re-sync" re-pushes
    // every row) — nothing to write, so no storage-access check either.
    // Without this, strict storage access would permanently reject other
    // storages' untouched rows on a full resync.
    if (existing) {
      const t = (d: Date | null | undefined) => (d ? d.getTime() : null);
      const same =
        existing.medicineId === data.medicineId &&
        existing.medicineStorageId === data.medicineStorageId &&
        existing.quality === data.quality &&
        existing.perQuantity === data.perQuantity &&
        existing.quantity === data.quantity &&
        existing.actualStock === data.actualStock &&
        existing.threshold === data.threshold &&
        t(existing.expiration) === t(data.expiration) &&
        t(existing.manufacturingDate) === t(data.manufacturingDate) &&
        (existing.addressRoom ?? null) === (data.addressRoom ?? null) &&
        (existing.addressCol ?? null) === (data.addressCol ?? null) &&
        (existing.addressRow ?? null) === (data.addressRow ?? null) &&
        (existing.addressSec ?? null) === (data.addressSec ?? null) &&
        (existing.container ?? null) === (data.container ?? null);
      if (same) return;
    }

    // Storage access (LOCKED BY DEFAULT): the pusher needs a grant on the
    // storage the row claims AND on the storage the existing server row sits
    // in (so batches can't be pulled out of a storage they can't touch).
    await assertStorageAccess(
      ctx.userId,
      [storageId, existing?.medicineStorageId],
      "modify stock",
    );

    await prisma.medicineStock.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
    if (!existing) {
      const total = data.quantity * data.perQuantity;
      await audit(
        1,
        `Added new batch: ${await medName(data.medicineId)} — ` +
          `qty ${data.quantity} × ${data.perQuantity} ${data.quality} (${total} items)`,
        ctx,
      );
    }
  },

  async diagnosis(row, _ctx) {
    const id = s(row.id);
    if (!id) return;
    if (s(row.deleted_at)) {
      await prisma.patientRecord.deleteMany({ where: { id } });
      return;
    }
    // a Diagnose is a PatientRecord of type 0 (scoped via its patient's line)
    const data = { patientId: s(row.patient_id), diagnose: s(row.diagnose), type: 0 };
    await prisma.patientRecord.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  },

  async prescription(row, ctx) {
    const lineId = ctx.lineId;
    const id = s(row.id);
    if (!id) return;
    if (s(row.deleted_at)) {
      // PrecribeMedicine cascades from Prescription; also drop the timeline row
      await prisma.patientRecord.deleteMany({ where: { id: "presrec_" + id } });
      await prisma.prescription.deleteMany({ where: { id } });
      return;
    }
    if (!lineId) throw new Error("This account is not assigned to a line; cannot sync.");
    if (!ctx.userId)
      throw new Error("Cannot resolve the prescribing user for this account.");

    const patientId = s(row.patient_id);
    // denormalise patient name + age + address (the web's prescription detail
    // shows these, and its DispensaryPrescription view reads them straight off
    // the Prescription row like a web-created one)
    let firstname: string | null = null;
    let lastname: string | null = null;
    let age = "N/A";
    let patientExists = false;
    let barangayId: string | null = null;
    let municipalId: string | null = null;
    let provinceId: string | null = null;
    if (patientId) {
      const p = await prisma.patient.findUnique({
        where: { id: patientId },
        select: {
          firstname: true, lastname: true, birthday: true,
          barangayId: true, municipalId: true, provinceId: true,
        },
      });
      if (p) {
        patientExists = true;
        firstname = p.firstname;
        lastname = p.lastname;
        // these came off a Patient that already synced, so they're valid FKs
        barangayId = p.barangayId;
        municipalId = p.municipalId;
        provinceId = p.provinceId;
        if (p.birthday)
          age = String(
            Math.max(0, Math.floor((Date.now() - p.birthday.getTime()) / 31557600000)),
          );
      }
    }
    // fall back to the name the desktop sent, so the prescription always shows one
    if (!firstname && !lastname && s(row.patient_name)) {
      const parts = String(row.patient_name).trim().split(/\s+/);
      lastname = parts.length > 1 ? parts[parts.length - 1] : parts[0];
      firstname = parts.length > 1 ? parts.slice(0, -1).join(" ") : null;
    }
    // don't let a not-yet-synced patient's FK block the insert; re-links on a
    // later push once the patient exists
    const linkPatientId = patientExists ? patientId : null;
    // dispensed === 2 to match the web (prescriptionDispense sets status 2 and
    // blocks re-dispense on status===2). Using 1 here let the web re-dispense a
    // desktop-dispensed rx (double dispense).
    const status = s(row.status) === "dispensed" ? 2 : 0;
    const timestamp = s(row.created_at) ? new Date(String(row.created_at)) : new Date();

    // refNumber is generated once and preserved on re-push (idempotent)
    const existing = await prisma.prescription.findUnique({
      where: { id },
      select: { refNumber: true, status: true },
    });
    const refNumber = existing?.refNumber ?? (await generatePrescriptionRef());

    await prisma.prescription.upsert({
      where: { id },
      create: {
        id,
        refNumber,
        userId: ctx.userId,
        lineId,
        patientId: linkPatientId ?? undefined,
        condtion: s(row.descr),
        firstname,
        lastname,
        age,
        barangayId: barangayId ?? undefined,
        municipalId: municipalId ?? undefined,
        provinceId: provinceId ?? undefined,
        status,
        timestamp,
        // web createPrescription seeds a progress step 0; mirror it so the
        // dispensary progress view has a starting point
        progress: { create: { step: 0 } },
      },
      update: {
        patientId: linkPatientId ?? undefined,
        condtion: s(row.descr),
        firstname,
        lastname,
        age,
        barangayId: barangayId ?? undefined,
        municipalId: municipalId ?? undefined,
        provinceId: provinceId ?? undefined,
        status,
      },
    });

    // record it on the patient's timeline (type 1 = Prescribed), idempotent id
    if (linkPatientId) {
      const recId = "presrec_" + id;
      await prisma.patientRecord.upsert({
        where: { id: recId },
        create: { id: recId, patientId, diagnose: s(row.descr), type: 1, prescriptionId: id },
        update: { diagnose: s(row.descr) },
      });
    }

    // audit logs (web parity): "submitted" on first sync, "dispensed" on the
    // open->dispensed transition (with a type-2 "Medicine Dispensed" record)
    if (!existing) {
      await audit(1, `Submitted Prescription Ref. #: ${refNumber}.`, ctx);
    }
    // Notify the line's pharmacy users, but only once the prescribed medicines
    // have also synced — they arrive in a separate, later push, so this call
    // usually defers and the prescription_item handler fires the alert instead.
    await maybeNotifyPrescription(id, ctx);
    if (status === 2 && (!existing || existing.status !== 2)) {
      await audit(4, `Dispensed Medicine: Ref. #: ${refNumber}`, ctx);
      if (linkPatientId) {
        const dispRecId = "disprec_" + id;
        const patientId = linkPatientId;
        await prisma.patientRecord.upsert({
          where: { id: dispRecId },
          create: { id: dispRecId, patientId, type: 2, prescriptionId: id },
          update: {},
        });
      }
      // notify the line (the prescriber especially) that it was dispensed —
      // the dispenser themselves is skipped by the per-user rule
      const dispensedFor =
        [lastname, firstname].filter((x) => x && String(x).trim()).join(", ") ||
        s(row.patient_name) ||
        "a patient";
      await notifyPrescriptionDispensed(id, dispensedFor, ctx);
    }
  },

  async prescription_item(row, ctx) {
    const id = s(row.id);
    if (!id) return;
    if (s(row.deleted_at)) {
      await prisma.precribeMedicine.deleteMany({ where: { id } });
      return;
    }
    const n = Number(row.quantity);
    const rel = Number(row.release_quantity);
    const remark = s(row.remark);
    const data = {
      prescriptionId: s(row.prescription_id),
      medicineId: s(row.medicine_id),
      quantity: Number.isFinite(n) ? Math.trunc(n) : 1,
      desc: s(row.comment), // the web stores the prescribe comment in `desc`
      // how much the dispenser actually released (0 until dispensed). Older
      // desktops don't send it — leave the server's value alone then.
      ...(Number.isFinite(rel) ? { releaseQuantity: Math.trunc(rel) } : {}),
      // dispense status: "OK" | "Pending" | "outofStock" (same values the web's
      // dropdown writes). Omitted by older desktops -> server value untouched.
      ...(remark ? { remark } : {}),
    };
    await prisma.precribeMedicine.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
    // A prescribed medicine now exists — send the "New Prescription" alert if
    // the prescription push deferred it (idempotent; dedups on the notif path).
    await maybeNotifyPrescription(data.prescriptionId, ctx);
  },

  // Server-owned: grants are managed on the web only. The desktop never dirties
  // these rows; if a client pushes anyway, silently ignore it.
  async storage_access(_row, _ctx) {
    return;
  },
};

// ── PULL: real table -> desktop rows (cursor on `timestamp`) ─────────────────
const PULL_LIMIT = 500;

export const REAL_PULL: Record<
  string,
  (
    lineId: string | null,
    since: Date | null,
  ) => Promise<{ rows: Row[]; cursor: string | null }>
> = {
  async patient(lineId, since) {
    if (!lineId) return { rows: [], cursor: since ? since.toISOString() : null };
    const recs = await prisma.patient.findMany({
      where: { lineId, ...(since ? { timestamp: { gt: since } } : {}) },
      orderBy: { timestamp: "asc" },
      take: PULL_LIMIT,
    });
    const rows: Row[] = recs.map((p) => ({
      id: p.id,
      firstname: p.firstname,
      middlename: p.middlename,
      lastname: p.lastname,
      birthday: p.birthday ? p.birthday.toISOString().slice(0, 10) : null,
      email: p.email,
      phone: p.phoneNumber,
      philhealth_no: p.philHealthNo,
      illi: p.illi ? 1 : 0,
      region_id: p.regionId,
      province_id: p.provinceId,
      municipal_id: p.municipalId,
      barangay_id: p.barangayId,
      updated_at: iso(p.timestamp),
      deleted_at: null,
    }));
    const cursor =
      recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
    return { rows, cursor };
  },

  async medicine(lineId, since) {
    if (!lineId) return { rows: [], cursor: since ? since.toISOString() : null };
    const recs = await prisma.medicine.findMany({
      where: { lineId, ...(since ? { timestamp: { gt: since } } : {}) },
      orderBy: { timestamp: "asc" },
      take: PULL_LIMIT,
    });
    const rows: Row[] = recs.map((m) => ({
      id: m.id,
      serial_number: m.serialNumber,
      barcode: m.barcode,
      name: m.name,
      descr: m.desc,
      updated_at: iso(m.timestamp),
      deleted_at: null,
    }));
    const cursor =
      recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
    return { rows, cursor };
  },

  // Storage locations are few, so we return the whole line's set each pull
  // (no cursor). The desktop upserts by id, so repeats are harmless.
  async medicine_storage(lineId, _since) {
    if (!lineId) return { rows: [], cursor: null };
    const recs = await prisma.medicineStorage.findMany({
      where: { lineId },
      orderBy: { refNumber: "asc" },
      include: { unit: { select: { name: true } } },
    });
    const rows: Row[] = recs.map((r) => ({
      id: r.id,
      ref_number: r.refNumber,
      name: r.name,
      descr: r.desc,
      department_id: r.departmentId,
      department_name: r.unit?.name ?? null,
      timestamp: r.timestamp,
      updated_at: r.timestamp,
      deleted_at: null,
    }));
    return { rows, cursor: null };
  },

  async medicine_stock(lineId, since) {
    if (!lineId) return { rows: [], cursor: since ? since.toISOString() : null };
    const recs = await prisma.medicineStock.findMany({
      where: { lineId, ...(since ? { timestamp: { gt: since } } : {}) },
      orderBy: { timestamp: "asc" },
      take: PULL_LIMIT,
    });
    const rows: Row[] = recs.map((r) => ({
      id: r.id,
      medicine_id: r.medicineId,
      medicine_storage_id: r.medicineStorageId,
      unit_of_measure: r.quality,
      quantity: r.quantity,
      per_unit: r.perQuantity,
      actual_stock: r.actualStock,
      threshold: r.threshold,
      price: 0,
      manufacturing_date: r.manufacturingDate
        ? r.manufacturingDate.toISOString().slice(0, 10)
        : null,
      expiration: r.expiration ? r.expiration.toISOString().slice(0, 10) : null,
      address_room: r.addressRoom,
      address_col: r.addressCol,
      address_row: r.addressRow,
      address_sec: r.addressSec,
      container: r.container,
      created_by: null,
      created_at: iso(r.timestamp),
      updated_at: iso(r.timestamp),
      deleted_at: null,
    }));
    const cursor = recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
    return { rows, cursor };
  },

  async diagnosis(lineId, since) {
    if (!lineId) return { rows: [], cursor: since ? since.toISOString() : null };
    const recs = await prisma.patientRecord.findMany({
      where: {
        type: 0,
        patient: { lineId },
        ...(since ? { timestamp: { gt: since } } : {}),
      },
      orderBy: { timestamp: "asc" },
      take: PULL_LIMIT,
      include: { patient: { select: { firstname: true, middlename: true, lastname: true } } },
    });
    const rows: Row[] = recs.map((r) => ({
      id: r.id,
      patient_id: r.patientId,
      // denormalised name so the desktop shows it even before the patient syncs
      patient_name: r.patient
        ? [r.patient.firstname, r.patient.middlename, r.patient.lastname]
            .filter((x) => x && String(x).trim())
            .join(" ")
        : null,
      diagnose: r.diagnose,
      created_by: null,
      created_at: iso(r.timestamp),
      updated_at: iso(r.timestamp),
      deleted_at: null,
    }));
    const cursor = recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
    return { rows, cursor };
  },

  async prescription(lineId, since) {
    if (!lineId) return { rows: [], cursor: since ? since.toISOString() : null };
    const recs = await prisma.prescription.findMany({
      where: { lineId, ...(since ? { timestamp: { gt: since } } : {}) },
      orderBy: { timestamp: "asc" },
      take: PULL_LIMIT,
    });
    const rows: Row[] = recs.map((r) => ({
      id: r.id,
      patient_id: r.patientId,
      patient_name: [r.firstname, r.lastname].filter((x) => x && String(x).trim()).join(" ") || null,
      diagnosis_id: null,
      descr: r.condtion,
      // dispensed = 2 (web) or legacy 1; anything else is still open
      status: r.status === 2 || r.status === 1 ? "dispensed" : "open",
      created_by: null,
      created_at: iso(r.timestamp),
      updated_at: iso(r.timestamp),
      deleted_at: null,
    }));
    const cursor = recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
    return { rows, cursor };
  },

  async prescription_item(lineId, since) {
    if (!lineId) return { rows: [], cursor: since ? since.toISOString() : null };
    const recs = await prisma.precribeMedicine.findMany({
      where: { Prescription: { lineId }, ...(since ? { timestamp: { gt: since } } : {}) },
      orderBy: { timestamp: "asc" },
      take: PULL_LIMIT,
    });
    const rows: Row[] = recs.map((r) => ({
      id: r.id,
      prescription_id: r.prescriptionId,
      medicine_id: r.medicineId,
      comment: r.desc,
      quantity: r.quantity,
      release_quantity: r.releaseQuantity,
      remark: r.remark,
      updated_at: iso(r.timestamp),
      deleted_at: null,
    }));
    const cursor = recs.length > 0 ? iso(recs[recs.length - 1].timestamp) : null;
    return { rows, cursor };
  },

  // Per-user storage grants (Storage > Dispense Access). Tiny table — return
  // the whole line's set each pull (no cursor); the desktop REPLACES its local
  // copy so revocations propagate too.
  async storage_access(lineId, _since) {
    if (!lineId) return { rows: [], cursor: null };
    const recs = await prisma.medicineStorageAccess.findMany({
      where: { medicineStorage: { lineId } },
      select: {
        id: true,
        medicineStorageId: true,
        userId: true,
        timestamp: true,
      },
    });
    const rows: Row[] = recs.map((r) => ({
      id: r.id,
      medicine_storage_id: r.medicineStorageId,
      user_id: r.userId,
      updated_at: iso(r.timestamp),
      deleted_at: null,
    }));
    return { rows, cursor: null };
  },
};

export const isRealTable = (t: string) => t in REAL_PUSH;
