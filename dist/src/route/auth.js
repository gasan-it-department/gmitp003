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
exports.auth = auth;
const request_1 = require("../models/request");
//constroller
const authController_1 = require("../controller/authController");
function auth(fastify) {
    return __awaiter(this, void 0, void 0, function* () {
        fastify.post("/auth", { schema: request_1.authSchema }, authController_1.authController);
        fastify.post("/register", authController_1.registerController);
    });
}
