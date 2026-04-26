import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Tier pages are data-driven and user-specific — render client-side only.
  // SSR would bake loading=true into the HTML and block hydration.
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
  // All other routes prerender normally
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];