// socket/notificationSocket.ts
import { DefaultEventsMap, Server } from "socket.io";
import { prisma } from "../barrel/prisma";

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
  // Chat presence: lineId → (userId → number of live sockets). A user is
  // "online" for a line while they have ≥1 socket joined to it.
  private linePresence = new Map<string, Map<string, number>>();

  constructor(
    io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>,
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
        socket.data.userId = userId;
        this.registerPresence(socket);
        console.log(`User ${userId} joined notification room`);

        // Send confirmation back to client
        socket.emit("user:joined", { userId, socketId: socket.id });
      });

      // Join specific rooms (e.g., for line notifications)
      socket.on("join-line", (lineId: string) => {
        socket.join(`line-${lineId}`);
        socket.data.lineId = lineId;
        this.registerPresence(socket);
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

      // ── Application chat rooms ───────────────────────────────────
      // Both the public applicant side and the HR side join the same
      // room (`chat-<applicationId>`) so messages emitted by one are
      // delivered instantly to the other without polling.
      socket.on("chat:join", (applicationId: string) => {
        if (!applicationId) return;
        const room = `chat-${applicationId}`;
        socket.join(room);
        socket.emit("chat:joined", { applicationId });
        // console.log(`Socket ${socket.id} joined ${room}`);
      });

      socket.on("chat:leave", (applicationId: string) => {
        if (!applicationId) return;
        socket.leave(`chat-${applicationId}`);
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
        this.unregisterPresence(socket);
        const userId = this.connectedUsers.get(socket.id);
        if (userId) {
          console.log(
            `User ${userId} disconnected from notifications. Reason: ${reason}`,
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

  // ── Chat presence ──────────────────────────────────────────────────
  /** Mark a socket's user online for its line once both ids are known. */
  private registerPresence(socket: any) {
    const userId: string | undefined = socket.data?.userId;
    const lineId: string | undefined = socket.data?.lineId;
    if (!userId || !lineId || socket.data.presenceOn) return;
    socket.data.presenceOn = true;
    let members = this.linePresence.get(lineId);
    if (!members) {
      members = new Map<string, number>();
      this.linePresence.set(lineId, members);
    }
    const count = (members.get(userId) ?? 0) + 1;
    members.set(userId, count);
    if (count === 1) {
      this.io.to(`line-${lineId}`).emit("chat:presence", { lineId, userId, online: true });
      void this.persistSeen(userId, lineId);
    }
  }

  /** Drop a socket from presence; if it was the user's last one, go offline. */
  private unregisterPresence(socket: any) {
    const userId: string | undefined = socket.data?.userId;
    const lineId: string | undefined = socket.data?.lineId;
    if (!socket.data?.presenceOn || !userId || !lineId) return;
    socket.data.presenceOn = false;
    const members = this.linePresence.get(lineId);
    if (!members) return;
    const count = (members.get(userId) ?? 1) - 1;
    if (count <= 0) {
      members.delete(userId);
      this.io.to(`line-${lineId}`).emit("chat:presence", { lineId, userId, online: false });
      void this.persistSeen(userId, lineId);
    } else {
      members.set(userId, count);
    }
  }

  private async persistSeen(userId: string, lineId: string) {
    try {
      await prisma.chatPresence.upsert({
        where: { userId },
        update: { lineId, lastSeenAt: new Date() },
        create: { userId, lineId, lastSeenAt: new Date() },
      });
    } catch {
      /* best-effort */
    }
  }

  /** User ids currently online for a line. */
  public getOnlineUserIds(lineId: string): string[] {
    return Array.from(this.linePresence.get(lineId)?.keys() ?? []);
  }

  // Method to send notification to specific user
  public sendToUser(
    userId: string,
    notification: Omit<NotificationData, "id" | "createdAt">,
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
    notification: Omit<NotificationData, "id" | "createdAt">,
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
    notification: Omit<NotificationData, "id" | "createdAt">,
  ) {
    const fullNotification: NotificationData = {
      ...notification,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };

    this.io.to("admin-room").emit("notification:new", fullNotification);
    console.log(`Notification sent to admins:`, fullNotification.title);
  }

  /**
   * Push a freshly-created Notification row to a single user. Used for
   * line-scoped user notifications (e.g. someone routes a document to
   * you). The room is `user-<recipientId>` so it only reaches that one
   * person regardless of how many tabs they have open.
   */
  public emitUserNotification(
    recipientId: string,
    notification: {
      id: string;
      title: string;
      content: string;
      path?: string | null;
      createdAt: string;
      isRead?: boolean;
    },
  ) {
    if (!recipientId) return;
    this.io
      .to(`user-${recipientId}`)
      .emit("notification:user-new", notification);
  }

  /**
   * Force a user to sign out across every open tab/device — e.g. when an admin
   * suspends or deletes their account. The client clears its session on receipt.
   */
  public emitForceLogout(userId: string, reason?: string) {
    if (!userId) return;
    this.io.to(`user-${userId}`).emit("auth:force-logout", {
      reason: reason ?? "Your account has been suspended.",
    });
    console.log(`Force-logout emitted to user ${userId}`);
  }

  /**
   * Force-logout many users at once — e.g. when a whole line is suspended,
   * every user in it is kicked. Emits to each user's own room.
   */
  public emitForceLogoutMany(userIds: string[], reason?: string) {
    const rooms = userIds.filter(Boolean).map((id) => `user-${id}`);
    if (rooms.length === 0) return;
    this.io.to(rooms).emit("auth:force-logout", {
      reason: reason ?? "Your account has been suspended.",
    });
    console.log(`Force-logout emitted to ${rooms.length} user(s)`);
  }

  /**
   * Push a freshly-created MedicineNotification to every user listening
   * on this line. Scopes the broadcast so people in other municipalities /
   * lines don't see it. Each row of MedicineNotification has its own
   * recipient `userId`; we also fan it out to the per-user room so the
   * specific recipient can update their badge without subscribing to the
   * whole line.
   */
  public emitMedicineNotification(
    lineId: string,
    notification: {
      id: string;
      userId: string;
      title: string;
      message: string;
      lineId: string;
      path?: string | null;
      timestamp: string;
      type?: number;
      view?: number;
    },
  ) {
    if (!lineId) return;
    this.io.to(`line-${lineId}`).emit("medicine-notification:new", notification);
    if (notification.userId) {
      this.io
        .to(`user-${notification.userId}`)
        .emit("medicine-notification:new", notification);
    }
  }

  /**
   * Push a new chat message to every socket joined to this application's
   * chat room. The payload mirrors the ApplicationConversation row shape
   * so the client can append it directly to the conversation cache.
   */
  public emitChatMessage(
    applicationId: string,
    message: {
      id: string;
      messageContent: string;
      fromHr: boolean;
      timestamp: string;
      submittedApplicationId: string;
      hrAdmin?: { id: string; firstName?: string; lastName?: string } | null;
    },
  ) {
    if (!applicationId) return;
    this.io.to(`chat-${applicationId}`).emit("chat:new-message", message);
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
