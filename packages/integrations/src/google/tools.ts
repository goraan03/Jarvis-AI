import { z } from "zod";
import type { ToolDefinition } from "@jarvis/ai-engine";
import { getGmailClient, getCalendarClient } from "./clients.js";
import { buildRawMessage, extractPlainTextBody, getHeader } from "./mime.js";
import type { GoogleOAuthConfig } from "./oauth.js";

export interface GoogleToolsConfig {
  oauth: GoogleOAuthConfig;
  encryptionMasterKey: string;
}

const searchEmailsInput = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(20).optional().default(5),
});
const searchEmailsOutput = z.object({
  messages: z.array(
    z.object({ id: z.string(), threadId: z.string(), subject: z.string(), from: z.string(), date: z.string(), snippet: z.string() }),
  ),
});

const readEmailInput = z.object({ messageId: z.string().min(1) });
const readEmailOutput = z.object({
  id: z.string(),
  subject: z.string(),
  from: z.string(),
  to: z.string(),
  date: z.string(),
  body: z.string(),
});

const createDraftInput = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
});
const createDraftOutput = z.object({ draftId: z.string(), messageId: z.string().optional() });

const sendEmailInput = createDraftInput;
const sendEmailOutput = z.object({ messageId: z.string() });

const calendarEventsInput = z.object({
  timeMin: z.string().datetime().optional(),
  timeMax: z.string().datetime().optional(),
  maxResults: z.number().int().min(1).max(50).optional().default(10),
});
const calendarEventsOutput = z.object({
  events: z.array(
    z.object({ id: z.string(), summary: z.string(), start: z.string(), end: z.string(), location: z.string().optional() }),
  ),
});

/**
 * Only Gmail/Calendar tools whose required OAuth connection actually
 * exists for a given task's user get offered to the model — enforced by
 * the caller checking isGoogleConnected(userId) before including these
 * in a task's tool list (docs/implementation-roadmap.md Phase 5), not by
 * anything in these definitions themselves.
 */
export function buildGoogleTools(config: GoogleToolsConfig): ToolDefinition<any, any>[] {
  return [
    {
      name: "search_emails",
      description: "Searches Gmail using a Gmail search query and returns matching message summaries.",
      inputSchema: searchEmailsInput,
      outputSchema: searchEmailsOutput,
      inputJsonSchema: {
        type: "object",
        properties: { query: { type: "string" }, maxResults: { type: "integer" } },
        required: ["query"],
      },
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 15_000,
      async handler(input, ctx) {
        const gmail = await getGmailClient(ctx.userId, config.oauth, config.encryptionMasterKey);
        const list = await gmail.users.messages.list({ userId: "me", q: input.query, maxResults: input.maxResults });
        const ids = list.data.messages ?? [];
        const messages = await Promise.all(
          ids.map(async (ref) => {
            const msg = await gmail.users.messages.get({
              userId: "me",
              id: ref.id!,
              format: "metadata",
              metadataHeaders: ["Subject", "From", "Date"],
            });
            return {
              id: msg.data.id!,
              threadId: msg.data.threadId!,
              subject: getHeader(msg.data.payload?.headers, "Subject"),
              from: getHeader(msg.data.payload?.headers, "From"),
              date: getHeader(msg.data.payload?.headers, "Date"),
              snippet: msg.data.snippet ?? "",
            };
          }),
        );
        return { messages };
      },
    },

    {
      name: "read_email",
      description: "Reads the full plain-text body and headers of one Gmail message by id.",
      inputSchema: readEmailInput,
      outputSchema: readEmailOutput,
      inputJsonSchema: { type: "object", properties: { messageId: { type: "string" } }, required: ["messageId"] },
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 15_000,
      async handler(input, ctx) {
        const gmail = await getGmailClient(ctx.userId, config.oauth, config.encryptionMasterKey);
        const msg = await gmail.users.messages.get({ userId: "me", id: input.messageId, format: "full" });
        return {
          id: msg.data.id!,
          subject: getHeader(msg.data.payload?.headers, "Subject"),
          from: getHeader(msg.data.payload?.headers, "From"),
          to: getHeader(msg.data.payload?.headers, "To"),
          date: getHeader(msg.data.payload?.headers, "Date"),
          body: extractPlainTextBody(msg.data.payload) || (msg.data.snippet ?? ""),
        };
      },
    },

    {
      name: "create_email_draft",
      description: "Creates a Gmail draft. Does not send anything — drafts are reversible and don't need approval.",
      inputSchema: createDraftInput,
      outputSchema: createDraftOutput,
      inputJsonSchema: {
        type: "object",
        properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["to", "subject", "body"],
      },
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 15_000,
      async handler(input, ctx) {
        const gmail = await getGmailClient(ctx.userId, config.oauth, config.encryptionMasterKey);
        const raw = buildRawMessage(input);
        const draft = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
        return { draftId: draft.data.id!, messageId: draft.data.message?.id ?? undefined };
      },
    },

    {
      name: "send_email",
      description: "Sends an email on the owner's behalf. Irreversible — always requires explicit owner approval.",
      inputSchema: sendEmailInput,
      outputSchema: sendEmailOutput,
      inputJsonSchema: {
        type: "object",
        properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["to", "subject", "body"],
      },
      riskLevel: "high",
      requiresApproval: true,
      timeoutMs: 15_000,
      async handler(input, ctx) {
        const gmail = await getGmailClient(ctx.userId, config.oauth, config.encryptionMasterKey);
        const raw = buildRawMessage(input);
        const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
        return { messageId: sent.data.id! };
      },
    },

    {
      name: "get_calendar_events",
      description: "Lists upcoming events on the owner's primary Google Calendar. Read-only.",
      inputSchema: calendarEventsInput,
      outputSchema: calendarEventsOutput,
      inputJsonSchema: {
        type: "object",
        properties: {
          timeMin: { type: "string" },
          timeMax: { type: "string" },
          maxResults: { type: "integer" },
        },
      },
      riskLevel: "low",
      requiresApproval: false,
      timeoutMs: 15_000,
      async handler(input, ctx) {
        const calendar = await getCalendarClient(ctx.userId, config.oauth, config.encryptionMasterKey);
        const res = await calendar.events.list({
          calendarId: "primary",
          timeMin: input.timeMin ?? new Date().toISOString(),
          timeMax: input.timeMax,
          maxResults: input.maxResults,
          singleEvents: true,
          orderBy: "startTime",
        });
        const events = (res.data.items ?? []).map((e) => ({
          id: e.id ?? "",
          summary: e.summary ?? "(no title)",
          start: e.start?.dateTime ?? e.start?.date ?? "",
          end: e.end?.dateTime ?? e.end?.date ?? "",
          location: e.location ?? undefined,
        }));
        return { events };
      },
    },
  ];
}
