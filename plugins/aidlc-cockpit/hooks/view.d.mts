// Types for view.mjs, so register.tsx type-checks against the same functions node tests.
import type { CockpitBoardRow, CockpitContext, CockpitGit, CockpitRun, CockpitSnapshot, CockpitTree, CockpitTreeNode, CockpitWork } from '../types';

export type Tone = 'warning' | 'subtle';
export type Line = { text: string; tone: Tone };
export type ColoredLine = { text: string; tone: 'text' | 'subtle' | 'success' | 'warning' | 'error' };
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
export declare function bandModel(snapshot: CockpitSnapshot | null, work?: CockpitWork | null): Band | null;
export declare function boardText(snapshot: CockpitSnapshot | null, work?: CockpitWork | null, toggled?: Record<string, boolean>): string;
export declare function coreTooOld(version: string | null | undefined, min: string): boolean;
export declare function transitions(prevRows: readonly CockpitBoardRow[] | null, rows: readonly CockpitBoardRow[] | null): Transition[];

// this session's work
export declare function editedPath(tool: string, input: { file_path?: unknown; notebook_path?: unknown } | null | undefined): string | null;
export declare function workspacePath(cwd: string, path: string): string | null;
export declare function checksIn(command: string | null | undefined): string[];
export declare function makesCommit(command: string | null | undefined): boolean;
export declare function noteEdit(work: CockpitWork | null, path: string, at: number): CockpitWork;
export declare function noteChecks(work: CockpitWork | null, kinds: readonly string[], ok: boolean, at: number): CockpitWork;
export declare function noteCommit(work: CockpitWork | null): CockpitWork;
export declare function parseGitStatus(out: string, prefix?: string): CockpitGit;
export declare function repoRoots(cfg: unknown, cwd: string): { key: string; dir: string }[];
export declare function repoOf(roots: readonly { key: string; dir: string }[], path: string): { key: string; dir: string } | null;
export type Session = {
  title: string;
  lines: ColoredLine[];
  files: number;
  uncommitted: number;
  checks: { kind: string; state: 'passed' | 'failed' | 'stale'; text: string; tone: ColoredLine['tone'] }[];
  branch: string | null;
};
export declare function sessionModel(work: CockpitWork | null, git: readonly CockpitGit[] | null | undefined, context: CockpitContext | null | undefined): Session;
export declare function workLine(session: Session, context: CockpitContext | null | undefined): Line | null;
export declare function contextModel(context: CockpitContext | null | undefined): { title: string; name: string; learn: string | null; lines: ColoredLine[] }[];
export type TreeRow = { id: string; depth: number; text: string; tone: ColoredLine['tone']; expandable: boolean; open: boolean };
export declare function treeRows(nodes: readonly CockpitTreeNode[] | null | undefined, toggled?: Record<string, boolean>): TreeRow[];
export declare function treeModel(tree: CockpitTree | null | undefined, toggled?: Record<string, boolean>): { title: string; rows: TreeRow[]; loose: TreeRow[]; note: string | null } | null;
