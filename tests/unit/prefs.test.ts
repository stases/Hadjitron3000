import { afterEach, expect, test, vi } from 'vitest';

/** A fresh copy of the preferences module over the given storage. */
async function load(storage: Partial<Storage>) {
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  return import('../../src/app/prefs');
}

function memory(initial: Record<string, string> = {}): Storage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    length: 0,
    key: () => null,
    clear: () => {},
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('beginner mode is on when nothing is stored', async () => {
  const { usePrefs } = await load(memory());
  expect(usePrefs.getState()).toEqual({ beginner: true });
});

test('a change is stored under one key and read back on the next start', async () => {
  const storage = memory();
  const first = await load(storage);
  first.setPrefs({ beginner: false });
  expect(first.usePrefs.getState().beginner).toBe(false);
  expect(Object.keys(storage.data)).toEqual(['hadjitron-prefs']);
  const second = await load(storage);
  expect(second.usePrefs.getState()).toEqual({ beginner: false });
});

test('broken storage leaves the defaults and never throws', async () => {
  const fail = () => {
    throw new Error('denied');
  };
  const broken = await load({ getItem: fail, setItem: fail });
  expect(broken.usePrefs.getState()).toEqual({ beginner: true });
  expect(() => broken.setPrefs({ beginner: false })).not.toThrow();
  expect(broken.usePrefs.getState().beginner).toBe(false);

  for (const stored of ['not json', 'null', '[1]', '{"beginner":"no"}']) {
    const { usePrefs } = await load(memory({ 'hadjitron-prefs': stored }));
    expect(usePrefs.getState(), stored).toEqual({ beginner: true });
  }
});

test('storage that is missing altogether leaves the defaults', async () => {
  vi.stubGlobal('localStorage', undefined);
  vi.resetModules();
  const { usePrefs, setPrefs } = await import('../../src/app/prefs');
  expect(usePrefs.getState()).toEqual({ beginner: true });
  expect(() => setPrefs({ beginner: false })).not.toThrow();
});
