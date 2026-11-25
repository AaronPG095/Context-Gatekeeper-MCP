// Must be imported first in cli.ts so Node 22's node:sqlite ExperimentalWarning
// is suppressed before static ESM module evaluation of db.ts.
const isSqliteExperimental = (w: string | Error): boolean => {
  const msg = typeof w === 'string' ? w : w.message;
  return msg.includes('SQLite is an experimental feature');
};

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  if (isSqliteExperimental(warning)) return;
  return originalEmitWarning(warning, ...(args as [string?]));
}) as typeof process.emitWarning;

process.on('warning', (warning) => {
  if (isSqliteExperimental(warning)) return;
  console.warn(warning);
});
