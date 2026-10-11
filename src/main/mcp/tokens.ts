// Unguessable per-chat endpoint tokens (ADR 0003): each app chat gets /mcp/chat/<chatId>/<token>, the token only lives
// in memory here and in the chat's own --mcp-config, so a chat sees and drives only its own tabs. Compared in constant
// time. Used by browser/service.ts (mcpUrlFor + the route's authorize()).
import crypto from 'node:crypto';

export class EndpointTokens {
  private readonly byKey = new Map<string, string>();

  /** The token for a key (created on first use, stable for the app run). */
  tokenFor(key: string): string {
    let t = this.byKey.get(key);
    if (!t) { t = crypto.randomBytes(24).toString('base64url'); this.byKey.set(key, t); }
    return t;
  }

  check(key: string, token: string): boolean {
    const want = this.byKey.get(key);
    if (!want) return false;
    const a = Buffer.from(want), b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  revoke(key: string): void { this.byKey.delete(key); }
}
