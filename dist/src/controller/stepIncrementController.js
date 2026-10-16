"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.stepIncrementsSetServiceRecord = exports.stepIncrementsList = exports.stepIncrementsDecide = exports.stepIncrementsPropose = exports.stepIncrementsDue = void 0;
const errors_1 = require("../errors/errors");
const callerScope_1 = require("../service/callerScope");
const stepIncrement_1 = require("../service/stepIncrement");
const asOfFrom = (raw) => {
    if (!raw)
        return new Date();
    const d = new Date(raw);
    if (Number.isNaN(d.getTime()))
        throw new errors_1.ValidationError("`asOf` is not a date.");
    return d;
};
/**
 * GET /hr/step-increments/due?lineId=&asOf=
 *
 * Everyone, not just those who qualify: an officer asking who is due also
 * needs to see who is nearly due and who is stuck behind a missing date.
 */
const stepIncrementsDue = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const q = req.query;
    if (!q.lineId)
        throw new errors_1.ValidationError("lineId is required.");
    yield (0, callerScope_1.requireHr)(req, q.lineId, "listing step increments");
    const asOf = asOfFrom(q.asOf);
    const candidates = yield (0, stepIncrement_1.listCandidates)(q.lineId, asOf);
    return res.code(200).send({
        asOf,
        rules: {
            yearsPerStep: stepIncrement_1.LOS_YEARS,
            maxLwopDays: stepIncrement_1.MAX_LWOP_DAYS,
            note: "Length of service only. Merit-based increments need a performance " +
                "rating module, which does not exist yet.",
        },
        due: candidates.filter((c) => c.blockers.length === 0),
        others: candidates.filter((c) => c.blockers.length > 0),
    });
});
exports.stepIncrementsDue = stepIncrementsDue;
/**
 * POST /hr/step-increments/propose  { lineId, asOf?, userIds? }
 *
 * Raises proposals. Nothing is granted here — a proposal still has to be
 * decided, and the people skipped are named with the reason.
 */
const stepIncrementsPropose = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!(body === null || body === void 0 ? void 0 : body.lineId))
        throw new errors_1.ValidationError("lineId is required.");
    yield (0, callerScope_1.requireHr)(req, body.lineId, "proposing step increments");
    const result = yield (0, stepIncrement_1.proposeDue)(body.lineId, asOfFrom(body.asOf), Array.isArray(body.userIds) ? body.userIds : undefined);
    return res.code(200).send(Object.assign({ message: "OK" }, result));
});
exports.stepIncrementsPropose = stepIncrementsPropose;
/**
 * POST /hr/step-increments/decide
 *   { lineId, id, action: "approve"|"reject", certifiedSatisfactory?,
 *     nosiNumber?, note? }
 *
 * Approving requires certifying the service was satisfactory. That is not
 * a checkbox for its own sake: the system has no performance ratings, so
 * the certification is the only record that anybody checked.
 */
const stepIncrementsDecide = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const body = req.body;
    if (!(body === null || body === void 0 ? void 0 : body.lineId) || !(body === null || body === void 0 ? void 0 : body.id)) {
        throw new errors_1.ValidationError("lineId and id are required.");
    }
    if (body.action !== "approve" && body.action !== "reject") {
        throw new errors_1.ValidationError('action must be "approve" or "reject".');
    }
    const caller = yield (0, callerScope_1.requireHr)(req, body.lineId, "deciding a step increment");
    const out = yield (0, stepIncrement_1.decide)({
        id: body.id,
        lineId: body.lineId,
        action: body.action,
        decidedByUserId: caller.actorId,
        certifiedSatisfactory: body.certifiedSatisfactory === true,
        nosiNumber: (_a = body.nosiNumber) !== null && _a !== void 0 ? _a : null,
        note: (_b = body.note) !== null && _b !== void 0 ? _b : null,
    });
    if (!out.ok)
        throw new errors_1.ValidationError(out.why);
    return res.code(200).send({ message: "OK", status: out.status });
});
exports.stepIncrementsDecide = stepIncrementsDecide;
/** GET /hr/step-increments?lineId=&userId= — the record, for a NOSI. */
const stepIncrementsList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const q = req.query;
    if (!q.lineId)
        throw new errors_1.ValidationError("lineId is required.");
    yield (0, callerScope_1.requireHr)(req, q.lineId, "listing step increments");
    const rows = yield prismaList(q);
    return res.code(200).send({ list: rows });
});
exports.stepIncrementsList = stepIncrementsList;
// Kept out of the handler so the query reads in one piece.
const prismaList = (q) => __awaiter(void 0, void 0, void 0, function* () {
    const { prisma } = yield Promise.resolve().then(() => __importStar(require("../barrel/prisma")));
    return prisma.stepIncrement.findMany({
        where: Object.assign(Object.assign({ lineId: q.lineId }, (q.userId ? { userId: q.userId } : {})), (q.status ? { status: q.status } : {})),
        orderBy: [{ proposedAt: "desc" }],
        take: 500,
        select: {
            id: true,
            userId: true,
            fromStep: true,
            toStep: true,
            basis: true,
            effectiveDate: true,
            serviceFrom: true,
            serviceTo: true,
            lwopDays: true,
            status: true,
            certifiedSatisfactory: true,
            nosiNumber: true,
            note: true,
            proposedAt: true,
            decidedAt: true,
            user: { select: { firstName: true, lastName: true } },
            decidedBy: { select: { firstName: true, lastName: true } },
        },
    });
});
/**
 * POST /hr/step-increments/service-record
 *   { lineId, userId, originalAppointmentDate?, presentPositionDate?,
 *     stepEffectiveDate?, step? }
 *
 * Recording what is already true, so the arithmetic has something to work
 * from. A field left out is left alone; an empty string clears it.
 */
const stepIncrementsSetServiceRecord = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    const lineId = typeof (body === null || body === void 0 ? void 0 : body.lineId) === "string" ? body.lineId : "";
    const userId = typeof (body === null || body === void 0 ? void 0 : body.userId) === "string" ? body.userId : "";
    if (!lineId || !userId) {
        throw new errors_1.ValidationError("lineId and userId are required.");
    }
    const caller = yield (0, callerScope_1.requireHr)(req, lineId, "editing a service record");
    /* "" clears the date, a missing key leaves it untouched. */
    const dateField = (key) => {
        if (!(key in body))
            return undefined;
        const raw = body[key];
        if (raw === null || raw === "")
            return null;
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) {
            throw new errors_1.ValidationError(`\`${key}\` is not a date.`);
        }
        return d;
    };
    let step = undefined;
    if ("step" in body) {
        const raw = body.step;
        if (raw === null || raw === "")
            step = null;
        else {
            step = Number(raw);
            if (!Number.isFinite(step))
                throw new errors_1.ValidationError("`step` is not a number.");
        }
    }
    const out = yield (0, stepIncrement_1.setServiceRecord)({
        userId,
        lineId,
        byUserId: caller.actorId,
        originalAppointmentDate: dateField("originalAppointmentDate"),
        presentPositionDate: dateField("presentPositionDate"),
        stepEffectiveDate: dateField("stepEffectiveDate"),
        step,
    });
    if (!out.ok)
        throw new errors_1.ValidationError(out.why);
    return res.code(200).send({ message: "OK" });
});
exports.stepIncrementsSetServiceRecord = stepIncrementsSetServiceRecord;
