import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const title = (page: Page) => page.locator('.h-titlebar-text');
const bpm = (page: Page) => page.locator('.h-app-bpm');
const where = (page: Page) => page.locator('.h-statusfield').nth(1);

async function bytesOf(download: Download): Promise<Buffer> {
  return readFile((await download.path())!);
}

async function exportAs(page: Page, format: string): Promise<Download> {
  await page.keyboard.press('Control+E');
  const dialog = page.getByRole('dialog', { name: 'Export Audio' });
  await dialog.locator('.h-select').nth(1).click();
  await page.locator('.h-select-option', { hasText: format }).click();
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Export' }).click();
  return download;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(title(page)).toHaveText('Welcome - Hadjitron 3000');
});

test('the demo project opens on the first launch', async ({ page }) => {
  await expect(bpm(page)).toHaveText('126.0');
  await expect(where(page)).toHaveText('Pattern A · 2 bars');
  await expect(page.locator('.h-statusfield').first()).toHaveText('Ready.');
});

test('Space starts playback and the position in the status bar advances', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect(where(page)).toHaveText(/^Pattern A \d\.\d$/);
  const first = await where(page).textContent();
  await expect(where(page)).not.toHaveText(first!, { timeout: 5000 });
  await expect(page.locator('.h-statusfield').nth(2)).toHaveText(/^\d+\.\d kHz$/);
  await page.keyboard.press('Space');
  await expect(where(page)).toHaveText('Pattern A · 2 bars');
});

test('exporting writes a WAV file and an MP3 file', async ({ page }) => {
  const wav = await exportAs(page, 'WAV, 16-bit');
  expect(wav.suggestedFilename()).toBe('Welcome - Pattern A.wav');
  const w = await bytesOf(wav);
  expect(w.subarray(0, 4).toString('latin1')).toBe('RIFF');
  expect(w.subarray(8, 12).toString('latin1')).toBe('WAVE');
  // Two bars at 126 BPM are 3.8 s; with the tail the file holds 3.8 to 10 s of 16-bit stereo at 44.1 kHz.
  expect(w.length).toBeGreaterThan(3.8 * 44100 * 4);
  expect(w.length).toBeLessThan(10 * 44100 * 4 + 44);

  const mp3 = await exportAs(page, 'MP3, 192 kbit/s');
  expect(mp3.suggestedFilename()).toBe('Welcome - Pattern A.mp3');
  const m = await bytesOf(mp3);
  const id3 = m.subarray(0, 3).toString('latin1') === 'ID3';
  expect(id3 || (m[0] === 0xff && (m[1] & 0xe0) === 0xe0)).toBe(true);
  expect(m.length).toBeGreaterThan((3.8 * 192000) / 8 * 0.8);
  expect(m.length).toBeLessThan((10 * 192000) / 8 * 1.2);
});

test('saving downloads a project file', async ({ page }) => {
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+S');
  const file = await download;
  expect(file.suggestedFilename()).toBe('Welcome.h3k');
  const json = JSON.parse((await bytesOf(file)).toString('utf8'));
  expect(json.format).toBe('hadjitron3000/project');
  expect(json.project.name).toBe('Welcome');
  expect(json.project.channels).toHaveLength(8);
});

test('reloading the page restores the project', async ({ page }) => {
  await bpm(page).hover();
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await expect(bpm(page)).toHaveText('128.0');
  await expect(title(page)).toHaveText('Welcome* - Hadjitron 3000');
  await page.waitForTimeout(1500);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect(bpm(page)).toHaveText('128.0');
  await expect(title(page)).toHaveText('Welcome* - Hadjitron 3000');
});
