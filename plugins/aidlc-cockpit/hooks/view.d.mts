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
export declare function money(usd: number | null | undefined): string | null;
export declare function runLine(run: CockpitRun, usd?: number): Line;

export type Ledger = { item: string | null; phase: string | null; baseline: number | null };
export type Charge = { item: string; phase: string; usd: number };
export type LedgerFile = { item: string; session: string; started: string; updated: string; phases: Record<string, number> };
export declare function runFileTarget(tool: string, input: { command?: unknown; file_path?: unknown } | null | undefined): { item: string; path: string } | null;
export declare function phaseOf(text: string): string | null;
export declare function commandItem(command: { name: string; args?: string } | null | undefined): string | null;
export declare function advance(ledger: Ledger, next: { item: string; phase: string } | null, usd: number): { ledger: Ledger; charges: Charge[] };
export declare function ledgerName(item: string, session: string): string;
export declare function mergeLedger(existing: Partial<LedgerFile> | null, at: { item: string; session: string; now: string }, charges: readonly Charge[]): LedgerFile;
export declare function bandModel(snapshot: CockpitSnapshot | null): Band | null;
export declare function boardText(snapshot: CockpitSnapshot | null): string;
export declare function transitions(prevRows: readonly CockpitBoardRow[] | null, rows: readonly CockpitBoardRow[] | null): Transition[];
