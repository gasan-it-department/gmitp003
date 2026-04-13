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
exports.admin = void 0;
const adminAuth_1 = require("../controller/adminAuth");
const request_1 = require("../models/request");
const admin = (fastify) => {
    fastify.post("/admin-login", { schema: request_1.adminLoginScehma }, adminAuth_1.adminAuth);
    fastify.post("/create-admin", { schema: request_1.adminLoginScehma }, adminAuth_1.creteAdmin);
    fastify.get("/admin-inbox", (req, res) => __awaiter(void 0, void 0, void 0, function* () { }));
};
exports.admin = admin;
