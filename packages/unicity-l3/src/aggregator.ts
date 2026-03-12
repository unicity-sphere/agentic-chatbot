/** Strip the leading 1-bit prefix to get the human-readable shard ID.
 *  e.g. 2 (0b10) → "0", 3 (0b11) → "1" */
export function displayShardId(rawId: string): string {
  const n = parseInt(rawId);
  const bits = n.toString(2); // e.g. "10" or "11"
  return bits.slice(1) || '0';  // drop the leading "1" prefix
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

  async fetchShardIds(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/config/shards`);
    if (!res.ok) throw new Error(`Failed to fetch shards: ${res.status}`);
    const data = (await res.json()) as { shardIds: number[] };
    return data.shardIds.map((id) => String(id));
  }

  async getBlockHeight(shardId: string): Promise<number> {
    const result = await this.rpc('get_block_height', { shardId }) as { blockNumber: string };
    return parseInt(result.blockNumber);
  }

  async getBlock(blockNumber: number, shardId: string): Promise<BlockData> {
    const result = await this.rpc('get_block', {
      blockNumber: blockNumber.toString(),
      shardId,
    }) as { block?: { index: number; shardId: string }; totalCommitments?: string };
    return {
      index: result.block?.index ?? blockNumber,
      shardId: result.block?.shardId ?? shardId,
      totalCommitments: result.totalCommitments ? parseInt(result.totalCommitments) : 0,
    };
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
