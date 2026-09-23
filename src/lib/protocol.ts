import type { CardCode } from "./poker/cards";
import type { PlayerAction, PublicTableState, TableSettings } from "./poker/game";

export interface ChatMessage {
  id: string;
  playerId: string | null;
  name: string;
  text: string;
  at: number;
  system?: boolean;
}

/** Everything that is safe to broadcast to every socket in the room. */
export interface RoomSnapshot {
  code: string;
  hostId: string;
  table: PublicTableState;
  chat: ChatMessage[];
  spectators: number;
  started: boolean;
}

/** Sent only to the socket that owns the seat. */
export interface YouInfo {
  playerId: string;
  name: string;
  seat: number;
  holeCards: CardCode[];
  isHost: boolean;
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  code?: string;
  playerId?: string | null;
  snapshot?: RoomSnapshot;
  you?: YouInfo | null;
}

export interface CreateRoomPayload {
  name: string;
  settings?: Partial<TableSettings>;
}

export interface JoinRoomPayload {
  code: string;
  name: string;
  seat?: number;
}

export interface SubscribePayload {
  code: string;
  playerId?: string | null;
}

export interface ServerToClientEvents {
  "room:state": (snapshot: RoomSnapshot) => void;
  "room:you": (you: YouInfo | null) => void;
  "chat:new": (message: ChatMessage) => void;
  "room:error": (payload: { message: string }) => void;
}

export interface ClientToServerEvents {
  "room:create": (payload: CreateRoomPayload, ack: (result: JoinResult) => void) => void;
  "room:join": (payload: JoinRoomPayload, ack: (result: JoinResult) => void) => void;
  "room:subscribe": (payload: SubscribePayload, ack: (result: JoinResult) => void) => void;
  "room:leave": () => void;
  "game:start": (ack: (result: JoinResult) => void) => void;
  "game:settings": (
    payload: { settings: Partial<TableSettings> },
    ack: (result: JoinResult) => void,
  ) => void;
  "player:action": (
    payload: { action: PlayerAction; amount?: number },
    ack: (result: JoinResult) => void,
  ) => void;
  "player:rebuy": (ack: (result: JoinResult) => void) => void;
  "player:sitout": (payload: { sittingOut: boolean }, ack: (result: JoinResult) => void) => void;
  "player:standup": (ack: (result: JoinResult) => void) => void;
  "chat:send": (payload: { text: string }, ack: (result: JoinResult) => void) => void;
}

/** Sanitise a display name coming off the wire. */
export function cleanName(raw: unknown, fallback = "Player"): string {
  const value = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!value) return fallback;
  return value.slice(0, 22);
}

export function cleanText(raw: unknown, max = 240): string {
  const value = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return value.slice(0, max);
}
