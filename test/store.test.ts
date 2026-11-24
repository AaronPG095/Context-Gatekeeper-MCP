import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../src/store/artifacts.js';
import { openDatabase } from '../src/store/db.js';

describe('ArtifactStore (node:sqlite FTS5)', () => {
  const dbs: Array<ReturnType<typeof openDatabase>> = [];

  afterEach(() => {
    while (dbs.length > 0) {
      dbs.pop()?.close();
    }
  });

  function createStore() {
    const db = openDatabase(':memory:');
    dbs.push(db);
    return new ArtifactStore(db);
  }

  it('saves raw lines and retrieves exact line ranges', () => {
    const store = createStore();
    const record = store.saveArtifact({
      command: 'dotnet build',
      cwd: 'C:\\repo',
      exitCode: 1,
      durationMs: 120,
      summaryText: 'Build FAILED',
      lines: [
        { stream: 'stdout', text: 'line 1 restore' },
        { stream: 'stdout', text: 'line 2 compile' },
        { stream: 'stderr', text: 'error CS1002: ; expected' },
        { stream: 'stdout', text: 'line 4 done' },
      ],
    });

    expect(record.id).toMatch(/^art_[0-9a-f]{8}$/);
    const chunk = store.fetchByLineRange(record.id, 2, 3);
    expect(chunk.map((c) => c.line_no)).toEqual([2, 3]);
    expect(chunk[1].text).toContain('CS1002');
  });

  it('searches via FTS5 and merges overlapping context ranges', () => {
    const store = createStore();
    const record = store.saveArtifact({
      command: 'vitest run',
      cwd: 'C:\\repo',
      exitCode: 1,
      durationMs: 250,
      summaryText: '2 failed',
      lines: [
        { stream: 'stdout', text: 'line 1 ok' },
        { stream: 'stdout', text: 'line 2 error TS2345: Argument type mismatch' },
        { stream: 'stdout', text: 'line 3 at foo.ts:10' },
        { stream: 'stdout', text: 'line 4 error TS2345: Another mismatch' },
        { stream: 'stdout', text: 'line 5 ok' },
      ],
    });

    const hits = store.searchLines(record.id, 'TS2345', { contextLines: 1 });
    expect(hits.map((h) => h.line_no)).toEqual([1, 2, 3, 4, 5]);
    expect(hits.filter((h) => h.isMatch).map((h) => h.line_no)).toEqual([2, 4]);

    // Multi-word non-contiguous query only succeeds via FTS5 (not LIKE substring fallback).
    const multiWordHits = store.searchLines(record.id, 'TS2345 mismatch', { contextLines: 0 });
    expect(multiWordHits.map((h) => h.line_no)).toEqual([2, 4]);
  });

  it('evicts oldest artifacts beyond maxArtifacts', () => {
    const store = createStore();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const rec = store.saveArtifact({
        command: `echo ${i}`,
        cwd: 'C:\\repo',
        exitCode: 0,
        durationMs: 5,
        summaryText: `${i}`,
        lines: [{ stream: 'stdout', text: `output ${i}` }],
        maxArtifacts: 2,
      });
      ids.push(rec.id);
    }

    expect(store.getArtifact(ids[0])).toBeUndefined();
    expect(store.getArtifact(ids[1])).toBeUndefined();
    expect(store.getArtifact(ids[2])).toBeDefined();
    expect(store.getArtifact(ids[3])).toBeDefined();
  });
});
