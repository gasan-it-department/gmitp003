import { prisma } from "../barrel/prisma";
import { EncryptionService } from "../service/encryption";
import { getCardExtras } from "../controller/idCardController";

/**
 * The catalogue of user properties an HR officer can choose to capture on an
 * attendance sheet. `AttendanceEvent.fields` stores a subset of these keys in
 * the officer's chosen column order; the same keys drive the mobile preview,
 * the web table and the Excel export, so there is exactly one source of truth
 * for what a column is called and where its value comes from.
 */
export interface AttendanceFieldDef {
  key: string;
  label: string;
  group: "Identity" | "Contact" | "Employment" | "Personal" | "Address";
  /** Sourced from the PDS (SubmittedApplication) rather than the User row.
   *  Those cost an extra query + decryption, so we only load them on demand. */
  pds?: boolean;
}

export const ATTENDANCE_FIELDS: AttendanceFieldDef[] = [
  // Identity
  { key: "fullName", label: "Full name", group: "Identity" },
  { key: "lastName", label: "Last name", group: "Identity" },
  { key: "firstName", label: "First name", group: "Identity" },
  { key: "middleName", label: "Middle name", group: "Identity" },
  { key: "middleInitial", label: "Middle initial", group: "Identity" },
  { key: "suffix", label: "Suffix", group: "Identity" },
  { key: "username", label: "Username", group: "Identity" },
  // Contact
  { key: "email", label: "Email address", group: "Contact" },
  { key: "phone", label: "Phone number", group: "Contact", pds: true },
  // Employment
  { key: "position", label: "Position", group: "Employment" },
  { key: "office", label: "Office / Unit", group: "Employment" },
  { key: "itemNumber", label: "Plantilla item no.", group: "Employment" },
  { key: "salaryGrade", label: "Salary grade", group: "Employment" },
  { key: "employmentStatus", label: "Employment status", group: "Employment" },
  // Personal
  { key: "birthday", label: "Date of birth", group: "Personal", pds: true },
  { key: "age", label: "Age", group: "Personal", pds: true },
  { key: "sex", label: "Sex", group: "Personal", pds: true },
  { key: "civilStatus", label: "Civil status", group: "Personal", pds: true },
  { key: "bloodType", label: "Blood type", group: "Personal", pds: true },
  // Address
  { key: "address", label: "Address", group: "Address", pds: true },
];

const FIELD_MAP = new Map(ATTENDANCE_FIELDS.map((f) => [f.key, f]));

export const isAttendanceField = (k: string) => FIELD_MAP.has(k);
export const attendanceFieldLabel = (k: string) => FIELD_MAP.get(k)?.label ?? k;

/** What a brand-new sheet starts with — the columns an attendance sheet
 *  almost always needs. HR can add or remove any of them. */
export const DEFAULT_ATTENDANCE_FIELDS = [
  "lastName",
  "firstName",
  "middleName",
  "position",
  "office",
];

/** Keeps only known keys, drops duplicates, preserves the caller's order. */
export const sanitizeAttendanceFields = (raw: unknown): string[] => {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    const k = typeof v === "string" ? v.trim() : "";
    if (k && FIELD_MAP.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
};

const dec = async (
  data: string | null | undefined,
  iv: string | null | undefined,
): Promise<string> => {
  if (data && iv) {
    try {
      return (await EncryptionService.decrypt(data, iv)) ?? "";
    } catch {
      return data;
    }
  }
  return data ?? "";
};

export interface AttendanceUser {
  id: string;
  lineId: string | null;
  fullName: string;
  profilePicture: string | null;
  /** Only the fields the event asked for, keyed by field key. */
  values: Record<string, string>;
}

/**
 * Resolves an employee into the exact set of values an event captures.
 *
 * Returns `null` when the user does not exist. PII columns on User are
 * encrypted at rest (`*Iv` siblings) so every one of them goes through `dec`.
 */
export const resolveAttendanceUser = async (
  userId: string,
  fields: string[],
): Promise<AttendanceUser | null> => {
  const wanted = sanitizeAttendanceFields(fields);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      lineId: true,
      firstName: true,
      firstNameIv: true,
      lastName: true,
      lastNameIv: true,
      middleName: true,
      suffix: true,
      username: true,
      usernameIv: true,
      email: true,
      emailIv: true,
      status: true,
      statusIV: true,
      profilePicture: true,
      Position: { select: { name: true, itemNumber: true } },
      department: { select: { name: true } },
      SalaryGrade: { select: { grade: true } },
    },
  });
  if (!user) return null;

  const firstName = await dec(user.firstName, user.firstNameIv);
  const lastName = await dec(user.lastName, user.lastNameIv);
  const middleName = user.middleName ?? "";
  const suffix = user.suffix ?? "";

  const fullName = [firstName, middleName, lastName, suffix]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");

  // Only pay for the PDS lookup when a PDS-backed column was actually chosen.
  const needsExtras = wanted.some((k) => FIELD_MAP.get(k)?.pds);
  const extras = needsExtras
    ? await getCardExtras(user.id)
    : {
        birthday: "",
        age: "",
        sex: "",
        phone: "",
        civilStatus: "",
        bloodType: "",
        address: "",
      };

  const all: Record<string, string> = {
    fullName,
    lastName,
    firstName,
    middleName,
    middleInitial: middleName ? `${middleName.trim().charAt(0)}.` : "",
    suffix,
    username: await dec(user.username, user.usernameIv),
    email: await dec(user.email, user.emailIv),
    phone: extras.phone,
    position: user.Position?.name ?? "",
    office: user.department?.name ?? "",
    itemNumber: user.Position?.itemNumber ?? "",
    salaryGrade:
      user.SalaryGrade?.grade != null ? String(user.SalaryGrade.grade) : "",
    employmentStatus: await dec(user.status, user.statusIV),
    birthday: extras.birthday,
    age: extras.age,
    sex: extras.sex,
    civilStatus: extras.civilStatus,
    bloodType: extras.bloodType,
    address: extras.address,
  };

  const values: Record<string, string> = {};
  for (const k of wanted) values[k] = all[k] ?? "";

  return {
    id: user.id,
    lineId: user.lineId,
    fullName: fullName || lastName || firstName || "Unnamed employee",
    profilePicture: user.profilePicture,
    values,
  };
};
