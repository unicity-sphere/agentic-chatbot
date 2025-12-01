import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DDGSResult {
  title: string;
  url: string;
  description: string;
  provider: string;
}

export interface DDGSResponse {
  success: boolean;
  query: string;
  count?: number;
  backend?: string;
  region?: string;
  results?: DDGSResult[];
  error?: string;
}

/**
 * Search using DDGS Python library (metasearch across multiple engines)
 *
 * @param query Search query
 * @param maxResults Maximum number of results (default: 10)
 * @param region Region code (default: wt-wt for worldwide)
 * @param backend Search backend: auto, duckduckgo, bing, brave, google, etc. (default: auto for parallel search)
 */
export async function ddgsSearch(
  query: string,
  maxResults: number = 10,
  region: string = 'wt-wt',
  backend: string = 'auto'
): Promise<DDGSResponse> {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, '../scripts/ddgs_search.py');

    // Spawn Python process
    const python = spawn('python3', [
      scriptPath,
      query,
      maxResults.toString(),
      region,
      backend,
    ]);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        // Unexpected error code
        reject(new Error(`DDGS process exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const response: DDGSResponse = JSON.parse(stdout);
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || 'DDGS search failed'));
        }
      } catch (error) {
        reject(new Error(`Failed to parse DDGS output: ${stdout}\nStderr: ${stderr}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to spawn Python process: ${error.message}`));
    });

    // Set timeout (30 seconds)
    const timeout = setTimeout(() => {
      python.kill();
      reject(new Error('DDGS search timed out after 30 seconds'));
    }, 30000);

    python.on('close', () => {
      clearTimeout(timeout);
    });
  });
}
