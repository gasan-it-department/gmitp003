/** Reproduces "patient with address synced but not showing in web". */
import "dotenv/config";
import { randomUUID } from "crypto";
import { createSigner } from "fast-jwt";
import { prisma } from "../src/barrel/prisma";

const BASE = "http://localhost:3000";

async function main() {
  const account = await prisma.account.findFirst({ where: { lineId: { not: undefined } }, select: { id: true, lineId: true } });
  if (!account?.lineId) throw new Error("no account with line");
  const token = createSigner({ key: process.env.JWT_SECRET as string })({ id: account.id });
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

  // real Gasan address from PSGC, exactly what the desktop form would send
  const provinces = await (await fetch("https://psgc.gitlab.io/api/regions/170000000/provinces/")).json();
  const marinduque = provinces.find((p: any) => p.name.includes("Marinduque"));
  const muns = await (await fetch(`https://psgc.gitlab.io/api/provinces/${marinduque.code}/municipalities/`)).json();
  const gasan = muns.find((m: any) => m.name.includes("Gasan"));
  const brgys = await (await fetch(`https://psgc.gitlab.io/api/municipalities/${gasan.code}/barangays/`)).json();
  const brgy = brgys[0];
  console.log("address codes:", { region: "170000000", province: marinduque.code, municipal: gasan.code, barangay: brgy.code });

  const id = randomUUID();
  const patient = {
    id, firstname: "ADDR", middlename: "", lastname: "Test",
    birthday: null, phone: "0917", email: null, illi: 0,
    region_id: "170000000", region_name: "MIMAROPA",
    province_id: marinduque.code, province_name: "Marinduque",
    municipal_id: gasan.code, municipal_name: "Gasan",
    barangay_id: brgy.code, barangay_name: brgy.name,
    updated_at: new Date().toISOString(), deleted_at: null,
  };

  const r = await fetch(BASE + "/sync/push", { method: "POST", headers: H, body: JSON.stringify({ table: "patient", rows: [patient] }) });
  const j = await r.json();
  console.log("PUSH RESPONSE:", JSON.stringify(j, null, 2));

  const inDb = await prisma.patient.findUnique({ where: { id } });
  console.log("LANDED IN PATIENT TABLE? ", !!inDb);
  if (inDb) console.log("  lineId:", inDb.lineId, " barangayId:", inDb.barangayId);

  await prisma.patient.deleteMany({ where: { id } });
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); });
