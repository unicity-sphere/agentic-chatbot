import { Sphere } from '@unicitylabs/sphere-sdk';
import { createNodeProviders } from '@unicitylabs/sphere-sdk/impl/nodejs';
import { AggregatorClient } from './aggregator.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const log = (msg: string) => console.log(`[unicity-l3] ${msg}`);

async function main() {
  log('Starting...');

  // Init Sphere with group chat support
  const providers = createNodeProviders({
    dataDir: config.dataDir,
    tokensDir: config.tokensDir,
    network: config.network,
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    autoGenerate: true,
    nametag: config.nametag,
    groupChat: true,
  });

  if (created) {
    log(`New wallet created. Nametag: ${config.nametag}`);
    if (generatedMnemonic) {
      log(`Mnemonic (save this!): ${generatedMnemonic}`);
    }
  } else {
    log(`Wallet loaded. Nametag: ${config.nametag}`);
  }

  // Connect group chat
  const groupChat = sphere.groupChat;
  if (!groupChat) {
    throw new Error('GroupChat module not initialized');
  }
  await groupChat.connect();
  log(`Group chat connected. Target group: ${config.groupId}`);

  // Join group if not already a member
  try {
    await groupChat.joinGroup(config.groupId);
    log('Joined group');
  } catch {
    log('Already in group or join not needed');
  }

  // Init aggregator client and discover shards
  const aggregator = new AggregatorClient(config.aggregatorUrl);
  const shards = await aggregator.fetchShards();
  log(`Discovered ${shards.length} shard(s): ${shards.map((s) => s.id).join(', ')}`);

  // Track last seen block per shard
  const lastBlock = new Map<string, number>();

  // Initialize with current block heights
  for (const shard of shards) {
    try {
      const height = await aggregator.getBlockHeight(shard.id);
      lastBlock.set(shard.id, height);
      log(`Shard ${shard.id}: current block height ${height}`);
    } catch (err) {
      log(`Failed to get initial height for shard ${shard.id}: ${err}`);
      lastBlock.set(shard.id, 0);
    }
  }

  log(`Polling every ${config.pollIntervalMs}ms...`);

  // Poll loop
  const poll = async () => {
    for (const shard of shards) {
      try {
        const height = await aggregator.getBlockHeight(shard.id);
        const prev = lastBlock.get(shard.id) || 0;

        if (height <= prev) continue;

        // Process new blocks (cap at 10 per poll to avoid flooding)
        const start = Math.max(prev + 1, height - 9);
        for (let blockNr = start; blockNr <= height; blockNr++) {
          try {
            const block = await aggregator.getBlock(blockNr, shard.id);
            const explorerUrl = `${config.explorerBaseUrl}?shard=${shard.id}&block=${blockNr}`;
            const message = `Block #${blockNr} | Shard ${shard.id} | ${block.totalCommitments} tx | ${explorerUrl}`;

            log(`Posting: ${message}`);
            await groupChat.sendMessage(config.groupId, message);
          } catch (err) {
            log(`Failed to process block ${blockNr} shard ${shard.id}: ${err}`);
          }
        }

        lastBlock.set(shard.id, height);
      } catch (err) {
        log(`Poll error shard ${shard.id}: ${err}`);
      }
    }
  };

  setInterval(poll, config.pollIntervalMs);

  // Graceful shutdown
  const shutdown = () => {
    log('Shutting down...');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[unicity-l3] Fatal:', error);
  process.exit(1);
});
