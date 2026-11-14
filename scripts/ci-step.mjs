// Run one step of the GitHub workflow and, when it fails, make the failure readable from outside: the names of all
// failed tests become one error annotation, its most telling lines become more (the public API lists them with the
// check run, at most ten a step), and its last lines go into the job summary.
// Usage: node scripts/ci-step.mjs "<step name>" "<command>". The command runs in the system's shell.

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEEP = 400;
// Test runners, tsc and npm say what failed at the end of their output, so only the end is searched.
const SEARCHED = 150;
// GitHub keeps ten error annotations a step: the failed tests, then up to eight details, the last of them the end.
const ANNOTATIONS = 8;
const ANNOTATION_LENGTH = 300;
const LIST_LENGTH = 1500;
const SUMMARY_LINES = 60;

// Lines that say what went wrong: a failed test, an error, an assertion's two sides, a missing file, a timeout.
const TELLING = new RegExp([
  '^\\s*(FAIL|×|✗|✘|\\d+\\) )', 'Error:', 'error TS\\d+', 'npm (ERR!|error)', '\\b(Expected|Received)\\b',
  '\\bexpected\\b.*\\bto\\b', 'Timeout|timed out', '\\b(ENOENT|EPERM|EACCES|EBUSY)\\b', '[Cc]annot find|not found',
  'exit(ed with)? code [1-9]',
].join('|'));
const PASSED = /^\s*(✓|√|ok\b)/;

export const plain = (line) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').trimEnd();

// A failed test named on a line of its own: vitest's `FAIL  |project| file > test`, Playwright's `1) [project] › …`.
const FAILED_TEST = [/^\s*FAIL\s+(?:\|[^|]+\|\s*)?(.+)$/, /^\s*\d+\) (\[[^\]]+\] › .+?)\s*─*$/];

/** The test a line of output names as failed, or null. */
export function failedTest(line) {
  for (const pattern of FAILED_TEST) {
    const match = pattern.exec(plain(line));
    if (match) return match[1].trim();
  }
  return null;
}

/** The same message from a retry: without durations and retry counts. */
const sameness = (text) => text.replace(/\s*\(?\d+(\.\d+)?m?s\)?/g, '').replace(/\s*\(retry[^)]*\)/gi, '');

/** One annotation listing the failed tests, as many as fit. */
export function failedList(names) {
  let text = `${names.length} failed: `;
  for (const [i, name] of names.entries()) {
    const next = `${i ? '\n' : ''}${name}`;
    if (text.length + next.length > LIST_LENGTH) return `${text}\n…and ${names.length - i} more`;
    text += next;
  }
  return text;
}

/** The lines worth reading in the tail of a failed step's output: telling lines with a little context, then the end. */
export function tellingLines(lines, count = ANNOTATIONS) {
  const text = lines.map(plain).filter((line) => line.trim()).slice(-SEARCHED);
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < text.length && picked.length < count - 1; i++) {
    if (PASSED.test(text[i]) || !TELLING.test(text[i]) || picked.some((group) => group.end >= i)) continue;
    // A retry prints the same failure again; a line already shown does not start another message.
    if (seen.has(sameness(text[i].trim()))) continue;
    const end = Math.min(text.length - 1, i + 2);
    const group = text.slice(i, end + 1).map((line) => line.trim());
    for (const line of group) seen.add(sameness(line));
    picked.push({ start: i, end, text: group.join(' | ') });
  }
  const tail = text.slice(-2).map((line) => line.trim());
  const messages = picked.map((group) => group.text);
  if (tail.some((line) => !seen.has(sameness(line)))) messages.push(tail.join(' | '));
  return messages.map((message) => (message.length > ANNOTATION_LENGTH
    ? `${message.slice(0, ANNOTATION_LENGTH - 1)}…`
    : message));
}

/** A workflow command's message, and one of its properties, escaped as GitHub reads them. */
export const escape = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (text) => escape(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

function report(name, lines, code, failed) {
  const messages = tellingLines(lines);
  if (failed.length) messages.unshift(failedList(failed));
  for (const message of messages) {
    console.log(`::error title=${escapeProperty(name)}::${escape(message)}`);
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  const tail = lines.slice(-SUMMARY_LINES).map(plain).join('\n').replace(/```/g, "'''");
  appendFileSync(summary,
    `### ${name} failed (exit code ${code})\n\nThe last lines of its output:\n\n\`\`\`\n${tail}\n\`\`\`\n\n`);
}

async function run(name, command) {
  const lines = [];
  const failed = new Set();
  const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const ends = [[child.stdout, process.stdout], [child.stderr, process.stderr]].map(([from, to]) => {
    let partial = '';
    from.setEncoding('utf8');
    from.on('data', (text) => {
      to.write(text);
      const parts = (partial + text).split('\n');
      partial = parts.pop();
      lines.push(...parts);
      for (const line of parts) {
        const test = failedTest(line);
        if (test) failed.add(test);
      }
      if (lines.length > KEEP) lines.splice(0, lines.length - KEEP);
    });
    return () => partial && lines.push(partial);
  });
  const code = await new Promise((resolve) => {
    child.once('error', (error) => { lines.push(String(error)); resolve(1); });
    child.once('close', (exit) => resolve(exit ?? 1));
  });
  for (const end of ends) end();
  if (code !== 0) report(name, lines, code, [...failed]);
  return code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, command] = process.argv.slice(2);
  if (!name || !command) {
    console.error('Usage: node scripts/ci-step.mjs "<step name>" "<command>"');
    process.exit(2);
  }
  process.exitCode = await run(name, command);
}
