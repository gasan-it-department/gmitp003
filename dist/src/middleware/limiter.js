"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.limiter = void 0;
exports.limiter = {
    max: 100,
    timeWindow: "1 minute",
    ban: 10,
    cache: 10000,
    allowList: ["127.0.0.1"],
};
