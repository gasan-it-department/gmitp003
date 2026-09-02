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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.containerDatasets = exports.restockSupply = exports.uploadBulkExcel = exports.timebaseReportExport = exports.timebaseReport = exports.unitSupplyDispenseRecords = exports.userSupplyDispenseRecords = exports.supplyTransactionInfo = exports.removeStockInList = exports.supplyTimeBaseReport = exports.supplyDispenseTransaction = exports.categories = exports.timebaseSupplyReport = exports.supplyList = exports.dispenseItem = exports.updateSupplyDispense = exports.dispenseSupply = exports.newOrder = exports.updateSupply = exports.deleteSupply = exports.addSupply = void 0;
const prisma_1 = require("../barrel/prisma");
const exceljs_1 = __importDefault(require("exceljs"));
const stream_1 = require("stream");
const handler_1 = require("../middleware/handler");
const errors_1 = require("../errors/errors");
const date_1 = require("../utils/date");
const addSupply = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        if (!body.item || !body.suppliesDataSetId || !body.lineId) {
            return res.code(400).send({ message: "Bad Request" });
        }
        const code = yield (0, handler_1.generatedItemCode)();
        yield prisma_1.prisma.$transaction([
            prisma_1.prisma.supplies.create({
                data: {
                    item: body.item,
                    suppliesDataSetId: body.suppliesDataSetId,
                    lineId: body.lineId,
                    description: body.description,
                    consumable: body.consumable,
                    code,
                },
            }),
            prisma_1.prisma.inventoryAccessLogs.create({
                data: {
                    userId: body.userId,
                    inventoryBoxId: body.inventoryBoxId,
                    action: `Added Supply: ${body.item}`,
                    timestamp: new Date(),
                },
            }),
        ]);
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.addSupply = addSupply;
const deleteSupply = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.query;
        if (!body.id || !body.userId || !body.inventoryBoxId) {
            return res.code(400).send({ message: "Bad Request!" });
        }
        yield prisma_1.prisma.$transaction([
            prisma_1.prisma.supplies.delete({
                where: {
                    id: body.id,
                },
            }),
            prisma_1.prisma.inventoryAccessLogs.create({
                data: {
                    action: "Deleted an item.",
                    inventoryBoxId: body.inventoryBoxId,
                    userId: body.userId,
                    timestamp: new Date(),
                },
            }),
        ]);
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.deleteSupply = deleteSupply;
const updateSupply = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        if (!body.id) {
            return res.code(400).send({ message: "Bad Request" });
        }
        const toUpdate = {
            consumable: body.consumable,
        };
        if (body.item) {
            toUpdate.item = body.item;
        }
        if (body.description) {
            toUpdate.description = body.description;
        }
        yield prisma_1.prisma.$transaction([
            prisma_1.prisma.supplies.update({
                where: {
                    id: body.id,
                },
                data: toUpdate,
            }),
            // prisma.inventoryAccessLogs.create({
            //   data:{
            //   }
            // })
        ]);
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.updateSupply = updateSupply;
const newOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const params = req.body;
        console.log("New ORder:", params);
        const refNumber = yield (0, handler_1.generateOrderRef)();
        const response = yield prisma_1.prisma.supplyBatchOrder.create({
            data: {
                title: params.title,
                refNumber,
                supplyBatchId: params.id,
                status: 0,
                lineId: params.lineId,
            },
        });
        res.code(200).send({ message: "OK", data: response });
    }
    catch (error) {
        console.log(error);
        res.code(500).send({ message: "Internal Server Error" });
    }
});
exports.newOrder = newOrder;
const dispenseSupply = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id || !body.quantity || parseInt(body.quantity, 10) <= 0) {
        throw new errors_1.ValidationError("Item ID and positive quantity are required");
    }
    // Offline desktop dispenses carry a stable clientOpId so a retried push is
    // idempotent — if we've already recorded this op, return OK without
    // deducting stock again.
    const clientOpId = req.body.clientOpId;
    try {
        if (clientOpId) {
            const existing = yield prisma_1.prisma.supplyDispenseRecord.findUnique({
                where: { clientOpId },
                select: { id: true },
            });
            if (existing) {
                return res.code(200).send({
                    success: true,
                    duplicate: true,
                    message: "Already dispensed (idempotent replay).",
                });
            }
        }
        const stock = yield prisma_1.prisma.supplyStockTrack.findUnique({
            where: {
                id: body.id,
            },
            select: {
                quantity: true,
                perQuantity: true,
                id: true,
                stock: true,
                suppliesId: true,
                desc: true,
            },
        });
        if (!stock) {
            throw new errors_1.NotFoundError("ITEM NOT FOUND");
        }
        const currentBoxes = stock.quantity;
        const perBox = stock.perQuantity;
        const currentStockPieces = stock.stock;
        const toDispense = parseInt(body.quantity, 10);
        // Check if database consistency issue
        if (currentStockPieces !== currentBoxes * perBox) {
            console.warn(`Database inconsistency:
        stock.stock = ${currentStockPieces},
        but quantity * perQuantity = ${currentBoxes * perBox}`);
            // You might want to fix this or use stock.stock as source of truth
        }
        // Check if enough stock
        if (toDispense > currentStockPieces) {
            throw new errors_1.ValidationError(`Insufficient stock. Available: ${currentStockPieces}, Requested: ${toDispense}`);
        }
        // Calculate dispensing details - FIXED LOGIC
        const fullBoxesToGive = Math.floor(toDispense / perBox);
        const loosePieces = toDispense % perBox;
        console.log("Dispensing calculation:", {
            fullBoxesToGive,
            loosePieces,
        });
        // Calculate remaining inventory - SIMPLIFIED CORRECT LOGIC
        let remainingFullBoxes = currentBoxes - fullBoxesToGive;
        let openedBoxRemainingPieces = 0;
        if (loosePieces > 0) {
            // We need to open a box for loose pieces
            remainingFullBoxes -= 1; // Remove the box we're opening
            openedBoxRemainingPieces = perBox - loosePieces; // What's left in that opened box
        }
        // Total pieces calculation
        const remainingPieces = remainingFullBoxes * perBox + openedBoxRemainingPieces;
        // Also calculate expected remaining pieces
        const expectedRemainingPieces = currentStockPieces - toDispense;
        console.log("Remaining calculation:", {
            remainingFullBoxes,
            openedBoxRemainingPieces,
            remainingPieces,
            expectedRemainingPieces,
            check: remainingPieces === expectedRemainingPieces,
        });
        // Verify calculation matches
        if (remainingPieces !== expectedRemainingPieces) {
            console.error("Calculation mismatch details:", {
                currentStockPieces,
                toDispense,
                remainingPieces,
                expectedRemainingPieces,
                difference: remainingPieces - expectedRemainingPieces,
            });
            throw new Error(`Inventory calculation mismatch:
        Got ${remainingPieces}, Expected ${expectedRemainingPieces}`);
        }
        // Prepare update data
        // The quantity field should represent total boxes (full + partial)
        const totalBoxesAfter = remainingFullBoxes + (openedBoxRemainingPieces > 0 ? 1 : 0);
        const updateData = {
            quantity: totalBoxesAfter,
            stock: remainingPieces,
        };
        console.log("Update data:", updateData);
        // Prepare data for dispense record - Using ALL fields from your schema
        const dispenseRecordData = {
            refCode: yield (0, handler_1.generateDispenseRef)(),
            clientOpId: clientOpId || undefined,
            quantity: toDispense.toString(),
            suppliesId: stock.suppliesId,
            supplyStockTrackId: stock.id,
            remarks: body.remark || `Dispensed ${toDispense} pieces`,
            inventoryBoxId: body.inventoryBoxId,
            supplyBatchId: body.listId,
            desc: stock.desc,
        };
        // Add optional fields based on request body
        if (body.unitId) {
            dispenseRecordData.departmentId = body.unitId;
        }
        // Add user info - userId might be the recipient
        if (body.userId && body.userId.trim() !== "") {
            dispenseRecordData.userId = body.userId;
        }
        // Add dispensary info - currUserId might be the person dispensing
        if (body.currUserId) {
            dispenseRecordData.dispensaryId = body.currUserId;
        }
        console.log("Dispense record data:", dispenseRecordData);
        // Use transaction to ensure both operations succeed or fail together
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Update stock
            yield tx.supplyStockTrack.update({
                where: { id: body.id },
                data: updateData,
            });
            // Create dispense record - Now with all valid fields
            yield tx.supplyDispenseRecord.create({
                data: dispenseRecordData,
            });
            return "OK";
        }));
        if (!response)
            throw new errors_1.ValidationError("FAILED TO DISPENSE");
        // Return success response with details
        return res.code(200).send({
            success: true,
            message: `Successfully dispensed ${toDispense} pieces`,
            data: {
                dispensedQuantity: toDispense,
                dispensingDetails: {
                    fullBoxesGiven: fullBoxesToGive,
                    loosePiecesGiven: loosePieces,
                },
                newStockLevels: {
                    totalBoxes: totalBoxesAfter,
                    totalPieces: remainingPieces,
                    fullBoxes: remainingFullBoxes,
                    loosePiecesInOpenedBox: openedBoxRemainingPieces,
                },
                previousStockLevels: {
                    totalBoxes: currentBoxes,
                    totalPieces: currentStockPieces,
                },
                dispenseRecord: {
                    departmentId: body.unitId,
                    userId: body.userId,
                    dispensaryId: body.currUserId,
                    remarks: body.remark,
                },
            },
        });
    }
    catch (error) {
        console.error("Error in dispenseItem:", error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            switch (error.code) {
                case "P2002":
                    throw new errors_1.AppError("DUPLICATE_ENTRY", 409, "Duplicate record");
                case "P2003":
                    throw new errors_1.AppError("FOREIGN_KEY_CONSTRAINT", 400, "Invalid reference");
                case "P2025":
                    throw new errors_1.AppError("RECORD_NOT_FOUND", 404, "Record not found");
                default:
                    console.error("Prisma error code:", error.code);
                    throw new errors_1.AppError("DB_ERROR", 500, "Database operation failed");
            }
        }
        if (error instanceof errors_1.ValidationError) {
            throw error;
        }
        if (error instanceof errors_1.NotFoundError) {
            throw error;
        }
        if (error instanceof Error) {
            console.error("Error stack:", error.stack);
            if (error.message.includes("Insufficient stock") ||
                error.message.includes("Inventory calculation")) {
                throw new errors_1.ValidationError(error.message);
            }
        }
        throw new errors_1.AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    }
});
exports.dispenseSupply = dispenseSupply;
/**
 * "Update" a dispense transaction by creating a compensating audit record.
 * The original record is left untouched (sacred history). A new
 * SupplyDispenseRecord is created that captures the delta:
 *   - quantity is signed (e.g. "-20" = return to stock, "+15" = extra deduct)
 *   - recipient = new recipient (or same as original if unchanged)
 *   - desc links back to the original via "ADJ:<originalId>"
 *   - stock is adjusted by the delta (return increases stock, extra decreases)
 */
const updateSupplyDispense = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    if (!body.id)
        throw new errors_1.ValidationError("Transaction ID is required");
    try {
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const original = yield tx.supplyDispenseRecord.findUnique({
                where: { id: body.id },
                include: {
                    supply: {
                        select: {
                            id: true,
                            stock: true,
                            quantity: true,
                            perQuantity: true,
                        },
                    },
                    user: { select: { id: true, firstName: true, lastName: true, username: true } },
                    unit: { select: { id: true, name: true } },
                },
            });
            if (!original)
                throw new errors_1.NotFoundError("Dispense record not found");
            if (!original.supply || !original.supplyStockTrackId)
                throw new errors_1.ValidationError("Dispense record has no linked stock — cannot adjust quantity.");
            // Adjustment records (created by previous edits) cannot be re-edited.
            if (original.desc && original.desc.startsWith("ADJ:"))
                throw new errors_1.ValidationError("This is an adjustment record and cannot be edited.");
            const stock = original.supply;
            const perQ = stock.perQuantity || 1;
            const currentStockPieces = stock.stock;
            const oldQty = parseInt(original.quantity, 10) || 0;
            const parentRef = (_a = original.refCode) !== null && _a !== void 0 ? _a : original.id.slice(0, 8);
            // Human-readable label for the original recipient
            const labelRecipient = (userId, unitId, user, unit) => {
                var _a;
                if (unitId && (unit === null || unit === void 0 ? void 0 : unit.name))
                    return `Unit: ${unit.name}`;
                if (userId && user) {
                    const nm = [user.firstName, user.lastName].filter(Boolean).join(" ");
                    return nm ? `User: ${nm}` : `User: @${(_a = user.username) !== null && _a !== void 0 ? _a : userId}`;
                }
                return "Unassigned";
            };
            const originalRecipientLabel = labelRecipient(original.userId, original.departmentId, original.user, original.unit);
            // ────────────────────────────────────────────────────────────────
            // TRANSFER MODE — split N units to a new recipient
            // ────────────────────────────────────────────────────────────────
            if (body.mode === "transfer") {
                const transferQty = parseInt((_b = body.transferQuantity) !== null && _b !== void 0 ? _b : "", 10);
                if (Number.isNaN(transferQty) || transferQty <= 0)
                    throw new errors_1.ValidationError("Transfer quantity must be a positive number.");
                if (transferQty > oldQty)
                    throw new errors_1.ValidationError(`Cannot transfer ${transferQty} units — original transaction only has ${oldQty} units.`);
                const newToUserId = body.toUserId || null;
                const newToUnitId = body.toUnitId || null;
                if (!newToUserId && !newToUnitId)
                    throw new errors_1.ValidationError("Specify a destination user or unit for the transfer.");
                if (newToUserId && newToUnitId)
                    throw new errors_1.ValidationError("Pick exactly one destination — either a user OR a unit.");
                // Look up the destination's label for nicer remarks
                let destinationLabel = "";
                if (newToUserId) {
                    const u = yield tx.user.findUnique({
                        where: { id: newToUserId },
                        select: { firstName: true, lastName: true, username: true },
                    });
                    const nm = u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "";
                    destinationLabel = nm
                        ? `User: ${nm}`
                        : `User: @${(_c = u === null || u === void 0 ? void 0 : u.username) !== null && _c !== void 0 ? _c : newToUserId}`;
                }
                else if (newToUnitId) {
                    const d = yield tx.department.findUnique({
                        where: { id: newToUnitId },
                        select: { name: true },
                    });
                    destinationLabel = `Unit: ${(_d = d === null || d === void 0 ? void 0 : d.name) !== null && _d !== void 0 ? _d : newToUnitId}`;
                }
                // Allocate two ref codes
                const deductRef = yield (0, handler_1.generateDispenseRef)();
                const transferRef = yield (0, handler_1.generateDispenseRef)();
                // 1) Deduction from original recipient
                const remarksDeduct = `Transferred ${transferQty} units to ${destinationLabel}. ` +
                    `Original txn ${parentRef} reduced from ${oldQty} → ${oldQty - transferQty}. ` +
                    `See ${transferRef} for the receiving side.`;
                const deduction = yield tx.supplyDispenseRecord.create({
                    data: {
                        refCode: deductRef,
                        quantity: `-${transferQty}`,
                        suppliesId: original.suppliesId,
                        supplyStockTrackId: original.supplyStockTrackId,
                        inventoryBoxId: original.inventoryBoxId,
                        supplyBatchId: original.supplyBatchId,
                        userId: original.userId, // keep original recipient
                        departmentId: original.departmentId,
                        dispensaryId: body.currUserId || original.dispensaryId,
                        desc: `ADJ:${original.id}`,
                        remarks: body.remarks
                            ? `${remarksDeduct} | ${body.remarks}`
                            : remarksDeduct,
                    },
                });
                // 2) Receipt by the new recipient
                const remarksTransfer = `Received ${transferQty} units transferred from ${originalRecipientLabel}. ` +
                    `Source txn ${parentRef}. See ${deductRef} for the deduction side.`;
                const transferIn = yield tx.supplyDispenseRecord.create({
                    data: {
                        refCode: transferRef,
                        quantity: `+${transferQty}`,
                        suppliesId: original.suppliesId,
                        supplyStockTrackId: original.supplyStockTrackId,
                        inventoryBoxId: original.inventoryBoxId,
                        supplyBatchId: original.supplyBatchId,
                        userId: newToUserId,
                        departmentId: newToUnitId,
                        dispensaryId: body.currUserId || original.dispensaryId,
                        desc: `ADJ:${original.id}`,
                        remarks: body.remarks
                            ? `${remarksTransfer} | ${body.remarks}`
                            : remarksTransfer,
                    },
                });
                // NO stock change — items physically just moved between recipients.
                return { mode: "transfer", deduction, transferIn };
            }
            // ────────────────────────────────────────────────────────────────
            // ADJUST MODE (default) — quantity delta and/or recipient reassign
            // ────────────────────────────────────────────────────────────────
            // ── Compute the quantity delta (if quantity was sent) ─────────────
            let delta = 0;
            let quantityChanged = false;
            if (body.quantity !== undefined && body.quantity !== null) {
                const newQty = parseInt(body.quantity, 10);
                if (isNaN(newQty) || newQty < 0)
                    throw new errors_1.ValidationError("Quantity must be a non-negative number");
                delta = newQty - oldQty;
                if (delta !== 0)
                    quantityChanged = true;
            }
            // ── Resolve the new recipient (or keep original) ──────────────────
            let recipientChanged = false;
            let newUserId = (_e = original.userId) !== null && _e !== void 0 ? _e : null;
            let newDepartmentId = (_f = original.departmentId) !== null && _f !== void 0 ? _f : null;
            if (body.userId !== undefined) {
                const v = body.userId || null;
                if (v !== original.userId) {
                    newUserId = v;
                    newDepartmentId = v ? null : newDepartmentId; // mutually exclusive
                    recipientChanged = true;
                }
            }
            if (body.unitId !== undefined) {
                const v = body.unitId || null;
                if (v !== original.departmentId) {
                    newDepartmentId = v;
                    newUserId = v ? null : newUserId; // mutually exclusive
                    recipientChanged = true;
                }
            }
            if (!quantityChanged && !recipientChanged)
                throw new errors_1.ValidationError("Nothing to update.");
            // ── Apply stock delta (only if quantity changed) ────────────────────
            if (quantityChanged) {
                // delta > 0 → need more pieces from stock
                // delta < 0 → return abs(delta) pieces back to stock
                const newStockPieces = currentStockPieces - delta;
                if (newStockPieces < 0) {
                    throw new errors_1.ValidationError(`Insufficient stock to increase dispense. Available: ${currentStockPieces}, additional needed: ${delta}`);
                }
                const newBoxes = newStockPieces === 0 ? 0 : Math.ceil(newStockPieces / perQ);
                yield tx.supplyStockTrack.update({
                    where: { id: stock.id },
                    data: { stock: newStockPieces, quantity: newBoxes },
                });
            }
            // ── Build clear, human-readable remarks ────────────────────────────
            const parts = [];
            if (quantityChanged) {
                if (delta > 0) {
                    parts.push(`Additional ${delta} unit${delta === 1 ? "" : "s"} dispensed (was ${oldQty}, now ${oldQty + delta}); deducted from stock.`);
                }
                else {
                    parts.push(`${Math.abs(delta)} unit${Math.abs(delta) === 1 ? "" : "s"} returned to stock (was ${oldQty}, now ${oldQty + delta}).`);
                }
            }
            if (recipientChanged) {
                // Best-effort label for the new recipient
                let newRecipientLabel = "Unassigned";
                if (newDepartmentId) {
                    const d = yield tx.department.findUnique({
                        where: { id: newDepartmentId },
                        select: { name: true },
                    });
                    newRecipientLabel = `Unit: ${(_g = d === null || d === void 0 ? void 0 : d.name) !== null && _g !== void 0 ? _g : newDepartmentId}`;
                }
                else if (newUserId) {
                    const u = yield tx.user.findUnique({
                        where: { id: newUserId },
                        select: { firstName: true, lastName: true, username: true },
                    });
                    const nm = u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "";
                    newRecipientLabel = nm
                        ? `User: ${nm}`
                        : `User: @${(_h = u === null || u === void 0 ? void 0 : u.username) !== null && _h !== void 0 ? _h : newUserId}`;
                }
                parts.push(`Recipient reassigned: ${originalRecipientLabel} → ${newRecipientLabel}.`);
            }
            const autoRemarks = `Adjustment of txn ${parentRef}: ${parts.join(" ")}`;
            const finalRemarks = body.remarks
                ? `${autoRemarks} | ${body.remarks}`
                : autoRemarks;
            const refCode = yield (0, handler_1.generateDispenseRef)();
            const signedQty = quantityChanged
                ? delta > 0
                    ? `+${delta}`
                    : `${delta}`
                : "0";
            const adjustment = yield tx.supplyDispenseRecord.create({
                data: {
                    refCode,
                    quantity: signedQty,
                    suppliesId: original.suppliesId,
                    supplyStockTrackId: original.supplyStockTrackId,
                    inventoryBoxId: original.inventoryBoxId,
                    supplyBatchId: original.supplyBatchId,
                    userId: newUserId,
                    departmentId: newDepartmentId,
                    dispensaryId: body.currUserId || original.dispensaryId,
                    desc: `ADJ:${original.id}`,
                    remarks: finalRemarks,
                },
            });
            return { mode: "adjust", adjustment };
        }));
        return res.code(200).send({ message: "OK", data: result });
    }
    catch (error) {
        console.error("Error in updateSupplyDispense:", error);
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof errors_1.NotFoundError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.updateSupplyDispense = updateSupplyDispense;
const dispenseItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.body;
    console.log("Request body:", body);
    if (!body.id || !body.quantity) {
        throw new errors_1.ValidationError("Item ID and positive quantity are required");
    }
    try {
        console.log("Log 1 - Starting transaction");
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // 1. Get the current stock item with all necessary details
            const stockItem = yield tx.supplyStockTrack.findUnique({
                where: {
                    id: body.id,
                },
                select: {
                    id: true,
                    stock: true,
                    quality: true,
                    quantity: true,
                    perQuantity: true,
                    suppliesId: true,
                },
            });
            console.log("Log 2 - Stock item found:", stockItem === null || stockItem === void 0 ? void 0 : stockItem.id);
            if (!stockItem) {
                throw new errors_1.ValidationError("Supply item not found");
            }
            const currentStock = stockItem.stock || 0;
            const currentQuantity = stockItem.quantity || 0;
            const currentPerQuantity = stockItem.perQuantity || 0;
            const toDispense = parseInt(body.quantity, 10);
            console.log("Log 3 - Current values:", {
                currentStock,
                currentQuantity,
                currentPerQuantity,
                toDispense,
            });
            // Validate we have enough stock
            if (currentStock < toDispense) {
                throw new errors_1.ValidationError("Insufficient stock available");
            }
            // Calculate the dispensing logic (same algorithm as prescriptionDispense)
            console.log("Log 4 - Starting stock calculation");
            let perQuantityReal;
            let perQuantityRemainder;
            if (currentPerQuantity > 0) {
                // If we have a perQuantity value, use the same logic as prescriptionDispense
                perQuantityReal =
                    toDispense > currentPerQuantity
                        ? Math.floor(toDispense / currentPerQuantity)
                        : toDispense;
                perQuantityRemainder =
                    toDispense >= currentPerQuantity
                        ? toDispense % currentPerQuantity
                        : currentPerQuantity;
            }
            else {
                // If perQuantity is 0, we just deduct from quantity directly
                perQuantityReal = toDispense;
                perQuantityRemainder = 0;
            }
            console.log("Log 5 - Calculation results:", {
                perQuantityReal,
                perQuantityRemainder,
            });
            const newQuantity = currentQuantity - perQuantityReal;
            const newPerQuantity = currentPerQuantity - perQuantityRemainder;
            // Ensure no negative values
            const finalQuantity = Math.max(0, newQuantity);
            const finalPerQuantity = Math.max(0, newPerQuantity);
            // Calculate new total stock
            const newTotalStock = finalQuantity * finalPerQuantity;
            console.log("Log 6 - Updated values:", {
                newQuantity: finalQuantity,
                newPerQuantity: finalPerQuantity,
                newTotalStock,
            });
            // 2. Create the dispense record
            console.log("Log 7 - Creating dispense record");
            yield tx.supplyDispenseRecord.create({
                data: {
                    refCode: yield (0, handler_1.generateDispenseRef)(),
                    supplyStockTrackId: body.id,
                    quantity: toDispense.toString(),
                    remarks: body.desc || "",
                    userId: body.userId || null,
                    departmentId: body.unitId || null,
                },
            });
            // 3. Update the stock by deducting the quantity
            console.log("Log 8 - Updating stock track");
            yield tx.supplyStockTrack.update({
                where: {
                    id: body.id,
                },
                data: {
                    stock: newTotalStock,
                    quantity: finalQuantity,
                    perQuantity: finalPerQuantity,
                },
            });
            // 4. Create a log entry for tracking
            console.log("Log 9 - Creating system log");
            // await tx.systemLogs.create({
            //   data: {
            //     userId: body.userId || null,
            //     action: "DISPENSE_ITEM",
            //     message: `Dispensed ${toDispense} units of supply item ${stockItem.supplyId}`,
            //     details: JSON.stringify({
            //       stockItemId: body.id,
            //       quantityDispensed: toDispense,
            //       previousStock: currentStock,
            //       newStock: newTotalStock,
            //       remarks: body.desc
            //     }),
            //   },
            // });
            console.log("Log 10 - Transaction completed successfully");
        }));
        res.code(200).send({
            success: true,
            message: "Item dispensed successfully",
        });
    }
    catch (error) {
        console.error("Error in dispenseItem:", error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            // Handle specific Prisma errors
            switch (error.code) {
                case "P2002":
                    throw new errors_1.AppError("DUPLICATE_ENTRY", 409, "Duplicate record");
                case "P2003":
                    throw new errors_1.AppError("FOREIGN_KEY_CONSTRAINT", 400, "Invalid reference");
                case "P2025":
                    throw new errors_1.AppError("RECORD_NOT_FOUND", 404, "Record not found");
                default:
                    console.error("Prisma error code:", error.code);
                    throw new errors_1.AppError("DB_ERROR", 500, "Database operation failed");
            }
        }
        if (error instanceof errors_1.ValidationError) {
            throw error;
        }
        if (error instanceof Error) {
            console.error("Error stack:", error.stack);
        }
        throw new errors_1.AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    }
});
exports.dispenseItem = dispenseItem;
const supplyList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        const take = params.limit ? parseInt(params.limit, 10) : 20;
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        // Build search filter on Supplies (item name / refNumber)
        const searchFilter = {};
        if (params.query) {
            const terms = params.query.trim().split(/\s+/);
            if (terms.length === 1) {
                searchFilter.OR = [
                    { item: { contains: terms[0], mode: "insensitive" } },
                    { refNumber: { contains: terms[0], mode: "insensitive" } },
                ];
            }
            else {
                searchFilter.AND = terms.map((term) => ({
                    OR: [
                        { item: { contains: term, mode: "insensitive" } },
                        { refNumber: { contains: term, mode: "insensitive" } },
                    ],
                }));
            }
        }
        // Return Supplies rows joined to the list via their stock-tracks.
        const supplies = yield prisma_1.prisma.supplies.findMany({
            where: Object.assign(Object.assign({}, searchFilter), { SupplyStockTrack: {
                    some: { supplyBatchId: params.id },
                } }),
            skip: cursor ? 1 : 0,
            take,
            cursor,
            orderBy: { item: "asc" },
            include: {
                SupplyStockTrack: {
                    where: { supplyBatchId: params.id },
                    orderBy: { timestamp: "desc" },
                    include: {
                        brand: {
                            select: { brand: true, model: true },
                            orderBy: { timestamp: "desc" },
                            take: 1,
                        },
                        // Pulled so the Dispense flow can label each batch with its
                        // supplier name (e.g. "Stock: 12 → Supplier 1"). Null when
                        // the stock row was created without a supplier reference.
                        supplier: { select: { id: true, name: true } },
                    },
                },
                SupplyPriceTrack: {
                    select: { value: true, timestamp: true },
                    orderBy: { timestamp: "desc" },
                    take: 1,
                },
            },
        });
        // Attach computed `totalStock` per supply (sum of quantity * perQuantity)
        const list = supplies.map((s) => {
            var _a;
            const tracks = (_a = s.SupplyStockTrack) !== null && _a !== void 0 ? _a : [];
            const totalStock = tracks.reduce((sum, t) => { var _a; return sum + ((_a = t.quantity) !== null && _a !== void 0 ? _a : 0) * (t.perQuantity || 1); }, 0);
            return Object.assign(Object.assign({}, s), { totalStock });
        });
        const newLastCursorId = list.length > 0 ? list[list.length - 1].id : null;
        const hasMore = list.length === take;
        return res.code(200).send({ list, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.supplyList = supplyList;
const timebaseSupplyReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("BAD_REQUEST");
    try {
        let period = 1;
        if (params.period === "Quarterly")
            period = 4;
        if (params.period === "Semi-Annual")
            period = 2;
        if (params.period === "Annually")
            period = 1;
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const currentYear = new Date().getFullYear();
        const startOfYear = new Date(currentYear, 0, 1); // Jan 1, current year
        const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);
        const response = yield prisma_1.prisma.supplyStockTrack.findMany({
            where: {
                supplyBatchId: params.id,
                supply: {
                    SupplyOrder: {
                        some: {
                            status: { not: "Drafted" },
                        },
                    },
                },
            },
            include: {
                price: {
                    where: {
                        timestamp: {
                            gte: startOfYear,
                            lt: endOfYear,
                        },
                    },
                    select: {
                        value: true,
                        timestamp: true,
                    },
                },
                supply: {
                    select: {
                        id: true,
                        item: true,
                    },
                },
            },
            cursor,
        });
        const groupedPrice = [];
        response.forEach((item) => {
            const existed = groupedPrice.find((stock) => stock.item.id === item.id);
            if (!existed) {
                groupedPrice.push({
                    item: item,
                    price: {
                        first: (0, date_1.getPriceTotal)(item.price, period, 1),
                        second: (0, date_1.getPriceTotal)(item.price, period, 2),
                        third: (0, date_1.getPriceTotal)(item.price, period, 3),
                        fourth: (0, date_1.getPriceTotal)(item.price, period, 4),
                    },
                });
            }
        });
        const newLastCursorId = groupedPrice.length > 0
            ? groupedPrice[groupedPrice.length - 1].item.id
            : null;
        const hasMore = groupedPrice.length === parseInt(params.limit, 10);
        return res
            .code(200)
            .send({ list: groupedPrice, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "DB_ERROR");
        }
        throw error;
    }
});
exports.timebaseSupplyReport = timebaseSupplyReport;
const categories = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    if (!params.query)
        return res.code(200).send({ list: [], lastCursor: null, hasMore: false });
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 10;
        const response = yield prisma_1.prisma.supplyCategory.findMany({
            where: {
                label: {
                    contains: params.query,
                    mode: "insensitive",
                },
            },
            take: limit,
            skip: cursor ? 1 : 0,
            cursor,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = limit === response.length;
        return res
            .code(200)
            .send({ list: response, hasMore, lastCursor: newLastCursorId });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.categories = categories;
const supplyDispenseTransaction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        const filter = {
            supplyBatchId: params.id,
        };
        // Date range filter on timestamp.
        // dateFrom = inclusive start of day, dateTo = inclusive end of day.
        if (params.dateFrom || params.dateTo) {
            filter.timestamp = {};
            if (params.dateFrom) {
                const start = new Date(params.dateFrom);
                start.setHours(0, 0, 0, 0);
                filter.timestamp.gte = start;
            }
            if (params.dateTo) {
                const end = new Date(params.dateTo);
                end.setHours(23, 59, 59, 999);
                filter.timestamp.lte = end;
            }
        }
        if (params.query) {
            const searchTerms = params.query.trim().split(/\s+/);
            // Create OR conditions for each search term
            filter.OR = searchTerms.map((term) => ({
                OR: [
                    // Search in user/dispensary names
                    {
                        user: {
                            OR: [
                                {
                                    firstName: {
                                        contains: term,
                                        mode: "insensitive",
                                    },
                                },
                                {
                                    lastName: {
                                        contains: term,
                                        mode: "insensitive",
                                    },
                                },
                            ],
                        },
                    },
                    {
                        dispensary: {
                            OR: [
                                {
                                    firstName: {
                                        contains: term,
                                        mode: "insensitive",
                                    },
                                },
                                {
                                    lastName: {
                                        contains: term,
                                        mode: "insensitive",
                                    },
                                },
                            ],
                        },
                    },
                    // Search in department name
                    {
                        unit: {
                            name: {
                                contains: term,
                                mode: "insensitive",
                            },
                        },
                    },
                    // Search in remarks
                    {
                        remarks: {
                            contains: term,
                            mode: "insensitive",
                        },
                    },
                    // Search in quantity (exact match for numbers)
                    {
                        quantity: {
                            equals: term,
                        },
                    },
                    // Search in ID fields (partial match)
                    {
                        id: {
                            contains: term,
                            mode: "insensitive",
                        },
                    },
                    // Search in supplyStockTrackId
                    {
                        supplyStockTrackId: {
                            contains: term,
                            mode: "insensitive",
                        },
                    },
                    // Search in suppliesId
                    {
                        suppliesId: {
                            contains: term,
                            mode: "insensitive",
                        },
                    },
                    // Search in userId
                    {
                        userId: {
                            contains: term,
                            mode: "insensitive",
                        },
                    },
                    // Search in departmentId
                    {
                        departmentId: {
                            contains: term,
                            mode: "insensitive",
                        },
                    },
                    // Search in inventoryBoxId
                    {
                        inventoryBoxId: {
                            contains: term,
                            mode: "insensitive",
                        },
                    },
                ],
            }));
        }
        const response = yield prisma_1.prisma.supplyDispenseRecord.findMany({
            where: filter,
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                    },
                },
                unit: {
                    select: {
                        name: true,
                    },
                },
                dispensary: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
            skip: cursor ? 1 : 0,
            orderBy: {
                timestamp: "desc",
            },
            cursor,
            take: limit,
        });
        const newLastCursorId = response.length > 0 ? response[response.length - 1].id : null;
        const hasMore = limit === response.length;
        return res
            .code(200)
            .send({ list: response, hasMore, lastCursor: newLastCursorId });
    }
    catch (error) {
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw (0, errors_1.dbError)(error);
        }
        throw error;
    }
});
exports.supplyDispenseTransaction = supplyDispenseTransaction;
const supplyTimeBaseReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    console.log({ params });
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    try {
        const currentYear = params.yearRange;
        let years = [];
        if (typeof currentYear === "string") {
            const trimmed = currentYear.trim();
            if (trimmed.includes("-")) {
                // Handle "2025-2026" format - get the last year (2026)
                const parts = trimmed.split("-");
                // Parse all parts and filter out invalid numbers
                const parsedYears = parts
                    .map((part) => parseInt(part.trim(), 10))
                    .filter((num) => !isNaN(num));
                if (parsedYears.length > 0) {
                    years = parsedYears;
                }
            }
            else {
                // Handle "2025" format - get that year
                const yearNum = parseInt(trimmed, 10);
                if (!isNaN(yearNum)) {
                    years = [yearNum];
                }
            }
        }
        console.log("Range: ", { years });
        const yearStart = years.length > 1 ? years[years.length - 1] : years[0];
        const yearEnd = years[0];
        // If yearStart is still NaN (unlikely with our validation), fallback to current year
        const finalYearStart = !isNaN(yearStart)
            ? yearStart
            : new Date().getFullYear();
        console.log("Selected Year: ", finalYearStart);
        const firstHalfStart = new Date(finalYearStart, 0, 1); // January 1
        const firstHalfEnd = new Date(finalYearStart, 5, 30, 23, 59, 59, 999); // June 30
        const secondHalfStart = new Date(yearEnd, 6, 1); // July 1
        const secondHalfEnd = new Date(yearEnd, 11, 31, 23, 59, 59, 999); // December 31
        console.log({
            firstHalfEnd: firstHalfEnd,
            firstHalfStart: firstHalfStart,
            secondHalfEnd: secondHalfEnd,
            secondHalfStart: secondHalfStart,
        });
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit) : 20;
        //console.log(JSON.stringify(supplies, null, 2));
        const response = yield prisma_1.prisma.supplies.findMany({
            where: {
                SupplieRecieveHistory: {
                    some: {
                        supplyBatchId: params.id,
                    },
                },
            },
            select: {
                id: true,
                item: true,
                SupplieRecieveHistory: {
                    where: {
                        supplyBatchId: params.id,
                    },
                    select: {
                        id: true,
                        perQuantity: true,
                        suppliesId: true,
                        pricePerItem: true,
                        quantity: true,
                        quality: true,
                        timestamp: true,
                    },
                    orderBy: {
                        timestamp: "asc",
                    },
                },
                supplyDispenseRecords: {
                    select: {
                        suppliesId: true,
                        quantity: true,
                        timestamp: true,
                    },
                },
                SuppliesDataSet: {
                    select: {
                        id: true,
                        title: true,
                    },
                },
                suppliesDataSetId: true,
            },
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
        });
        console.log({ response });
        const processedData = response.map((item) => {
            console.log("Entry");
            // Calculate individual supply data
            const firstHalfRecieved = item.SupplieRecieveHistory.reduce((base, acc) => {
                if (acc.timestamp >= firstHalfStart &&
                    acc.timestamp <= firstHalfEnd) {
                    console.log("1 R found");
                    return (base += acc.quantity);
                }
                return base;
            }, 0);
            const secondhalfRecieved = item.SupplieRecieveHistory.reduce((base, acc) => {
                if (acc.timestamp >= secondHalfStart &&
                    acc.timestamp <= secondHalfEnd) {
                    console.log("2 R found");
                    return (base += acc.quantity);
                }
                return base;
            }, 0);
            const firstHalfCost = item.SupplieRecieveHistory.reduce((base, acc) => {
                if (acc.timestamp >= firstHalfStart && acc.timestamp <= firstHalfEnd) {
                    console.log("1 C found");
                    return (base += acc.pricePerItem);
                }
                return base;
            }, 0);
            const secondhalfCost = item.SupplieRecieveHistory.reduce((base, acc) => {
                if (acc.timestamp >= secondHalfStart &&
                    acc.timestamp <= secondHalfEnd) {
                    return (base += acc.pricePerItem);
                }
                return base;
            }, 0);
            const firstHalfdispense = item.supplyDispenseRecords.reduce((base, acc) => {
                if (acc.timestamp >= firstHalfStart &&
                    acc.timestamp <= firstHalfEnd) {
                    const quantity = parseInt(acc.quantity);
                    return (base += quantity);
                }
                return base;
            }, 0);
            const secondHalfDispense = item.supplyDispenseRecords.reduce((base, acc) => {
                if (acc.timestamp >= secondHalfStart &&
                    acc.timestamp <= secondHalfEnd) {
                    const quantity = parseInt(acc.quantity);
                    return (base += quantity);
                }
                return base;
            }, 0);
            const totalQuantity = firstHalfRecieved + secondhalfRecieved;
            const totalInsuance = firstHalfdispense + secondHalfDispense;
            const totalBalance = totalQuantity - totalInsuance;
            return {
                id: item.id,
                name: item.item,
                firstHalfRecieved,
                secondhalfRecieved,
                firstHalfCost,
                secondhalfCost,
                firstHalfdispense,
                secondHalfDispense,
                totalQuantity,
                totalInsuance,
                totalBalanceQuantity: totalBalance,
                supplyDataSetId: item.suppliesDataSetId,
            };
        });
        const newLastCursorId = processedData.length > 0
            ? processedData[processedData.length - 1].id
            : null;
        const hasMore = limit === processedData.length;
        console.log({ processedData });
        return res
            .code(200)
            .send({ list: processedData, newLastCursorId, hasMore });
    }
    catch (error) {
        console.error("Error in supplyTimeBaseReport:", error);
        if (error instanceof errors_1.ValidationError) {
            throw error;
        }
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            console.error("Prisma error code:", error.code);
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
        }
        if (error instanceof Error) {
            console.error("Error stack:", error.stack);
        }
        throw new errors_1.AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    }
});
exports.supplyTimeBaseReport = supplyTimeBaseReport;
const removeStockInList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const body = req.query;
    console.log({ body });
    if (!body.id ||
        !body.inventoryId ||
        !body.lineId ||
        !body.listId ||
        !body.userId) {
        throw new errors_1.ValidationError("INVALID_REQUIRED_ID");
    }
    try {
        // First, check if all required related records exist
        const [stock, inventory, supplyBatch, line] = yield Promise.all([
            prisma_1.prisma.supplyStockTrack.findUnique({
                where: { id: body.id },
                select: {
                    id: true,
                    suppliesId: true,
                    quantity: true,
                    perQuantity: true,
                    quality: true,
                    // Add relation checks
                },
            }),
            prisma_1.prisma.inventoryBox.findUnique({
                where: { id: body.inventoryId },
                select: { id: true },
            }),
            prisma_1.prisma.supplyBatch.findUnique({
                where: { id: body.listId },
                select: { id: true },
            }),
            prisma_1.prisma.line.findUnique({
                where: { id: body.lineId },
                select: { id: true },
            }),
        ]);
        if (!stock) {
            throw new errors_1.ValidationError("STOCK_NOT_FOUND");
        }
        if (!inventory) {
            throw new errors_1.ValidationError("INVENTORY_NOT_FOUND");
        }
        if (!supplyBatch) {
            throw new errors_1.ValidationError("SUPPLY_BATCH_NOT_FOUND");
        }
        if (!line) {
            throw new errors_1.ValidationError("LINE_NOT_FOUND");
        }
        // Execute transaction
        const response = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // First, check if there are any dependent records that might cause null constraint
            // This depends on your schema - adjust based on actual relations
            // Option 1: If there are dependent records, handle them first
            // Example: Clear or update related records before delete
            // await tx.someRelatedModel.updateMany({
            //   where: { supplyStockTrackId: body.id },
            //   data: { supplyStockTrackId: null } // or another valid value
            // });
            // Option 2: Check if deletion is allowed
            const canDelete = yield tx.supplyStockTrack.findUnique({
                where: { id: body.id },
            });
            // Delete the stock record
            const deletedStock = yield tx.supplyStockTrack.delete({
                where: {
                    id: body.id,
                },
            });
            // Create the transaction record
            const transaction = yield tx.supplyTransaction.create({
                data: {
                    lineId: body.lineId,
                    supplyBatchId: body.listId,
                    userId: body.userId,
                    suppliesId: stock.suppliesId,
                    action: 3, // 0 - add, 1 - update, 3 - remove
                    quantity: stock.quantity,
                    perQuantity: stock.perQuantity,
                    quality: stock.quality || "N/A",
                    inventoryBoxId: body.inventoryId,
                    // If your schema requires linking to the deleted stock,
                    // you might need to store the ID differently or skip it
                    // supplyStockTrackId: body.id, // This might cause null constraint if NOT NULL
                },
                select: { id: true },
            });
            return {
                success: true,
                transactionId: transaction.id,
                deletedStockId: deletedStock.id,
            };
        }), {
            maxWait: 10000,
            timeout: 15000,
            isolationLevel: prisma_1.Prisma.TransactionIsolationLevel.Serializable, // Add isolation level
        });
        if (!response.success) {
            throw new errors_1.ValidationError("TRANSACTION_FAILED");
        }
        return res.code(200).send({
            message: "OK",
            transactionId: response.transactionId,
            deletedStockId: response.deletedStockId,
        });
    }
    catch (error) {
        console.error("Error in Remove Item:", error);
        // Handle specific Prisma errors
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            switch (error.code) {
                case "P2011":
                    console.error("Null constraint violation:", error.meta);
                    throw new errors_1.AppError("DELETION_CONSTRAINT_VIOLATION", 400, "Cannot delete this record due to database constraints. Please check related records.");
                case "P2025":
                    console.error("Record not found for deletion:", error.meta);
                    throw new errors_1.ValidationError("RECORD_NOT_FOUND_FOR_DELETION");
                case "P2028":
                    console.error("Transaction timeout occurred");
                    throw new errors_1.AppError("TRANSACTION_TIMEOUT", 408, "Transaction took too long to complete. Please try again.");
                case "P2003":
                    console.error("Foreign key constraint failed:", error.meta);
                    throw new errors_1.AppError("FOREIGN_KEY_CONSTRAINT", 400, "Cannot delete due to foreign key constraints.");
                default:
                    console.error("Prisma error code:", error.code, error.meta);
                    throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
            }
        }
        if (error instanceof errors_1.ValidationError) {
            throw error;
        }
        if (error instanceof errors_1.AppError) {
            throw error;
        }
        console.error("Unexpected error stack:", error instanceof Error ? error.stack : error);
        throw new errors_1.AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    }
});
exports.removeStockInList = removeStockInList;
const supplyTransactionInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const query = req.query;
    console.log({ query });
    if (!query.id) {
        throw new errors_1.ValidationError("INVALID_ID");
    }
    try {
        const transaction = yield prisma_1.prisma.supplyDispenseRecord.findUnique({
            where: {
                id: query.id,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        userProfilePictures: {
                            select: {
                                file_name: true,
                                file_size: true,
                                file_url: true,
                            },
                        },
                    },
                },
                unit: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                supply: {
                    select: {
                        supply: {
                            select: {
                                item: true,
                                refNumber: true,
                                code: true,
                            },
                        },
                        stock: true,
                    },
                },
                supplyItem: {
                    select: {
                        item: true,
                        id: true,
                        code: true,
                    },
                },
            },
        });
        if (!transaction) {
            throw new errors_1.ValidationError("TRANSACTION_NOT_FOUND");
        }
        return res.code(200).send(transaction);
    }
    catch (error) {
        console.error("Error in supplyTransactionInfo:", error);
        if (error instanceof errors_1.ValidationError) {
            throw error;
        }
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            console.error("Prisma error code:", error.code);
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
        }
        if (error instanceof Error) {
            console.error("Error stack:", error.stack);
        }
        throw new errors_1.AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    }
});
exports.supplyTransactionInfo = supplyTransactionInfo;
const userSupplyDispenseRecords = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const query = req.query;
    console.log({ query });
    if (!query.id) {
        throw new errors_1.ValidationError("INVALID_USER_ID");
    }
    try {
        const cursor = query.lastCursor ? { id: query.lastCursor } : undefined;
        const limit = query.limit ? parseInt(query.limit, 10) : 20;
        const records = yield prisma_1.prisma.supplyDispenseRecord.findMany({
            where: {
                userId: query.id,
            },
            include: {
                supply: {
                    select: {
                        supply: {
                            select: {
                                item: true,
                                refNumber: true,
                                code: true,
                            },
                        },
                        stock: true,
                    },
                },
                dispensary: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
        });
        console.log({ records });
        const newLastCursorId = records.length > 0 ? records[records.length - 1].id : null;
        const hasMore = records.length === limit;
        return res
            .code(200)
            .send({ list: records, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        console.error("Error in userSupplyDispenseRecords:", error);
        if (error instanceof errors_1.ValidationError) {
            throw error;
        }
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            console.error("Prisma error code:", error.code);
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
        }
        if (error instanceof Error) {
            console.error("Error stack:", error.stack);
        }
        throw new errors_1.AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    }
});
exports.userSupplyDispenseRecords = userSupplyDispenseRecords;
const unitSupplyDispenseRecords = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const query = req.query;
    console.log("Unit: ", { query });
    if (!query.id) {
        throw new errors_1.ValidationError("INVALID_UNIT_ID");
    }
    try {
        const cursor = query.lastCursor ? { id: query.lastCursor } : undefined;
        const limit = query.limit ? parseInt(query.limit, 10) : 20;
        const records = yield prisma_1.prisma.supplyDispenseRecord.findMany({
            where: {
                departmentId: query.id,
            },
            include: {
                dispensary: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                    },
                },
                supply: {
                    select: {
                        supply: {
                            select: {
                                item: true,
                                refNumber: true,
                                code: true,
                            },
                        },
                        stock: true,
                    },
                },
                supplyItem: {
                    select: {
                        item: true,
                        id: true,
                    },
                },
            },
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
        });
        const newLastCursorId = records.length > 0 ? records[records.length - 1].id : null;
        const hasMore = records.length === limit;
        return res
            .code(200)
            .send({ list: records, lastCursor: newLastCursorId, hasMore });
    }
    catch (error) {
        console.error("Error in unitSupplyDispenseRecords:", error);
        if (error instanceof errors_1.ValidationError) {
            throw error;
        }
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            console.error("Prisma error code:", error.code);
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
        }
        if (error instanceof Error) {
            console.error("Error stack:", error.stack);
        }
        throw new errors_1.AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    }
});
exports.unitSupplyDispenseRecords = unitSupplyDispenseRecords;
/**
 * Quarterly stock + dispense report.
 *
 * Behaviour:
 * - When `quarter` is a valid number (1-4): each item is returned as a
 *   per-quarter object whose populated field is the requested quarter only;
 *   dispense records are filtered to that quarter's date range.
 * - Otherwise: returns every item with all four quarters (q1..q4) computed,
 *   plus a full list of the dispense records for the year.
 */
/**
 * Inventory issuance report.
 *
 * Returns each stock-track row with up to the first 5 issuance (dispense)
 * records of the chosen year (optionally narrowed to a single quarter) laid
 * out as `first`, `second`, `third`, `fourth`, `fifth`. Records beyond the
 * 5th are still counted into `totalDispensed` so the balance math stays
 * correct.
 *
 * Query params:
 *   - id      (required) supplyBatchId
 *   - year    (optional, defaults to current year) — 4-digit issuance year
 *   - quarter (optional, 1..4) — narrows the issuance pool to that quarter
 *   - lastCursor / limit — standard cursor paging
 */
const timebaseReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id) {
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    }
    try {
        const cursor = params.lastCursor ? { id: params.lastCursor } : undefined;
        const limit = params.limit ? parseInt(params.limit, 10) : 20;
        // ── Year (defaults to current) ─────────────────────────────────────────
        const yearNum = typeof params.year === "number"
            ? params.year
            : typeof params.year === "string" && /^\d{4}$/.test(params.year.trim())
                ? parseInt(params.year.trim(), 10)
                : new Date().getFullYear();
        // ── Quarter (optional, 1..4) ───────────────────────────────────────────
        const quarterRaw = typeof params.quarter === "number"
            ? params.quarter
            : typeof params.quarter === "string" && params.quarter.trim() !== ""
                ? parseInt(params.quarter, 10)
                : NaN;
        const quarter = Number.isFinite(quarterRaw) && quarterRaw >= 1 && quarterRaw <= 4
            ? quarterRaw
            : null;
        // ── Date range — full year, or just the requested quarter ─────────────
        const quarterRanges = {
            1: {
                start: new Date(yearNum, 0, 1),
                end: new Date(yearNum, 2, 31, 23, 59, 59, 999),
            },
            2: {
                start: new Date(yearNum, 3, 1),
                end: new Date(yearNum, 5, 30, 23, 59, 59, 999),
            },
            3: {
                start: new Date(yearNum, 6, 1),
                end: new Date(yearNum, 8, 30, 23, 59, 59, 999),
            },
            4: {
                start: new Date(yearNum, 9, 1),
                end: new Date(yearNum, 11, 31, 23, 59, 59, 999),
            },
        };
        const rangeStart = quarter
            ? quarterRanges[quarter].start
            : new Date(yearNum, 0, 1);
        const rangeEnd = quarter
            ? quarterRanges[quarter].end
            : new Date(yearNum, 11, 31, 23, 59, 59, 999);
        const response = yield prisma_1.prisma.supplyStockTrack.findMany({
            where: { supplyBatchId: params.id },
            skip: cursor ? 1 : 0,
            take: limit,
            cursor,
            orderBy: { timestamp: "desc" },
            select: {
                SupplyDispenseRecord: {
                    where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
                    select: { quantity: true, timestamp: true },
                    orderBy: { timestamp: "asc" }, // chronological → first = earliest
                },
                supply: {
                    select: {
                        item: true,
                        SupplieRecieveHistory: {
                            // Initial QTY scoped to THIS list + the selected year/quarter
                            where: {
                                supplyBatchId: params.id,
                                timestamp: { gte: rangeStart, lte: rangeEnd },
                            },
                            select: {
                                quality: true,
                                perQuantity: true,
                                pricePerItem: true,
                                quantity: true,
                                timestamp: true,
                            },
                            orderBy: { timestamp: "desc" },
                        },
                    },
                },
                price: {
                    // Price fallback also scoped to the selected year/quarter
                    where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
                    select: { value: true, timestamp: true },
                    orderBy: { timestamp: "desc" },
                    take: 1,
                },
                stock: true,
                perQuantity: true,
                quantity: true,
                quality: true,
                id: true,
            },
        });
        const parseQty = (q) => q ? parseInt(q, 10) || 0 : 0;
        const slot = (records, index) => { var _a; return ((_a = records[index]) === null || _a === void 0 ? void 0 : _a.quantity) ? parseQty(records[index].quantity) : null; };
        const processedData = response.map((item) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
            const records = item.SupplyDispenseRecord;
            // Scope received qty to THIS batch (segmented by unit/quality + per-qty).
            // Receive history is fetched per supply+list, but a supply can have
            // several batches in one list — without this filter every batch row would
            // show the supply's combined receive total.
            const receiveHistory = ((_b = (_a = item.supply) === null || _a === void 0 ? void 0 : _a.SupplieRecieveHistory) !== null && _b !== void 0 ? _b : []).filter((r) => {
                var _a, _b;
                return ((_a = r.quality) !== null && _a !== void 0 ? _a : null) === ((_b = item.quality) !== null && _b !== void 0 ? _b : null) &&
                    (r.perQuantity || 0) === (item.perQuantity || 0);
            });
            // ── Initial QTY = Σ (receive.quantity × receive.perQuantity) ─────────
            const totalStock = receiveHistory.reduce((sum, r) => { var _a; return sum + ((_a = r.quantity) !== null && _a !== void 0 ? _a : 0) * (r.perQuantity || 1); }, 0);
            // Unit cost: latest pricePerItem from receive history, falling back to
            // SupplyPriceTrack, then 0.
            const latestPrice = (_g = (_d = (_c = receiveHistory[0]) === null || _c === void 0 ? void 0 : _c.pricePerItem) !== null && _d !== void 0 ? _d : (_f = (_e = item.price) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.value) !== null && _g !== void 0 ? _g : 0;
            const totalDispensed = records.reduce((sum, r) => sum + parseQty(r.quantity), 0);
            const remaining = totalStock - totalDispensed;
            return {
                id: item.id,
                desc: (_j = (_h = item.supply) === null || _h === void 0 ? void 0 : _h.item) !== null && _j !== void 0 ? _j : "N/A",
                unit: (_m = (_l = (_k = receiveHistory[0]) === null || _k === void 0 ? void 0 : _k.quality) !== null && _l !== void 0 ? _l : item.quality) !== null && _m !== void 0 ? _m : "N/A",
                first: slot(records, 0),
                second: slot(records, 1),
                third: slot(records, 2),
                fourth: slot(records, 3),
                fifth: slot(records, 4),
                recordedIssuances: records.length,
                totalDispensed,
                qty: totalStock, // initial QTY
                unitCost: latestPrice, // per-unit price
                totalCost: totalStock * latestPrice, // qty × unit cost
                balStock: remaining, // remaining stock on hand
                balAmount: remaining * latestPrice, // balance × unit cost
                // legacy aliases (kept so any older consumer doesn't break)
                totalStock,
                price: latestPrice,
            };
        });
        const newLastCursorId = processedData.length > 0
            ? processedData[processedData.length - 1].id
            : null;
        const hasMore = processedData.length === limit;
        return res.code(200).send({
            list: processedData,
            lastCursor: newLastCursorId,
            hasMore,
            meta: { year: yearNum, quarter: quarter !== null && quarter !== void 0 ? quarter : null },
        });
    }
    catch (error) {
        console.error("Error in timebaseReport:", error);
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            console.error("Prisma error code:", error.code);
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
        }
        if (error instanceof Error) {
            console.error("Error stack:", error.stack);
        }
        throw new errors_1.AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    }
});
exports.timebaseReport = timebaseReport;
/**
 * Excel export of the inventory issuance report.
 * Renders the SUPPLIES YYYY workbook layout: letterhead → "As of …" →
 * merged "ISSUANCE YYYY" header spanning 1ST..5TH → data rows → TOTAL →
 * Certified Correct block.
 */
const timebaseReportExport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED FIELD");
    try {
        const yearNum = typeof params.year === "number"
            ? params.year
            : typeof params.year === "string" && /^\d{4}$/.test(params.year.trim())
                ? parseInt(params.year.trim(), 10)
                : new Date().getFullYear();
        const quarterRaw = typeof params.quarter === "number"
            ? params.quarter
            : typeof params.quarter === "string" && params.quarter.trim() !== ""
                ? parseInt(params.quarter, 10)
                : NaN;
        const quarter = Number.isFinite(quarterRaw) && quarterRaw >= 1 && quarterRaw <= 4
            ? quarterRaw
            : null;
        const quarterRanges = {
            1: {
                start: new Date(yearNum, 0, 1),
                end: new Date(yearNum, 2, 31, 23, 59, 59, 999),
            },
            2: {
                start: new Date(yearNum, 3, 1),
                end: new Date(yearNum, 5, 30, 23, 59, 59, 999),
            },
            3: {
                start: new Date(yearNum, 6, 1),
                end: new Date(yearNum, 8, 30, 23, 59, 59, 999),
            },
            4: {
                start: new Date(yearNum, 9, 1),
                end: new Date(yearNum, 11, 31, 23, 59, 59, 999),
            },
        };
        const rangeStart = quarter
            ? quarterRanges[quarter].start
            : new Date(yearNum, 0, 1);
        const rangeEnd = quarter
            ? quarterRanges[quarter].end
            : new Date(yearNum, 11, 31, 23, 59, 59, 999);
        const rows = yield prisma_1.prisma.supplyStockTrack.findMany({
            where: { supplyBatchId: params.id },
            orderBy: { timestamp: "desc" },
            select: {
                SupplyDispenseRecord: {
                    where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
                    select: { quantity: true, timestamp: true },
                    orderBy: { timestamp: "asc" },
                },
                supply: {
                    select: {
                        item: true,
                        SupplieRecieveHistory: {
                            // Scoped to THIS list + the selected year/quarter range
                            where: {
                                supplyBatchId: params.id,
                                timestamp: { gte: rangeStart, lte: rangeEnd },
                            },
                            select: {
                                quantity: true,
                                perQuantity: true,
                                pricePerItem: true,
                                quality: true,
                                timestamp: true,
                            },
                            orderBy: { timestamp: "desc" },
                        },
                    },
                },
                price: {
                    // Price fallback also scoped to the selected year/quarter
                    where: { timestamp: { gte: rangeStart, lte: rangeEnd } },
                    select: { value: true, timestamp: true },
                    orderBy: { timestamp: "desc" },
                    take: 1,
                },
                stock: true,
                perQuantity: true,
                quantity: true,
                quality: true,
                id: true,
            },
        });
        const parseQty = (q) => q ? parseInt(q, 10) || 0 : 0;
        const items = rows.map((item) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
            const records = item.SupplyDispenseRecord;
            // Scope received qty to THIS batch (unit/quality + per-qty), matching the
            // on-screen report.
            const receiveHistory = ((_b = (_a = item.supply) === null || _a === void 0 ? void 0 : _a.SupplieRecieveHistory) !== null && _b !== void 0 ? _b : []).filter((r) => {
                var _a, _b;
                return ((_a = r.quality) !== null && _a !== void 0 ? _a : null) === ((_b = item.quality) !== null && _b !== void 0 ? _b : null) &&
                    (r.perQuantity || 0) === (item.perQuantity || 0);
            });
            // Initial QTY = Σ (receive.quantity × receive.perQuantity)
            const totalStock = receiveHistory.reduce((sum, r) => { var _a; return sum + ((_a = r.quantity) !== null && _a !== void 0 ? _a : 0) * (r.perQuantity || 1); }, 0);
            // Unit cost: latest pricePerItem from receive history → fallback to
            // SupplyPriceTrack → 0.
            const unitCost = (_g = (_d = (_c = receiveHistory[0]) === null || _c === void 0 ? void 0 : _c.pricePerItem) !== null && _d !== void 0 ? _d : (_f = (_e = item.price) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.value) !== null && _g !== void 0 ? _g : 0;
            const totalDispensed = records.reduce((s, r) => s + parseQty(r.quantity), 0);
            const balStock = totalStock - totalDispensed;
            return {
                desc: (_j = (_h = item.supply) === null || _h === void 0 ? void 0 : _h.item) !== null && _j !== void 0 ? _j : "N/A",
                unit: (_m = (_l = (_k = receiveHistory[0]) === null || _k === void 0 ? void 0 : _k.quality) !== null && _l !== void 0 ? _l : item.quality) !== null && _m !== void 0 ? _m : "",
                first: ((_o = records[0]) === null || _o === void 0 ? void 0 : _o.quantity) ? parseQty(records[0].quantity) : null,
                second: ((_p = records[1]) === null || _p === void 0 ? void 0 : _p.quantity) ? parseQty(records[1].quantity) : null,
                third: ((_q = records[2]) === null || _q === void 0 ? void 0 : _q.quantity) ? parseQty(records[2].quantity) : null,
                fourth: ((_r = records[3]) === null || _r === void 0 ? void 0 : _r.quantity) ? parseQty(records[3].quantity) : null,
                fifth: ((_s = records[4]) === null || _s === void 0 ? void 0 : _s.quantity) ? parseQty(records[4].quantity) : null,
                qty: totalStock,
                unitCost,
                totalCost: totalStock * unitCost,
                balStock,
                balAmount: balStock * unitCost,
            };
        });
        // Workbook layout matches the supplied SUPPLIES YYYY template exactly:
        //   Columns A..M: Item No. | DESCRIPTION | UNIT | QTY | UNIT COST |
        //   TOTAL COST | 1ST | 2ND | 3RD | 4TH | 5TH | Balance On Stock | Total Amount
        //   Header group "ISSUANCE {YEAR}" spans D9:M9.
        const wb = new exceljs_1.default.Workbook();
        wb.creator = "GMITP";
        wb.created = new Date();
        const ws = wb.addWorksheet(`Supplies ${yearNum}`, {
            views: [{ state: "frozen", ySplit: 10 }],
        });
        ws.columns = [
            { width: 7 }, // A Item No.
            { width: 41.8 }, // B DESCRIPTION
            { width: 10.5 }, // C UNIT
            { width: 12 }, // D QTY
            { width: 12 }, // E UNIT COST
            { width: 12 }, // F TOTAL COST
            { width: 10 }, // G 1ST
            { width: 10 }, // H 2ND
            { width: 10 }, // I 3RD
            { width: 10 }, // J 4TH
            { width: 10 }, // K 5TH
            { width: 14 }, // L Balance On Stock
            { width: 14 }, // M Total Amount
        ];
        // ── Letterhead (rows 1, 2, 3, blank 4, title 5, blank 6, "As of" 7) ──
        const letterhead = [
            { row: 1, text: "Republic of the Philippines", bold: false, size: 11 },
            { row: 2, text: "Province of Marinduque", bold: false, size: 11 },
            { row: 3, text: "MUNICIPALITY OF GASAN", bold: true, size: 11 },
            { row: 5, text: "SUPPLIES & EQUIPMENT INVENTORY", bold: true, size: 14 },
        ];
        letterhead.forEach(({ row, text, bold, size }) => {
            const r = ws.getRow(row);
            r.getCell(1).value = text;
            ws.mergeCells(row, 1, row, 13);
            r.alignment = { horizontal: "center", vertical: "middle" };
            r.font = { name: "Arial", bold, size };
        });
        const monthName = new Date(yearNum, new Date().getMonth(), 1)
            .toLocaleString("en-US", { month: "long" })
            .toUpperCase();
        const asOf = quarter
            ? `As of Q${quarter} ${yearNum}`
            : `As of ${monthName} ${yearNum}`;
        ws.getRow(7).getCell(1).value = asOf;
        ws.mergeCells(7, 1, 7, 13);
        ws.getRow(7).alignment = { horizontal: "center" };
        ws.getRow(7).font = { name: "Arial", italic: true, size: 11 };
        // ── Table headers in rows 9-10 ───────────────────────────────────────
        const headerTopRow = 9;
        const headerSubRow = 10;
        // Row 9 top headers (parent labels)
        ws.getRow(headerTopRow).values = [
            "Item No.", // A
            "DESCRIPTION", // B
            "UNIT", // C
            `ISSUANCE ${yearNum}`, // D — merged across D9:M9
            null, null, null, null, null, null, null, null, null,
        ];
        // Row 10 sub-headers
        ws.getRow(headerSubRow).values = [
            null, null, null,
            "QTY", // D
            "UNIT COST", // E
            "TOTAL COST", // F
            "1ST", // G
            "2ND", // H
            "3RD", // I
            "4TH", // J
            "5TH", // K
            "Balance On Stock", // L
            "Total Amount", // M
        ];
        // Merges
        ws.mergeCells(headerTopRow, 1, headerSubRow, 1); // A9:A10 Item No.
        ws.mergeCells(headerTopRow, 2, headerSubRow, 2); // B9:B10 DESCRIPTION
        ws.mergeCells(headerTopRow, 3, headerSubRow, 3); // C9:C10 UNIT
        ws.mergeCells(headerTopRow, 4, headerTopRow, 13); // D9:M9  ISSUANCE YYYY
        const styleHeader = (rowIdx) => {
            const row = ws.getRow(rowIdx);
            row.font = { bold: true, size: 10 };
            row.alignment = {
                horizontal: "center",
                vertical: "middle",
                wrapText: true,
            };
            row.height = 22;
            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    right: { style: "thin" },
                    bottom: { style: "thin" },
                };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF2F2F2" },
                };
            });
        };
        styleHeader(headerTopRow);
        styleHeader(headerSubRow);
        // ── Data rows starting at row 11, columns matching template A..M ─────
        const dataStartRow = headerSubRow + 1;
        items.forEach((it, i) => {
            var _a, _b, _c, _d, _e;
            const rowIdx = dataStartRow + i;
            const r = ws.getRow(rowIdx);
            r.values = [
                i + 1, // A Item No.
                it.desc, // B DESCRIPTION
                it.unit, // C UNIT
                it.qty, // D QTY
                it.unitCost, // E UNIT COST
                // F TOTAL COST as a live D*E formula (matches the original template)
                { formula: `D${rowIdx}*E${rowIdx}`, result: it.totalCost },
                (_a = it.first) !== null && _a !== void 0 ? _a : "", // G 1ST
                (_b = it.second) !== null && _b !== void 0 ? _b : "", // H 2ND
                (_c = it.third) !== null && _c !== void 0 ? _c : "", // I 3RD
                (_d = it.fourth) !== null && _d !== void 0 ? _d : "", // J 4TH
                (_e = it.fifth) !== null && _e !== void 0 ? _e : "", // K 5TH
                it.balStock, // L Balance On Stock
                it.balAmount, // M Total Amount
            ];
            r.font = { name: "Arial", size: 10 };
            r.alignment = { vertical: "middle" };
            r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
            r.getCell(2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
            r.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
            r.getCell(4).alignment = { horizontal: "center", vertical: "middle" }; // QTY
            // Currency cells: E UNIT COST, F TOTAL COST, M Total Amount
            [5, 6, 13].forEach((c) => {
                r.getCell(c).numFmt = '"₱"#,##0.00';
                r.getCell(c).alignment = { horizontal: "right", vertical: "middle" };
            });
            // Issuance slots G..K — centered
            for (let c = 7; c <= 11; c++) {
                r.getCell(c).alignment = { horizontal: "center", vertical: "middle" };
            }
            r.getCell(12).alignment = { horizontal: "center", vertical: "middle" };
            r.eachCell({ includeEmpty: true }, (cell) => {
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    right: { style: "thin" },
                    bottom: { style: "thin" },
                };
            });
        });
        // ── TOTAL row ────────────────────────────────────────────────────────
        const totalRowIdx = dataStartRow + items.length;
        const totalRow = ws.getRow(totalRowIdx);
        const totalQty = items.reduce((s, x) => s + x.qty, 0);
        const totalCost = items.reduce((s, x) => s + x.totalCost, 0);
        const totalAmount = items.reduce((s, x) => s + x.balAmount, 0);
        totalRow.values = [
            null, // A
            "TOTAL", // B (merged label across A:C)
            null, // C
            totalQty, // D
            null, // E
            totalCost, // F
            null, null, null, null, null, // G..K issuance slots
            null, // L Balance On Stock (blank — sum doesn't make sense across mixed units)
            totalAmount, // M Total Amount
        ];
        ws.mergeCells(totalRowIdx, 1, totalRowIdx, 3); // "TOTAL" label spans A:C
        totalRow.font = { name: "Arial", bold: true, size: 10 };
        totalRow.getCell(2).alignment = { horizontal: "right", vertical: "middle" };
        totalRow.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
        [5, 6, 13].forEach((c) => {
            totalRow.getCell(c).numFmt = '"₱"#,##0.00';
            totalRow.getCell(c).alignment = { horizontal: "right", vertical: "middle" };
        });
        totalRow.eachCell({ includeEmpty: true }, (cell) => {
            cell.border = {
                top: { style: "double" }, left: { style: "thin" },
                right: { style: "thin" }, bottom: { style: "double" },
            };
            cell.fill = {
                type: "pattern", pattern: "solid",
                fgColor: { argb: "FFFAFAFA" },
            };
        });
        const certByRow = totalRowIdx + 3;
        ws.getRow(certByRow).getCell(2).value = "Certified Correct:";
        ws.getRow(certByRow).getCell(2).font = { italic: true, size: 10 };
        const signerRow = certByRow + 3;
        ws.getRow(signerRow).getCell(2).value =
            (_a = params.certifiedBy) !== null && _a !== void 0 ? _a : "MICHELLE CHRISTINE Z. ILAO";
        ws.getRow(signerRow).getCell(2).font = { bold: true, size: 10 };
        const titleRow = signerRow + 1;
        ws.getRow(titleRow).getCell(2).value =
            (_b = params.certifiedTitle) !== null && _b !== void 0 ? _b : "Administrative Officer I (SO I)";
        ws.getRow(titleRow).getCell(2).font = { italic: true, size: 9 };
        const buffer = (yield wb.xlsx.writeBuffer());
        const nodeBuffer = Buffer.from(new Uint8Array(buffer));
        const filenameSafe = ((_c = params.listTitle) !== null && _c !== void 0 ? _c : `SUPPLIES_${yearNum}${quarter ? `_Q${quarter}` : ""}`).replace(/[^a-z0-9_\-]+/gi, "_");
        return res
            .code(200)
            .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .header("Content-Disposition", `attachment; filename="${filenameSafe}.xlsx"`)
            .send(nodeBuffer);
    }
    catch (error) {
        console.error("Error in timebaseReportExport:", error);
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
        }
        throw new errors_1.AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    }
});
exports.timebaseReportExport = timebaseReportExport;
const uploadBulkExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c, _d, e_2, _e, _f;
    const isMultipart = req.isMultipart();
    if (!isMultipart) {
        throw new errors_1.ValidationError("INVALID MULTI-PART");
    }
    try {
        const parts = req.parts();
        let fileBuffer = null;
        const formData = {};
        try {
            for (var _g = true, parts_1 = __asyncValues(parts), parts_1_1; parts_1_1 = yield parts_1.next(), _a = parts_1_1.done, !_a; _g = true) {
                _c = parts_1_1.value;
                _g = false;
                const part = _c;
                if (part.type === "file") {
                    const buffers = [];
                    try {
                        for (var _h = true, _j = (e_2 = void 0, __asyncValues(part.file)), _k; _k = yield _j.next(), _d = _k.done, !_d; _h = true) {
                            _f = _k.value;
                            _h = false;
                            const chunk = _f;
                            buffers.push(chunk);
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (!_h && !_d && (_e = _j.return)) yield _e.call(_j);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                    fileBuffer = Buffer.concat(buffers);
                }
                else {
                    formData[part.fieldname] = part.value;
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_g && !_a && (_b = parts_1.return)) yield _b.call(parts_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
        if (!formData.lineId) {
            throw new errors_1.ValidationError("INVALID REQUIRED FIELD: lineId");
        }
        if (!formData.dataSetId) {
            throw new errors_1.ValidationError("INVALID REQUIRED FIELD: dataSetId");
        }
        if (!fileBuffer) {
            throw new errors_1.ValidationError("INVALID FILE");
        }
        const workbook = new exceljs_1.default.Workbook();
        const stream = stream_1.Readable.from(fileBuffer);
        yield workbook.xlsx.read(stream);
        const itemsToInsert = [];
        workbook.eachSheet((sheet) => {
            sheet.eachRow((row) => {
                const value = row.getCell(1).value;
                if (value && value.toString().trim()) {
                    itemsToInsert.push(value.toString());
                }
            });
        });
        if (itemsToInsert.length === 0) {
            throw new errors_1.ValidationError("No valid data found in Excel file");
        }
        const BATCH_SIZE = 50;
        const existingItems = new Set();
        for (let i = 0; i < itemsToInsert.length; i += BATCH_SIZE) {
            const batch = itemsToInsert.slice(i, i + BATCH_SIZE);
            const existingBatch = yield prisma_1.prisma.supplies.findMany({
                where: {
                    item: { in: batch },
                    suppliesDataSetId: formData.dataSetId,
                    lineId: formData.lineId,
                },
                select: { item: true },
            });
            existingBatch.forEach((item) => existingItems.add(item.item));
        }
        const newItems = itemsToInsert.filter((item) => !existingItems.has(item));
        if (newItems.length === 0) {
            return res.status(200).send({
                message: "All items already exist. No new items to insert.",
                totalChecked: itemsToInsert.length,
                existingCount: existingItems.size,
                insertedCount: 0,
            });
        }
        const suppliesData = [];
        for (const item of newItems) {
            const code = yield (0, handler_1.generatedItemCode)();
            suppliesData.push({
                item,
                code,
                suppliesDataSetId: formData.dataSetId,
                lineId: formData.lineId,
                consumable: false,
                description: "",
            });
        }
        let insertedCount = 0;
        for (let i = 0; i < suppliesData.length; i += BATCH_SIZE) {
            const batch = suppliesData.slice(i, i + BATCH_SIZE);
            try {
                const result = yield prisma_1.prisma.supplies.createMany({
                    data: batch,
                    skipDuplicates: true,
                });
                insertedCount += result.count;
            }
            catch (error) {
                console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, error);
                throw new errors_1.AppError("BATCH_INSERT_ERROR", 500, `Failed to insert batch ${i / BATCH_SIZE + 1}`);
            }
        }
        return res.status(200).send({
            message: "Bulk upload completed",
            totalChecked: itemsToInsert.length,
            existingCount: existingItems.size,
            insertedCount,
            skippedCount: itemsToInsert.length - insertedCount,
        });
    }
    catch (error) {
        if (error instanceof errors_1.ValidationError)
            throw error;
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            console.error("Prisma error code:", error.code);
            throw new errors_1.AppError("DB_CONNECTION_ERROR", 500, "Database error occurred");
        }
        if (error instanceof Error) {
            console.error("Error stack:", error.stack);
        }
        throw new errors_1.AppError("INTERNAL_ERROR", 500, "An unexpected error occurred");
    }
});
exports.uploadBulkExcel = uploadBulkExcel;
// POST /supply/restock
// DIRECT re-stock: add stock to a supply inside a container/list WITHOUT going
// through the order process (no SupplyOrder / purchase-request workflow). It
// mirrors the stock-writing half of the order fulfillment (saveItemOrder) so
// the order/transaction system stays fully intact for those who still need it.
const restockSupply = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    const body = req.body;
    if ((!body.suppliesId && !((_b = (_a = body.newItem) === null || _a === void 0 ? void 0 : _a.item) === null || _b === void 0 ? void 0 : _b.trim())) ||
        !body.inventoryBoxId ||
        !body.listId ||
        !body.quantity) {
        throw new errors_1.ValidationError("An existing item (suppliesId) or a new item name, plus inventoryBoxId, listId and quantity, are required");
    }
    const quantity = parseInt(String(body.quantity), 10);
    if (Number.isNaN(quantity) || quantity < 1) {
        throw new errors_1.ValidationError("Quantity must be a positive number");
    }
    const perQuantity = body.perQuantity
        ? parseInt(String(body.perQuantity), 10) || 1
        : 1;
    const priceValue = body.price ? Math.round(parseFloat(String(body.price))) || 0 : 0;
    const addedStock = quantity * perQuantity;
    const brands = body.brand
        ? String(body.brand)
            .split(",")
            .map((b) => b.trim())
            .filter((b) => b.length > 0)
        : [];
    // Offline desktop restocks carry a stable clientOpId so a retried push is
    // idempotent — if we've already recorded this op, return OK without applying
    // it again (this mirrors the dispense flow's clientOpId dedup).
    const clientOpId = ((_c = body.clientOpId) === null || _c === void 0 ? void 0 : _c.trim()) || undefined;
    try {
        if (clientOpId) {
            const existing = yield prisma_1.prisma.supplieRecieveHistory.findUnique({
                where: { clientOpId },
                select: { id: true },
            });
            if (existing) {
                return res
                    .code(200)
                    .send({ message: "OK", duplicate: true });
            }
        }
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            // Resolve (or create) the supply item.
            let supply;
            let suppliesId;
            if (body.suppliesId) {
                supply = yield tx.supplies.findUnique({
                    where: { id: body.suppliesId },
                });
                if (!supply)
                    throw new errors_1.NotFoundError("Supply not found");
                suppliesId = supply.id;
            }
            else {
                // New item — create it in the chosen container dataset, then stock it.
                if (!body.datasetId) {
                    throw new errors_1.ValidationError("Pick a dataset for the new item before adding it.");
                }
                if (!body.lineId) {
                    throw new errors_1.ValidationError("lineId is required to create a new item");
                }
                const code = yield (0, handler_1.generatedItemCode)();
                supply = yield tx.supplies.create({
                    data: {
                        item: body.newItem.item.trim(),
                        description: (_b = (_a = body.newItem) === null || _a === void 0 ? void 0 : _a.description) !== null && _b !== void 0 ? _b : null,
                        consumable: !!((_c = body.newItem) === null || _c === void 0 ? void 0 : _c.consumable),
                        suppliesDataSetId: body.datasetId,
                        lineId: body.lineId,
                        code,
                    },
                });
                suppliesId = supply.id;
                if (body.userId) {
                    yield tx.inventoryAccessLogs.create({
                        data: {
                            userId: body.userId,
                            inventoryBoxId: body.inventoryBoxId,
                            action: `Added Supply (direct): ${supply.item}`,
                            timestamp: new Date(),
                        },
                    });
                }
            }
            // Resolve supplier — accept an id, a known name, or create a new one.
            // Supplier.name is unique PER LINE, so match within THIS line only —
            // another line's supplier of the same name is a different record.
            let supplierId;
            if (body.supplier && body.supplier.trim()) {
                const raw = body.supplier.trim();
                const byId = yield tx.supplier.findUnique({ where: { id: raw } });
                if (byId) {
                    supplierId = byId.id;
                }
                else {
                    const byName = yield tx.supplier.findFirst({
                        where: Object.assign({ name: { equals: raw, mode: "insensitive" } }, (body.lineId ? { lineId: body.lineId } : {})),
                    });
                    if (byName)
                        supplierId = byName.id;
                    else if (body.lineId) {
                        const created = yield tx.supplier.create({
                            data: { name: raw, lineId: body.lineId },
                        });
                        supplierId = created.id;
                    }
                }
            }
            const optional = {};
            if (body.expiration)
                optional.expiration = new Date(body.expiration).toISOString();
            if (supplierId)
                optional.supplierId = supplierId;
            const brandCreates = brands.map((brand) => ({ brand, suppliesId }));
            // Stock is segmented per (item, batch, container, supplier, unit,
            // perQuantity) — same key the order flow uses, so direct restocks merge
            // cleanly into existing batches instead of fragmenting them.
            const stock = yield tx.supplyStockTrack.findFirst({
                where: {
                    suppliesId,
                    supplyBatchId: body.listId,
                    inventoryBoxId: body.inventoryBoxId,
                    supplierId: supplierId !== null && supplierId !== void 0 ? supplierId : null,
                    quality: (_d = body.quality) !== null && _d !== void 0 ? _d : null,
                    perQuantity,
                },
            });
            if (stock) {
                yield tx.supplyStockTrack.update({
                    where: { id: stock.id },
                    data: Object.assign(Object.assign(Object.assign(Object.assign({ stock: stock.stock + addedStock, quantity: stock.quantity + quantity }, (body.quality ? { quality: body.quality } : {})), optional), (brandCreates.length > 0
                        ? { brand: { createMany: { data: brandCreates } } }
                        : {})), { price: { create: { value: priceValue, suppliesId } } }),
                });
            }
            else {
                yield tx.supplyStockTrack.create({
                    data: Object.assign(Object.assign(Object.assign({ suppliesId, stock: addedStock, quantity, quality: (_e = body.quality) !== null && _e !== void 0 ? _e : null, perQuantity, inventoryBoxId: body.inventoryBoxId, supplyBatchId: body.listId }, optional), { price: { create: { value: priceValue, suppliesId } } }), (brandCreates.length > 0
                        ? { brand: { createMany: { data: brandCreates } } }
                        : {})),
                });
            }
            // Receive history — the Time-Based / Issuance report derives received QTY
            // (and Balance On Stock) from SupplieRecieveHistory, NOT from
            // SupplyStockTrack. An order fulfillment writes this row, so a direct
            // restock must too, or the report shows QTY 0 and a negative balance.
            yield tx.supplieRecieveHistory.create({
                data: Object.assign(Object.assign({ suppliesId, quality: (_f = body.quality) !== null && _f !== void 0 ? _f : null, quantity, // received units of measure (× perQuantity in the report)
                    perQuantity, pricePerItem: body.price ? parseFloat(String(body.price)) || 0 : 0, condition: "New", supplyBatchId: body.listId, inventoryBoxId: body.inventoryBoxId }, (supplierId ? { supplierId } : {})), (clientOpId ? { clientOpId } : {})),
            });
            // Audit trail (system requirement) — the stock-in is still recorded even
            // though it skipped the order process.
            if (body.userId && body.lineId) {
                yield tx.inventoryLogs.create({
                    data: {
                        lineId: body.lineId,
                        userId: body.userId,
                        action: 1,
                        desc: `DIRECT RESTOCK: +${addedStock} unit(s) of "${supply.item}" (qty ${quantity} x ${perQuantity})`,
                    },
                });
            }
        }));
        return res.code(200).send({ message: "OK" });
    }
    catch (error) {
        if (error instanceof errors_1.NotFoundError || error instanceof errors_1.ValidationError) {
            throw error;
        }
        console.error("[restock] failed:", error);
        if (error instanceof prisma_1.Prisma.PrismaClientKnownRequestError) {
            const meta = ((_d = error.meta) !== null && _d !== void 0 ? _d : {});
            const target = (_f = (_e = meta.target) !== null && _e !== void 0 ? _e : meta.field_name) !== null && _f !== void 0 ? _f : meta.modelName;
            throw new errors_1.AppError(`Restock DB error ${error.code}${target ? ` (${Array.isArray(target) ? target.join(", ") : target})` : ""}`, 500, "DB_ERROR");
        }
        throw new errors_1.AppError(`Restock failed: ${error instanceof Error ? error.message : "unknown"}`, 500, "DB_ERROR");
    }
});
exports.restockSupply = restockSupply;
// GET /supply/container-datasets?id=<inventoryBoxId>
// Datasets belong to a CONTAINER (a container can have several), and lists
// aren't pinned to one — so the direct "Add item" form searches/creates within
// the container's datasets. Returns them with their supply counts.
const containerDatasets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const params = req.query;
    if (!params.id)
        throw new errors_1.ValidationError("INVALID REQUIRED ID");
    const datasets = yield prisma_1.prisma.suppliesDataSet.findMany({
        where: { inventoryBoxId: params.id },
        orderBy: { timestamp: "asc" },
        select: {
            id: true,
            title: true,
            _count: { select: { supplies: true } },
        },
    });
    return res.code(200).send({
        list: datasets.map((d) => ({
            id: d.id,
            title: d.title,
            count: d._count.supplies,
        })),
    });
});
exports.containerDatasets = containerDatasets;
