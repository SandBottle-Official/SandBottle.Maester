#!/usr/bin/env node
import { checkNodeVersion } from './node-version.mjs';

const runtime = checkNodeVersion(process.version);
const isHook = process.argv.includes('--hook');

if (runtime.ok) {
  const { main } = await import('../src/cli/main.ts');
  await main(process.argv.slice(2));
} else if (!isHook) {
  console.error(runtime.message);
  process.exitCode = 1;
}
