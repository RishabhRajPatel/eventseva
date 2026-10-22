import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { notify } from '../notifications/notify';

/** Customer app sends vendorId; Partner app sends bookingId (it can only open chats with its own customers). */
class StartDto {
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() bookingId?: string;
}

class MessageDto {
  @IsString() @Length(1, 1000) body: string;
}

class MessagesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) beforeId?: number;
}

const PAGE = 50;
const PHONE = /(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}/g;

/**
 * Until a booking between the two is confirmed, phone numbers in messages are hidden, so
 * nobody can take the deal outside the app (and outside its refund protection).
 */
export const maskPhones = (text: string) => text.replace(PHONE, '••••••••••');

interface Conversation {
  id: string;
  customer_id: string;
  vendor_id: string;
  vendor_user_id: string;
}

/**
 * Customer ↔ vendor chat. The customer app talks as the customer, the Partner app as the
 * vendor. The apps poll every few seconds while a chat is open (Socket.io can be added later
 * without changing these routes).
 */
@UseGuards(AuthGuard)
@Controller('v1/conversations')
export class ChatController {
  constructor(private readonly db: Db) {}

  @Post()
  async start(@Auth() auth: AuthContext, @Body() body: StartDto) {
    if (auth.app === 'partner') {
      if (!body.bookingId) throw new AppError('VALIDATION', 'bookingId is required.');
      const b = await this.db.one<{ customer_id: string; vendor_id: string }>(
        this.db,
        `SELECT b.customer_id, b.vendor_id FROM bookings b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = $1 AND v.user_id = $2`,
        [body.bookingId, auth.userId],
      );
      if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
      return { id: await this.open(b.customer_id, b.vendor_id) };
    }
    if (!body.vendorId) throw new AppError('VALIDATION', 'vendorId is required.');
    const vendor = await this.db.one<{ user_id: string }>(this.db, `SELECT user_id FROM vendors WHERE id = $1 AND status = 'approved'`, [body.vendorId]);
    if (!vendor) throw new AppError('VENDOR_NOT_FOUND', 'This vendor is not available.', HttpStatus.NOT_FOUND);
    if (vendor.user_id === auth.userId) throw new AppError('OWN_VENDOR', 'You cannot chat with your own business.');
    return { id: await this.open(auth.userId, body.vendorId) };
  }

  /** Get-or-create: one conversation per customer and vendor. */
  private async open(customerId: string, vendorId: string): Promise<string> {
    const conv = await this.db.one<{ id: string }>(
      this.db,
      `INSERT INTO conversations (customer_id, vendor_id) VALUES ($1, $2)
       ON CONFLICT (customer_id, vendor_id) DO UPDATE SET customer_id = EXCLUDED.customer_id RETURNING id`,
      [customerId, vendorId],
    );
    return conv!.id;
  }

  @Get()
  async list(@Auth() auth: AuthContext) {
    const asVendor = auth.app === 'partner';
    const { rows } = await this.db.query(
      `SELECT c.id, c.last_message_at AS "lastMessageAt",
              v.id AS "vendorId", v.business_name AS "vendorName",
              COALESCE(cu.name, 'Customer') AS "customerName",
              (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS "lastMessage",
              (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS "unreadCount",
              EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = c.customer_id AND b.vendor_id = c.vendor_id
                       AND b.status IN ('confirmed', 'completed')) AS "hasBooking"
         FROM conversations c JOIN vendors v ON v.id = c.vendor_id JOIN users cu ON cu.id = c.customer_id
        WHERE ${asVendor ? 'v.user_id = $1' : 'c.customer_id = $1'}
        ORDER BY c.last_message_at DESC NULLS LAST LIMIT 100`,
      [auth.userId],
    );
    return {
      items: rows.map((r) => ({ ...r, lastMessage: r.lastMessage && !r.hasBooking ? maskPhones(r.lastMessage) : r.lastMessage })),
    };
  }

  /** Newest first, 50 at a time. Opening the chat marks the other side's messages read. */
  @Get(':id/messages')
  async messages(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: MessagesQuery) {
    const conv = await this.member(this.db, auth, id);
    const share = await this.hasBooking(conv);
    const { rows } = await this.db.query(
      `SELECT id::int, sender_id AS "senderId", body, read_at AS "readAt", created_at AS "createdAt"
         FROM messages WHERE conversation_id = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`,
      [id, query.beforeId ?? null, PAGE + 1],
    );
    await this.db.query(
      'UPDATE messages SET read_at = now() WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL',
      [id, auth.userId],
    );
    return {
      items: rows.slice(0, PAGE).map((m) => ({ ...m, mine: m.senderId === auth.userId, body: share ? m.body : maskPhones(m.body) })),
      hasMore: rows.length > PAGE,
      phoneShared: share,
    };
  }

  @Post(':id/messages')
  async send(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: MessageDto) {
    const text = body.body.trim();
    if (!text) throw new AppError('VALIDATION', 'Message is empty.');
    return this.db.tx(async (client) => {
      const conv = await this.member(client, auth, id);
      const share = await this.hasBooking(conv, client);
      const msg = await this.db.one(
        client,
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)
         RETURNING id::int, sender_id AS "senderId", body, read_at AS "readAt", created_at AS "createdAt"`,
        [id, auth.userId, text],
      );
      await client.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [id]);
      const to = auth.userId === conv.customer_id ? conv.vendor_user_id : conv.customer_id;
      const preview = (share ? text : maskPhones(text)).slice(0, 100);
      await notify(client, to, 'chat_message', { en: { title: 'New message', body: preview }, hi: { title: 'नया मैसेज', body: preview } }, {
        conversationId: id,
      }, to === conv.vendor_user_id ? 'partner' : 'customer');
      return { ...msg, mine: true, body: share ? msg.body : maskPhones(msg.body) };
    });
  }

  private async member(q: Queryable, auth: AuthContext, id: string): Promise<Conversation> {
    const conv = await this.db.one<Conversation>(
      q,
      `SELECT c.id, c.customer_id, c.vendor_id, v.user_id AS vendor_user_id
         FROM conversations c JOIN vendors v ON v.id = c.vendor_id
        WHERE c.id = $1 AND ${auth.app === 'partner' ? 'v.user_id = $2' : 'c.customer_id = $2'}`,
      [id, auth.userId],
    );
    if (!conv) throw new AppError('NOT_FOUND', 'Chat not found.', HttpStatus.NOT_FOUND);
    return conv;
  }

  private async hasBooking(conv: Conversation, q: Queryable = this.db) {
    return !!(await this.db.one(
      q,
      `SELECT 1 FROM bookings WHERE customer_id = $1 AND vendor_id = $2 AND status IN ('confirmed', 'completed')`,
      [conv.customer_id, conv.vendor_id],
    ));
  }
}
