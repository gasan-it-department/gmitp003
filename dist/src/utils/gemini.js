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
exports.testGemini = testGemini;
const genai_1 = require("@google/genai");
const ai = new genai_1.GoogleGenAI({});
function testGemini() {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `
    Coke Price
    July -Php 10 
    August- Php 13
    
    
    Anlyze the coke price over 2 months, give me final conclusion.`,
        });
        console.log(response.text);
    });
}
