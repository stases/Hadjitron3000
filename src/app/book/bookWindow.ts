// The Guide Book's own window: a blank page of the app's origin, opened with `window.open`, that the app's one
// renderer draws the book into through a portal. It carries copies of the app's stylesheets, kept in step as they
// change, and the app's keyboard shortcuts, except the reading keys, which stay in the book. It remembers its place
// and size in the preferences, and closes with the app's page.

import { installKeys } from '../keys';
import { setPrefs, usePrefs } from '../prefs';

/** The window's name; the Electron shell lets a window of this name open and no other. */
export const BOOK_WINDOW = 'guide-book';

const READING_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'];
/** How far an arrow key scrolls the page, in pixels. */
const LINE = 40;

let current: { win: Window; dispose: () => void } | null = null;

function features(): string {
  const { width, height, left, top } = usePrefs.getState().bookWindow;
  const values = Object.entries({ width, height, left, top }).filter(([, v]) => Number.isFinite(v));
  return ['popup', ...values.map(([key, v]) => `${key}=${Math.round(v!)}`)].join(',');
}

function remember(win: Window): void {
  if (win.innerWidth > 0 && win.innerHeight > 0) {
    setPrefs({ bookWindow: { width: win.innerWidth, height: win.innerHeight, left: win.screenX, top: win.screenY } });
  }
}

/** Copy the app's stylesheets into the window's document, and again whenever they change (as Vite updates them). */
function copyStyles(doc: Document): () => void {
  const base = doc.createElement('base');
  base.href = document.baseURI;
  const title = doc.createElement('title');
  title.textContent = 'Guide Book';
  const copy = () => doc.head.replaceChildren(base, title,
    ...[...document.querySelectorAll('style, link[rel="stylesheet"]')].map((el) => doc.importNode(el, true)));
  copy();
  const sheet = (node: Node | null) => node?.nodeName === 'STYLE' || node?.nodeName === 'LINK';
  const observer = new MutationObserver((records) => {
    if (records.some((r) => sheet(r.target) || sheet(r.target.parentNode)
      || [...r.addedNodes, ...r.removedNodes].some(sheet))) copy();
  });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
  return () => observer.disconnect();
}

/** Page Up and Down, Home, End and the arrows scroll the page, unless a list in the book has used them. */
function onReadingKey(e: KeyboardEvent): void {
  if (!READING_KEYS.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
  const page = (e.currentTarget as Document).querySelector('.h-book-page');
  if (page && !e.defaultPrevented) {
    const by: Record<string, number> = {
      ArrowUp: -LINE, ArrowDown: LINE, PageUp: LINE - page.clientHeight, PageDown: page.clientHeight - LINE,
      Home: -page.scrollHeight, End: page.scrollHeight,
    };
    page.scrollTop += by[e.key] ?? 0;
  }
  e.preventDefault();
}

/** Open the book's window, or null when the browser does not let it open. `onClose` hears the reader close it. */
export function openBookWindow(onClose: () => void): Window | null {
  let win: Window | null = null;
  try {
    win = window.open('', BOOK_WINDOW, features());
  } catch {
    win = null;
  }
  if (!win) return null;
  const opened = win;
  // Unnamed, the window cannot be reached by another `window.open` of its name, which would load a page into it.
  opened.name = '';
  const doc = opened.document;
  doc.documentElement.lang = 'en';
  doc.body.replaceChildren();
  const stopStyles = copyStyles(doc);
  const removeKeys = installKeys(opened);
  const onResize = () => remember(opened);
  const onClosed = () => {
    current = null;
    dispose();
    onClose();
  };
  function dispose() {
    remember(opened);
    stopStyles();
    removeKeys();
    doc.removeEventListener('keydown', onReadingKey);
    opened.removeEventListener('resize', onResize);
    opened.removeEventListener('pagehide', onClosed);
    window.removeEventListener('pagehide', closeBookWindow);
  }
  doc.addEventListener('keydown', onReadingKey);
  opened.addEventListener('resize', onResize);
  opened.addEventListener('pagehide', onClosed);
  window.addEventListener('pagehide', closeBookWindow);
  current = { win: opened, dispose };
  return opened;
}

/** Close the book's window, remembering where it was. */
export function closeBookWindow(): void {
  if (!current) return;
  const { win, dispose } = current;
  current = null;
  dispose();
  win.close();
}
