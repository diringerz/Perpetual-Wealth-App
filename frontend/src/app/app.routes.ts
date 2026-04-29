import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'deterministic',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/mode-home/mode-home.component').then(
            (m) => m.ModeHomeComponent
          ),
        data: { mode: 'deterministic' },
      },
      {
        path: 'satirical',
        loadComponent: () =>
          import('./features/deterministic/satirical/satirical.component').then(
            (m) => m.SatiricalComponent
          ),
      },
      {
        path: 'tier-1',
        loadComponent: () =>
          import('./features/deterministic/tier/tier.component').then(
            (m) => m.TierComponent
          ),
        data: { tier: 1 },
      },
      {
        path: 'tier-2',
        loadComponent: () =>
          import('./features/deterministic/tier/tier.component').then(
            (m) => m.TierComponent
          ),
        data: { tier: 2 },
      },
      {
        path: 'tier-3',
        loadComponent: () =>
          import('./features/deterministic/tier/tier.component').then(
            (m) => m.TierComponent
          ),
        data: { tier: 3 },
      },
      {
        path: 'simulator',
        loadComponent: () =>
          import('./features/deterministic/simulator/simulator.component').then(
            (m) => m.SimulatorComponent
          ),
      },
    ],
  },
  {
    path: 'stochastic',
    loadComponent: () =>
      import('./features/mode-home/mode-home.component').then(
        (m) => m.ModeHomeComponent
      ),
    data: { mode: 'stochastic' },
  },
  {
    path: '**',
    redirectTo: '',
  },
];