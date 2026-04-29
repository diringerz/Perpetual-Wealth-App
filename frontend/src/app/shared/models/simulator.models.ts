import { WealthParams } from './wealth.models';

// ---------------------------------------------------------------------------
// Core tree data structures
// ---------------------------------------------------------------------------

export interface SimNode {
  id:         string;       // uuid
  label:      string;       // e.g. "W₀", "Y1·Main", "Y3·A"
  year:       number;       // depth — 0 = root
  W:          number;       // wealth at this node
  bankrupt:   boolean;
  branchName: string;       // "Main", "Branch A", "Branch B" ...
  parentId:   string | null;
  childIds:   string[];
}

export interface SimEdge {
  id:     string;
  fromId: string;
  toId:   string;
  params: WealthParams;     // parameters used this year
  tier:   number;
}

export interface SimTree {
  nodes:  Record<string, SimNode>;
  edges:  Record<string, SimEdge>;
  rootId: string;
  // Counter for auto-naming branches: 0=Main, 1=A, 2=B ...
  branchCounter: number;
}

// ---------------------------------------------------------------------------
// SVG layout types
// ---------------------------------------------------------------------------

export interface LayoutNode {
  node:  SimNode;
  x:     number;    // pixel x (time axis)
  y:     number;    // pixel y (branch axis)
}

export interface LayoutEdge {
  edge:     SimEdge;
  x1:       number;
  y1:       number;
  x2:       number;
  y2:       number;
  label:    string;    // formatted params for tooltip
  color:    string;    // branch colour hex
  colorIdx: number;    // index into BRANCH_COLORS for marker-end id
}

// ---------------------------------------------------------------------------
// Simulator state
// ---------------------------------------------------------------------------

export type StepMode = 'continue' | 'fork-independent' | 'fork-rebuild';

export interface PendingStep {
  fromNodeId: string;
  params:     WealthParams;
  mode:       StepMode;
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

export interface AdviseRequest {
  W_current: number;
  year:      number;
  params:    WealthParams;
  tier:      number;
}

export interface Suggestion {
  variable: string;
  action:   'increase' | 'reduce';
  current:  number;
  target:   number;
  plain:    string;
}

export interface AdviseResponse {
  bankrupt:    boolean;
  W_required:  number | null;
  shortfall:   number | null;
  suggestions: Suggestion[];
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export interface CsvRow {
  year:   number;
  [branchName: string]: number | null;
}