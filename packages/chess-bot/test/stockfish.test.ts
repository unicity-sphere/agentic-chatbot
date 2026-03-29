import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StockfishEngine } from '../src/stockfish.js';

describe('StockfishEngine', () => {
  it('initializes and responds to UCI', async () => {
    const engine = new StockfishEngine();
    await engine.init(1500);
    engine.destroy();
  });

  it('returns a valid move from the starting position', async () => {
    const engine = new StockfishEngine();
    await engine.init(1500);

    const move = await engine.getBestMove(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      500,
    );

    // UCI move: 4 chars (e.g. e2e4) or 5 with promotion (e.g. e7e8q)
    assert.ok(move.length >= 4 && move.length <= 5, `Unexpected move format: ${move}`);
    engine.destroy();
  });

  it('returns a move from a mid-game position', async () => {
    const engine = new StockfishEngine();
    await engine.init(1300);

    // Italian Game position
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
    const move = await engine.getBestMove(fen, 500);
    assert.ok(move.length >= 4);
    engine.destroy();
  });

  it('works at low ELO with depth limiting', async () => {
    const engine = new StockfishEngine();
    await engine.init(800);

    const move = await engine.getBestMove(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      300,
    );
    assert.ok(move.length >= 4);
    engine.destroy();
  });

  it('works at high ELO', async () => {
    const engine = new StockfishEngine();
    await engine.init(2100);

    const move = await engine.getBestMove(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      500,
    );
    assert.ok(move.length >= 4);
    engine.destroy();
  });

  it('finds checkmate in one', async () => {
    const engine = new StockfishEngine();
    await engine.init(2100);

    // Mate in 1: Qh5 is checkmate (Scholar's mate setup)
    // White to move, Qxf7#
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const move = await engine.getBestMove(fen, 1000);
    // Qxf7# in UCI = h5f7
    assert.equal(move, 'h5f7');
    engine.destroy();
  });
});
