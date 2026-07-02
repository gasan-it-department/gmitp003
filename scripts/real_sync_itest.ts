/**
 * Proves desktop sync now lands in the REAL web tables (so the web app sees it).
 * Pushes a patient + medicine through /sync/push, asserts they appear in
 * prisma.patient / prisma.medicine for the line, checks idempotency (re-push =
 * no duplicate), checks pull returns them in the desktop's shape, then cleans up.
 *
 * Run:  npx ts-node scripts/real_sync_itest.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { createSigner } from "fast-jwt";
import { prisma } from "../src/barrel/prisma";

const BASE = "http://localhost:3000";

function ok(label: string, cond: boolean, extra?: unknown) {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : ""));
  if (!cond) throw new Error("FAILED: " + label);
}

async function main() {
  const candidates = await prisma.account.findMany({
    where: { User: { isNot: null } },
    select: { id: true, lineId: true, User: { select: { id: true } } },
  });
  const account = candidates.find((a) => a.lineId && a.User?.id);
  if (!account?.lineId) throw new Error("Need an account with a lineId and a linked User.");
  const token = createSigner({ key: process.env.JWT_SECRET as string })({ id: account.id });
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  console.log("account", account.id, "line", account.lineId);

  const patientId = randomUUID();
  const addrPatientId = randomUUID();
  const medicineId = randomUUID();
  const storageId = randomUUID();
  const stockId = randomUUID();
  const diagnosisId = randomUUID();
  const prescriptionId = randomUUID();
  const itemId = randomUUID();
  const orphanRxId = randomUUID();
  const ITEST_REG = "ITEST-REG", ITEST_PROV = "ITEST-PROV", ITEST_MUN = "ITEST-MUN", ITEST_BRGY = "ITEST-BRGY";
  let presRef = "";

  try {
    // ── push a patient ──
    const patient = {
      id: patientId,
      firstname: "ITEST", middlename: "Sync", lastname: "Patient",
      birthday: "1992-04-05", phone: "09171234567", email: "itest@example.com",
      illi: 0,
      region_id: "170000000", province_id: "174000000",
      municipal_id: null, barangay_id: null,
      updated_at: new Date().toISOString(), deleted_at: null,
    };
    let r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "patient", rows: [patient] }) });
    let j = await r.json();
    ok("patient push ok, no per-row errors", j.ok === true && (j.errors?.length ?? 0) === 0, j);

    const inDb = await prisma.patient.findUnique({ where: { id: patientId } });
    ok("patient landed in REAL Patient table", !!inDb && inDb.firstname === "ITEST", { found: !!inDb });
    ok("patient is scoped to the line (web list would show it)", inDb?.lineId === account.lineId);
    ok("patient phone mapped to phoneNumber", inDb?.phoneNumber === "09171234567");

    // idempotent re-push -> still exactly one row
    await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "patient", rows: [patient] }) });
    const cnt = await prisma.patient.count({ where: { id: patientId } });
    ok("re-push does not duplicate the patient", cnt === 1, { cnt });

    // a patient whose barangay code isn't seeded yet still syncs — the desktop
    // sends the PSGC names too, so the lookup rows are created on demand (like
    // the web) and the address is preserved rather than dropped
    const addrPatient = {
      id: addrPatientId, firstname: "ADDR", lastname: "Tolerant", illi: 0,
      region_id: ITEST_REG, region_name: "Itest Region",
      province_id: ITEST_PROV, province_name: "Itest Province",
      municipal_id: ITEST_MUN, municipal_name: "Itest Municipality",
      barangay_id: ITEST_BRGY, barangay_name: "Itest Barangay",
      updated_at: new Date().toISOString(), deleted_at: null,
    };
    r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "patient", rows: [addrPatient] }) });
    j = await r.json();
    ok("patient with an unseeded address code still pushes (no per-row errors)", j.ok === true && (j.errors?.length ?? 0) === 0, j);
    const addrDb = await prisma.patient.findUnique({ where: { id: addrPatientId }, select: { id: true, barangayId: true, municipalId: true } });
    ok("patient landed WITH its address (barangay/municipal preserved)",
      !!addrDb && addrDb.barangayId === ITEST_BRGY && addrDb.municipalId === ITEST_MUN, addrDb);
    const brgyDb = await prisma.barangay.findUnique({ where: { id: ITEST_BRGY }, select: { name: true } });
    ok("missing barangay lookup row was created on demand (name from desktop)",
      brgyDb?.name === "Itest Barangay", brgyDb);

    // ── push a medicine ──
    const medicine = {
      id: medicineId, serial_number: "MED-ITEST01", barcode: null,
      name: "ITEST Paracetamol", descr: "500mg tablet",
      updated_at: new Date().toISOString(), deleted_at: null,
    };
    r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine", rows: [medicine] }) });
    j = await r.json();
    ok("medicine push ok", j.ok === true && (j.errors?.length ?? 0) === 0, j);
    const medDb = await prisma.medicine.findUnique({ where: { id: medicineId } });
    ok("medicine landed in REAL Medicine table", !!medDb && medDb.name === "ITEST Paracetamol");
    const medLog = await prisma.medicineLogs.findFirst({ where: { userId: account.User!.id, message: { contains: "MED-ITEST01" } } });
    ok("medicine-add written to MedicineLogs (action 1, like the web)", !!medLog && medLog.action === 1, medLog?.message);

    // ── push a storage location (mirrors the web "Add Storage Location") ──
    const storage = {
      id: storageId, name: "ITEST Storage", descr: "itest bay",
      department_id: null, department_name: null,
      timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(), deleted_at: null,
    };
    r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine_storage", rows: [storage] }) });
    j = await r.json();
    ok("storage push ok", j.ok === true && (j.errors?.length ?? 0) === 0, j);
    const storageDb = await prisma.medicineStorage.findUnique({ where: { id: storageId } });
    ok("storage landed in REAL MedicineStorage (refNumber generated, department defaulted)",
      !!storageDb && !!storageDb.refNumber && !!storageDb.departmentId && storageDb.lineId === account.lineId, storageDb && { ref: storageDb.refNumber, dept: storageDb.departmentId });
    const storageLog = await prisma.medicineLogs.findFirst({ where: { message: { contains: `Added new Storage location: ITEST Storage` } } });
    ok("storage-add written to MedicineLogs (action 1, like the web)", !!storageLog && storageLog.action === 1);

    // ── push a stock batch for that medicine, INTO that storage ──
    const stock = {
      id: stockId, medicine_id: medicineId, medicine_storage_id: storageId,
      unit_of_measure: "box", quantity: 10, per_unit: 10, actual_stock: 100,
      threshold: 20, price: 2.5, manufacturing_date: "2026-01-01", expiration: "2027-01-01",
      address_room: "A", address_sec: "1", address_row: "2", address_col: "3", container: "shelf",
      updated_at: new Date().toISOString(), deleted_at: null,
    };
    r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "medicine_stock", rows: [stock] }) });
    j = await r.json();
    ok("stock push ok", j.ok === true && (j.errors?.length ?? 0) === 0, j);
    const stockDb = await prisma.medicineStock.findUnique({ where: { id: stockId } });
    ok("stock landed in REAL MedicineStock (unit -> quality, perUnit -> perQuantity)",
      !!stockDb && stockDb.quality === "box" && stockDb.perQuantity === 10 && stockDb.actualStock === 100, stockDb);
    ok("stock is linked to its storage (medicineStorageId)", stockDb?.medicineStorageId === storageId, { got: stockDb?.medicineStorageId });

    // ── pull the storage back in desktop shape ──
    r = await fetch(BASE + "/sync/pull?table=medicine_storage", { headers: H });
    j = await r.json();
    const pulledStorage = (j.rows as any[]).find((x) => x.id === storageId);
    ok("pull returns the storage in desktop shape (ref_number + department_name)",
      !!pulledStorage && !!pulledStorage.ref_number && "department_name" in pulledStorage, pulledStorage);

    // ── push a diagnosis (PatientRecord type 0) for that patient ──
    const diagnosis = {
      id: diagnosisId, patient_id: patientId, diagnose: "ITEST viral infection",
      updated_at: new Date().toISOString(), deleted_at: null,
    };
    r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "diagnosis", rows: [diagnosis] }) });
    j = await r.json();
    ok("diagnosis push ok", j.ok === true && (j.errors?.length ?? 0) === 0, j);
    const recDb = await prisma.patientRecord.findUnique({ where: { id: diagnosisId } });
    ok("diagnosis landed in REAL PatientRecord (type 0)", !!recDb && recDb.type === 0 && recDb.diagnose === "ITEST viral infection");

    // ── push a prescription + a prescribed medicine ──
    const prescription = {
      id: prescriptionId, patient_id: patientId, diagnosis_id: null,
      descr: "ITEST rest and fluids", status: "open",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
    };
    r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "prescription", rows: [prescription] }) });
    j = await r.json();
    ok("prescription push ok", j.ok === true && (j.errors?.length ?? 0) === 0, j);
    const presDb = await prisma.prescription.findUnique({ where: { id: prescriptionId } });
    ok("prescription landed in REAL Prescription table (refNumber + userId set)",
      !!presDb && !!presDb.refNumber && presDb.userId === account.User!.id && presDb.patientId === patientId, presDb && { ref: presDb.refNumber, userId: presDb.userId });
    const timeline = await prisma.patientRecord.findUnique({ where: { id: "presrec_" + prescriptionId } });
    ok("prescription added to patient timeline (PatientRecord type 1)", !!timeline && timeline.type === 1);
    ok("timeline record is linked to the patient (shows in Patient Record module)",
      timeline?.patientId === patientId, { got: timeline?.patientId });
    // prescription carries the patient's address (so the web detail view — which
    // reads barangay/municipal/province off the Prescription — doesn't get nulls)
    const presPatient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { provinceId: true, municipalId: true, barangayId: true },
    });
    ok("prescription copies the patient's province onto itself",
      presDb?.provinceId === presPatient?.provinceId, { rx: presDb?.provinceId, pt: presPatient?.provinceId });
    presRef = presDb!.refNumber;
    const submitLog = await prisma.medicineLogs.findFirst({ where: { message: { contains: `Submitted Prescription Ref. #: ${presRef}` } } });
    ok("prescription submit written to MedicineLogs (action 1)", !!submitLog && submitLog.action === 1);
    const presNotif = await prisma.medicineNotification.findFirst({ where: { path: `prescription/${prescriptionId}` } });
    ok("new prescription fires a MedicineNotification (pharmacy is notified)",
      !!presNotif && presNotif.title === "New Prescription", presNotif?.message);

    const item = {
      id: itemId, prescription_id: prescriptionId, medicine_id: medicineId,
      comment: "1 tab q6h", quantity: 10,
      updated_at: new Date().toISOString(), deleted_at: null,
    };
    r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "prescription_item", rows: [item] }) });
    j = await r.json();
    ok("prescription_item push ok", j.ok === true && (j.errors?.length ?? 0) === 0, j);
    const itemDb = await prisma.precribeMedicine.findUnique({ where: { id: itemId } });
    ok("item landed in REAL PrecribeMedicine (comment -> desc, qty)", !!itemDb && itemDb.desc === "1 tab q6h" && itemDb.quantity === 10);

    // ── dispense: re-push the prescription as dispensed ──
    const dispensed = { ...prescription, status: "dispensed", updated_at: new Date(Date.now() + 1000).toISOString() };
    r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "prescription", rows: [dispensed] }) });
    await r.json();
    const dispLog = await prisma.medicineLogs.findFirst({ where: { message: { contains: `Dispensed Medicine: Ref. #: ${presRef}` } } });
    ok("dispense written to MedicineLogs (action 4)", !!dispLog && dispLog.action === 4);
    const dispRec = await prisma.patientRecord.findUnique({ where: { id: "disprec_" + prescriptionId } });
    ok("dispense recorded on patient timeline (PatientRecord type 2)", !!dispRec && dispRec.type === 2);

    // ── a prescription whose patient is NOT in the cloud still lands (FK-tolerant) ──
    const orphanRx = {
      id: orphanRxId, patient_id: randomUUID(), patient_name: "Ghost Patient",
      descr: "patient not synced yet", status: "open",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
    };
    r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "prescription", rows: [orphanRx] }) });
    j = await r.json();
    ok("orphan-patient prescription push ok (no per-row errors)", j.ok === true && (j.errors?.length ?? 0) === 0, j);
    const orphanDb = await prisma.prescription.findUnique({ where: { id: orphanRxId } });
    ok("prescription lands even when patient not in cloud (patientId null, name kept)",
      !!orphanDb && orphanDb.patientId === null && orphanDb.firstname === "Ghost" && orphanDb.lastname === "Patient",
      orphanDb && { pid: orphanDb.patientId, fn: orphanDb.firstname, ln: orphanDb.lastname });

    // ── pull patient back in desktop shape ──
    r = await fetch(BASE + "/sync/pull?table=patient", { headers: H });
    j = await r.json();
    const pulled = (j.rows as any[]).find((x) => x.id === patientId);
    ok("pull returns the patient in desktop shape (phone field)", !!pulled && pulled.phone === "09171234567", pulled);
    ok("pull returns a cursor", typeof j.cursor === "string" && j.cursor.length > 0);

    console.log("\nREAL SYNC ITEST OK");
  } finally {
    // remove the audit logs this test created
    await prisma.medicineLogs.deleteMany({ where: { message: { contains: "MED-ITEST01" } } });
    if (presRef) await prisma.medicineLogs.deleteMany({ where: { message: { contains: presRef } } });
    await prisma.medicineNotification.deleteMany({ where: { path: `prescription/${prescriptionId}` } });
    await prisma.notification.deleteMany({ where: { path: `/${account.lineId}/medicine/prescription/${prescriptionId}` } });
    await prisma.patientRecord.deleteMany({ where: { id: "disprec_" + prescriptionId } });
    await prisma.precribeMedicine.deleteMany({ where: { id: itemId } });
    await prisma.patientRecord.deleteMany({ where: { id: "presrec_" + prescriptionId } });
    await prisma.prescription.deleteMany({ where: { id: prescriptionId } });
    await prisma.prescription.deleteMany({ where: { id: orphanRxId } });
    await prisma.patientRecord.deleteMany({ where: { id: diagnosisId } });
    await prisma.medicineStock.deleteMany({ where: { id: stockId } });
    await prisma.medicineLogs.deleteMany({ where: { message: { contains: "Added new Storage location: ITEST Storage" } } });
    await prisma.medicineStorage.deleteMany({ where: { id: storageId } });
    await prisma.patient.deleteMany({ where: { id: patientId } });
    await prisma.patient.deleteMany({ where: { id: addrPatientId } });
    await prisma.medicine.deleteMany({ where: { id: medicineId } });
    // remove the on-demand PSGC lookup rows the address test created (children first)
    await prisma.barangay.deleteMany({ where: { id: ITEST_BRGY } });
    await prisma.municipal.deleteMany({ where: { id: ITEST_MUN } });
    await prisma.province.deleteMany({ where: { id: ITEST_PROV } });
    await prisma.region.deleteMany({ where: { id: ITEST_REG } });
    console.log("cleaned up");
    await prisma.$disconnect();
  }
}

main().catch(async (e) => { console.error(e); process.exitCode = 1; await prisma.$disconnect(); });
