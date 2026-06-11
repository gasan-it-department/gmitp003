// services/embedding.service.ts
import { prisma } from "../barrel/prisma";
import { pipeline } from "@huggingface/transformers";
import { PDFParse } from "pdf-parse";

export class EmbeddingService {
  private extractor: any = null;
  private summarizer: any = null;

  async initialize() {
    if (!this.extractor) {
      this.extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );
    }
  }

  async initializeSummarizer() {
    if (!this.summarizer) {
      this.summarizer = await pipeline(
        "summarization",
        "Xenova/distilbart-cnn-6-6",
      );
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    await this.initialize();
    const output = await this.extractor(text, {
      pooling: "mean",
      normalize: true,
    });
    return Array.from(output.data);
  }

  // Store embedding for a document
  async storeEmbedding(documentAbstractId: string, text: string) {
    const embedding = await this.generateEmbedding(text);

    return await prisma.archiveEmbedding.upsert({
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
  }

  // Generate abstract from a PDF on disk (kept for back-compat)
  async generateAbstractFromPDF(pdfPath: string): Promise<string> {
    await this.initializeSummarizer();

    const parser = new PDFParse({ url: pdfPath });
    const result = await parser.getText();
    await parser.destroy();
    return this.summarizeText(result.text);
  }

  // Generate abstract from a PDF buffer (no disk I/O)
  async generateAbstractFromBuffer(buffer: Buffer): Promise<string> {
    await this.initializeSummarizer();

    // pdf-parse takes ArrayBuffer/TypedArray; ensure the input matches.
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return this.summarizeText(result.text);
  }

  private async summarizeText(text: string): Promise<string> {
    // Clean + truncate to fit the summarizer's effective input window
    const cleaned = (text || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return "";

    const input = cleaned.length > 3000 ? cleaned.substring(0, 3000) : cleaned;

    const summary = await this.summarizer(input, {
      max_length: 500,
      min_length: 30,
      do_sample: false,
    });

    return summary[0].summary_text;
  }

  // Find similar documents
  async findSimilar(query: string, roomId?: string, limit: number = 20) {
    const queryEmbedding = await this.generateEmbedding(query);

    // Get all embeddings (or filter by room)
    const embeddings = await prisma.archiveDocument.findMany({
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
    const withScores = embeddings.map((emb) => ({
      ...emb,
      similarity: this.cosineSimilarity(
        queryEmbedding,
        emb.abstract?.embedding?.vector as number[],
      ),
    }));

    console.log({ withScores });

    // Sort and return top results
    return withScores
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b) return 0;

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

export const embeddingService = new EmbeddingService();
