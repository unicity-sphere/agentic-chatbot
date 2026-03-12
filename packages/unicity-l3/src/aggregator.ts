export interface ShardConfig {
  id: string;
  alphabillUrl: string;
}

export interface BlockData {
  index: number;
  shardId: string;
  totalCommitments: number;
}

export class AggregatorClient {
  private readonly baseUrl: string;
  private requestId = 0;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async fetchShards(): Promise<ShardConfig[]> {
    const res = await fetch(`${this.baseUrl}/config/shards`);
    if (!res.ok) throw new Error(`Failed to fetch shards: ${res.status}`);
    return res.json() as Promise<ShardConfig[]>;
  }

  async getBlockHeight(shardId: string): Promise<number> {
    const result = await this.rpc('get_block_height', { shard_id: shardId });
    return result as number;
  }

  async getBlock(blockNumber: number, shardId: string): Promise<BlockData> {
    const result = await this.rpc('get_block', {
      block_number: blockNumber,
      shard_id: shardId,
    });
    return result as BlockData;
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.requestId,
        method,
        params,
      }),
    });
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
    return json.result;
  }
}
