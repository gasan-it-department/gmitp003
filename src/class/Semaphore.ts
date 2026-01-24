// services/semaphoreService.ts
import axios from "axios";

export const semaphoreKey = process.env.SEMAPHORE_API_KEY;
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
      const { number, message, sendername = "SEMAPHORE" } = options;

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
      console.log("Success", number);

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
        error: error.response?.data?.message || error.message,
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
