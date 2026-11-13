// Which dialog is open. One dialog at a time; message boxes queue up and show one after another on top.

import type { ReactNode } from 'react';
import { create } from 'zustand';

export type DialogKind =
  | { kind: 'library'; replace: string | null }
  | { kind: 'blocks' }
  | { kind: 'rename'; patternId: string }
  | { kind: 'export' }
  | { kind: 'about' }
  | { kind: 'shortcuts' }
  | { kind: 'update' };

export interface Message {
  id: number;
  title: string;
  icon: 'info' | 'warning' | 'error' | 'question';
  text: ReactNode;
  buttons: { label: string; value: string; primary?: boolean }[];
  resolve: (value: string) => void;
}

interface DialogState {
  dialog: DialogKind | null;
  messages: Message[];
}

export const useDialogs = create<DialogState>(() => ({ dialog: null, messages: [] }));

export function openDialog(dialog: DialogKind): void {
  useDialogs.setState({ dialog });
}

export function closeDialog(): void {
  useDialogs.setState({ dialog: null });
}

/** Show a message box and wait for the button the user picks (Escape picks the last one). */
let nextId = 1;

export function ask(message: Omit<Message, 'id' | 'resolve'>): Promise<string> {
  return new Promise((resolve) => {
    const done = (value: string) => {
      useDialogs.setState((s) => ({ messages: s.messages.filter((m) => m !== entry) }));
      resolve(value);
    };
    const entry: Message = { ...message, id: nextId++, resolve: done };
    useDialogs.setState((s) => ({ messages: [...s.messages, entry] }));
  });
}

/** Tell the user something went wrong. */
export async function fail(text: ReactNode): Promise<void> {
  await ask({ title: 'Hadjitron 3000', icon: 'error', text, buttons: [{ label: 'OK', value: 'ok', primary: true }] });
}

/** " (what the error says)" for a sentence about a failure, or nothing when the error says nothing. */
export const reason = (error: unknown) => (error instanceof Error && error.message ? ` (${error.message})` : '');
