// What the bot logic needs from WhatsApp. The Baileys adapter lives in main.ts; tests use a fake.
export type SentMessage = { id: string; message?: string /* proto JSON for re-send requests */ };
export interface WhatsAppPort {
  sendText(jid: string, text: string, mentions?: string[]): Promise<SentMessage>;
  sendImage(jid: string, url: string, caption?: string, mentions?: string[]): Promise<SentMessage>;
  sendPoll(jid: string, poll: { name: string; values: string[]; selectableCount: number; messageSecret: Uint8Array }): Promise<SentMessage & { creatorJid: string }>;
  /** Everyone in the group (for "marcar todos"). */
  groupMembers(jid: string): Promise<string[]>;
  logout(): Promise<void>;
}
