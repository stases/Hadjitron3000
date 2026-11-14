import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

// The script is plain JavaScript without types; the specifier is cast so TypeScript does not look for them.
const { tellingLines, escape, failedTest, failedList } = await import('../../scripts/ci-step.mjs' as string) as {
  tellingLines(lines: string[], count?: number): string[];
  escape(text: string): string;
  failedTest(line: string): string | null;
  failedList(names: string[]): string;
};

const script = fileURLToPath(new URL('../../scripts/ci-step.mjs', import.meta.url));
const cacheDirectory = fileURLToPath(new URL('../../.cache/', import.meta.url));
let dir: string;

beforeEach(async () => {
  await mkdir(cacheDirectory, { recursive: true });
  dir = await mkdtemp(path.join(cacheDirectory, 'ci-step-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const VITEST = `
 ✓ |unit| tests/unit/fileformat.test.ts (40 tests) 30ms
 ✓ |unit| tests/unit/update.test.ts > check reports git failures 12ms
\u001b[31m ❯ |unit| tests/unit/electron.test.ts (12 tests | 1 failed) 654ms\u001b[39m
   × Electron updates from GitHub releases 16ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| tests/unit/electron.test.ts > Electron updates from GitHub releases
AssertionError: expected 'source' to be 'release' // Object.is equality
 ❯ tests/unit/electron.test.ts:274:26
    272|   const { bridge } = installed;
 Test Files  1 failed | 31 passed (32)
      Tests  1 failed | 830 passed (831)`.split('\n');

test('the telling lines of a failed test run name the test and the assertion, and end with the totals', () => {
  const lines = tellingLines(VITEST);
  expect(lines[0]).toBe('× Electron updates from GitHub releases 16ms | ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯ | '
    + 'FAIL  |unit| tests/unit/electron.test.ts > Electron updates from GitHub releases');
  expect(lines[1]).toMatch(/^AssertionError: expected 'source' to be 'release'/);
  expect(lines.at(-1)).toBe('Test Files  1 failed | 31 passed (32) | Tests  1 failed | 830 passed (831)');
  expect(lines.join('\n')).not.toMatch(/\u001b|fileformat|reports git failures/);
});

test('telling lines are few and short, and plain output still gives its last lines', () => {
  const noisy = Array.from({ length: 500 }, (_, i) => `src/x${i}.ts(1,1): error TS2322: ${'y'.repeat(400)}`);
  const lines = tellingLines(noisy);
  expect(lines.length).toBeLessThanOrEqual(8);
  expect(lines.every((line) => line.length <= 300)).toBe(true);
  expect(lines[0]).toMatch(/^src\/x350\.ts/);
  expect(tellingLines(['Building…', 'Something odd happened', ''])).toEqual(['Building… | Something odd happened']);
});

test('failed tests are found in vitest and Playwright output and listed in one message', () => {
  expect(failedTest(' FAIL  |browser (chromium)| tests/browser/voice.test.ts > an old sound renders'))
    .toBe('tests/browser/voice.test.ts > an old sound renders');
  expect(failedTest('  1) [electron] › tests/e2e/electron.spec.ts:96:1 › the shell serves the app ──────────'))
    .toBe('[electron] › tests/e2e/electron.spec.ts:96:1 › the shell serves the app');
  expect(failedTest('\u001b[31m FAIL \u001b[39m tests/unit/a.test.ts > b')).toBe('tests/unit/a.test.ts > b');
  expect(failedTest(' ✓ |unit| tests/unit/fileformat.test.ts (40 tests) 30ms')).toBeNull();
  expect(failedTest('   × the transport schedules every step on time 1016ms')).toBeNull();
  expect(failedList(['a > one', 'b > two'])).toBe('2 failed: a > one\nb > two');
  const many = failedList(Array.from({ length: 100 }, (_, i) => `tests/browser/file${i}.test.ts > a test with a name`));
  expect(many.length).toBeLessThan(1600);
  expect(many).toMatch(/^100 failed: tests\/browser\/file0\.test\.ts/);
  expect(many).toMatch(/…and \d+ more$/);
});

test('a failure printed again by a retry is shown once', () => {
  const failure = VITEST.slice(4, 9);
  const twice = [...failure, ...failure.map((line) => line.replace('16ms', '21ms (retry x1)'))];
  const lines = tellingLines(twice);
  expect(lines.filter((line) => line.includes('AssertionError'))).toHaveLength(1);
});

test('messages are escaped as workflow commands read them', () => {
  expect(escape('50% done\r\nnext')).toBe('50%25 done%0D%0Anext');
});

test('a failed step prints error annotations and writes its tail to the job summary', async () => {
  const failing = path.join(dir, 'failing.cjs');
  await writeFile(failing, "console.log('Running 3 tests');\nconsole.error('Error: the window did not open');\n"
    + 'process.exit(3);\n');
  const summary = path.join(dir, 'summary.md');
  const result = spawnSync(process.execPath, [script, 'Installed app, smoke test', `node "${failing}"`], {
    encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
  });
  expect(result.status).toBe(3);
  expect(result.stdout).toContain('Running 3 tests');
  expect(result.stdout).toContain('::error title=Installed app%2C smoke test::Error: the window did not open');
  expect(result.stdout).not.toContain('failed: ');
  const written = await readFile(summary, 'utf8');
  expect(written).toContain('### Installed app, smoke test failed (exit code 3)');
  expect(written).toContain('Running 3 tests\nError: the window did not open');

  await writeFile(failing, "console.log('fine');\n");
  const passed = spawnSync(process.execPath, [script, 'Fine', `node "${failing}"`], {
    encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: path.join(dir, 'other.md') },
  });
  expect(passed.status).toBe(0);
  expect(passed.stdout).not.toContain('::error');
});
