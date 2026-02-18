import { Sphere } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import type { ModelMessage } from 'ai';
import type { SphereBotConfig } from './types.js';
import type { SphereBotAgent } from './agent.js';

export class SphereBot {
  private sphere: Sphere | null = null;
  private config: SphereBotConfig;
  private agent: SphereBotAgent;
  private conversations: Map<string, ModelMessage[]> = new Map();
  private pendingWelcomes: Set<string> = new Set();
  private prefix: string;

  constructor(config: SphereBotConfig, agent: SphereBotAgent) {
    this.config = config;
    this.agent = agent;
    this.prefix = `[Bot:${config.name}]`;
  }

  async start(): Promise<void> {
    console.log(`${this.prefix} Starting...`);

    const providers = createNodeProviders({
      network: this.config.network,
      dataDir: this.config.dataDir,
      tokensDir: this.config.tokensDir,
    });

    const { sphere, created, generatedMnemonic } = await Sphere.init({
      ...providers,
      autoGenerate: true,
      nametag: this.config.nametag,
    });

    this.sphere = sphere;

    if (created) {
      console.log(`${this.prefix} Created new wallet`);
      if (generatedMnemonic) {
        console.log(`${this.prefix} WARNING: Back up this mnemonic:`, generatedMnemonic);
      }
    } else {
      console.log(`${this.prefix} Loaded existing wallet`);
    }

    const identity = sphere.identity!;
    console.log(`${this.prefix} Nametag: @${identity.nametag}`);
    console.log(`${this.prefix} Direct address: ${identity.directAddress}`);
    console.log(`${this.prefix} Chain pubkey: ${identity.chainPubkey}`);

    // Listen for incoming DMs
    sphere.communications.onDirectMessage(async (message) => {
      // Ignore our own messages
      if (message.senderPubkey === identity.chainPubkey) return;

      console.log(`${this.prefix} DM from ${message.senderNametag || message.senderPubkey.slice(0, 12)}...: ${message.content.slice(0, 100)}`);

      try {
        // Send composing indicators periodically while generating
        // Frontend typing timeout is 1.5s, so send every 1s to keep dots visible
        const sendComposing = () =>
          sphere.communications.sendComposingIndicator(message.senderPubkey).catch(() => {});
        await sendComposing();
        const composingInterval = setInterval(sendComposing, 1000);

        // Get conversation history
        const history = this.getHistory(message.senderPubkey);

        // Generate response
        let response: string;
        try {
          response = await this.agent.respond(message.content, history);
        } finally {
          clearInterval(composingInterval);
        }
        console.log(`${this.prefix} Response (${response.length} chars): ${response.slice(0, 200)}`);

        // Update history
        this.addToHistory(message.senderPubkey, 'user', message.content);
        this.addToHistory(message.senderPubkey, 'assistant', response);

        // Send response
        const sent = await sphere.communications.sendDM(message.senderPubkey, response);
        console.log(`${this.prefix} Replied to ${message.senderNametag || message.senderPubkey.slice(0, 12)}..., msgId=${sent.id}`);
      } catch (error) {
        console.error(`${this.prefix} Error handling DM:`, error);
        try {
          await sphere.communications.sendDM(
            message.senderPubkey,
            "Sorry, I encountered an error. Please try again."
          );
        } catch (sendError) {
          console.error(`${this.prefix} Failed to send error reply:`, sendError);
        }
      }
    });

    console.log(`${this.prefix} Listening for DMs`);
  }

  async notifyNewUser(pubkey: string, nametag?: string): Promise<void> {
    if (!this.config.welcomeMessage) return;

    if (!this.sphere) {
      console.warn(`${this.prefix} Not ready, ignoring notify`);
      return;
    }

    // Deduplicate: skip if we already have a pending welcome for this pubkey
    if (this.pendingWelcomes.has(pubkey)) {
      console.log(`${this.prefix} Welcome already pending for ${pubkey.slice(0, 12)}...`);
      return;
    }

    this.pendingWelcomes.add(pubkey);
    const label = nametag ? `@${nametag}` : pubkey.slice(0, 12) + '...';
    console.log(`${this.prefix} Scheduling welcome DM to ${label} in ${this.config.welcomeDelayMs}ms`);

    const welcomeMessage = this.config.welcomeMessage;
    setTimeout(async () => {
      this.pendingWelcomes.delete(pubkey);
      try {
        await this.sphere!.communications.sendDM(pubkey, welcomeMessage);
        console.log(`${this.prefix} Sent welcome DM to ${label}`);
      } catch (error) {
        console.error(`${this.prefix} Failed to send welcome DM to ${label}:`, error);
      }
    }, this.config.welcomeDelayMs);
  }

  get identity() {
    return this.sphere?.identity ?? null;
  }

  async destroy(): Promise<void> {
    if (this.sphere) {
      await this.sphere.destroy();
      this.sphere = null;
      console.log(`${this.prefix} Destroyed`);
    }
  }

  private getHistory(pubkey: string): ModelMessage[] {
    return this.conversations.get(pubkey) || [];
  }

  private addToHistory(pubkey: string, role: 'user' | 'assistant', content: string): void {
    if (!this.conversations.has(pubkey)) {
      this.conversations.set(pubkey, []);
    }

    const history = this.conversations.get(pubkey)!;
    history.push({ role, content });

    // Trim to max history (each pair = 2 entries)
    const maxEntries = this.config.maxHistoryMessages * 2;
    if (history.length > maxEntries) {
      history.splice(0, history.length - maxEntries);
    }
  }
}
