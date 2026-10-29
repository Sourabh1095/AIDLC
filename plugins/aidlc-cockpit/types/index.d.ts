// What aidlc-cockpit keeps in the session's state. The values come from core's own scripts:
// `run-files.mjs --json` (runs), `sprint.mjs board --json` (the sprint board), `brain.mjs context --json`
// (the module being changed) and `work-items/tree.mjs --json` (the board as a tree); the session's own
// work is kept by the mod as the tools run.

export type CockpitRun = {
  item: string;
  phase: string;
  repo?: string;
  branch?: string;
  fixCycles?: string;
  pr?: string;
};

export type CockpitBoardRow = {
  item: string;
  repo: string | null;
  phase: string | null;
  fixCycles: string | null;
  branch: string | null;
  pr: string | null;
  session: string | null;
  status: string;
  terminal: boolean;
  waitingFor?: string;
  needsYou?: string;
};

export type CockpitSprint = { rows: CockpitBoardRow[]; allTerminal: boolean };

/** A module being changed, as core's `brain.mjs context --json` reports it. */
export type CockpitModule = {
  name: string;
  page: string | null;
  area: string | null;
  title: string | null;
  purpose: string | null;
  rules: string[];
  connectsTo: string[];
  usedBy: { name: string; recorded: boolean; live: boolean }[];
  assumed: number;
  gaps: number;
  state: string | null;
  behindFiles: number;
  files: string[];
};
export type CockpitContext = { modules: CockpitModule[]; unmapped: string[]; partial: boolean };

/** One repo's `git status`, paths workspace-relative. */
export type CockpitGit = { repo: string; branch: string | null; ahead: number; behind: number; dirty: string[] };

/** One item on the board and everything under it, from core's `work-items/tree.mjs --json`. */
export type CockpitTreeNode = {
  id: string;
  type: string;
  title: string;
  status: string;
  parent: string | null;
  run: string | null;
  counts: { total: number; done: number; openBugs: number };
  children: CockpitTreeNode[];
};
export type CockpitTree = {
  source?: string;
  tracker?: string;
  at?: string | null;
  note?: string | null;
  truncated?: boolean;
  roots: CockpitTreeNode[];
  loose: CockpitTreeNode[];
  hiddenDone: number;
  error?: string;
};

/** What this session changed: each file and when, each check and whether it passed, the commits. */
export type CockpitWork = {
  files: Record<string, number>;
  checks: Record<string, { at: number; ok: boolean }>;
  commits: number;
};

export type CockpitSnapshot = {
  runs: CockpitRun[];
  sprint: CockpitSprint | null;
  /** What each item has cost so far (ledger + this session's uncharged spend), when measured. */
  costs?: Record<string, number>;
  /** The modules the session's newest edits are in. */
  context?: CockpitContext | null;
  /** `git status` of each repo the session touched, and of the workspace. */
  git?: CockpitGit[];
  /** The board as a tree; read every few minutes from a remote tracker, every look from a markdown one. */
  tree?: CockpitTree | null;
  at: number;
  problem: string | null;
};

declare module 'claude-code' {
  interface PluginState {
    'aidlc-cockpit': {
      snapshot: Shaped<CockpitSnapshot | null>;
      hidden: boolean;
      work: Shaped<CockpitWork>;
      /** Tree nodes the person opened (true) or closed (false); the rest follow the default. */
      toggled: Record<string, boolean>;
    };
  }
}
