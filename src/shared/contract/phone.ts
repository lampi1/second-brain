// Phone bridge contract: the types shared by the Telegram phone bridge (src/main/phone), its Settings page
// (Impostazioni → Telefono) and the chats port that lets the bridge talk to the Orchestrator.
// Why: the bridge was built in parallel parts; this file is the one interface between them (ADR "phone bridge");
// the integrator added PhonePort.onChatFailed (failed non-Orchestrator chats, design §8).
// Who uses it: src/main/phone/*, src/main/ipc-handlers/phone.ts, src/preload, the renderer Settings page, src/main/chats/phone-port.ts.

/** One action that arrived from the phone, as shown in Settings (last 20). label is neutral: never message text. */
export interface PhoneAction {
  at: number;
  kind: 'text' | 'voice' | 'answer' | 'plan' | 'command' | 'backlog' | 'dropped';
  label: string;
}

export type PhoneBridgeState =
  | 'off'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopped-from-phone'
  | 'error'
  | 'dev-disabled';

/** What Settings → Telefono and app_guide read. Never carries the token. */
export interface PhoneStatus {
  hasToken: boolean;
  enabled: boolean;
  paired: boolean;
  pairing: { code: string; expiresAt: number } | null;
  state: PhoneBridgeState;
  error: string | null;
  dropped: number;
  quietHours: { from: number; to: number } | null;
  recent: PhoneAction[];
}

export interface PhoneSettingsPatch {
  enabled?: boolean;
  quietHours?: { from: number; to: number } | null;
}

/** IPC channel names (invoke unless noted). */
export const PHONE_IPC = {
  status: 'phone:status',
  setToken: 'phone:set-token',
  clearToken: 'phone:clear-token',
  startPairing: 'phone:start-pairing',
  unpair: 'phone:unpair',
  update: 'phone:update',
  /** main → renderer event with the new PhoneStatus */
  changed: 'phone:changed',
  /** renderer → main: the chat in Focus (null = none) */
  focusChanged: 'focus:changed',
  /** main → renderer event: decode a Telegram voice note */
  decodeRequest: 'phone:decode-request',
  /** renderer → main invoke: the decoded 16 kHz mono PCM WAV, or an error */
  decodeResult: 'phone:decode-result',
} as const;

export interface PhoneDecodeRequest {
  id: string;
  bytes: Uint8Array;
}

export interface PhoneDecodeResult {
  id: string;
  wav?: Uint8Array;
  error?: string;
}

/** What main's IPC handlers call; implemented by the bridge (src/main/phone/bridge.ts). */
export interface PhoneController {
  status(): PhoneStatus;
  setToken(token: string): Promise<PhoneStatus>;
  clearToken(): Promise<PhoneStatus>;
  startPairing(): PhoneStatus;
  unpair(): PhoneStatus;
  update(patch: PhoneSettingsPatch): PhoneStatus;
  onChanged(cb: (status: PhoneStatus) => void): () => void;
  setFocus(chatId: string | null): void;
}

/** A request the phone may see. simple=false or reserved=true → the phone shows "Serve il PC", no buttons. */
export interface PhoneDecidable {
  chatId: string;
  ref: { kind: 'question'; requestId: string } | { kind: 'plan'; at: string };
  /** role name, e.g. "Artisan" */
  role: string;
  /** neutral label, e.g. "lavoro 3": never the chat title */
  neutralLabel: string;
  /** question or plan text, unfiltered: the bridge filters every outgoing text */
  text: string;
  recommended?: 'yes' | 'no';
  /** true only for a type:'question' request with one question and two options, or a Strategist plan */
  simple: boolean;
  /** true when it matches RESERVED (src/shared/away.ts) or is a permission, command or workflow proposal */
  reserved: boolean;
  /** true when the chat is the Orchestrator */
  orchestrator: boolean;
}

export type PhoneDecideResult = 'ok' | 'already' | 'gone';

/** What the bridge needs from the chats; implemented by src/main/chats/phone-port.ts. */
export interface PhonePort {
  /** sends text as the user's message to the Orchestrator with source {kind:'phone'}; never approves anything */
  sendFromPhone(text: string, opts: { voice: boolean }): Promise<{ queued: boolean }>;
  listDecidable(): PhoneDecidable[];
  /** answers a simple yes/no question, actor 'phone'; refuses non-simple or reserved ones with 'gone' */
  answerFromPhone(chatId: string, requestId: string, yes: boolean): Promise<PhoneDecideResult>;
  /** decides a proposed Strategist plan by its `at`, actor 'phone' */
  decidePlanFromPhone(chatId: string, at: string, approve: boolean): Promise<PhoneDecideResult>;
  onDecidable(cb: (ev: { type: 'added' | 'resolved'; item: PhoneDecidable; by?: 'phone' | 'pc' }) => void): () => void;
  onOrchestratorTurnEnd(cb: (ev: { reply: string; fromPhone: boolean; failed: boolean }) => void): () => void;
  /** a chat other than the Orchestrator ended its turn with an error (design §8 «chat fallite»): role + neutral label only */
  onChatFailed(cb: (ev: { chatId: string; role: string; neutralLabel: string }) => void): () => void;
  waitingSummary(): { waiting: number; orchestratorBusy: boolean; labels: string[] };
}
