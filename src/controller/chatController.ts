import { FastifyReply, FastifyRequest } from "../barrel/fastify";
import { prisma } from "../barrel/prisma";
import { ValidationError } from "../errors/errors";
import { sendPushToUser } from "../service/expoPush";

/**
 * Employee chat — three fixed rooms per line:
 *   community : everyone in the line can post + read (group chat)
 *   hr        : only HR-module users post; everyone reads
 *   mayor     : only `super`-privilege users post; everyone reads
 *
 * Realtime: on send we emit `chat:message` to the line room (`line-<lineId>`),
 * which every signed-in client already joins. Push: mentions always notify the
 * mentioned users; the two announcement channels notify the whole line; the
 * community channel only pushes to mentioned users (to avoid spamming everyone).
 */

const ROOMS = ["community", "hr", "mayor"] as const;
type Room = (typeof ROOMS)[number];

const ROOM_TITLE: Record<Room, string> = {
  community: "Community",
  hr: "HR to Employee",
  mayor: "Mayor's Notice",
};

const isRoom = (r: any): r is Room => ROOMS.includes(r);

interface ChatCtx {
  userId: string;
  lineId: string;
  name: string;
  isHr: boolean;
  isSuper: boolean;
}

// Resolve the caller (account id from the token) → their User + line + role.
async function resolveCtx(req: FastifyRequest): Promise<ChatCtx | null> {
  const accountId = (req.user as { id?: string } | undefined)?.id;
  if (!accountId) return null;
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      lineId: true,
      User: {
        select: {
          id: true,
          lineId: true,
          firstName: true,
          lastName: true,
          privilege: { select: { humanResources: true, super: true } },
        },
      },
    },
  });
  const u = account?.User;
  if (!u) return null;
  // The line lives on the ACCOUNT; the User row's lineId is often null. Use the
  // account's line (fall back to the User's) so chat isn't wrongly gated off.
  const lineId = account.lineId || u.lineId;
  if (!lineId) return null;
  return {
    userId: u.id,
    lineId,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || "Employee",
    isHr: !!u.privilege?.humanResources || !!u.privilege?.super,
    isSuper: !!u.privilege?.super,
  };
}

function canPost(ctx: ChatCtx, room: Room): boolean {
  if (room === "community") return true;
  if (room === "hr") return ctx.isHr;
  if (room === "mayor") return ctx.isSuper;
  return false;
}

// ── Community safety: light rate limiting + profanity mask ──────────────
// In-memory sliding window (per process). Community is the open, all-employee
// room so it's the abuse surface; the two announcement rooms are already gated.
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 6; // messages per window per user
const rateHits = new Map<string, number[]>();
function rateLimited(userId: string): boolean {
  const now = Date.now();
  const arr = (rateHits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  rateHits.set(userId, arr);
  return arr.length > RATE_MAX;
}

// Common English + Filipino profanity; matched words are masked (first letter
// kept, rest → asterisks) so the message still posts but stays civil.
const PROFANITY = [
  "fuck", "fucking", "shit", "bitch", "asshole", "bastard", "dick", "pussy",
  "cunt", "motherfucker", "slut", "whore", "nigger", "faggot", "retard",
  "putangina", "putang ina", "tangina", "gago", "gaga", "ulol", "tarantado",
  "punyeta", "pakyu", "leche", "hayop ka", "bwiset", "buwisit",
];
const profanityRe = new RegExp(
  `\\b(${PROFANITY.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`,
  "gi",
);
function maskProfanity(text: string): string {
  return text.replace(profanityRe, (w) => w[0] + "*".repeat(Math.max(1, w.length - 1)));
}

// ── Link previews (Open Graph) ──────────────────────────────────────────
const URL_RE = /(https?:\/\/[^\s<>"']+)/i;
function firstUrl(text?: string | null): string | null {
  if (!text) return null;
  const m = URL_RE.exec(text);
  return m ? m[1] : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

// Best-effort Open Graph fetch. SSRF-guarded: http/https only, no private
// hosts, short timeout, size-capped, text/html only. Never throws.
async function fetchLinkPreview(
  url: string,
): Promise<{ title?: string; desc?: string; image?: string } | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname;
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    )
      return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    let resp: Response;
    try {
      resp = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "user-agent": "gasan-lgu-linkbot/1.0", accept: "text/html" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return null;
    const ctype = resp.headers.get("content-type") ?? "";
    if (!ctype.includes("text/html")) return null;
    const html = (await resp.text()).slice(0, 200_000);
    const pick = (prop: string): string | undefined => {
      const a = new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
        "i",
      ).exec(html);
      const b = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
        "i",
      ).exec(html);
      const hit = (a || b)?.[1];
      return hit ? decodeEntities(hit) : undefined;
    };
    const titleTag = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1];
    const title = pick("og:title") || (titleTag ? decodeEntities(titleTag) : undefined);
    const desc = pick("og:description") || pick("description");
    let image = pick("og:image") || pick("og:image:url");
    if (image && image.startsWith("//")) image = `${u.protocol}${image}`;
    else if (image && image.startsWith("/")) image = `${u.origin}${image}`;
    if (!title && !desc && !image) return null;
    return {
      title: title?.slice(0, 160),
      desc: desc?.slice(0, 240),
      image: image?.slice(0, 500),
    };
  } catch {
    return null;
  }
}

// Fetch a preview asynchronously (after the message is already delivered) and,
// if found, patch the message + push a live update so the card fills in.
async function enrichLinkPreview(
  req: FastifyRequest,
  lineId: string,
  messageId: string,
  url: string,
) {
  try {
    const p = await fetchLinkPreview(url);
    if (!p || (!p.title && !p.desc && !p.image)) return;
    const updated = await prisma.chatMessage
      .update({
        where: { id: messageId },
        data: {
          linkTitle: p.title ?? null,
          linkDesc: p.desc ?? null,
          linkImage: p.image ?? null,
        },
      })
      .catch(() => null);
    if (!updated || updated.deletedAt) return;
    await emitMessageUpdate(lineId, shape(req, updated));
  } catch (e) {
    console.warn("[chat] link preview failed", e);
  }
}

// HR/super members of a line (via the account's line) — used to notify admins
// of a report and to authorise moderation.
async function lineAdminUserIds(lineId: string): Promise<string[]> {
  const accounts = await prisma.account.findMany({
    where: { lineId },
    select: {
      User: {
        select: {
          id: true,
          privilege: { select: { humanResources: true, super: true } },
        },
      },
    },
  });
  return accounts
    .filter((a) => a.User && (a.User.privilege?.humanResources || a.User.privilege?.super))
    .map((a) => a.User!.id);
}

const imageUrl = (req: FastifyRequest, imageId: string | null) =>
  imageId ? `${selfBase(req)}/chat/image/${imageId}` : null;

const fileUrl = (req: FastifyRequest, fileId: string | null) =>
  fileId ? `${selfBase(req)}/chat/file/${fileId}` : null;

function selfBase(req: FastifyRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  return `${proto}://${host}`;
}

function shape(req: FastifyRequest, m: any) {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    room: m.room,
    senderId: m.senderId,
    senderName: m.senderName,
    body: deleted ? null : m.body,
    imageUrl: deleted ? null : imageUrl(req, m.imageId),
    fileUrl: deleted ? null : fileUrl(req, m.fileId),
    fileName: deleted ? null : m.fileName ?? null,
    fileSize: deleted ? null : m.fileSize ?? null,
    linkUrl: deleted ? null : m.linkUrl,
    linkTitle: deleted ? null : m.linkTitle ?? null,
    linkDesc: deleted ? null : m.linkDesc ?? null,
    linkImage: deleted ? null : m.linkImage ?? null,
    mentionUserIds: deleted ? [] : m.mentionUserIds ?? [],
    mentionNames: deleted ? [] : m.mentionNames ?? [],
    replyToId: deleted ? null : m.replyToId ?? null,
    replyToName: deleted ? null : m.replyToName ?? null,
    replyToPreview: deleted ? null : m.replyToPreview ?? null,
    clientOpId: m.clientOpId ?? null,
    deleted,
    editedAt: m.editedAt ?? null,
    createdAt: m.createdAt,
  };
}

// Push an edited/deleted message to everyone on the line so they replace it.
async function emitMessageUpdate(
  lineId: string,
  payload: ReturnType<typeof shape>,
) {
  try {
    const { notificationSocket } = await import("..");
    notificationSocket.io.to(`line-${lineId}`).emit("chat:message-update", payload);
  } catch (e) {
    console.warn("[chat] message-update emit failed", e);
  }
}

// GET /chat/rooms — the 3 rooms for the caller's line with last message,
// unread count and whether the caller may post.
export const chatRooms = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");

  const reads = await prisma.chatReadState.findMany({
    where: { userId: ctx.userId, lineId: ctx.lineId },
  });
  const readMap = new Map(reads.map((r) => [r.room, r.lastReadAt]));
  const mutedMap = new Map(reads.map((r) => [r.room, r.muted]));

  const rooms = await Promise.all(
    ROOMS.map(async (room) => {
      const last = await prisma.chatMessage.findFirst({
        where: { lineId: ctx.lineId, room },
        orderBy: { createdAt: "desc" },
      });
      const lastReadAt = readMap.get(room);
      const unread = await prisma.chatMessage.count({
        where: {
          lineId: ctx.lineId,
          room,
          senderId: { not: ctx.userId },
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
      });
      return {
        key: room,
        title: ROOM_TITLE[room],
        canPost: canPost(ctx, room),
        unread,
        muted: !!mutedMap.get(room),
        lastMessage: last ? shape(req, last) : null,
      };
    }),
  );

  return res.code(200).send({ rooms });
};

interface ReactionAgg {
  emoji: string;
  count: number;
  userIds: string[];
}

// Aggregate reactions for a set of messages → { messageId: [{emoji,count,userIds}] }.
async function aggregateReactions(
  messageIds: string[],
): Promise<Record<string, ReactionAgg[]>> {
  if (messageIds.length === 0) return {};
  const rows = await prisma.chatReaction.findMany({
    where: { messageId: { in: messageIds } },
    select: { messageId: true, emoji: true, userId: true },
  });
  const byMsg: Record<string, Record<string, string[]>> = {};
  for (const r of rows) {
    if (!byMsg[r.messageId]) byMsg[r.messageId] = {};
    if (!byMsg[r.messageId][r.emoji]) byMsg[r.messageId][r.emoji] = [];
    byMsg[r.messageId][r.emoji].push(r.userId);
  }
  const out: Record<string, ReactionAgg[]> = {};
  for (const mid of Object.keys(byMsg)) {
    out[mid] = Object.entries(byMsg[mid]).map(([emoji, userIds]) => ({
      emoji,
      count: userIds.length,
      userIds,
    }));
  }
  return out;
}

// GET /chat/messages?room=&cursor=&limit=  — newest-first, paginated.
export const chatMessages = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");

  const q = req.query as { room?: string; cursor?: string; limit?: string; query?: string };
  if (!isRoom(q.room)) throw new ValidationError("BAD_ROOM");
  const take = Math.min(parseInt(q.limit ?? "30", 10) || 30, 100);

  const where: any = { lineId: ctx.lineId, room: q.room };
  if (q.query && q.query.trim()) {
    where.body = { contains: q.query.trim(), mode: "insensitive" };
  }

  const cursor = q.cursor ? { id: q.cursor } : undefined;
  const rows = await prisma.chatMessage.findMany({
    where,
    take,
    skip: cursor ? 1 : 0,
    cursor,
    orderBy: { createdAt: "desc" },
  });

  const nextCursor = rows.length === take ? rows[rows.length - 1].id : null;
  const agg = await aggregateReactions(rows.map((r) => r.id));
  return res.code(200).send({
    list: rows.map((m) => ({ ...shape(req, m), reactions: agg[m.id] ?? [] })),
    lastCursor: nextCursor,
    hasMore: rows.length === take,
    canPost: canPost(ctx, q.room),
  });
};

// POST /chat/react  { messageId, emoji }  — toggle a reaction (Messenger-style).
export const chatReact = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");
  const b = req.body as { messageId?: string; emoji?: string };
  if (!b.messageId || !b.emoji) throw new ValidationError("BAD_REQUEST");
  const emoji = String(b.emoji).slice(0, 8);

  const msg = await prisma.chatMessage.findUnique({
    where: { id: b.messageId },
    select: { id: true, lineId: true, room: true },
  });
  if (!msg || msg.lineId !== ctx.lineId) throw new ValidationError("MESSAGE_NOT_FOUND");

  const key = { messageId_userId: { messageId: msg.id, userId: ctx.userId } };
  const existing = await prisma.chatReaction.findUnique({ where: key });
  if (existing && existing.emoji === emoji) {
    await prisma.chatReaction.delete({ where: key }); // toggle off
  } else if (existing) {
    await prisma.chatReaction.update({ where: key, data: { emoji } }); // change
  } else {
    await prisma.chatReaction.create({
      data: { messageId: msg.id, userId: ctx.userId, emoji },
    });
  }

  const reactions = (await aggregateReactions([msg.id]))[msg.id] ?? [];
  try {
    const { notificationSocket } = await import("..");
    notificationSocket.io
      .to(`line-${ctx.lineId}`)
      .emit("chat:reaction", { messageId: msg.id, room: msg.room, reactions });
  } catch (e) {
    console.warn("[chat] reaction emit failed", e);
  }

  return res.code(200).send({ messageId: msg.id, reactions });
};

// PATCH /chat/message  { messageId, body }  — edit your own message's text.
export const chatEdit = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");
  const b = req.body as { messageId?: string; body?: string };
  if (!b.messageId) throw new ValidationError("BAD_REQUEST");
  const text = (b.body ?? "").trim();

  const msg = await prisma.chatMessage.findUnique({ where: { id: b.messageId } });
  if (!msg || msg.lineId !== ctx.lineId) throw new ValidationError("MESSAGE_NOT_FOUND");
  if (msg.senderId !== ctx.userId)
    return res.code(403).send({ message: "You can only edit your own messages." });
  if (msg.deletedAt)
    return res.code(400).send({ message: "This message was deleted." });
  if (!text && !msg.imageId && !msg.linkUrl) throw new ValidationError("EMPTY_MESSAGE");

  const updated = await prisma.chatMessage.update({
    where: { id: msg.id },
    data: { body: text || null, editedAt: new Date() },
  });
  const payload = shape(req, updated);
  await emitMessageUpdate(ctx.lineId, payload);
  return res.code(200).send({ message: payload });
};

// DELETE /chat/message?messageId=  — delete for everyone (sender only).
export const chatDelete = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");
  const q = req.query as { messageId?: string };
  const bodyId = (req.body as { messageId?: string } | undefined)?.messageId;
  const messageId = q.messageId || bodyId;
  if (!messageId) throw new ValidationError("BAD_REQUEST");

  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.lineId !== ctx.lineId) throw new ValidationError("MESSAGE_NOT_FOUND");
  // Sender can always delete their own; HR/super can moderate anyone's message.
  const isAdmin = ctx.isHr || ctx.isSuper;
  if (msg.senderId !== ctx.userId && !isAdmin)
    return res.code(403).send({ message: "You can only delete your own messages." });

  const updated = await prisma.chatMessage.update({
    where: { id: msg.id },
    data: {
      deletedAt: new Date(),
      body: null,
      imageId: null,
      fileId: null,
      fileName: null,
      fileSize: null,
      linkUrl: null,
      linkTitle: null,
      linkDesc: null,
      linkImage: null,
      replyToName: null,
      replyToPreview: null,
      mentionUserIds: [],
      mentionNames: [],
    },
  });
  await prisma.chatReaction.deleteMany({ where: { messageId: msg.id } }).catch(() => {});

  const payload = shape(req, updated);
  await emitMessageUpdate(ctx.lineId, payload);
  return res.code(200).send({ message: payload });
};

// POST /chat/message  { room, body?, imageId?, linkUrl?, mentions?, clientOpId? }
export const chatSend = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");

  const body = req.body as {
    room?: string;
    body?: string;
    imageId?: string;
    fileId?: string;
    fileName?: string;
    fileSize?: number;
    linkUrl?: string;
    mentions?: string[];
    mentionNames?: string[];
    replyToId?: string;
    clientOpId?: string;
  };
  if (!isRoom(body.room)) throw new ValidationError("BAD_ROOM");
  const room = body.room;

  if (!canPost(ctx, room)) {
    return res.code(403).send({ message: "You can't post in this channel." });
  }

  let text = (body.body ?? "").trim();
  if (!text && !body.imageId && !body.linkUrl && !body.fileId) {
    throw new ValidationError("EMPTY_MESSAGE");
  }

  // Idempotent replay (offline resend): return the existing message.
  if (body.clientOpId) {
    const existing = await prisma.chatMessage.findUnique({
      where: { clientOpId: body.clientOpId },
    });
    if (existing) return res.code(200).send({ message: shape(req, existing) });
  }

  // Community safety: rate-limit + mask profanity (open, all-employee room).
  if (room === "community") {
    if (rateLimited(ctx.userId)) {
      return res
        .code(429)
        .send({ message: "You're sending messages too fast — wait a few seconds." });
    }
    if (text) text = maskProfanity(text);
  }

  // Reply/quote: resolve the parent (same line) and denormalise a preview.
  let replyToId: string | null = null;
  let replyToName: string | null = null;
  let replyToPreview: string | null = null;
  if (body.replyToId) {
    const parent = await prisma.chatMessage.findUnique({
      where: { id: body.replyToId },
      select: {
        id: true,
        lineId: true,
        senderName: true,
        body: true,
        deletedAt: true,
        imageId: true,
        fileName: true,
        linkUrl: true,
      },
    });
    if (parent && parent.lineId === ctx.lineId) {
      replyToId = parent.id;
      replyToName = parent.senderName ?? "Employee";
      replyToPreview = parent.deletedAt
        ? "Deleted message"
        : parent.body?.slice(0, 120) ||
          (parent.imageId
            ? "📷 Photo"
            : parent.fileName
              ? `📎 ${parent.fileName}`
              : parent.linkUrl
                ? "🔗 Link"
                : "Message");
    }
  }

  const mentions = Array.isArray(body.mentions)
    ? Array.from(new Set(body.mentions.filter((x) => typeof x === "string" && x)))
    : [];
  const mentionNames = Array.isArray(body.mentionNames)
    ? body.mentionNames.filter((x) => typeof x === "string" && x).slice(0, mentions.length || undefined)
    : [];

  const created = await prisma.chatMessage.create({
    data: {
      lineId: ctx.lineId,
      room,
      senderId: ctx.userId,
      senderName: ctx.name,
      body: text || null,
      imageId: body.imageId || null,
      fileId: body.fileId || null,
      fileName: body.fileName || null,
      fileSize: typeof body.fileSize === "number" ? body.fileSize : null,
      linkUrl: body.linkUrl || null,
      mentionUserIds: mentions,
      mentionNames,
      replyToId,
      replyToName,
      replyToPreview,
      clientOpId: body.clientOpId || null,
    },
  });

  const payload = shape(req, created);

  // Sender has implicitly read up to their own message.
  await prisma.chatReadState
    .upsert({
      where: { userId_lineId_room: { userId: ctx.userId, lineId: ctx.lineId, room } },
      update: { lastReadAt: created.createdAt },
      create: { userId: ctx.userId, lineId: ctx.lineId, room, lastReadAt: created.createdAt },
    })
    .catch(() => {});

  // Realtime fan-out to everyone on the line.
  try {
    const { notificationSocket } = await import("..");
    notificationSocket.io.to(`line-${ctx.lineId}`).emit("chat:message", payload);
  } catch (e) {
    console.warn("[chat] realtime emit failed", e);
  }

  // Push: work out who to notify, then fire (best-effort, non-blocking).
  void notifyRecipients(ctx, room, payload, mentions);

  // Link preview (best-effort, async): fetch OG tags then patch + push update.
  const previewUrl = body.linkUrl || firstUrl(text);
  if (previewUrl) void enrichLinkPreview(req, ctx.lineId, created.id, previewUrl);

  return res.code(200).send({ message: payload });
};

// Every User in the line — resolved via the ACCOUNT's line (User.lineId is
// often null, so a `user.where({lineId})` query would miss most people).
async function lineMemberUserIds(lineId: string): Promise<string[]> {
  const accounts = await prisma.account.findMany({
    where: { lineId },
    select: { User: { select: { id: true } } },
  });
  return accounts
    .map((a) => a.User?.id)
    .filter((x): x is string => typeof x === "string" && !!x);
}

async function notifyRecipients(
  ctx: ChatCtx,
  room: Room,
  payload: ReturnType<typeof shape>,
  mentions: string[],
) {
  try {
    const title =
      room === "mayor"
        ? "Mayor's Notice"
        : room === "hr"
          ? "HR to Employee"
          : "Community";
    const preview =
      payload.body?.slice(0, 140) ||
      (payload.imageUrl
        ? "📷 Photo"
        : payload.fileUrl
          ? "📎 File"
          : payload.linkUrl
            ? "🔗 Link"
            : "New message");
    const data = { path: `/chat/${room}`, room };

    // All three rooms notify everyone on the line (Community is a group chat,
    // so every member is pinged like Messenger).
    const recipientIds = await lineMemberUserIds(ctx.lineId);
    for (const m of mentions) if (!recipientIds.includes(m)) recipientIds.push(m);

    // Users who muted this room get no push — unless they were @mentioned.
    const mutedRows = await prisma.chatReadState.findMany({
      where: { lineId: ctx.lineId, room, muted: true },
      select: { userId: true },
    });
    const mutedSet = new Set(mutedRows.map((m) => m.userId));

    const targets = recipientIds.filter(
      (id) =>
        id && id !== ctx.userId && (mentions.includes(id) || !mutedSet.has(id)),
    );
    await Promise.all(
      targets.map((id) =>
        sendPushToUser(id, {
          title,
          // For Community, prefix the sender's name like a group chat does.
          body: mentions.includes(id)
            ? `${ctx.name} mentioned you: ${preview}`
            : room === "community"
              ? `${ctx.name}: ${preview}`
              : preview,
          data,
        }),
      ),
    );
  } catch (e) {
    console.warn("[chat] push notify failed", e);
  }
}

// POST /chat/read  { room }
export const chatMarkRead = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");
  const b = req.body as { room?: string };
  if (!isRoom(b.room)) throw new ValidationError("BAD_ROOM");

  const now = new Date();
  await prisma.chatReadState.upsert({
    where: { userId_lineId_room: { userId: ctx.userId, lineId: ctx.lineId, room: b.room } },
    update: { lastReadAt: now },
    create: { userId: ctx.userId, lineId: ctx.lineId, room: b.room, lastReadAt: now },
  });

  // Realtime read receipt: tell the line who read up to when, so senders can
  // update their "Seen by …" live.
  try {
    const { notificationSocket } = await import("..");
    notificationSocket.io.to(`line-${ctx.lineId}`).emit("chat:read", {
      room: b.room,
      userId: ctx.userId,
      name: ctx.name,
      lastReadAt: now.toISOString(),
    });
  } catch (e) {
    console.warn("[chat] read emit failed", e);
  }

  return res.code(200).send({ message: "OK" });
};

// POST /chat/mute  { room, muted }  — silence/unsilence a room's push for me.
export const chatMute = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");
  const b = req.body as { room?: string; muted?: boolean };
  if (!isRoom(b.room)) throw new ValidationError("BAD_ROOM");
  const muted = !!b.muted;

  await prisma.chatReadState.upsert({
    where: { userId_lineId_room: { userId: ctx.userId, lineId: ctx.lineId, room: b.room } },
    update: { muted },
    create: { userId: ctx.userId, lineId: ctx.lineId, room: b.room, muted },
  });
  return res.code(200).send({ room: b.room, muted });
};

// POST /chat/report  { messageId, reason? } — flag a message; notify admins.
export const chatReport = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");
  const b = req.body as { messageId?: string; reason?: string };
  if (!b.messageId) throw new ValidationError("BAD_REQUEST");

  const msg = await prisma.chatMessage.findUnique({
    where: { id: b.messageId },
    select: { id: true, lineId: true, room: true },
  });
  if (!msg || msg.lineId !== ctx.lineId) throw new ValidationError("MESSAGE_NOT_FOUND");

  await prisma.chatReport.create({
    data: {
      lineId: ctx.lineId,
      room: msg.room,
      messageId: msg.id,
      reporterId: ctx.userId,
      reporterName: ctx.name,
      reason: (b.reason ?? "").slice(0, 300) || null,
    },
  });

  // Tell the line's HR/super (best-effort, non-blocking).
  void (async () => {
    try {
      const admins = await lineAdminUserIds(ctx.lineId);
      const roomTitle = ROOM_TITLE[msg.room as Room] ?? msg.room;
      await Promise.all(
        admins
          .filter((id) => id && id !== ctx.userId)
          .map((id) =>
            sendPushToUser(id, {
              title: "Message reported",
              body: `${ctx.name} reported a message in ${roomTitle}.`,
              data: { path: `/chat/${msg.room}`, room: msg.room },
            }),
          ),
      );
    } catch (e) {
      console.warn("[chat] report notify failed", e);
    }
  })();

  return res.code(200).send({ ok: true });
};

// GET /chat/presence — who on the line is online now + everyone's last-seen.
export const chatPresence = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");

  let online: string[] = [];
  try {
    const { notificationSocket } = await import("..");
    online = notificationSocket.getOnlineUserIds(ctx.lineId);
  } catch {
    /* socket not ready — treat everyone as offline */
  }

  const rows = await prisma.chatPresence.findMany({
    where: { lineId: ctx.lineId },
    select: { userId: true, lastSeenAt: true },
  });
  const lastSeen: Record<string, string> = {};
  for (const r of rows) lastSeen[r.userId] = r.lastSeenAt.toISOString();

  return res.code(200).send({ online, lastSeen });
};

// GET /chat/reads?room=  — everyone's last-read time in this room (for "Seen by").
export const chatReads = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");
  const q = req.query as { room?: string };
  if (!isRoom(q.room)) throw new ValidationError("BAD_ROOM");

  const reads = await prisma.chatReadState.findMany({
    where: { lineId: ctx.lineId, room: q.room },
    select: { userId: true, lastReadAt: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: reads.map((r) => r.userId) } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = new Map(
    users.map((u) => [
      u.id,
      [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || "Employee",
    ]),
  );

  return res.code(200).send({
    reads: reads.map((r) => ({
      userId: r.userId,
      name: nameById.get(r.userId) ?? "Employee",
      lastReadAt: r.lastReadAt,
    })),
  });
};

// POST /chat/image  (multipart, field "file") → { imageId }
export const chatUploadImage = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");
  if (!req.isMultipart()) throw new ValidationError("NOT_MULTIPART");

  let file: { mimetype: string; buffer: Buffer } | null = null;
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      file = { mimetype: part.mimetype, buffer: Buffer.concat(chunks) };
    }
  }
  if (!file) throw new ValidationError("MISSING_FILE");
  if (!file.mimetype.startsWith("image/")) throw new ValidationError("FILE_MUST_BE_AN_IMAGE");
  if (file.buffer.length > 8 * 1024 * 1024) throw new ValidationError("IMAGE_TOO_LARGE");

  const saved = await prisma.chatImage.create({
    data: { mime: file.mimetype, bytes: file.buffer },
    select: { id: true },
  });
  return res.code(200).send({ imageId: saved.id, url: imageUrl(req, saved.id) });
};

// GET /chat/image/:id  (PUBLIC — loaded via <Image src>)
export const chatServeImage = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id?: string };
  if (!id) throw new ValidationError("BAD_REQUEST");
  const img = await prisma.chatImage.findUnique({
    where: { id },
    select: { bytes: true, mime: true },
  });
  if (!img?.bytes) return res.code(404).send({ message: "No image" });
  return res
    .header("Content-Type", img.mime || "image/jpeg")
    .header("Cache-Control", "public, max-age=31536000, immutable")
    .send(Buffer.from(img.bytes));
};

// POST /chat/file  (multipart, field "file") → { fileId, name, size, url }
export const chatUploadFile = async (req: FastifyRequest, res: FastifyReply) => {
  const ctx = await resolveCtx(req);
  if (!ctx) throw new ValidationError("NO_LINKED_USER");
  if (!req.isMultipart()) throw new ValidationError("NOT_MULTIPART");

  let file: { filename: string; mimetype: string; buffer: Buffer } | null = null;
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      file = {
        filename: part.filename || "file",
        mimetype: part.mimetype || "application/octet-stream",
        buffer: Buffer.concat(chunks),
      };
    }
  }
  if (!file) throw new ValidationError("MISSING_FILE");
  if (file.buffer.length > 20 * 1024 * 1024) throw new ValidationError("FILE_TOO_LARGE");

  const saved = await prisma.chatFile.create({
    data: {
      name: file.filename.slice(0, 200),
      mime: file.mimetype,
      size: file.buffer.length,
      bytes: file.buffer,
    },
    select: { id: true, name: true, size: true },
  });
  return res.code(200).send({
    fileId: saved.id,
    name: saved.name,
    size: saved.size,
    url: fileUrl(req, saved.id),
  });
};

// GET /chat/file/:id  (PUBLIC — opened/downloaded via the message link)
export const chatServeFile = async (req: FastifyRequest, res: FastifyReply) => {
  const { id } = req.params as { id?: string };
  if (!id) throw new ValidationError("BAD_REQUEST");
  const f = await prisma.chatFile.findUnique({
    where: { id },
    select: { bytes: true, mime: true, name: true },
  });
  if (!f?.bytes) return res.code(404).send({ message: "No file" });
  const safeName = (f.name || "file").replace(/["\r\n]/g, "");
  return res
    .header("Content-Type", f.mime || "application/octet-stream")
    .header("Content-Disposition", `inline; filename="${safeName}"`)
    .header("Cache-Control", "public, max-age=31536000, immutable")
    .send(Buffer.from(f.bytes));
};
