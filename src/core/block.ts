import { soundSampleIds } from './fileformat';
import type { Block, Project } from './types';

/** The block of a project as a self-contained piece: one track per channel that has notes in it, in channel order. */
export function extractBlock(project: Project, patternId: string): Block | null {
  const pattern = project.patterns.find((pattern) => pattern.id === patternId);
  if (!pattern) return null;
  const tracks = project.channels.flatMap((channel) => {
    const notes = Object.hasOwn(pattern.notes, channel.id) ? pattern.notes[channel.id] : [];
    return notes.length > 0 ? [{ sound: channel.sound, notes }] : [];
  });
  const ids = new Set(tracks.flatMap((track) => soundSampleIds(track.sound)));
  return structuredClone({
    name: pattern.name,
    color: pattern.color,
    bars: pattern.bars,
    tracks,
    samples: Object.fromEntries([...ids].filter((id) => Object.hasOwn(project.samples, id))
      .map((id) => [id, project.samples[id]])),
  });
}
