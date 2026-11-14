import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const title = (page: Page) => page.locator('.h-titlebar-text');
const bpm = (page: Page) => page.locator('.h-app-bpm');
const where = (page: Page) => page.locator('.h-statusfield').nth(1);
const tab = (page: Page) => page.locator('.h-tab.is-selected');
const blockSelect = (page: Page) => page.locator('.h-track-bar .h-select');

async function bytesOf(download: Download): Promise<Buffer> {
  return readFile((await download.path())!);
}

async function exportAs(page: Page, format: string): Promise<Download> {
  await page.keyboard.press('ControlOrMeta+E');
  const dialog = page.getByRole('dialog', { name: 'Export Audio' });
  await dialog.locator('.h-select').nth(1).click();
  await page.locator('.h-select-option', { hasText: format }).click();
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Export' }).click();
  return download;
}

async function menu(page: Page, menuLabel: string, item: string): Promise<void> {
  await page.locator('.h-menubar-item', { hasText: menuLabel }).click();
  await page.locator('.h-menu-item', { hasText: item }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const welcome = page.getByRole('dialog', { name: 'Welcome to Hadjitron 3000' });
  await welcome.getByRole('button', { name: 'Listen to the Demo' }).click();
  await expect(title(page)).toHaveText('Welcome - Hadjitron 3000');
});

test('the demo project opens in the Song view on the first launch', async ({ page }) => {
  await expect(bpm(page)).toHaveText('126.0');
  await expect(tab(page)).toHaveText('Song');
  await expect(where(page)).toHaveText('Song · 16 bars');
  await expect(page.locator('.h-statusfield').first()).toHaveText('Ready.');
  await page.keyboard.press('ControlOrMeta+2');
  await expect(tab(page)).toHaveText('Track');
  await expect(where(page)).toHaveText('Block Beat · 2 bars');
  await expect(page.locator('.h-track-used')).toHaveText('In the song 2 times');
});

test('Space starts playback and the position in the status bar advances', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect(where(page)).toHaveText(/^Song · \d+\.\d$/);
  const first = await where(page).textContent();
  await expect(where(page)).not.toHaveText(first!, { timeout: 5000 });
  await expect(page.locator('.h-statusfield').nth(2)).toHaveText(/^\d+\.\d kHz$/);
  await page.keyboard.press('Space');
  await expect(where(page)).toHaveText('Song · 16 bars');
});

test('exporting writes the song and a block as WAV and MP3 files', async ({ page }) => {
  const song = await exportAs(page, 'WAV, 16-bit');
  expect(song.suggestedFilename()).toBe('Welcome.wav');
  // Sixteen bars at 126 BPM are 30.5 s.
  expect((await bytesOf(song)).length).toBeGreaterThan(30.4 * 44100 * 4);

  await page.keyboard.press('ControlOrMeta+2');
  const wav = await exportAs(page, 'WAV, 16-bit');
  expect(wav.suggestedFilename()).toBe('Welcome - Beat.wav');
  const w = await bytesOf(wav);
  expect(w.subarray(0, 4).toString('latin1')).toBe('RIFF');
  expect(w.subarray(8, 12).toString('latin1')).toBe('WAVE');
  // Two bars at 126 BPM are 3.8 s; with the tail the file holds 3.8 to 10 s of 16-bit stereo at 44.1 kHz.
  expect(w.length).toBeGreaterThan(3.8 * 44100 * 4);
  expect(w.length).toBeLessThan(10 * 44100 * 4 + 44);

  const mp3 = await exportAs(page, 'MP3, 192 kbit/s');
  expect(mp3.suggestedFilename()).toBe('Welcome - Beat.mp3');
  const m = await bytesOf(mp3);
  const id3 = m.subarray(0, 3).toString('latin1') === 'ID3';
  expect(id3 || (m[0] === 0xff && (m[1] & 0xe0) === 0xe0)).toBe(true);
  expect(m.length).toBeGreaterThan((3.8 * 192000) / 8 * 0.8);
  expect(m.length).toBeLessThan((10 * 192000) / 8 * 1.2);
});

test('the block bar picks and renames blocks, and the Block Library adds one', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+2');
  await blockSelect(page).click();
  await page.locator('.h-select-option', { hasText: 'Pads up' }).click();
  await expect(blockSelect(page)).toHaveText('Pads up');
  await expect(where(page)).toHaveText('Block Pads up · 2 bars');

  await page.locator('.h-track-bar').getByRole('button', { name: 'Rename…' }).click();
  await page.keyboard.type('Pads, higher');
  await page.keyboard.press('Enter');
  await expect(blockSelect(page)).toHaveText('Pads, higher');

  await menu(page, 'Block', 'Block Library…');
  const library = page.getByRole('dialog', { name: 'Block Library' });
  await library.locator('.h-list-row', { hasText: 'Keys up' }).click();
  await library.getByRole('button', { name: 'Add to Project' }).click();
  await expect(library).toHaveCount(0);
  await expect(blockSelect(page)).toHaveText('Keys up');
  await expect(page.locator('.h-track-used')).toHaveText('Not in the song yet');
});

test('saving downloads a project file, and Save Block As a block file', async ({ page }) => {
  const download = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+S');
  const file = await download;
  expect(file.suggestedFilename()).toBe('Welcome.h3k');
  const json = JSON.parse((await bytesOf(file)).toString('utf8'));
  expect(json.format).toBe('hadjitron3000/project');
  expect(json.project.name).toBe('Welcome');
  expect(json.project.channels).toHaveLength(8);
  expect(json.project.patterns).toHaveLength(8);

  const blockDownload = page.waitForEvent('download');
  await menu(page, 'Block', 'Save Block As…');
  const block = await blockDownload;
  expect(block.suggestedFilename()).toBe('Beat.h3b');
  const blockJson = JSON.parse((await bytesOf(block)).toString('utf8'));
  expect(blockJson.format).toBe('hadjitron3000/block');
  expect(blockJson.block.tracks).toHaveLength(3);
});

test('reloading the page restores the project and the view', async ({ page }) => {
  await bpm(page).hover();
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await expect(bpm(page)).toHaveText('128.0');
  await expect(title(page)).toHaveText('Welcome* - Hadjitron 3000');
  await page.keyboard.press('ControlOrMeta+1');
  await expect(tab(page)).toHaveText('Factory');
  await page.waitForTimeout(1500);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect(bpm(page)).toHaveText('128.0');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(title(page)).toHaveText('Welcome* - Hadjitron 3000');
  await expect(tab(page)).toHaveText('Factory');
});
