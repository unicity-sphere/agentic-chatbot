import { Chess } from 'chess.js';
import { StockfishEngine } from './stockfish.js';
import {
  encodeMessage,
  ACTION,
  HEARTBEAT_INTERVAL_MS,
  type ParsedMessage,
  type GameOverResult,
  type GameOverReason,
} from './protocol.js';

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
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private ended = false;
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
      this.startHeartbeat();
    }
  }

  async handleMessage(msg: ParsedMessage): Promise<void> {
    if (this.ended) return;

    switch (msg.action) {
      case ACTION.MOVE:
        await this.handleOpponentMove(msg.san, msg.clockMs);
        break;
      case ACTION.HEARTBEAT:
        this.opponentClockMs = msg.clockMs;
        break;
      case ACTION.RESIGN:
        console.log(`${this.tag} Opponent resigned`);
        await this.endGame(this.myColor, 'resign');
        break;
      case ACTION.DRAW_OFFER:
        // Bot always declines draws
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

  private async handleOpponentMove(san: string, clockMs: number): Promise<void> {
    this.stopHeartbeat();
    this.opponentClockMs = clockMs;

    try {
      this.chess.move(san);
    } catch {
      console.error(`${this.tag} Invalid opponent move: ${san}`);
      return;
    }

    this.moveCount++;
    console.log(`${this.tag} Opponent: ${san} (clock: ${clockMs}ms)`);

    // Check if game ended after opponent's move (e.g. opponent checkmated us)
    if (this.checkTerminal()) return;

    // Our turn
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

    // Convert UCI move (e.g. e2e4) to SAN (e.g. e4) via chess.js
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

    // Update clock
    const elapsed = Date.now() - this.turnStartedAt;
    this.myClockMs -= elapsed;
    this.turnStartedAt = 0;
    this.moveCount++;

    // Check timeout
    if (this.myClockMs <= 0) {
      this.myClockMs = 0;
      const winner = this.myColor === 'w' ? 'b' : 'w';
      await this.endGame(winner as GameOverResult, 'timeout');
      return;
    }

    // Send move message
    const nextTurn = this.myColor === 'w' ? 'b' : 'w';
    await this.sendMessage(
      encodeMessage({
        action: ACTION.MOVE,
        gameId: this.gameId,
        san,
        clockMs: Math.max(0, Math.round(this.myClockMs)),
        turn: nextTurn as 'w' | 'b',
      }),
    );
    console.log(`${this.tag} Bot: ${san} (clock: ${Math.round(this.myClockMs)}ms)`);

    // Check if game ended after our move
    if (this.checkTerminal()) return;

    // Wait for opponent's move
    this.startHeartbeat();
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
    this.stopHeartbeat();

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

  private calculateThinkTime(): number {
    let thinkTime = Math.floor(this.myClockMs / 40);
    thinkTime = Math.max(200, thinkTime);
    thinkTime = Math.min(10_000, thinkTime);
    // Leave buffer so we don't flag on time
    thinkTime = Math.min(thinkTime, this.myClockMs - 2000);
    return Math.max(100, thinkTime);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(async () => {
      if (this.ended) return;
      try {
        await this.sendMessage(
          encodeMessage({
            action: ACTION.HEARTBEAT,
            gameId: this.gameId,
            clockMs: Math.max(0, Math.round(this.myClockMs)),
          }),
        );
      } catch (err) {
        console.error(`${this.tag} Heartbeat error:`, err);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /** External cleanup without sending game-over message. */
  cleanup(): void {
    if (this.ended) return;
    this.ended = true;
    this.stopHeartbeat();
    this.engine.destroy();
    this.onGameEnd({ gameId: this.gameId, result: null, reason: null, pgn: this.chess.pgn() });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
