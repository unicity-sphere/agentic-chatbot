import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export class StockfishEngine extends EventEmitter {
  private engine: { ccall: (fn: string, ret: string | null, types: string[], args: string[], opts?: Record<string, unknown>) => void; listener: ((line: string) => void) | null } | null = null;
  private destroyed = false;
  private elo = 1500;

  private async create(): Promise<void> {
    // Use the lite ASM.JS build: pure JS, no WASM/SharedArrayBuffer/worker issues.
    // Clear require cache so each engine gets a fresh module instance.
    const sfPath = require.resolve('stockfish/bin/stockfish-18-asm.js');
    delete require.cache[sfPath];
    const outerFactory = require(sfPath);
    const innerFactory = outerFactory();
    const engineModule = await innerFactory();

    this.engine = engineModule;
    this.engine!.listener = (line: string) => {
      const trimmed = typeof line === 'string' ? line.trim() : String(line).trim();
      if (trimmed) this.emit('line', trimmed);
    };
  }

  private send(cmd: string): void {
    if (this.destroyed || !this.engine) return;
    // The 'go' command needs async:true for Emscripten asyncify support
    const isAsync = /^go\b/.test(cmd);
    this.engine.ccall('command', null, ['string'], [cmd], isAsync ? { async: true } : undefined);
  }

  private waitFor(prefix: string, timeoutMs = 10_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('line', handler);
        reject(new Error(`Stockfish timeout waiting for "${prefix}" after ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (line: string) => {
        if (line.startsWith(prefix)) {
          clearTimeout(timer);
          this.off('line', handler);
          resolve(line);
        }
      };
      this.on('line', handler);
    });
  }

  async init(elo: number): Promise<void> {
    this.elo = elo;

    if (!this.engine) {
      await this.create();
    }

    // Register listener BEFORE sending to catch synchronous output from ccall
    const uciOk = this.waitFor('uciok', 30_000);
    this.send('uci');
    await uciOk;

    // Use both UCI_LimitStrength (for 1320+) and Skill Level + depth (for below)
    this.send('setoption name UCI_LimitStrength value true');
    this.send(`setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, elo))}`);
    if (elo < 1320) {
      // Skill Level: 200→0, 800→3, 1000→5, 1320→8
      // Intentionally low — Skill Level 0 is already ~800+ ELO
      const skillLevel = Math.max(0, Math.min(8, Math.round(((elo - 200) / 1120) * 8)));
      this.send(`setoption name Skill Level value ${skillLevel}`);
    }

    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 16');
    const ready = this.waitFor('readyok');
    this.send('isready');
    await ready;
  }

  async getBestMove(fen: string, thinkTimeMs: number): Promise<string> {
    this.send(`position fen ${fen}`);

    let goCmd = `go movetime ${Math.max(100, thinkTimeMs)}`;
    if (this.elo < 1320) {
      // Depth: 200→1, 500→1, 800→2, 1000→3, 1320→4
      const maxDepth = Math.max(1, Math.min(4, Math.ceil(((this.elo - 200) / 1120) * 4)));
      goCmd += ` depth ${maxDepth}`;
    }

    const bestMove = this.waitFor('bestmove', thinkTimeMs + 30_000);
    this.send(goCmd);
    const line = await bestMove;
    const parts = line.split(/\s+/);
    const move = parts[1];
    if (!move || move === '(none)') {
      throw new Error('Stockfish returned no move');
    }
    return move;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.send('quit');
    } catch {}
    if (this.engine) {
      this.engine.listener = null;
      this.engine = null;
    }
    this.removeAllListeners();
  }
}
