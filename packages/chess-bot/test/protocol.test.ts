import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, encodeMessage, ACTION } from '../src/protocol.js';

describe('protocol', () => {
  describe('parseMessage', () => {
    it('parses challenge URL with elo', () => {
      const raw = 'unicity-connect://chess.example.com?game=a1b2c3d4&action=ch&color=w&time=5&from=alice&elo=1300';
      const msg = parseMessage(raw);
      assert.ok(msg);
      assert.equal(msg.action, ACTION.CHALLENGE);
      if (msg.action !== ACTION.CHALLENGE) return;
      assert.equal(msg.gameId, 'a1b2c3d4');
      assert.equal(msg.color, 'w');
      assert.equal(msg.timeMinutes, 5);
      assert.equal(msg.elo, 1300);
      assert.equal(msg.from, 'alice');
    });

    it('parses challenge URL without elo (defaults to 1500)', () => {
      const raw = 'https://chess.example.com?game=abcd1234&action=ch&color=b&time=3&from=bob';
      const msg = parseMessage(raw);
      assert.ok(msg);
      assert.equal(msg.action, ACTION.CHALLENGE);
      if (msg.action !== ACTION.CHALLENGE) return;
      assert.equal(msg.elo, 1500);
    });

    it('clamps elo to 200-3000 range', () => {
      const low = parseMessage('https://x.com?game=abcd1234&action=ch&color=w&time=5&elo=50');
      assert.ok(low && low.action === ACTION.CHALLENGE);
      if (low.action === ACTION.CHALLENGE) assert.equal(low.elo, 200);

      const high = parseMessage('https://x.com?game=abcd1234&action=ch&color=w&time=5&elo=9999');
      assert.ok(high && high.action === ACTION.CHALLENGE);
      if (high.action === ACTION.CHALLENGE) assert.equal(high.elo, 3000);
    });

    it('parses move message', () => {
      const msg = parseMessage('unichess:a1b2c3d4:mv:e4:298000:b');
      assert.ok(msg);
      assert.equal(msg.action, ACTION.MOVE);
      if (msg.action !== ACTION.MOVE) return;
      assert.equal(msg.san, 'e4');
      assert.equal(msg.clockMs, 298000);
      assert.equal(msg.turn, 'b');
    });

    it('parses accept', () => {
      const msg = parseMessage('unichess:a1b2c3d4:ok');
      assert.ok(msg);
      assert.equal(msg.action, ACTION.ACCEPT);
      assert.equal(msg.gameId, 'a1b2c3d4');
    });

    it('parses resign', () => {
      const msg = parseMessage('unichess:a1b2c3d4:rs');
      assert.ok(msg);
      assert.equal(msg.action, ACTION.RESIGN);
    });

    it('parses heartbeat', () => {
      const msg = parseMessage('unichess:a1b2c3d4:hb:250000');
      assert.ok(msg);
      assert.equal(msg.action, ACTION.HEARTBEAT);
      if (msg.action === ACTION.HEARTBEAT) assert.equal(msg.clockMs, 250000);
    });

    it('parses game over', () => {
      const msg = parseMessage('unichess:a1b2c3d4:go:w:checkmate');
      assert.ok(msg);
      assert.equal(msg.action, ACTION.GAMEOVER);
      if (msg.action === ACTION.GAMEOVER) {
        assert.equal(msg.result, 'w');
        assert.equal(msg.reason, 'checkmate');
      }
    });

    it('parses draw offer/accept/decline', () => {
      assert.equal(parseMessage('unichess:a1b2c3d4:do')?.action, ACTION.DRAW_OFFER);
      assert.equal(parseMessage('unichess:a1b2c3d4:da')?.action, ACTION.DRAW_ACCEPT);
      assert.equal(parseMessage('unichess:a1b2c3d4:dd')?.action, ACTION.DRAW_DECLINE);
    });

    it('parses abort', () => {
      assert.equal(parseMessage('unichess:a1b2c3d4:ab')?.action, ACTION.ABORT);
    });

    it('returns null for invalid messages', () => {
      assert.equal(parseMessage('hello'), null);
      assert.equal(parseMessage('unichess:short:mv'), null);
      assert.equal(parseMessage('unichess:a1b2c3d4:xx'), null);
      assert.equal(parseMessage(''), null);
    });

    it('returns null for bad game ID length', () => {
      assert.equal(parseMessage('unichess:abc:ok'), null);
      assert.equal(parseMessage('unichess:toolonggameid1234:ok'), null);
    });
  });

  describe('encodeMessage', () => {
    it('encodes accept', () => {
      assert.equal(
        encodeMessage({ action: ACTION.ACCEPT, gameId: 'a1b2c3d4' }),
        'unichess:a1b2c3d4:ok',
      );
    });

    it('encodes move', () => {
      assert.equal(
        encodeMessage({ action: ACTION.MOVE, gameId: 'a1b2c3d4', san: 'Nf3', clockMs: 295000, turn: 'b' }),
        'unichess:a1b2c3d4:mv:Nf3:295000:b',
      );
    });

    it('encodes heartbeat', () => {
      assert.equal(
        encodeMessage({ action: ACTION.HEARTBEAT, gameId: 'a1b2c3d4', clockMs: 280000 }),
        'unichess:a1b2c3d4:hb:280000',
      );
    });

    it('encodes game over', () => {
      assert.equal(
        encodeMessage({ action: ACTION.GAMEOVER, gameId: 'a1b2c3d4', result: 'b', reason: 'checkmate' }),
        'unichess:a1b2c3d4:go:b:checkmate',
      );
    });

    it('roundtrips messages', () => {
      const cases = [
        'unichess:a1b2c3d4:ok',
        'unichess:a1b2c3d4:no',
        'unichess:a1b2c3d4:mv:e4:300000:b',
        'unichess:a1b2c3d4:rs',
        'unichess:a1b2c3d4:hb:250000',
        'unichess:a1b2c3d4:go:d:stalemate',
        'unichess:a1b2c3d4:ab',
      ];
      for (const raw of cases) {
        const parsed = parseMessage(raw);
        assert.ok(parsed, `Failed to parse: ${raw}`);
        assert.equal(encodeMessage(parsed), raw);
      }
    });
  });
});
