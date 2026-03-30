import { Chess } from 'chess.js';
import { StockfishEngine } from './stockfish.js';
import {
  encodeMessage,
  ACTION,
  type ParsedMessage,
  type GameOverResult,
  type GameOverReason,
} from './protocol.js';

const POLL_INTERVAL_MS = 10_000;

export interface GameEndInfo {
  gameId: string;
  result: GameOverResult | null;
  reason: GameOverReason | null;
  pgn: string;
}

export interface GameOptions {
  gameId: string;
  myColor: 'w' | 'b';
  timeControlMs: number;
  elo: number;
  sendMessage: (msg: string) => Promise<void>;
  onGameEnd: (info: GameEndInfo) => void;
}

export class Game {
  readonly gameId: string;
  readonly myColor: 'w' | 'b';
  readonly elo: number;

  private chess: Chess;
  private engine: StockfishEngine;
  private myClockMs: number;
  private opponentClockMs: number;
  private turnStartedAt = 0;
  private moveCount = 0;
  private lastAppliedOpponentMoveNum = 0;
  private pollInterval?: ReturnType<typeof setInterval>;
  private lastMoveSent: { san: string; color: 'w' | 'b'; moveNum: number } | null = null;
  private ended = false;
  private lastOpponentActivity = 0;
  private timeControlMs: number;
  private sendMessage: (msg: string) => Promise<void>;
  private onGameEnd: (info: GameEndInfo) => void;
  private tag: string;

  constructor(options: GameOptions) {
    this.gameId = options.gameId;
    this.myColor = options.myColor;
    this.elo = options.elo;
    this.chess = new Chess();
    this.engine = new StockfishEngine();
    this.myClockMs = options.timeControlMs;
    this.opponentClockMs = options.timeControlMs;
    this.sendMessage = options.sendMessage;
    this.onGameEnd = options.onGameEnd;
    this.timeControlMs = options.timeControlMs;
    this.lastOpponentActivity = Date.now();
    this.tag = `[game:${options.gameId}]`;

    this.engine.on('exit', () => {
      if (!this.ended) {
        console.error(`${this.tag} Stockfish crashed, resigning`);
        this.sendMessage(
          encodeMessage({ action: ACTION.RESIGN, gameId: this.gameId }),
        ).catch(() => {});
        this.cleanup();
      }
    });
  }

  async start(): Promise<void> {
    console.log(
      `${this.tag} Starting (color=${this.myColor}, elo=${this.elo}, time=${this.myClockMs}ms)`,
    );
    await this.engine.init(this.elo);

    if (this.myColor === 'w') {
      // Small delay so opponent has time to process the accept message
      await sleep(1500);
      this.turnStartedAt = Date.now();
      await this.makeMove();
    } else {
      this.startPolling();
    }
  }

  async handleMessage(msg: ParsedMessage): Promise<void> {
    if (this.ended) return;

    switch (msg.action) {
      case ACTION.MOVE: {
        this.lastOpponentActivity = Date.now();
        // Reject moves claiming to be from our color
        if (msg.color === this.myColor) return;
        // Dedup by moveNum
        if (msg.moveNum > 0 && msg.moveNum <= this.lastAppliedOpponentMoveNum) return;
        await this.handleOpponentMove(msg.san, msg.clockMs, msg.moveNum);
        break;
      }
      case ACTION.HEARTBEAT:
        this.lastOpponentActivity = Date.now();
        this.opponentClockMs = msg.clockMs;
        break;
      case ACTION.RESIGN:
        console.log(`${this.tag} Opponent resigned`);
        await this.endGame(this.myColor, 'resign');
        break;
      case ACTION.DRAW_OFFER:
        await this.sendMessage(
          encodeMessage({ action: ACTION.DRAW_DECLINE, gameId: this.gameId }),
        );
        break;
      case ACTION.ABORT:
        if (this.moveCount < 2) {
          console.log(`${this.tag} Game aborted by opponent`);
          this.cleanup();
        }
        break;
      case ACTION.GAMEOVER:
        console.log(`${this.tag} Opponent sent game over: ${msg.result} by ${msg.reason}`);
        this.cleanup();
        break;
      default:
        break;
    }
  }

  private async handleOpponentMove(san: string, clockMs: number, moveNum: number): Promise<void> {
    this.stopPolling();
    this.opponentClockMs = clockMs;

    try {
      this.chess.move(san);
    } catch {
      console.error(`${this.tag} Invalid opponent move: ${san}`);
      return;
    }

    this.moveCount++;
    this.lastAppliedOpponentMoveNum = moveNum;
    console.log(`${this.tag} Opponent: ${san} #${moveNum} (clock: ${clockMs}ms)`);

    if (this.checkTerminal()) return;

    this.turnStartedAt = Date.now();
    await this.makeMove();
  }

  private async makeMove(): Promise<void> {
    if (this.ended) return;
    if (!this.turnStartedAt) this.turnStartedAt = Date.now();

    const thinkTime = this.calculateThinkTime();

    let uciMove: string;
    try {
      uciMove = await this.engine.getBestMove(this.chess.fen(), thinkTime);
    } catch (err) {
      console.error(`${this.tag} Stockfish error:`, err);
      await this.sendMessage(
        encodeMessage({ action: ACTION.RESIGN, gameId: this.gameId }),
      ).catch(() => {});
      this.cleanup();
      return;
    }

    if (this.ended) return;

    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length > 4 ? uciMove[4] : undefined;

    let san: string;
    try {
      const move = this.chess.move({ from, to, promotion });
      san = move.san;
    } catch {
      console.error(`${this.tag} Cannot apply Stockfish move ${uciMove} to position`);
      await this.sendMessage(
        encodeMessage({ action: ACTION.RESIGN, gameId: this.gameId }),
      ).catch(() => {});
      this.cleanup();
      return;
    }

    const elapsed = Date.now() - this.turnStartedAt;
    this.myClockMs -= elapsed;
    this.turnStartedAt = 0;
    this.moveCount++;

    if (this.myClockMs <= 0) {
      this.myClockMs = 0;
      const winner = this.myColor === 'w' ? 'b' : 'w';
      await this.endGame(winner as GameOverResult, 'timeout');
      return;
    }

    this.lastMoveSent = { san, color: this.myColor, moveNum: this.moveCount };
    await this.sendMessage(this.buildMoveMsg());
    console.log(`${this.tag} Bot: ${san} #${this.moveCount} (clock: ${Math.round(this.myClockMs)}ms)`);

    if (this.checkTerminal()) return;

    // Poll: resend last move periodically until opponent responds
    this.startPolling();
  }

  private checkTerminal(): boolean {
    if (this.chess.isCheckmate()) {
      const loser = this.chess.turn();
      const winner = (loser === 'w' ? 'b' : 'w') as GameOverResult;
      this.endGame(winner, 'checkmate');
      return true;
    }
    if (this.chess.isStalemate()) {
      this.endGame('d', 'stalemate');
      return true;
    }
    if (this.chess.isThreefoldRepetition()) {
      this.endGame('d', 'repetition');
      return true;
    }
    if (this.chess.isInsufficientMaterial()) {
      this.endGame('d', 'material');
      return true;
    }
    if (this.chess.isDraw()) {
      this.endGame('d', '50move');
      return true;
    }
    return false;
  }

  private async endGame(result: GameOverResult, reason: GameOverReason): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.stopPolling();

    const outcome =
      result === 'd'
        ? 'draw'
        : result === this.myColor
          ? 'bot wins'
          : 'opponent wins';
    console.log(`${this.tag} Game over: ${outcome} by ${reason}`);

    try {
      await this.sendMessage(
        encodeMessage({ action: ACTION.GAMEOVER, gameId: this.gameId, result, reason }),
      );
    } catch (err) {
      console.error(`${this.tag} Failed to send game over:`, err);
    }

    this.engine.destroy();
    this.onGameEnd({ gameId: this.gameId, result, reason, pgn: this.chess.pgn() });
  }

  /** Build move message with current clock value (for accurate clock sync on resends) */
  private buildMoveMsg(): string {
    const m = this.lastMoveSent!;
    return encodeMessage({
      action: ACTION.MOVE,
      gameId: this.gameId,
      san: m.san,
      clockMs: Math.max(0, Math.round(this.myClockMs)),
      color: m.color,
      moveNum: m.moveNum,
    });
  }

  private calculateThinkTime(): number {
    let thinkTime = Math.floor(this.myClockMs / 40);
    thinkTime = Math.max(200, thinkTime);
    thinkTime = Math.min(10_000, thinkTime);
    thinkTime = Math.min(thinkTime, this.myClockMs - 2000);
    return Math.max(100, thinkTime);
  }

  /**
   * While waiting for the opponent, periodically resend the last move.
   * This serves as both heartbeat and retry — the opponent deduplicates by moveNum.
   * Also detects opponent disconnect/timeout.
   */
  private startPolling(): void {
    this.stopPolling();
    this.pollInterval = setInterval(async () => {
      if (this.ended) return;

      const silenceMs = Date.now() - this.lastOpponentActivity;

      // Opponent disconnect: no activity for the full time control duration
      if (silenceMs >= this.timeControlMs) {
        console.log(`${this.tag} Opponent disconnected (${Math.round(silenceMs / 1000)}s silence)`);
        await this.endGame(this.myColor as GameOverResult, 'disconnect');
        return;
      }

      // Opponent timeout: their clock ran out
      const estimatedOpponentClock = this.opponentClockMs - silenceMs;
      if (estimatedOpponentClock <= 0 && this.moveCount > 0) {
        console.log(`${this.tag} Opponent timed out`);
        await this.endGame(this.myColor as GameOverResult, 'timeout');
        return;
      }

      // Resend last move with fresh clock as keep-alive + retry
      if (this.lastMoveSent) {
        const msg = this.buildMoveMsg();
        console.log(`${this.tag} Resending: ${msg.slice(0, 60)}`);
        try {
          await this.sendMessage(msg);
        } catch {}
      }
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    this.lastMoveSent = null;
  }

  cleanup(): void {
    if (this.ended) return;
    this.ended = true;
    this.stopPolling();
    this.engine.destroy();
    this.onGameEnd({ gameId: this.gameId, result: null, reason: null, pgn: this.chess.pgn() });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
