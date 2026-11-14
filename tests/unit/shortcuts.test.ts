import { expect, test } from 'vitest';
import { isMacPlatform, modKey, quitItem, shortcutGroups } from '../../src/app/shortcuts';

const keys = (mac: boolean) => shortcutGroups(mac).flatMap((group) => group.keys.map(([key]) => key));

test.each([
  ['MacIntel', true], ['iPad', true], ['Win32', false], ['Windows', false], ['Linux x86_64', false],
])('navigator.platform %s is a Mac: %s', (platform, mac) => {
  expect(isMacPlatform(platform)).toBe(mac);
});

test('Windows labels say Ctrl, Shift and Alt in words', () => {
  expect(modKey('S', false, false)).toBe('Ctrl+S');
  expect(modKey('S', true, false)).toBe('Ctrl+Shift+S');
  const all = keys(false);
  expect(all).toContain('Ctrl+Shift+Z, Ctrl+Y');
  expect(all).toContain('Ctrl+1, Ctrl+2, Ctrl+3, Ctrl+4');
  expect(all).toContain('Shift+↑ Shift+↓');
  expect(all).toContain('Alt while dragging');
  expect(all.join(' ')).not.toMatch(/[⌘⇧⌥]|Cmd|Option/);
  expect(quitItem(false)).toEqual({ label: 'Exit', shortcut: 'Alt+F4' });
});

test('Mac labels use the Mac symbols', () => {
  expect(modKey('S', false, true)).toBe('⌘S');
  expect(modKey('S', true, true)).toBe('⇧⌘S');
  const all = keys(true);
  expect(all).toContain('⇧⌘Z, ⌘Y');
  expect(all).toContain('⇧↑ ⇧↓');
  expect(all).toContain('⌥ while dragging');
  expect(all.join(' ')).not.toMatch(/Ctrl|Alt/);
  expect(quitItem(true)).toEqual({ label: 'Quit' });
});

test('both platforms list the same shortcuts in the same order', () => {
  const describe = (mac: boolean) =>
    shortcutGroups(mac).map((group) => [group.label, group.keys.map(([, what]) => what)]);
  expect(describe(false)).toEqual(describe(true));
});
