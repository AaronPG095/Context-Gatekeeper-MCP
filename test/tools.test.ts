import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../src/store/artifacts.js';
import { openDatabase } from '../src/store/db.js';
import { fetchChunk } from '../src/tools/fetch-chunk.js';
import { runCompact } from '../src/tools/run-compact.js';

describe('runCompact + fetchChunk integration', () => {
  const dbs: Array<ReturnType<typeof openDatabase>> = [];

  afterEach(() => {
    while (dbs.length > 0) {
      dbs.pop()?.close();
    }
  });

  it('executes a real command and retrieves exact chunks via query and line_range', async () => {
    const db = openDatabase(':memory:');
    dbs.push(db);
    const store = new ArtifactStore(db);

    const cmd =
      'node -e "for (let i = 1; i <= 30; i++) console.log(i === 17 ? \'ERR_NEEDLE: boom at step 17\' : \'ok line \' + i)"';
    const compact = await runCompact(store, { command: cmd });

    expect(compact.exit_code).toBe(0);
    expect(compact.raw_lines).toBe(30);
    expect(compact.artifact_id).toMatch(/^art_[0-9a-f]{8}$/);

    const byQuery = fetchChunk(store, {
      artifact_id: compact.artifact_id,
      query: 'ERR_NEEDLE',
      context_lines: 1,
    });
    expect(byQuery.mode).toBe('fts_query');
    expect(byQuery.content).toContain('*L17: ERR_NEEDLE: boom at step 17');
    expect(byQuery.content).toContain(' L16: ok line 16');
    expect(byQuery.content).toContain(' L18: ok line 18');

    const byRange = fetchChunk(store, {
      artifact_id: compact.artifact_id,
      line_range: '1..3',
    });
    expect(byRange.mode).toBe('line_range');
    expect(byRange.returned_lines).toBe(3);
    expect(byRange.content).toContain('L1: ok line 1');
  });
});
