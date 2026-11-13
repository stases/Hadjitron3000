// The project survives a restart: it is kept in IndexedDB and restored on launch.
// The document (without samples) is one entry; each sample's bytes are their own entry, written once.

import { clear, createStore, del, get, keys, set, setMany } from 'idb-keyval';
import { readProject, soundSampleIds } from '../core/fileformat';
import type { Project, SampleData } from '../core/types';
import { demoProject } from '../presets/projects';
import { openProject, useApp } from '../state/store';
import type { FileRef } from '../state/store';

const store = createStore('hadjitron-session', 'session');
const DOC = 'doc';
const SAMPLE = 'sample:';
const DELAY_MS = 1000;

interface StoredDoc {
  project: Omit<Project, 'samples'>;
  samples: string[];
  file: FileRef | null;
  dirty: boolean;
}

// Sample ids known to be in the database.
let stored = new Set<string>();
let queue = Promise.resolve();

/** Write the current project now. Writes run one after another. */
export function saveSession(): Promise<void> {
  queue = queue.then(write).catch((error: unknown) => console.error('The session could not be stored:', error));
  return queue;
}

async function write(): Promise<void> {
  const { project, file, dirty } = useApp.getState();
  const { samples, ...doc } = project;
  const used = [...new Set(project.channels.flatMap((c) => soundSampleIds(c.sound)))].filter((id) => samples[id]);
  const fresh = used.filter((id) => !stored.has(id));
  if (fresh.length) await setMany(fresh.map((id) => [SAMPLE + id, samples[id]]), store);
  fresh.forEach((id) => stored.add(id));
  await set(DOC, { project: doc, samples: used, file, dirty } satisfies StoredDoc, store);
  for (const id of [...stored].filter((id) => !used.includes(id))) {
    await del(SAMPLE + id, store);
    stored.delete(id);
  }
}

/** Open the stored project, or the demo on the first launch or when the stored one cannot be read. */
export async function restoreSession(): Promise<void> {
  try {
    stored = new Set((await keys<string>(store)).filter((k) => k.startsWith(SAMPLE)).map((k) => k.slice(SAMPLE.length)));
    const doc = await get<StoredDoc>(DOC, store);
    if (doc) {
      const samples: Record<string, SampleData> = {};
      for (const id of doc.samples) {
        const sample = await get<SampleData>(SAMPLE + id, store);
        if (sample) samples[id] = sample;
      }
      openProject(readProject(doc.project, samples), doc.file);
      useApp.setState({ dirty: doc.dirty });
      return;
    }
  } catch (error) {
    console.error('The stored session could not be restored:', error);
    stored = new Set();
    await clear(store).catch(() => {});
  }
  openProject(demoProject(), null);
}

/** Save the project about a second after every change. Returns the function that stops it. */
export function watchSession(): () => void {
  let timer = 0;
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    void saveSession();
  };
  const unsubscribe = useApp.subscribe((state, prev) => {
    if (state.project === prev.project && state.file === prev.file && state.dirty === prev.dirty) return;
    clearTimeout(timer);
    timer = window.setTimeout(flush, DELAY_MS);
  });
  window.addEventListener('pagehide', flush);
  return () => {
    unsubscribe();
    clearTimeout(timer);
    window.removeEventListener('pagehide', flush);
  };
}
