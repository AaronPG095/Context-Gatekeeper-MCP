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

  it('returns delta-only summary on repeat runCompact calls for the same command and cwd', async () => {
    const db = openDatabase(':memory:');
    dbs.push(db);
    const store = new ArtifactStore(db);

    const cmd = 'node -e "console.log(\'error TS100: failA\'); console.log(\'ok line\')"';
    const first = await runCompact(store, { command: cmd });
    expect(first.is_delta).toBeUndefined();
    expect(first.summary).toContain('error TS100: failA');

    const second = await runCompact(store, { command: cmd });
    expect(second.is_delta).toBe(true);
    expect(second.prev_artifact_id).toBe(first.artifact_id);
    expect(second.summary).toContain(`[delta vs ${first.artifact_id}] No change`);
  });

  it('enforces max_lines safety cap on wide line_range reads and preserves delta on clean short outputs', async () => {
    const db = openDatabase(':memory:');
    dbs.push(db);
    const store = new ArtifactStore(db);

    const bigCmd = 'node -e "for (let i = 1; i <= 200; i++) console.log(\'row-\' + i)"';
    const bigRes = await runCompact(store, { command: bigCmd });

    const capped = fetchChunk(store, {
      artifact_id: bigRes.artifact_id,
      line_range: '1-200',
    });
    expect(capped.returned_lines).toBe(120);
    expect(capped.truncated).toBe(true);
    expect(capped.content).toContain('capped at 120 lines, L121-L200 omitted');

    const uncapped = fetchChunk(store, {
      artifact_id: bigRes.artifact_id,
      line_range: '1-200',
      max_lines: 200,
    });
    expect(uncapped.returned_lines).toBe(200);
    expect(uncapped.truncated).toBeUndefined();

    const nanFallback = fetchChunk(store, {
      artifact_id: bigRes.artifact_id,
      line_range: '1-200',
      max_lines: Number.NaN,
    });
    expect(nanFallback.returned_lines).toBe(120);

    const shortCmd = 'node -e "console.log(\'[main 1a2b3c4] commit msg\'); console.log(\'1 file changed\')"';
    const s1 = await runCompact(store, { command: shortCmd });
    expect(s1.summary).toBe('[main 1a2b3c4] commit msg\n1 file changed');
    const s2 = await runCompact(store, { command: shortCmd });
    expect(s2.is_delta).toBe(true);
    expect(s2.summary).toContain(`[delta vs ${s1.artifact_id}] No change`);
  });
});
