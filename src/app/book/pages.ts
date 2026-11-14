// The Guide Book as plain data. A chapter is one file in ./chapters whose default export is a Chapter; the files
// are read in the order of their names, so adding a chapter is adding a file.

import type { Params, Project } from '../../core/types';
import type { TourStep } from '../tour/tourStore';

/**
 * A starting state, made in code: a project of its own. A sound example is the first sound of that project, which
 * Load adds to the reader's project and Hear plays on the notes of its first block; a block example is its first
 * block with the sounds it plays, added the same way; a project example replaces the reader's project, after the
 * usual offer to save. Hear plays a project's song, or its first block when it has none.
 */
export interface Example {
  kind: 'sound' | 'block' | 'project';
  title: string;
  make: () => Project;
}

/** What a before/after pair claims, as the tests measure it: the after one has more, or less, of something. */
export interface Claim {
  measure:
    | 'level' // overall loudness
    | 'highs' // the share of the sound above about 2 kHz
    | 'lows' // the share below about 150 Hz
    | 'tail' // how long it rings on after the notes end
    | 'width' // the difference between left and right
    | 'crest' // how far the peaks stand out of the average level
    | 'harmonics' // overtones that were not in the note
    | 'ring' // a resonant peak at `hz`
    | 'sidebands' // new pitches at `hz` above and below the note
    | 'movement' // how much the tone changes from moment to moment
    | 'wobble' // how much the pitch wavers, in cents
    | 'duck'; // how far the bass dips while the kick plays
  more: boolean;
  hz?: number;
}

/** Plain words. */
export type Text = string;

/** An example to load and hear, with a live picture where it helps: the scope while it plays, or its envelope. */
export interface ExamplePiece {
  kind: 'example';
  example: Example;
  picture?: 'scope' | 'envelope';
}

/**
 * A worked example: steps from a starting state to a stated result, each pointing at a control. The finished one
 * is the start with every step done, and a recipe can also be loaded part way, after a checkpoint step.
 */
export interface WorkedPiece {
  kind: 'worked';
  example: Example;
  steps: readonly TourStep[];
  result: Text;
  checkpoints?: readonly { label: string; after: number }[];
}

/** Two examples to hear side by side, where hearing the difference is the point. */
export interface ComparePiece {
  kind: 'compare';
  before: Example;
  after: Example;
  claim: Claim;
}

/** What the knobs of a unit mean, from the module table and the status bar hints, with when one reaches for it. */
export interface KnobsPiece {
  kind: 'knobs';
  unit: string;
  when: Text;
}

/** An envelope drawn the way the Factory draws one. */
export interface EnvelopePiece {
  kind: 'envelope';
  params: Params;
  caption: Text;
}

/** Words for the glossary: a term and what it means. */
export interface TermsPiece {
  kind: 'terms';
  terms: readonly (readonly [term: string, meaning: Text])[];
}

export type Piece = Text | ExamplePiece | WorkedPiece | ComparePiece | KnobsPiece | EnvelopePiece | TermsPiece;

export interface Page {
  title: string;
  pieces: readonly Piece[];
}

export interface Chapter {
  id: string;
  title: string;
  pages: readonly Page[];
}

const files = import.meta.glob<Chapter>('./chapters/*.ts', { import: 'default', eager: true });

export const CHAPTERS: readonly Chapter[] = Object.keys(files).sort().map((path) => files[path]);

/** Where a page is, as the preferences keep it: "chapter/page". */
export const pageKey = (chapter: Chapter, page: number) => `${chapter.id}/${page}`;

/** The chapter and page of a key, or the first page when the key names none. */
export function findPage(key: string): { chapter: number; page: number } {
  const [id, page] = key.split('/');
  const chapter = CHAPTERS.findIndex((c) => c.id === id);
  const n = Number(page);
  return chapter >= 0 && Number.isInteger(n) && n >= 0 && n < CHAPTERS[chapter].pages.length
    ? { chapter, page: n }
    : { chapter: 0, page: 0 };
}

/** Every page in reading order. */
export const PAGES: readonly { chapter: number; page: number }[] = CHAPTERS.flatMap((c, chapter) =>
  c.pages.map((_, page) => ({ chapter, page })));
