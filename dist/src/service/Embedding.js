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
exports.embeddingService = exports.EmbeddingService = void 0;
// services/embedding.service.ts
const prisma_1 = require("../barrel/prisma");
const transformers_1 = require("@huggingface/transformers");
const pdf_parse_1 = require("pdf-parse");
class EmbeddingService {
    constructor() {
        this.extractor = null;
        this.summarizer = null;
    }
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.extractor) {
                this.extractor = yield (0, transformers_1.pipeline)("feature-extraction", "Xenova/all-MiniLM-L6-v2");
            }
        });
    }
    initializeSummarizer() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.summarizer) {
                this.summarizer = yield (0, transformers_1.pipeline)("summarization", "Xenova/distilbart-cnn-6-6");
            }
        });
    }
    generateEmbedding(text) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.initialize();
            const output = yield this.extractor(text, {
                pooling: "mean",
                normalize: true,
            });
            return Array.from(output.data);
        });
    }
    // Store embedding for a document
    storeEmbedding(documentAbstractId, text) {
        return __awaiter(this, void 0, void 0, function* () {
            const embedding = yield this.generateEmbedding(text);
            return yield prisma_1.prisma.archiveEmbedding.upsert({
                where: { documentAbstractId: documentAbstractId },
                update: {
                    vector: embedding,
                    updatedAt: new Date(),
                },
                create: {
                    documentAbstractId: documentAbstractId,
                    vector: embedding,
                    model: "all-MiniLM-L6-v2",
                    dimensions: embedding.length,
                },
            });
        });
    }
    // Generate abstract from PDF file
    generateAbstractFromPDF(pdfPath) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.initializeSummarizer();
            // Extract text from PDF
            const parser = new pdf_parse_1.PDFParse({ url: pdfPath });
            const result = yield parser.getText();
            yield parser.destroy();
            const text = result.text;
            // Clean and truncate text (summarizer has token limits)
            const cleanedText = text.replace(/\s+/g, " ").trim();
            const truncatedText = cleanedText.length > 3000 ? cleanedText.substring(0, 3000) : cleanedText;
            // Generate summary
            const summary = yield this.summarizer(truncatedText, {
                max_length: 500,
                min_length: 30,
                do_sample: false,
            });
            return summary[0].summary_text;
        });
    }
    // Find similar documents
    findSimilar(query_1, roomId_1) {
        return __awaiter(this, arguments, void 0, function* (query, roomId, limit = 20) {
            const queryEmbedding = yield this.generateEmbedding(query);
            // Get all embeddings (or filter by room)
            const embeddings = yield prisma_1.prisma.archiveDocument.findMany({
                where: roomId
                    ? {
                        receivingRoomId: roomId,
                    }
                    : {},
                include: {
                    document: {
                        select: {
                            title: true,
                        },
                    },
                    abstract: {
                        select: {
                            embedding: {
                                select: {
                                    vector: true,
                                },
                            },
                        },
                    },
                },
            });
            // Calculate cosine similarity
            const withScores = embeddings.map((emb) => {
                var _a, _b;
                return (Object.assign(Object.assign({}, emb), { similarity: this.cosineSimilarity(queryEmbedding, (_b = (_a = emb.abstract) === null || _a === void 0 ? void 0 : _a.embedding) === null || _b === void 0 ? void 0 : _b.vector) }));
            });
            console.log({ withScores });
            // Sort and return top results
            return withScores
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, limit);
        });
    }
    cosineSimilarity(a, b) {
        if (!a || !b)
            return 0;
        let dotProduct = 0;
        let magA = 0;
        let magB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        magA = Math.sqrt(magA);
        magB = Math.sqrt(magB);
        return magA && magB ? dotProduct / (magA * magB) : 0;
    }
}
exports.EmbeddingService = EmbeddingService;
exports.embeddingService = new EmbeddingService();
