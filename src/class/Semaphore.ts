// services/semaphoreService.ts
import axios from "axios";

export const semaphoreKey = process.env.SEMAPHORE_API_KEY;

/**
 * The sender name every message goes out under.
 *
 * Semaphore only accepts sender names REGISTERED to the account. Two call
 * sites were passing "Gasan", which is not one of ours, and every message
 * they sent came back "The selected sendername is invalid." — silently, see
 * below. Configurable because the registered name belongs to the account,
 * not to the code; "SEMAPHORE" is the universal default and always works.
 *
 * Check what this account may use:
 *   GET https://api.semaphore.co/api/v4/account/sendernames?apikey=…
 */
export const SEMAPHORE_SENDER =
  process.env.SEMAPHORE_SENDER_NAME?.trim() || "SEMAPHORE";

/**
 * Turn a Semaphore error body into one readable line.
 *
 * Failures come back as `{ field: ["what is wrong"] }` — for example
 * `{"number":["The number format is invalid."]}` — and NOT as
 * `{ message }`. Every reader of this service was looking for `message`,
 * found nothing, and fell back to a generic string, so the one piece of
 * information worth having was thrown away at the door.
 */
export const readGatewayError = (data: unknown, fallback: string): string => {
  if (typeof data === "string" && data.trim()) return data.trim();
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.message === "string" && d.message.trim()) return d.message;
    const parts: string[] = [];
    for (const [field, val] of Object.entries(d)) {
      const msgs = Array.isArray(val) ? val : [val];
      for (const m of msgs) {
        if (typeof m === "string" && m.trim()) {
          parts.push(field === "message" ? m : `${field}: ${m}`);
        }
      }
    }
    if (parts.length) return parts.join("; ");
  }
  return fallback;
};
// types/semaphore.ts
export interface SemaphoreSMSOptions {
  number: string | string[];
  message: string;
  sendername?: string;
}

export interface SemaphoreResponse {
  message_id?: number;
  user_id?: number;
  user?: string;
  account_id?: number;
  account?: string;
  recipient?: string;
  message?: string;
  code?: number;
  sender_name?: string;
  network?: string;
  status?: string;
  type?: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SemaphoreServiceResponse {
  success: boolean;
  data?: SemaphoreResponse | SemaphoreResponse[];
  error?: string;
  status?: number;
}

export class SemaphoreService {
  private apiKey: string;
  private baseURL: string = "https://api.semaphore.co/api/v4/messages";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async sendSMS(
    options: SemaphoreSMSOptions
  ): Promise<SemaphoreServiceResponse> {
    try {
      const { number, message, sendername = SEMAPHORE_SENDER } = options;

      // Convert array to comma-separated string if needed
      const numberString = Array.isArray(number) ? number.join(",") : number;

      const response = await axios.post<
        SemaphoreResponse[] | SemaphoreResponse
      >(this.baseURL, null, {
        params: {
          apikey: this.apiKey,
          number: numberString,
          message,
          sendername,
        },
        paramsSerializer: {
          indexes: null, // Don't use array format for params
        },
      });
      /**
        * A 2xx is not automatically a delivery.
        *
        * Semaphore answers with one object per recipient; a rejected one
        * carries status "Failed". Treating every 2xx as success reported
        * messages as sent that the gateway had already given up on.
        */
      const rows = Array.isArray(response.data)
        ? response.data
        : [response.data];
      const failed = rows.filter(
        (m) => typeof m?.status === "string" && /fail|reject/i.test(m.status),
      );
      if (rows.length > 0 && failed.length === rows.length) {
        return {
          success: false,
          error: `Gateway reported ${failed[0]?.status ?? "Failed"}`,
          data: response.data,
          status: response.status,
        };
      }

      return {
        success: true,
        data: response.data,
        status: response.status,
      };
    } catch (error: any) {
      console.error(
        "Semaphore SMS error:",
        error.response?.data || error.message
      );
      return {
        success: false,
        error: readGatewayError(error.response?.data, error.message),
        status: error.response?.status || 500,
      };
    }
  }

  // Send to multiple numbers (alias for sendSMS)
  async sendBulkSMS(
    numbers: string[],
    message: string,
    sendername?: string
  ): Promise<SemaphoreServiceResponse> {
    return this.sendSMS({
      number: numbers,
      message,
      sendername,
    });
  }

  // Send to single number
  async sendSingleSMS(
    number: string,
    message: string,
    sendername?: string
  ): Promise<SemaphoreServiceResponse> {
    return this.sendSMS({
      number,
      message,
      sendername,
    });
  }
}

// Create singleton instance
export const semaphoreService = new SemaphoreService(
  process.env.SEMAPHORE_API_KEY || ""
);
