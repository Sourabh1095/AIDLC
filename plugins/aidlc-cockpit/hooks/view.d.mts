// Types for view.mjs, so register.tsx type-checks against the same functions node tests.
import type { CockpitBoardRow, CockpitRun, CockpitSnapshot } from '../types';

export type Tone = 'warning' | 'subtle';
export type Line = { text: string; tone: Tone };
export type Band = { lines: Line[]; needsYou: number };
export type Transition = { item: string; kind: 'needs-you' | 'over'; text: string };
export type ListedEntry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs?: number };

export declare function toSlash(p: string): string;
export declare function coreCandidates(root: string, cacheVersions?: readonly string[]): string[];
export declare function cacheDirOf(root: string): string;
export declare function newestSprintFile(entries: readonly ListedEntry[] | null | undefined): string | null;
export declare function prLabel(pr: string | null | undefined): string | null;
export declare function runLine(run: CockpitRun): Line;
export declare function bandModel(snapshot: CockpitSnapshot | null): Band | null;
export declare function boardText(snapshot: CockpitSnapshot | null): string;
export declare function transitions(prevRows: readonly CockpitBoardRow[] | null, rows: readonly CockpitBoardRow[] | null): Transition[];
