// socket/notificationSocket.ts
import { DefaultEventsMap, Server } from "socket.io";
import { io } from "..";

// Define types for better TypeScript support
interface NotificationData {
  id: string;
  title: string;
  message: string;
  type: string;
  userId?: string;
  createdAt: string;
}

export class NotificationSocket {
  public io: Server;
  private connectedUsers = new Map<string, string>();

  constructor(
    io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>
  ) {
    this.io = io;
    this.setupEventHandlers();
    console.log("✅ NotificationSocket initialized");
  }

  private setupEventHandlers() {
    this.io.on("connection", (socket) => {
      console.log("Notification socket connected:", socket.id);

      // User joins with their user ID
      socket.on("user:join", (userId: string) => {
        this.connectedUsers.set(socket.id, userId);
        socket.join(`user-${userId}`);
        console.log(`User ${userId} joined notification room`);

        // Send confirmation back to client
        socket.emit("user:joined", { userId, socketId: socket.id });
      });

      // Join specific rooms (e.g., for line notifications)
      socket.on("join-line", (lineId: string) => {
        socket.join(`line-${lineId}`);
        console.log(`Socket ${socket.id} joined line-${lineId}`);
        socket.emit("line:joined", { lineId });
      });

      // Join admin room
      socket.on("join-admin", () => {
        socket.join("admin-room");
        console.log(`Socket ${socket.id} joined admin room`);
        socket.emit("admin:joined");
      });

      // Handle notification read
      socket.on("notification:read", (notificationId: string) => {
        console.log(`Notification ${notificationId} marked as read`);
        socket.emit("notification:read-success", notificationId);
      });

      // Test message handler
      socket.on("send_message", (data) => {
        console.log("Received test message:", data);
        socket.emit("message_received", {
          status: "success",
          message: "Message received by NotificationSocket class",
          originalData: data,
        });
      });

      // Handle disconnection
      socket.on("disconnect", (reason) => {
        const userId = this.connectedUsers.get(socket.id);
        if (userId) {
          console.log(
            `User ${userId} disconnected from notifications. Reason: ${reason}`
          );
          this.connectedUsers.delete(socket.id);
        } else {
          console.log(`Socket ${socket.id} disconnected. Reason: ${reason}`);
        }
      });

      // Handle connection errors
      socket.on("connect_error", (error) => {
        console.error("Connection error:", error);
      });
    });
  }

  // Method to send notification to specific user
  public sendToUser(
    userId: string,
    notification: Omit<NotificationData, "id" | "createdAt">
  ) {
    const fullNotification: NotificationData = {
      ...notification,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };

    this.io.to(`user-${userId}`).emit("notification:new", fullNotification);
    console.log(`Notification sent to user ${userId}:`, fullNotification.title);
  }

  // Method to send notification to all users in a line
  public sendToLine(
    lineId: string,
    notification: Omit<NotificationData, "id" | "createdAt">
  ) {
    const fullNotification: NotificationData = {
      ...notification,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };

    this.io.to(`line-${lineId}`).emit("notification:new", fullNotification);
    console.log(`Notification sent to line ${lineId}:`, fullNotification.title);
  }

  // Method to send notification to admin users
  public sendToAdmins(
    notification: Omit<NotificationData, "id" | "createdAt">
  ) {
    const fullNotification: NotificationData = {
      ...notification,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };

    this.io.to("admin-room").emit("notification:new", fullNotification);
    console.log(`Notification sent to admins:`, fullNotification.title);
  }

  // Method to broadcast to all connected users
  public broadcast(notification: Omit<NotificationData, "id" | "createdAt">) {
    const fullNotification: NotificationData = {
      ...notification,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };

    this.io.emit("notification:new", fullNotification);
  }

  // Get connected users count
  public getConnectedUsersCount(): number {
    return this.connectedUsers.size;
  }

  // Get all connected user IDs
  public getConnectedUserIds(): string[] {
    return Array.from(this.connectedUsers.values());
  }
}
