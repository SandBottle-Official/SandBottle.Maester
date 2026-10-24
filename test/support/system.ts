import { fileURLToPath } from 'node:url';

export { SCHEMA } from '../../src/core/schema.ts';
export { openStore } from '../../src/core/store.ts';
export { buildView } from '../../src/view/build-view.ts';
export { TEST_PATH } from '../../src/view/git.ts';
export { progressLine } from '../../src/view/progress.ts';
export { openEventsReminder, showText } from '../../src/view/show.ts';

export const CLI = fileURLToPath(new URL('../../bin/maester.mjs', import.meta.url));
export const DATA_DIR = '.maester';
export const DB_FILE = 'maester.db';
export const COMMAND = 'maester';
export const AI_GREEN_BY = 'ai';
export const PROTOCOL = 4;
export const KEY_HEADER = 'x-maester-key';
