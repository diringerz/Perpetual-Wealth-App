import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { WealthParams } from '../../shared/models/wealth.models';
import {
  SimTree, SimNode, SimEdge,
  AdviseRequest, AdviseResponse,
} from '../../shared/models/simulator.models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  return crypto.randomUUID();
}

function branchLabel(counter: number): string {
  if (counter === 0) return 'Main';
  let n = counter, label = '';
  while (n > 0) {
    n--;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n     = Math.floor(n / 26);
  }
  return `Branch ${label}`;
}

function nodeLabel(year: number, branchName: string): string {
  if (year === 0) return 'W₀';
  const suffix = branchName === 'Main' ? 'Main' : branchName.replace('Branch ', '');
  return `Y${year}·${suffix}`;
}

// ---------------------------------------------------------------------------
// Step formula — discrete, tier-aware
// ---------------------------------------------------------------------------

export function computeNextW(
  W:      number,
  params: WealthParams,
  year:   number,   // year of the FROM node (0-indexed)
  tier:   number,
): number {
  const { i, T, pi, C0, S0, g } = params;
  const growth      = W * (1 + i * (1 - T));
  const consumption = tier >= 2 ? C0 * Math.pow(1 + pi, year) : C0;
  const welfare     = tier >= 3 ? S0 * Math.pow(1 + g, year) * (1 - T) : 0;
  return growth - consumption + welfare;
}

// ---------------------------------------------------------------------------
// Node action constraints
// ---------------------------------------------------------------------------

export interface NodeActions {
  canStep:      boolean;
  canFork:      boolean;
  canRecalc:    boolean;
  canDelete:    boolean;
}

export function getNodeActions(node: SimNode): NodeActions {
  const isRoot     = node.parentId === null;
  const isLeaf     = node.childIds.length === 0;
  const hasChildren = node.childIds.length > 0;

  return {
    canStep:   isLeaf,                    // leaf only (root or non-root)
    canFork:   true,                      // always — fork creates new branch
    canRecalc: !isRoot,                   // needs an incoming edge
    canDelete: !isRoot,                   // can't delete root
  };
}

// ---------------------------------------------------------------------------
// SimulatorService
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class SimulatorService {

  private readonly base = `${environment.apiUrl}/api/v1/deterministic/simulate`;

  constructor(private http: HttpClient) {}

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  advise(req: AdviseRequest): Observable<AdviseResponse> {
    return this.http.post<AdviseResponse>(`${this.base}/advise`, req);
  }

  // ---------------------------------------------------------------------------
  // Create tree from initial W0
  // ---------------------------------------------------------------------------

  createTree(W0: number): SimTree {
    const rootId   = uuid();
    const rootNode: SimNode = {
      id:         rootId,
      label:      'W₀',
      year:       0,
      W:          W0,
      bankrupt:   W0 < 0,
      branchName: 'Main',
      parentId:   null,
      childIds:   [],
    };
    return {
      nodes:         { [rootId]: rootNode },
      edges:         {},
      rootId,
      branchCounter: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Step forward — only valid on leaf nodes
  // ---------------------------------------------------------------------------

  step(
    tree:   SimTree,
    fromId: string,
    params: WealthParams,
    tier:   number,
  ): SimTree {
    const fromNode = tree.nodes[fromId];
    if (!fromNode || fromNode.childIds.length > 0) return tree; // guard

    return this.addChild(tree, fromId, params, tier, fromNode.branchName);
  }

  // ---------------------------------------------------------------------------
  // Fork — valid on any node, always creates a new branch
  // ---------------------------------------------------------------------------

  fork(
    tree:   SimTree,
    fromId: string,
    params: WealthParams,
    tier:   number,
  ): SimTree {
    const newCounter  = tree.branchCounter + 1;
    const branchName  = branchLabel(newCounter);
    return this.addChild(
      { ...tree, branchCounter: newCounter },
      fromId,
      params,
      tier,
      branchName,
    );
  }

  // ---------------------------------------------------------------------------
  // Edit incoming edge + recalculate all downstream nodes recursively
  // ---------------------------------------------------------------------------

  recalculate(
    tree:   SimTree,
    nodeId: string,
    params: WealthParams,
    tier:   number,
  ): SimTree {
    const node = tree.nodes[nodeId];
    if (!node || !node.parentId) return tree; // root has no incoming edge

    // Find and update the incoming edge
    const incomingEdge = Object.values(tree.edges).find(e => e.toId === nodeId);
    if (!incomingEdge) return tree;

    const updatedEdge: SimEdge = { ...incomingEdge, params };

    // Recompute this node's W
    const parentNode  = tree.nodes[node.parentId];
    const newW        = computeNextW(parentNode.W, params, parentNode.year, tier);
    const updatedNode: SimNode = { ...node, W: newW, bankrupt: newW < 0 };

    let updatedTree: SimTree = {
      ...tree,
      nodes: { ...tree.nodes, [nodeId]: updatedNode },
      edges: { ...tree.edges, [incomingEdge.id]: updatedEdge },
    };

    // Recursively recompute ALL downstream nodes across all branches
    updatedTree = this.recomputeSubtree(updatedTree, nodeId, tier);

    return updatedTree;
  }

  // ---------------------------------------------------------------------------
  // Delete subtree
  // ---------------------------------------------------------------------------

  deleteSubtree(tree: SimTree, nodeId: string): SimTree {
    if (nodeId === tree.rootId) return tree;

    const toDelete = this.collectSubtree(tree, nodeId);
    const nodes    = { ...tree.nodes };
    const edges    = { ...tree.edges };

    const node = tree.nodes[nodeId];
    if (node.parentId) {
      const parent = nodes[node.parentId];
      nodes[node.parentId] = {
        ...parent,
        childIds: parent.childIds.filter(id => id !== nodeId),
      };
    }

    for (const id of toDelete) {
      delete nodes[id];
      const incomingEdge = Object.values(edges).find(e => e.toId === id);
      if (incomingEdge) delete edges[incomingEdge.id];
    }

    return { ...tree, nodes, edges };
  }

  // ---------------------------------------------------------------------------
  // CSV export
  // ---------------------------------------------------------------------------

  exportCsv(tree: SimTree): string {
    const allNodes  = Object.values(tree.nodes);
    const maxYear   = Math.max(...allNodes.map(n => n.year));
    const branches  = [...new Set(allNodes.map(n => n.branchName))].sort();

    const data: Map<number, Map<string, number>> = new Map();
    for (let y = 0; y <= maxYear; y++) data.set(y, new Map());
    for (const node of allNodes) data.get(node.year)?.set(node.branchName, node.W);

    const header = ['Year', ...branches].join(',');
    const rows: string[] = [header];
    for (let y = 0; y <= maxYear; y++) {
      const yearData = data.get(y)!;
      const cells    = branches.map(b => {
        const val = yearData.get(b);
        return val !== undefined ? val.toFixed(2) : '';
      });
      rows.push([y, ...cells].join(','));
    }
    return rows.join('\n');
  }

  downloadCsv(tree: SimTree, filename = 'simulator.csv'): void {
    const csv  = this.exportCsv(tree);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private addChild(
    tree:       SimTree,
    fromId:     string,
    params:     WealthParams,
    tier:       number,
    branchName: string,
  ): SimTree {
    const fromNode = tree.nodes[fromId];
    const year     = fromNode.year + 1;
    const W_next   = computeNextW(fromNode.W, params, fromNode.year, tier);
    const nodeId   = uuid();
    const edgeId   = uuid();

    const newNode: SimNode = {
      id:         nodeId,
      label:      nodeLabel(year, branchName),
      year,
      W:          W_next,
      bankrupt:   W_next < 0,
      branchName,
      parentId:   fromId,
      childIds:   [],
    };

    const newEdge: SimEdge = {
      id: edgeId, fromId, toId: nodeId, params, tier,
    };

    const updatedParent: SimNode = {
      ...fromNode,
      childIds: [...fromNode.childIds, nodeId],
    };

    return {
      ...tree,
      nodes: { ...tree.nodes, [fromId]: updatedParent, [nodeId]: newNode },
      edges: { ...tree.edges, [edgeId]: newEdge },
    };
  }

  // Recursively recompute W for all children of a node after its W changes
  private recomputeSubtree(tree: SimTree, nodeId: string, tier: number): SimTree {
    const node = tree.nodes[nodeId];
    if (!node || node.childIds.length === 0) return tree;

    let updatedTree = tree;

    for (const childId of node.childIds) {
      const childEdge = Object.values(updatedTree.edges).find(e => e.toId === childId);
      if (!childEdge) continue;

      const parentW  = updatedTree.nodes[nodeId].W;
      const newW     = computeNextW(parentW, childEdge.params, node.year, tier);
      const child    = updatedTree.nodes[childId];
      const updated: SimNode = { ...child, W: newW, bankrupt: newW < 0 };

      updatedTree = {
        ...updatedTree,
        nodes: { ...updatedTree.nodes, [childId]: updated },
      };

      // Recurse into this child's subtree
      updatedTree = this.recomputeSubtree(updatedTree, childId, tier);
    }

    return updatedTree;
  }

  private collectSubtree(tree: SimTree, nodeId: string): string[] {
    const result: string[] = [nodeId];
    const node = tree.nodes[nodeId];
    for (const childId of node.childIds) {
      result.push(...this.collectSubtree(tree, childId));
    }
    return result;
  }
}