import { Sphere } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import type { CoreMessage } from 'ai';
import type { KBBotConfig } from './config.js';
import type { KBBotAgent } from './agent.js';

const WELCOME_MESSAGE = `Hey! I'm KBBot, the Unicity knowledge base assistant. Ask me anything about Unicity, AgentSphere, Sphere wallet, or agentic commerce.`;

export class KBBot {
  private sphere: Sphere | null = null;
  private config: KBBotConfig;
  private agent: KBBotAgent;
  private conversations: Map<string, CoreMessage[]> = new Map();
  private pendingWelcomes: Set<string> = new Set();

  constructor(config: KBBotConfig, agent: KBBotAgent) {
    this.config = config;
    this.agent = agent;
  }

  async start(): Promise<void> {
    console.log('[Bot] Starting KBBot...');

    const providers = createNodeProviders({
      network: this.config.network,
      dataDir: this.config.dataDir,
      tokensDir: this.config.tokensDir,
    });

    const { sphere, created, generatedMnemonic } = await Sphere.init({
      ...providers,
      autoGenerate: true,
      nametag: this.config.botNametag,
    });

    this.sphere = sphere;

    if (created) {
      console.log('[Bot] Created new wallet');
      if (generatedMnemonic) {
        console.log('[Bot] WARNING: Back up this mnemonic:', generatedMnemonic);
      }
    } else {
      console.log('[Bot] Loaded existing wallet');
    }

    const identity = sphere.identity!;
    console.log(`[Bot] Nametag: @${identity.nametag}`);
    console.log(`[Bot] Direct address: ${identity.directAddress}`);
    console.log(`[Bot] Chain pubkey: ${identity.chainPubkey}`);

    // Listen for incoming DMs
    sphere.communications.onDirectMessage(async (message) => {
      // Ignore our own messages
      if (message.senderPubkey === identity.chainPubkey) return;

      console.log(`[Bot] DM from ${message.senderNametag || message.senderPubkey.slice(0, 12)}...: ${message.content.slice(0, 100)}`);

      try {
        // Send composing indicator
        await sphere.communications.sendComposingIndicator(message.senderPubkey).catch(() => {});

        // Get conversation history
        const history = this.getHistory(message.senderPubkey);

        // Generate response
        const response = await this.agent.respond(message.content, history);
        console.log(`[Bot] Response (${response.length} chars): ${response.slice(0, 200)}`);

        // Update history
        this.addToHistory(message.senderPubkey, 'user', message.content);
        this.addToHistory(message.senderPubkey, 'assistant', response);

        // Send response
        const sent = await sphere.communications.sendDM(message.senderPubkey, response);
        console.log(`[Bot] Replied to ${message.senderNametag || message.senderPubkey.slice(0, 12)}..., msgId=${sent.id}`);
      } catch (error) {
        console.error('[Bot] Error handling DM:', error);
        try {
          await sphere.communications.sendDM(
            message.senderPubkey,
            "Sorry, I encountered an error. Please try again."
          );
        } catch (sendError) {
          console.error('[Bot] Failed to send error reply:', sendError);
        }
      }
    });

    console.log('[Bot] Listening for DMs');
  }

  async notifyNewUser(pubkey: string, nametag?: string): Promise<void> {
    if (!this.sphere) {
      console.warn('[Bot] Not ready, ignoring notify');
      return;
    }

    // Deduplicate: skip if we already have a pending welcome for this pubkey
    if (this.pendingWelcomes.has(pubkey)) {
      console.log(`[Bot] Welcome already pending for ${pubkey.slice(0, 12)}...`);
      return;
    }

    this.pendingWelcomes.add(pubkey);
    const label = nametag ? `@${nametag}` : pubkey.slice(0, 12) + '...';
    console.log(`[Bot] Scheduling welcome DM to ${label} in ${this.config.welcomeDelayMs}ms`);

    setTimeout(async () => {
      this.pendingWelcomes.delete(pubkey);
      try {
        await this.sphere!.communications.sendDM(pubkey, WELCOME_MESSAGE);
        console.log(`[Bot] Sent welcome DM to ${label}`);
      } catch (error) {
        console.error(`[Bot] Failed to send welcome DM to ${label}:`, error);
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
      console.log('[Bot] Destroyed');
    }
  }

  private getHistory(pubkey: string): CoreMessage[] {
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
