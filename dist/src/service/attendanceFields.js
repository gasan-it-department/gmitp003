"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAttendanceUser = exports.sanitizeAttendanceFields = exports.DEFAULT_ATTENDANCE_FIELDS = exports.attendanceFieldLabel = exports.isAttendanceField = exports.ATTENDANCE_FIELDS = void 0;
const prisma_1 = require("../barrel/prisma");
const encryption_1 = require("../service/encryption");
const idCardController_1 = require("../controller/idCardController");
exports.ATTENDANCE_FIELDS = [
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
const FIELD_MAP = new Map(exports.ATTENDANCE_FIELDS.map((f) => [f.key, f]));
const isAttendanceField = (k) => FIELD_MAP.has(k);
exports.isAttendanceField = isAttendanceField;
const attendanceFieldLabel = (k) => { var _a, _b; return (_b = (_a = FIELD_MAP.get(k)) === null || _a === void 0 ? void 0 : _a.label) !== null && _b !== void 0 ? _b : k; };
exports.attendanceFieldLabel = attendanceFieldLabel;
/** What a brand-new sheet starts with — the columns an attendance sheet
 *  almost always needs. HR can add or remove any of them. */
exports.DEFAULT_ATTENDANCE_FIELDS = [
    "lastName",
    "firstName",
    "middleName",
    "position",
    "office",
];
/** Keeps only known keys, drops duplicates, preserves the caller's order. */
const sanitizeAttendanceFields = (raw) => {
    const arr = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const out = [];
    for (const v of arr) {
        const k = typeof v === "string" ? v.trim() : "";
        if (k && FIELD_MAP.has(k) && !seen.has(k)) {
            seen.add(k);
            out.push(k);
        }
    }
    return out;
};
exports.sanitizeAttendanceFields = sanitizeAttendanceFields;
const dec = (data, iv) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (data && iv) {
        try {
            return (_a = (yield encryption_1.EncryptionService.decrypt(data, iv))) !== null && _a !== void 0 ? _a : "";
        }
        catch (_b) {
            return data;
        }
    }
    return data !== null && data !== void 0 ? data : "";
});
/**
 * Resolves an employee into the exact set of values an event captures.
 *
 * Returns `null` when the user does not exist. PII columns on User are
 * encrypted at rest (`*Iv` siblings) so every one of them goes through `dec`.
 */
const resolveAttendanceUser = (userId, fields) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const wanted = (0, exports.sanitizeAttendanceFields)(fields);
    const user = yield prisma_1.prisma.user.findUnique({
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
    if (!user)
        return null;
    const firstName = yield dec(user.firstName, user.firstNameIv);
    const lastName = yield dec(user.lastName, user.lastNameIv);
    const middleName = (_a = user.middleName) !== null && _a !== void 0 ? _a : "";
    const suffix = (_b = user.suffix) !== null && _b !== void 0 ? _b : "";
    const fullName = [firstName, middleName, lastName, suffix]
        .map((s) => (s || "").trim())
        .filter(Boolean)
        .join(" ");
    // Only pay for the PDS lookup when a PDS-backed column was actually chosen.
    const needsExtras = wanted.some((k) => { var _a; return (_a = FIELD_MAP.get(k)) === null || _a === void 0 ? void 0 : _a.pds; });
    const extras = needsExtras
        ? yield (0, idCardController_1.getCardExtras)(user.id)
        : {
            birthday: "",
            age: "",
            sex: "",
            phone: "",
            civilStatus: "",
            bloodType: "",
            address: "",
        };
    const all = {
        fullName,
        lastName,
        firstName,
        middleName,
        middleInitial: middleName ? `${middleName.trim().charAt(0)}.` : "",
        suffix,
        username: yield dec(user.username, user.usernameIv),
        email: yield dec(user.email, user.emailIv),
        phone: extras.phone,
        position: (_d = (_c = user.Position) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "",
        office: (_f = (_e = user.department) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "",
        itemNumber: (_h = (_g = user.Position) === null || _g === void 0 ? void 0 : _g.itemNumber) !== null && _h !== void 0 ? _h : "",
        salaryGrade: ((_j = user.SalaryGrade) === null || _j === void 0 ? void 0 : _j.grade) != null ? String(user.SalaryGrade.grade) : "",
        employmentStatus: yield dec(user.status, user.statusIV),
        birthday: extras.birthday,
        age: extras.age,
        sex: extras.sex,
        civilStatus: extras.civilStatus,
        bloodType: extras.bloodType,
        address: extras.address,
    };
    const values = {};
    for (const k of wanted)
        values[k] = (_k = all[k]) !== null && _k !== void 0 ? _k : "";
    return {
        id: user.id,
        lineId: user.lineId,
        fullName: fullName || lastName || firstName || "Unnamed employee",
        profilePicture: user.profilePicture,
        values,
    };
});
exports.resolveAttendanceUser = resolveAttendanceUser;
