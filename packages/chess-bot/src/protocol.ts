export const PROTOCOL_PREFIX = 'unichess';
export const GAME_ID_LENGTH = 8;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const ENTRY_FEE = 10;
export const ESCROW_NAMETAG = '@unichess';
export const DEFAULT_ELO = 1500;

export const ACTION = {
  CHALLENGE: 'ch',
  ACCEPT: 'ok',
  DECLINE: 'no',
  MOVE: 'mv',
  RESIGN: 'rs',
  DRAW_OFFER: 'do',
  DRAW_ACCEPT: 'da',
  DRAW_DECLINE: 'dd',
  HEARTBEAT: 'hb',
  ABORT: 'ab',
  GAMEOVER: 'go',
  REMATCH: 'rm',
} as const;

export type ChallengeColor = 'w' | 'b' | 'r';
export type GameOverResult = 'w' | 'b' | 'd';
export type GameOverReason =
  | 'checkmate'
  | 'resign'
  | 'timeout'
  | 'stalemate'
  | 'agreement'
  | 'repetition'
  | '50move'
  | 'material'
  | 'disconnect';

export interface ChallengeMessage {
  action: typeof ACTION.CHALLENGE;
  gameId: string;
  color: ChallengeColor;
  timeMinutes: number;
  gameUrl: string;
  elo: number;
  from?: string;
}

export interface AcceptMessage {
  action: typeof ACTION.ACCEPT;
  gameId: string;
}

export interface DeclineMessage {
  action: typeof ACTION.DECLINE;
  gameId: string;
}

export interface MoveMessage {
  action: typeof ACTION.MOVE;
  gameId: string;
  san: string;
  clockMs: number;
  turn: 'w' | 'b';
}

export interface ResignMessage {
  action: typeof ACTION.RESIGN;
  gameId: string;
}

export interface DrawOfferMessage {
  action: typeof ACTION.DRAW_OFFER;
  gameId: string;
}

export interface DrawAcceptMessage {
  action: typeof ACTION.DRAW_ACCEPT;
  gameId: string;
}

export interface DrawDeclineMessage {
  action: typeof ACTION.DRAW_DECLINE;
  gameId: string;
}

export interface HeartbeatMessage {
  action: typeof ACTION.HEARTBEAT;
  gameId: string;
  clockMs: number;
}

export interface AbortMessage {
  action: typeof ACTION.ABORT;
  gameId: string;
}

export interface GameOverMessage {
  action: typeof ACTION.GAMEOVER;
  gameId: string;
  result: GameOverResult;
  reason: GameOverReason;
}

export interface RematchMessage {
  action: typeof ACTION.REMATCH;
  gameId: string;
  newGameId: string;
  color: ChallengeColor;
  timeMinutes: number;
}

export type ParsedMessage =
  | ChallengeMessage
  | AcceptMessage
  | DeclineMessage
  | MoveMessage
  | ResignMessage
  | DrawOfferMessage
  | DrawAcceptMessage
  | DrawDeclineMessage
  | HeartbeatMessage
  | AbortMessage
  | GameOverMessage
  | RematchMessage;

const VALID_CHALLENGE_COLORS = new Set(['w', 'b', 'r']);
const VALID_GAMEOVER_RESULTS = new Set(['w', 'b', 'd']);
const VALID_GAMEOVER_REASONS = new Set([
  'checkmate',
  'resign',
  'timeout',
  'stalemate',
  'agreement',
  'repetition',
  '50move',
  'material',
  'disconnect',
]);

function parseChallengeUrl(raw: string): ChallengeMessage | null {
  try {
    if (
      !raw.startsWith('http://') &&
      !raw.startsWith('https://') &&
      !raw.startsWith('unicity-connect://')
    )
      return null;

    const normalized = raw.replace(/^unicity-connect:\/\//, 'https://');
    const url = new URL(normalized);

    const action = url.searchParams.get('action');
    if (action !== 'ch') return null;

    const gameId = url.searchParams.get('game');
    if (!gameId || gameId.length !== GAME_ID_LENGTH) return null;

    const color = url.searchParams.get('color');
    if (!color || !VALID_CHALLENGE_COLORS.has(color)) return null;

    const timeStr = url.searchParams.get('time');
    if (!timeStr) return null;
    const timeMinutes = parseInt(timeStr, 10);
    if (isNaN(timeMinutes) || timeMinutes <= 0) return null;

    const from = url.searchParams.get('from') || undefined;
    const eloStr = url.searchParams.get('elo');
    const elo = eloStr ? parseInt(eloStr, 10) : DEFAULT_ELO;
    const clampedElo = isNaN(elo) ? DEFAULT_ELO : Math.max(200, Math.min(3000, elo));

    return {
      action: ACTION.CHALLENGE,
      gameId,
      color: color as ChallengeColor,
      timeMinutes,
      gameUrl: raw,
      elo: clampedElo,
      from,
    };
  } catch {
    return null;
  }
}

export function parseMessage(raw: string): ParsedMessage | null {
  const trimmed = raw.trim();

  // Challenge URLs
  const challenge = parseChallengeUrl(trimmed);
  if (challenge) return challenge;

  // Standard protocol messages: unichess:<gameId>:<action>[:<params>...]
  if (!trimmed.startsWith(`${PROTOCOL_PREFIX}:`)) return null;
  const parts = trimmed.split(':');
  if (parts.length < 3) return null;

  const gameId = parts[1];
  if (!gameId || gameId.length !== GAME_ID_LENGTH) return null;

  const act = parts[2];

  switch (act) {
    case ACTION.ACCEPT:
      return { action: ACTION.ACCEPT, gameId };

    case ACTION.DECLINE:
      return { action: ACTION.DECLINE, gameId };

    case ACTION.MOVE: {
      if (parts.length < 6) return null;
      const san = parts[3];
      const clockMs = parseInt(parts[4], 10);
      const turn = parts[5];
      if (!san || isNaN(clockMs) || (turn !== 'w' && turn !== 'b')) return null;
      return { action: ACTION.MOVE, gameId, san, clockMs, turn };
    }

    case ACTION.RESIGN:
      return { action: ACTION.RESIGN, gameId };

    case ACTION.DRAW_OFFER:
      return { action: ACTION.DRAW_OFFER, gameId };

    case ACTION.DRAW_ACCEPT:
      return { action: ACTION.DRAW_ACCEPT, gameId };

    case ACTION.DRAW_DECLINE:
      return { action: ACTION.DRAW_DECLINE, gameId };

    case ACTION.HEARTBEAT: {
      if (parts.length < 4) return null;
      const clockMs = parseInt(parts[3], 10);
      if (isNaN(clockMs)) return null;
      return { action: ACTION.HEARTBEAT, gameId, clockMs };
    }

    case ACTION.ABORT:
      return { action: ACTION.ABORT, gameId };

    case ACTION.GAMEOVER: {
      if (parts.length < 5) return null;
      const result = parts[3];
      const reason = parts[4];
      if (!VALID_GAMEOVER_RESULTS.has(result!) || !VALID_GAMEOVER_REASONS.has(reason!))
        return null;
      return {
        action: ACTION.GAMEOVER,
        gameId,
        result: result as GameOverResult,
        reason: reason as GameOverReason,
      };
    }

    case ACTION.REMATCH: {
      if (parts.length < 6) return null;
      const newGameId = parts[3];
      const color = parts[4];
      const timeStr = parts[5];
      if (!newGameId || newGameId.length !== GAME_ID_LENGTH) return null;
      if (!VALID_CHALLENGE_COLORS.has(color!)) return null;
      const timeMinutes = parseInt(timeStr!, 10);
      if (isNaN(timeMinutes)) return null;
      return {
        action: ACTION.REMATCH,
        gameId,
        newGameId,
        color: color as ChallengeColor,
        timeMinutes,
      };
    }

    default:
      return null;
  }
}

export function encodeMessage(msg: ParsedMessage): string {
  const prefix = `${PROTOCOL_PREFIX}:${msg.gameId}`;

  switch (msg.action) {
    case ACTION.CHALLENGE:
      return msg.gameUrl;
    case ACTION.ACCEPT:
      return `${prefix}:${ACTION.ACCEPT}`;
    case ACTION.DECLINE:
      return `${prefix}:${ACTION.DECLINE}`;
    case ACTION.MOVE:
      return `${prefix}:${ACTION.MOVE}:${msg.san}:${msg.clockMs}:${msg.turn}`;
    case ACTION.RESIGN:
      return `${prefix}:${ACTION.RESIGN}`;
    case ACTION.DRAW_OFFER:
      return `${prefix}:${ACTION.DRAW_OFFER}`;
    case ACTION.DRAW_ACCEPT:
      return `${prefix}:${ACTION.DRAW_ACCEPT}`;
    case ACTION.DRAW_DECLINE:
      return `${prefix}:${ACTION.DRAW_DECLINE}`;
    case ACTION.HEARTBEAT:
      return `${prefix}:${ACTION.HEARTBEAT}:${msg.clockMs}`;
    case ACTION.ABORT:
      return `${prefix}:${ACTION.ABORT}`;
    case ACTION.GAMEOVER:
      return `${prefix}:${ACTION.GAMEOVER}:${msg.result}:${msg.reason}`;
    case ACTION.REMATCH:
      return `${prefix}:${ACTION.REMATCH}:${msg.newGameId}:${msg.color}:${msg.timeMinutes}`;
  }
}
