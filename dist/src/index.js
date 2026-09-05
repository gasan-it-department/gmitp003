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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.notificationSocket = void 0;
const fastify_1 = __importDefault(require("fastify"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const fastify_2 = require("./barrel/fastify");
const prisma_1 = require("./barrel/prisma");
const cors_1 = __importDefault(require("@fastify/cors"));
const socket_io_1 = require("socket.io");
const NotificationSocket_1 = require("./class/NotificationSocket");
// `@fastify/websocket` would attach its own HTTP `upgrade` listener to
// the same http.Server we hand Socket.IO. The two listeners fight over
// /socket.io/* upgrades and the fastify-ws side returns 400, which the
// browser surfaces as "websocket error". Nothing currently uses
// fastify-ws (the only route was /notification/realtime, unreferenced on
// the frontend) so we drop the registration to let Socket.IO own
// upgrades. Re-enable carefully if you bring fastify-ws back.
// import fastifyWebsocket from "@fastify/websocket";
//routes
const auth_1 = require("./route/auth");
const employee_1 = require("./route/employee");
const test_1 = require("./route/test");
const area_1 = require("./route/area");
const position_1 = require("./route/position");
const personnel_1 = require("./route/personnel");
const line_1 = require("./route/line");
const invitation_1 = require("./route/invitation");
const unit_1 = require("./route/unit");
const announcement_1 = require("./route/announcement");
const admin_1 = require("./route/admin");
const account_1 = require("./route/account");
const dashboard_1 = require("./route/dashboard");
const inventory_1 = require("./route/inventory");
const list_1 = require("./route/list");
const dataSet_1 = require("./route/dataSet");
const order_1 = require("./route/order");
const quality_1 = require("./route/quality");
const overview_1 = require("./route/overview");
const supplier_1 = require("./route/supplier");
const medicine_1 = require("./route/medicine");
const prescription_1 = require("./route/prescription");
const notification_1 = require("./route/notification");
const salaryGrade_1 = require("./route/salaryGrade");
const application_1 = require("./route/application");
const push_1 = require("./route/push");
const otp_1 = require("./route/otp");
const module_1 = require("./route/module");
const document_1 = require("./route/document");
//
const file_1 = require("./route/file");
const supply_1 = require("./route/supply");
//
const user_1 = require("./route/user");
const patient_1 = require("./route/patient");
const leave_1 = require("./route/leave");
const services_1 = require("./route/services");
const peso_1 = require("./route/peso");
const provisional_1 = require("./route/provisional");
const sync_1 = require("./route/sync");
const chat_1 = require("./route/chat");
const attendance_1 = require("./route/attendance");
const hrMessage_1 = require("./route/hrMessage");
const errorHandlers_1 = __importDefault(require("./plugin/errorHandlers"));
const gemini_1 = require("./utils/gemini");
// ── Last-line crash guards ──────────────────────────────────────────────
// Without these, ONE leaked promise rejection anywhere kills the whole
// process (Node's default), severing every in-flight request — mobile
// uploads then surface as bare "Network Error" with nothing in the logs.
// Log loudly with the stack, keep serving.
process.on("unhandledRejection", (reason) => {
    var _a;
    console.error("[unhandledRejection]", (_a = reason === null || reason === void 0 ? void 0 : reason.stack) !== null && _a !== void 0 ? _a : reason);
});
process.on("uncaughtException", (err) => {
    var _a;
    console.error("[uncaughtException]", (_a = err === null || err === void 0 ? void 0 : err.stack) !== null && _a !== void 0 ? _a : err);
});
// Allow large archive uploads. PostgreSQL bytea tops out at ~1GB. The body
// limit covers multipart framing; the connection/keepalive timeouts are
// bumped so a slow client uploading hundreds of MB doesn't get cut off.
const app = (0, fastify_1.default)({
    bodyLimit: 1024 * 1024 * 1024, // 1GB
    connectionTimeout: 30 * 60 * 1000, // 30 min
    keepAliveTimeout: 5 * 60 * 1000, // 5 min
});
// Attach Socket.IO directly to Fastify's HTTP server (`app.server`). The
// previous `createServer(app.server)` wrapped Fastify's server in a second
// http.Server that was never `.listen()`'d — Socket.IO was effectively
// offline. Binding to `app.server` makes the socket reachable on the same
// port Fastify is listening on.
const io = new socket_io_1.Server(app.server, {
    cors: {
        origin: [
            "http://localhost:5173",
            // Inventory desktop (Tauri). 5174 is its vite dev server; the packaged
            // shell serves from tauri:// and http://tauri.localhost on Windows.
            "http://localhost:5174",
            "tauri://localhost",
            "http://tauri.localhost",
            "https://gasanmarinduque.xyz",
            "https://g671jwjj-5173.asse.devtunnels.ms",
            // Current production frontend (Vercel). The apex is the canonical URL;
            // www is kept as a safe alias.
            "https://portal.gasan.ph",
            "https://www.portal.gasan.ph",
            // Legacy frontend origins — kept so old links keep working during the
            // switch to portal.gasan.ph.
            "https://lgu-portal.xyz",
            "https://www.lgu-portal.xyz",
            "https://fastify-service-production.up.railway.app",
        ],
        methods: ["GET", "POST"],
        credentials: true,
    },
});
exports.io = io;
exports.notificationSocket = new NotificationSocket_1.NotificationSocket(io);
//plugin
// app.register(fastifyWebsocket); // disabled — see import comment above
app.register(errorHandlers_1.default);
app.register(multipart_1.default, {
    attachFieldsToBody: false,
    limits: {
        fileSize: 1024 * 1024 * 1024, // 1GB (PostgreSQL bytea max)
        files: 10,
    },
});
app.register(fastify_2.jwt, {
    secret: process.env.JWT_SECRET,
});
app.register(Promise.resolve().then(() => __importStar(require("@fastify/rate-limit"))), {
    max: 100,
    timeWindow: "1 minute",
    global: true,
});
app.register(cors_1.default, {
    origin: [
        "http://localhost:5173",
        // Inventory desktop (Tauri). 5174 is its vite dev server; the packaged
        // shell serves from tauri:// and http://tauri.localhost on Windows.
        "http://localhost:5174",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://gasanmarinduque.xyz",
        "https://ckv55gfl-5173.asse.devtunnels.ms",
        // Current production frontend (Vercel). Apex is canonical; www is a safe alias.
        "https://portal.gasan.ph",
        "https://www.portal.gasan.ph",
        // Legacy frontend origins — kept during the switch to portal.gasan.ph.
        "https://lgu-portal.xyz",
        "https://www.lgu-portal.xyz",
        "https://fastify-service-production.up.railway.app",
    ], // Allowed browser origins (credentials mode → must be explicit, no "*")
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"], // Allowed HTTP methods
    allowedHeaders: [
        "Origin",
        "X-Requested-With",
        "Content-Type",
        "Accept",
        "Authorization",
        "Cache-Control",
    ],
    credentials: true,
    preflightContinue: false,
    exposedHeaders: ["Authorization"],
});
app.decorate("io", io);
app.register(auth_1.auth);
app.register(test_1.test);
app.register(employee_1.employee);
app.register(area_1.area);
app.register(position_1.position);
app.register(line_1.lineRoutes);
app.register(invitation_1.invitation);
app.register(unit_1.unit);
app.register(announcement_1.announcement);
app.register(admin_1.admin);
app.register(account_1.accounts);
app.register(dashboard_1.dashboard);
app.register(inventory_1.inventory);
app.register(list_1.list);
app.register(dataSet_1.dataSet);
app.register(file_1.file);
app.register(supply_1.supply);
app.register(order_1.order);
app.register(quality_1.quality);
app.register(overview_1.overview);
app.register(supplier_1.supplier);
app.register(user_1.user);
app.register(personnel_1.personnel);
app.register(medicine_1.medicine);
app.register(prescription_1.prescription);
app.register(notification_1.notification);
app.register(salaryGrade_1.salaryGrade);
app.register(application_1.application);
app.register(push_1.push);
app.register(otp_1.otp);
app.register(module_1.modules);
app.register(document_1.document);
app.register(patient_1.patient);
app.register(leave_1.leave);
app.register(services_1.services);
app.register(peso_1.peso);
app.register(provisional_1.provisional);
app.register(sync_1.sync);
app.register(chat_1.chat);
app.register(attendance_1.attendance);
app.register(hrMessage_1.hrMessage);
io.on("connection", (socket) => {
    console.log("User connected: ", socket.id);
    socket.on("send_message", (data) => {
        console.log("Received message:", data);
        socket.emit("message_received", {
            status: "success",
            message: "Message received by server",
            originalData: data,
        });
    });
    // New area handler
    socket.on("new_area", (areaData) => {
        console.log("New area created:", areaData);
        // Broadcast to all other clients except sender
        socket.broadcast.emit("new_area_broadcast", areaData);
        // Or broadcast to everyone including sender
        // io.emit("new_area_broadcast", areaData);
    });
    socket.on("disconnect", (reason) => {
        console.log("User disconnected: ", socket.id, "Reason:", reason);
    });
});
//middleware
app.get("/admin-test", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const jobPost = yield prisma_1.prisma.jobPost.findMany({
        include: {
            line: {
                select: {
                    municipalId: true,
                },
            },
            position: {
                select: {
                    name: true,
                },
            },
        },
        orderBy: {
            timestamp: "desc",
        },
    });
    console.log("Admin Reached");
    return reply.code(200).send({ message: jobPost });
    // const text = "JudePogdasdasd";
    // const encrypted = {
    //   encryptedData: "05f9ee6af31971537b09794e0b35a988",
    //   iv: "5c35cf0ccba9c91a56f5fbc76f178c57",
    // };
    // const encrypt = await EncryptionService.encrypt(text);
    // const decrypt = await EncryptionService.decrypt(
    //   encrypted.encryptedData,
    //   encrypted.iv,
    // );
    // return { encrypt, decrypt };
}));
app.get("/test/ai", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, gemini_1.testGemini)();
    return { status: "ok" };
}));
// Public build marker — lets anyone (including the assistant) CONFIRM which
// build is actually serving, instead of trusting deploy timers. Bump the
// tag with each meaningful deploy.
const BUILD_TAG = "2026-09-03-routed-marker";
app.get("/health/build", () => __awaiter(void 0, void 0, void 0, function* () { return ({ status: "ok", build: BUILD_TAG }); }));
app.listen({ port: 3000, host: "0.0.0.0" }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is running at ${address}`);
    // One-shot data healer: merge stock batches that were split into
    // multiple rows by client-dependent date times-of-day (web local
    // midnight vs mobile UTC midnight). Best-effort, logged, non-blocking.
    setTimeout(() => {
        Promise.resolve().then(() => __importStar(require("./controller/medicineController"))).then((m) => m.consolidateSplitBatches())
            .then((n) => {
            if (n)
                console.log(`[boot] consolidated ${n} split batch row(s)`);
        })
            .catch((e) => console.warn("[boot] batch consolidation failed:", e));
    }, 5000);
});
