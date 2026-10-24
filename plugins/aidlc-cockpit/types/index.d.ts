// What aidlc-cockpit keeps in the session's state. The values come from core's own scripts:
// `run-files.mjs --json` (runs) and `sprint.mjs board --json` (the sprint board).

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

export type CockpitSnapshot = {
  runs: CockpitRun[];
  sprint: CockpitSprint | null;
  /** What each item has cost so far (ledger + this session's uncharged spend), when measured. */
  costs?: Record<string, number>;
  at: number;
  problem: string | null;
};

declare module 'claude-code' {
  interface PluginState {
    'aidlc-cockpit': {
      snapshot: Shaped<CockpitSnapshot | null>;
      hidden: boolean;
    };
  }
}
