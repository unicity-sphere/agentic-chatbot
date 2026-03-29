import WebSocket from 'ws';
import { Sphere } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import {
  parseMessage,
  encodeMessage,
  ACTION,
  ESCROW_NAMETAG,
  ENTRY_FEE,
  type ChallengeMessage,
} from './protocol.js';
import { Game, type GameEndInfo } from './game.js';
import type { ChessBotConfig } from './config.js';

// Polyfill WebSocket for Node.js (required by sphere-sdk)
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as Record<string, unknown>).WebSocket = WebSocket;
}

export class ChessBot {
  private sphere: Sphere | null = null;
  private games = new Map<string, Game>();
  private tag: string;

  constructor(private config: ChessBotConfig) {
    this.tag = `[chess-bot:${config.nametag}]`;
  }

  async start(): Promise<void> {
    console.log(`${this.tag} Starting...`);

    const providers = createNodeProviders({
      network: this.config.network as 'mainnet' | 'testnet',
      dataDir: this.config.dataDir,
      tokensDir: this.config.tokensDir,
    });

    const { sphere, created, generatedMnemonic } = await Sphere.init({
      ...providers,
      l1: null,
      autoGenerate: true,
      nametag: this.config.nametag,
      groupChat: !!this.config.groupId,
    });

    this.sphere = sphere;

    if (created) {
      console.log(`${this.tag} Created new wallet`);
      if (generatedMnemonic) {
        console.log(`${this.tag} *** SAVE THIS MNEMONIC ***:`, generatedMnemonic);
      }
    } else {
      console.log(`${this.tag} Loaded existing wallet`);
    }

    const identity = sphere.identity;
    console.log(`${this.tag} Nametag: @${identity?.nametag}`);
    console.log(`${this.tag} Max concurrent games: ${this.config.maxConcurrentGames}`);

    this.logBalance();

    // Listen for incoming DMs
    sphere.communications.onDirectMessage(async (message: { content: string; senderPubkey: string; senderNametag?: string }) => {
      if (message.senderPubkey === identity?.chainPubkey) return;

      // Only respond to unichess: protocol messages, ignore everything else
      if (!message.content.trim().startsWith('unichess:')) return;

      const parsed = parseMessage(message.content);
      if (!parsed) return;

      try {
        if (parsed.action === ACTION.CHALLENGE) {
          await this.handleChallenge(
            parsed as ChallengeMessage,
            message.senderPubkey,
            message.senderNametag,
          );
        } else {
          const game = this.games.get(parsed.gameId);
          if (!game) {
            console.log(`${this.tag} No active game ${parsed.gameId}, ignoring ${parsed.action}`);
            return;
          }
          await game.handleMessage(parsed);
        }
      } catch (err) {
        console.error(`${this.tag} Error handling message:`, err);
      }
    });

    // Join group chat for posting game results
    if (this.config.groupId) {
      try {
        const groupChat = (sphere as any).groupChat;
        if (groupChat) {
          await groupChat.connect();
          try {
            await groupChat.joinGroup(this.config.groupId);
            console.log(`${this.tag} Joined group ${this.config.groupId}`);
          } catch {
            console.log(`${this.tag} Already in group or join not needed`);
          }
        }
      } catch (err) {
        console.error(`${this.tag} Group chat setup failed:`, err);
      }
    }

    console.log(`${this.tag} Ready — listening for challenges`);
  }

  private async handleChallenge(
    challenge: ChallengeMessage,
    senderPubkey: string,
    senderNametag?: string,
  ): Promise<void> {
    const label = senderNametag ? `@${senderNametag}` : senderPubkey.slice(0, 12) + '...';
    console.log(
      `${this.tag} Challenge from ${label}: game=${challenge.gameId} color=${challenge.color} time=${challenge.timeMinutes}min elo=${challenge.elo}`,
    );

    if (this.games.has(challenge.gameId)) {
      console.log(`${this.tag} Game ${challenge.gameId} already exists, ignoring`);
      return;
    }

    if (this.games.size >= this.config.maxConcurrentGames) {
      console.log(`${this.tag} Too many active games (${this.games.size}), declining`);
      await this.sendDM(
        senderPubkey,
        encodeMessage({ action: ACTION.DECLINE, gameId: challenge.gameId }),
      );
      return;
    }

    // Determine bot's color (challenger picks their own color)
    let myColor: 'w' | 'b';
    if (challenge.color === 'w') {
      myColor = 'b';
    } else if (challenge.color === 'b') {
      myColor = 'w';
    } else {
      myColor = Math.random() < 0.5 ? 'w' : 'b';
    }

    // Deposit entry fee to escrow
    const deposited = await this.deposit(challenge.gameId);
    if (!deposited) {
      console.error(`${this.tag} Deposit failed for game ${challenge.gameId}, declining`);
      await this.sendDM(
        senderPubkey,
        encodeMessage({ action: ACTION.DECLINE, gameId: challenge.gameId }),
      );
      return;
    }

    // Accept the challenge
    await this.sendDM(
      senderPubkey,
      encodeMessage({ action: ACTION.ACCEPT, gameId: challenge.gameId }),
    );
    console.log(
      `${this.tag} Accepted game ${challenge.gameId} as ${myColor === 'w' ? 'white' : 'black'} (elo ${challenge.elo})`,
    );

    // Create and start the game
    const game = new Game({
      gameId: challenge.gameId,
      myColor,
      timeControlMs: challenge.timeMinutes * 60 * 1000,
      elo: challenge.elo,
      sendMessage: (msg) => this.sendDM(senderPubkey, msg),
      onGameEnd: (info) => {
        this.games.delete(info.gameId);
        console.log(`${this.tag} Game ${info.gameId} ended (${this.games.size} active)`);
        this.postGameResult(info, label, challenge.elo, myColor).catch((err) =>
          console.error(`${this.tag} Failed to post game result:`, err),
        );
      },
    });

    this.games.set(challenge.gameId, game);

    try {
      await game.start();
    } catch (err) {
      console.error(`${this.tag} Failed to start game ${challenge.gameId}:`, err);
      game.cleanup();
    }
  }

  private async ensureBalance(): Promise<void> {
    if (!this.sphere) return;

    try {
      const tokens = this.sphere.payments.getTokens();
      const uctCount = tokens.filter(
        (t: { coinId?: string; symbol?: string }) =>
          t.symbol === 'UCT' || t.coinId === this.config.uctCoinId,
      ).length;

      // If we have fewer than 2 UCT tokens, top up from faucet
      if (uctCount < 2) {
        console.log(`${this.tag} Low UCT balance (${uctCount} tokens), requesting from faucet...`);
        await this.requestFaucet();
      }
    } catch {}
  }

  private async requestFaucet(): Promise<void> {
    const nametag = this.sphere?.identity?.nametag;
    if (!nametag) return;

    try {
      const res = await fetch(this.config.faucetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unicityId: `@${nametag}`,
          coin: 'unicity',
          amount: this.config.faucetTopUpAmount,
        }),
      });

      if (res.ok) {
        console.log(`${this.tag} Faucet top-up: requested ${this.config.faucetTopUpAmount} UCT`);
        // Wait a moment for tokens to arrive
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        const body = await res.text().catch(() => '');
        console.error(`${this.tag} Faucet request failed (${res.status}): ${body}`);
      }
    } catch (err) {
      console.error(`${this.tag} Faucet error:`, err);
    }
  }

  private async deposit(gameId: string): Promise<boolean> {
    if (!this.sphere) return false;

    // Top up from faucet if balance is low
    await this.ensureBalance();

    // Resolve UCT coin info from bot's tokens
    let coinId = this.config.uctCoinId;
    let decimals = this.config.uctDecimals;

    try {
      const tokens = this.sphere.payments.getTokens();
      const uct = tokens.find(
        (t: { coinId?: string; symbol?: string; decimals?: number }) =>
          t.symbol === 'UCT' || t.coinId === this.config.uctCoinId,
      );
      if (uct) {
        coinId = uct.coinId ?? coinId;
        decimals = uct.decimals ?? decimals;
      }
    } catch {}

    // Use BigInt to avoid floating-point overflow at 18 decimals
    const amount = (BigInt(ENTRY_FEE) * 10n ** BigInt(decimals)).toString();

    try {
      const result = await this.sphere.payments.send({
        coinId,
        amount,
        recipient: ESCROW_NAMETAG,
        memo: `unichess:${gameId}`,
      });
      console.log(`${this.tag} Deposit ${ENTRY_FEE} UCT for game ${gameId}: ${result.status}`);
      return result.status !== 'failed';
    } catch (err) {
      console.error(`${this.tag} Deposit error:`, err);
      return false;
    }
  }

  private async postGameResult(info: GameEndInfo, opponentLabel: string, elo: number, botColor: 'w' | 'b'): Promise<void> {
    if (!this.config.groupId || !this.sphere || !info.result) return;

    const botName = `@${this.sphere.identity?.nametag ?? this.config.nametag}`;
    const botSide = botColor === 'w' ? '♔' : '♚';
    const oppSide = botColor === 'w' ? '♚' : '♔';
    const white = botColor === 'w' ? `${botName} (ELO ${elo})` : opponentLabel;
    const black = botColor === 'b' ? `${botName} (ELO ${elo})` : opponentLabel;

    const outcome =
      info.result === 'd'
        ? `Draw by ${info.reason}`
        : info.result === botColor
          ? `${botName} wins by ${info.reason}`
          : `${opponentLabel} wins by ${info.reason}`;

    const lines = [
      `♟ ${botSide} ${white} vs ${oppSide} ${black}`,
      outcome,
      '',
      info.pgn || '(no moves)',
    ];

    try {
      const groupChat = (this.sphere as any).groupChat;
      if (groupChat) {
        await groupChat.sendMessage(this.config.groupId, lines.join('\n'));
        console.log(`${this.tag} Posted game result to group`);
      }
    } catch (err) {
      console.error(`${this.tag} Group message error:`, err);
    }
  }

  private async sendDM(pubkey: string, message: string): Promise<void> {
    if (!this.sphere) throw new Error('Bot not started');
    await this.sphere.communications.sendDM(pubkey, message);
  }

  private logBalance(): void {
    if (!this.sphere) return;
    try {
      const tokens = this.sphere.payments.getTokens();
      const byCoin = new Map<string, number>();
      for (const t of tokens as Array<{ symbol?: string; coinId?: string }>) {
        const key = t.symbol || t.coinId || 'unknown';
        byCoin.set(key, (byCoin.get(key) || 0) + 1);
      }
      const summary = Array.from(byCoin.entries())
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      console.log(`${this.tag} Tokens: ${tokens.length} (${summary || 'none'})`);
    } catch {
      console.log(`${this.tag} Could not read token balance`);
    }
  }

  async destroy(): Promise<void> {
    console.log(`${this.tag} Shutting down (${this.games.size} active games)...`);
    for (const game of this.games.values()) {
      game.cleanup();
    }
    this.games.clear();
    if (this.sphere) {
      await this.sphere.destroy();
      this.sphere = null;
    }
    console.log(`${this.tag} Destroyed`);
  }
}
