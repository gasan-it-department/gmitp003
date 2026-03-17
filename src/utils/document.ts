import { FileConvertToBufferProps } from "../models/route";

export const fileToBuffer = async (
  file: any,
  options?: {
    maxSizeMB?: number;
    allowedMimeTypes?: string[];
    extractText?: boolean; // For PDFs/DOCX to populate abstract
  },
): Promise<FileConvertToBufferProps> => {
  const maxSizeBytes = (options?.maxSizeMB || 50) * 1024 * 1024; // Default 10MB
  const allowedTypes = options?.allowedMimeTypes || [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
    "image/gif",
    "text/plain",
  ];

  // Validate file size
  if (file.file.bytesRead > maxSizeBytes) {
    throw new Error(`File too large. Max size: ${options?.maxSizeMB || 50}MB`);
  }

  // Validate mime type
  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error(`File type ${file.mimetype} not allowed`);
  }

  // Convert stream to buffer
  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  // Optional: Extract text for abstract/search (for PDFs/DOCX)

  return {
    buffer, // Ready for PostgreSQL BYTEA column
    fileName: file.filename,
    mimeType: file.mimetype,
    fileSize: buffer.length,
    encoding: file.encoding,
    fields: file.fields,
  };
};

/**
 * More robust version with type assertion
 */
export async function extractTextFromFile(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  try {
    // PDF files
    if (mimeType === "application/pdf") {
      // Use try-require pattern with type assertion
      const pdfParse = require("pdf-parse") as (data: Buffer) => Promise<{
        text: string;
        numpages: number;
        info: any;
      }>;

      const result = await pdfParse(buffer);
      return result.text.substring(0, 100000);
    }

    // Word documents (.docx)
    if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value.substring(0, 10000);
    }

    // Rest remains the same...
    if (mimeType.startsWith("text/")) {
      return buffer.toString("utf-8").substring(0, 10000);
    }

    return "";
  } catch (error) {
    console.error("Text extraction failed:", error);
    return "";
  }
}

// Simple function to get file type from buffer or filename
export const getFileType = (
  input: Buffer | { buffer?: Buffer; filename?: string; mimetype?: string },
): string => {
  // If input has mimetype property, use it
  if ("mimetype" in input && input.mimetype) {
    return input.mimetype;
  }

  // Get the buffer to analyze
  const buffer = "buffer" in input ? input.buffer : input;

  if (!buffer || !Buffer.isBuffer(buffer)) {
    return "application/octet-stream";
  }

  // Check file signatures (magic numbers)
  const signatures: Record<
    string,
    { bytes: number[]; mime: string; extension: string }
  > = {
    // Images
    jpg: { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg", extension: "jpg" },
    png: {
      bytes: [0x89, 0x50, 0x4e, 0x47],
      mime: "image/png",
      extension: "png",
    },
    gif: { bytes: [0x47, 0x49, 0x46], mime: "image/gif", extension: "gif" },
    webp: {
      bytes: [0x52, 0x49, 0x46, 0x46],
      mime: "image/webp",
      extension: "webp",
    },

    // Documents
    pdf: {
      bytes: [0x25, 0x50, 0x44, 0x46],
      mime: "application/pdf",
      extension: "pdf",
    },
    doc: {
      bytes: [0xd0, 0xcf, 0x11, 0xe0],
      mime: "application/msword",
      extension: "doc",
    },
    docx: {
      bytes: [0x50, 0x4b, 0x03, 0x04],
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extension: "docx",
    },
    xls: {
      bytes: [0xd0, 0xcf, 0x11, 0xe0],
      mime: "application/vnd.ms-excel",
      extension: "xls",
    },
    xlsx: {
      bytes: [0x50, 0x4b, 0x03, 0x04],
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx",
    },
    ppt: {
      bytes: [0xd0, 0xcf, 0x11, 0xe0],
      mime: "application/vnd.ms-powerpoint",
      extension: "ppt",
    },
    pptx: {
      bytes: [0x50, 0x4b, 0x03, 0x04],
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      extension: "pptx",
    },

    // Archives
    zip: {
      bytes: [0x50, 0x4b, 0x03, 0x04],
      mime: "application/zip",
      extension: "zip",
    },
    rar: {
      bytes: [0x52, 0x61, 0x72, 0x21],
      mime: "application/x-rar-compressed",
      extension: "rar",
    },
    "7z": {
      bytes: [0x37, 0x7a, 0xbc, 0xaf],
      mime: "application/x-7z-compressed",
      extension: "7z",
    },

    // Text
    txt: { bytes: [0xef, 0xbb, 0xbf], mime: "text/plain", extension: "txt" }, // UTF-8 BOM
  };

  // Check each signature
  for (const [type, sig] of Object.entries(signatures)) {
    const match = sig.bytes.every((byte, index) => buffer[index] === byte);
    if (match) {
      return sig.mime;
    }
  }

  // Try to determine from filename if available
  if ("filename" in input && input.filename) {
    const ext = input.filename.split(".").pop()?.toLowerCase();
    if (ext) {
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        txt: "text/plain",
        zip: "application/zip",
        json: "application/json",
      };

      if (mimeMap[ext]) {
        return mimeMap[ext];
      }
    }
  }

  return "application/octet-stream";
};
