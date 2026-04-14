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
exports.unit = void 0;
const groupController_1 = require("../controller/groupController");
const request_1 = require("../models/request");
const handler_1 = require("../middleware/handler");
const unitController_1 = require("../controller/unitController");
const unit = (fasitfy) => __awaiter(void 0, void 0, void 0, function* () {
    fasitfy.post("/add-unit", { preHandler: handler_1.authenticated }, groupController_1.createGroup);
    fasitfy.get("/line-units", { preHandler: handler_1.authenticated, schema: request_1.groupListSchema }, groupController_1.groupList);
    fasitfy.get("/unit-info", { preHandler: handler_1.authenticated }, groupController_1.unitInfo);
    fasitfy.get("/unit/search", { preHandler: handler_1.authenticated }, unitController_1.searchUnit);
    fasitfy.delete("/unit/delete", { preHandler: handler_1.authenticated }, groupController_1.deleteUnit);
});
exports.unit = unit;
