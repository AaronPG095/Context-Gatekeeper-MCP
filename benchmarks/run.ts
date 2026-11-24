import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { compressOutput } from '../src/compress/registry.js';
import { getAllBenchmarkFixtures } from './fixtures.js';

const MIN_REDUCTION_PCT = 60;

interface BenchRow {
  name: string;
  rawTokens: number;
  compressedTokens: number;
  reductionPct: number;
  diagnosticsOk: boolean;
}

function main(): void {
  const fixtures = getAllBenchmarkFixtures();
  const results: BenchRow[] = [];
  let allPassed = true;

  for (const fixture of fixtures) {
    const rawText = fixture.lines.map((l) => l.text).join('\n');
    const compressed = compressOutput(fixture.command, fixture.lines, fixture.exitCode);

    const rawTokens = encode(rawText).length;
    const compressedTokens = encode(compressed.summary).length;
    const reductionPct = ((rawTokens - compressedTokens) / rawTokens) * 100;

    const missing = fixture.requiredSubstrings.filter(
      (sub) => !compressed.summary.includes(sub),
    );
    const diagnosticsOk = missing.length === 0;

    if (reductionPct < MIN_REDUCTION_PCT || !diagnosticsOk) {
      allPassed = false;
      if (!diagnosticsOk) {
        console.error(
          `[FAIL] ${fixture.name}: missing diagnostics: ${missing.join(', ')}`,
        );
      }
      if (reductionPct < MIN_REDUCTION_PCT) {
        console.error(
          `[FAIL] ${fixture.name}: reduction ${reductionPct.toFixed(1)}% < ${MIN_REDUCTION_PCT}%`,
        );
      }
    }

    results.push({
      name: fixture.name,
      rawTokens,
      compressedTokens,
      reductionPct,
      diagnosticsOk,
    });
  }

  console.log('\n### Context-Gatekeeper-MCP Token Benchmark (gpt-tokenizer o200k_base)\n');
  console.log('| Scenario | Raw Tokens | Compressed Tokens | Reduction | Diagnostics |');
  console.log('| :--- | ---: | ---: | ---: | :---: |');
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.rawTokens} | ${r.compressedTokens} | ${r.reductionPct.toFixed(1)}% | ${r.diagnosticsOk ? 'PASS' : 'FAIL'} |`,
    );
  }

  const totalRaw = results.reduce((s, r) => s + r.rawTokens, 0);
  const totalComp = results.reduce((s, r) => s + r.compressedTokens, 0);
  const totalPct = ((totalRaw - totalComp) / totalRaw) * 100;
  console.log(
    `| **Total** | **${totalRaw}** | **${totalComp}** | **${totalPct.toFixed(1)}%** | ${allPassed ? '**PASS**' : '**FAIL**'} |\n`,
  );

  if (!allPassed) {
    process.exit(1);
  }
}

main();
