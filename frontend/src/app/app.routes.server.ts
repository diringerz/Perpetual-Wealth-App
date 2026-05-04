import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'deterministic/tier-1',
    renderMode: RenderMode.Client,
  },
  {
    path: 'deterministic/tier-2',
    renderMode: RenderMode.Client,
  },
  {
    path: 'deterministic/tier-3',
    renderMode: RenderMode.Client,
  },
  {
    path: 'deterministic/simulator',
    renderMode: RenderMode.Client,
  },
  {
    path: 'stochastic/naive/tier-1',
    renderMode: RenderMode.Client,
  },
  {
    path: 'stochastic/naive/tier-2',
    renderMode: RenderMode.Client,
  },
  {
    path: 'stochastic/naive/tier-3',
    renderMode: RenderMode.Client,
  },
  {
    path: 'stochastic/correlated/tier-1',
    renderMode: RenderMode.Client,
  },
  {
    path: 'stochastic/correlated/tier-2',
    renderMode: RenderMode.Client,
  },
  {
    path: 'stochastic/correlated/tier-3',
    renderMode: RenderMode.Client,
  },
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];