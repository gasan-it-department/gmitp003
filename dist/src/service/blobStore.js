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
exports.blobStoreStatus = exports.deleteBlob = exports.readBlob = exports.getBlob = exports.putBlob = exports.sha256 = exports.keyFor = exports.blobStoreConfigured = void 0;
/**
 * Object storage for the things that should never have been in Postgres.
 *
 * 91 of the database's 123 MB is file bytes in one column — three quarters
 * of the database is not data, it is attachments. Every page view pulls a
 * whole PDF out of Postgres into Node memory, which is why the API runs
 * with --max-old-space-size=4096 and why a single 77 MB document is one
 * request away from exhausting it.
 *
 * ── Why the S3 API, when we are not using Amazon ──────────────────────────
 * "S3" here is a PROTOCOL, not a vendor, the way SQL is a protocol and not
 * Oracle. Railway Bucket, Cloudflare R2, Backblaze, MinIO and DigitalOcean
 * Spaces all speak it, so one client talks to any of them and switching
 * providers is a change of four environment variables rather than a rewrite.
 * Nothing here involves an AWS account.
 *
 * ── Migrating without a cliff ─────────────────────────────────────────────
 * Rows keep their `Bytes` column until every file is confirmed readable from
 * the bucket. Reads prefer the bucket and fall back to the column, so the
 * system works at every point during the move: before the backfill, halfway
 * through it, and after. Nothing is deleted by this module — dropping the
 * columns is a separate, deliberate act once the bucket has been proven.
 */
const crypto_1 = __importDefault(require("crypto"));
const ENDPOINT = process.env.BUCKET_ENDPOINT || "";
const ACCESS_KEY = process.env.BUCKET_ACCESS_KEY || "";
const SECRET_KEY = process.env.BUCKET_SECRET_KEY || "";
const BUCKET = process.env.BUCKET_NAME || "";
/**
 * Most S3-compatible providers that are not Amazon ignore the region but
 * require the client to send one. "auto" is what R2 documents; it is a
 * placeholder, not a location.
 */
const REGION = process.env.BUCKET_REGION || "auto";
/**
 * Path-style addressing (bucket in the URL path) rather than virtual-host
 * style (bucket as a subdomain). Amazon prefers the latter; nearly every
 * other implementation needs the former, and getting it wrong produces DNS
 * errors that look nothing like a configuration problem.
 */
const FORCE_PATH_STYLE = process.env.BUCKET_FORCE_PATH_STYLE !== "0";
const blobStoreConfigured = () => !!(ENDPOINT && ACCESS_KEY && SECRET_KEY && BUCKET);
exports.blobStoreConfigured = blobStoreConfigured;
let client = null;
const getClient = () => __awaiter(void 0, void 0, void 0, function* () {
    if (client)
        return client;
    const { S3Client } = yield Promise.resolve().then(() => __importStar(require("@aws-sdk/client-s3")));
    client = new S3Client({
        region: REGION,
        endpoint: ENDPOINT,
        forcePathStyle: FORCE_PATH_STYLE,
        credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    });
    return client;
});
/**
 * Where an object lives.
 *
 * Keyed by what the row IS, not by a random id, so a bucket listing is
 * readable by a human six years from now when somebody is answering a
 * records request and has no database to join against.
 */
const keyFor = (kind, id, ext = "bin") => `${kind}/${id}.${ext}`;
exports.keyFor = keyFor;
const sha256 = (b) => crypto_1.default.createHash("sha256").update(b).digest("hex");
exports.sha256 = sha256;
/** Store an object. Returns what is needed to find and verify it again. */
const putBlob = (key_1, body_1, ...args_1) => __awaiter(void 0, [key_1, body_1, ...args_1], void 0, function* (key, body, contentType = "application/octet-stream") {
    if (!(0, exports.blobStoreConfigured)()) {
        throw new Error("Object storage is not configured — set BUCKET_ENDPOINT, " +
            "BUCKET_ACCESS_KEY, BUCKET_SECRET_KEY and BUCKET_NAME.");
    }
    const { PutObjectCommand } = yield Promise.resolve().then(() => __importStar(require("@aws-sdk/client-s3")));
    const c = yield getClient();
    const digest = (0, exports.sha256)(body);
    yield c.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        /*
          The digest travels WITH the object. A bucket that has silently
          corrupted a file is indistinguishable from one that has not unless
          the expected hash is stored somewhere the file itself carries, and
          for municipal records "probably fine" is not an answer.
        */
        Metadata: { sha256: digest },
    }));
    return { key, bytes: body.length, sha256: digest };
});
exports.putBlob = putBlob;
/** Fetch an object. Returns null when it is simply not there. */
const getBlob = (key) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c;
    if (!(0, exports.blobStoreConfigured)())
        return null;
    try {
        const { GetObjectCommand } = yield Promise.resolve().then(() => __importStar(require("@aws-sdk/client-s3")));
        const c = yield getClient();
        const res = yield c.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        const body = res.Body;
        const chunks = [];
        try {
            for (var _d = true, body_1 = __asyncValues(body), body_1_1; body_1_1 = yield body_1.next(), _a = body_1_1.done, !_a; _d = true) {
                _c = body_1_1.value;
                _d = false;
                const chunk = _c;
                chunks.push(Buffer.from(chunk));
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = body_1.return)) yield _b.call(body_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
        return Buffer.concat(chunks);
    }
    catch (e) {
        const name = e.name;
        // Absent is a normal answer during a migration, not a failure.
        if (name === "NoSuchKey" || name === "NotFound")
            return null;
        throw e;
    }
});
exports.getBlob = getBlob;
/**
 * Read a blob that may live in either place.
 *
 * This is the whole migration strategy in one function: prefer the bucket,
 * fall back to the column. Before the backfill every read falls back; after
 * it every read hits the bucket; during it, both work. There is no moment
 * where the system is broken, and no deploy that has to be timed against a
 * data move.
 */
const readBlob = (key, fallback) => __awaiter(void 0, void 0, void 0, function* () {
    if (key) {
        const fromBucket = yield (0, exports.getBlob)(key);
        if (fromBucket)
            return fromBucket;
    }
    return fallback ? Buffer.from(fallback) : null;
});
exports.readBlob = readBlob;
/** Remove an object. Used by the backfill's rollback, not by normal code. */
const deleteBlob = (key) => __awaiter(void 0, void 0, void 0, function* () {
    if (!(0, exports.blobStoreConfigured)())
        return;
    const { DeleteObjectCommand } = yield Promise.resolve().then(() => __importStar(require("@aws-sdk/client-s3")));
    const c = yield getClient();
    yield c.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
});
exports.deleteBlob = deleteBlob;
/** Does the bucket actually work? For /health/build and the backfill. */
const blobStoreStatus = () => __awaiter(void 0, void 0, void 0, function* () {
    if (!(0, exports.blobStoreConfigured)()) {
        return { configured: false, reachable: false, bucket: null, endpoint: null };
    }
    const probe = `__healthcheck__/probe.txt`;
    try {
        const stamp = Buffer.from(new Date().toISOString());
        yield (0, exports.putBlob)(probe, stamp, "text/plain");
        const back = yield (0, exports.getBlob)(probe);
        yield (0, exports.deleteBlob)(probe);
        return {
            configured: true,
            // A write that cannot be read back is worse than no bucket, so the
            // probe round-trips rather than just writing.
            reachable: !!back && back.equals(stamp),
            bucket: BUCKET,
            endpoint: ENDPOINT,
        };
    }
    catch (e) {
        return {
            configured: true,
            reachable: false,
            bucket: BUCKET,
            endpoint: ENDPOINT,
            error: e instanceof Error ? e.message : String(e),
        };
    }
});
exports.blobStoreStatus = blobStoreStatus;
