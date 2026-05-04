import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterLinkActive } from '@angular/router';

interface NavItem {
  label:    string;
  route:    string;
  children: { label: string; route: string }[];
}

@Component({
  selector:    'app-top-menu',
  standalone:  true,
  imports:     [CommonModule, RouterModule, RouterLinkActive],
  templateUrl: './top-menu.component.html',
  styleUrls:   ['./top-menu.component.scss'],
})
export class TopMenuComponent {

  readonly navItems: NavItem[] = [
    {
      label: 'Deterministic',
      route: '/deterministic',
      children: [
        { label: 'Overview',             route: '/deterministic' },
        { label: 'Satirical solutions',  route: '/deterministic/satirical' },
        { label: 'Tier 1 — Base',        route: '/deterministic/tier-1' },
        { label: 'Tier 2 — Inflation',   route: '/deterministic/tier-2' },
        { label: 'Tier 3 — Welfare',     route: '/deterministic/tier-3' },
        //{ label: 'Tier 4 — Reinvested',  route: '/deterministic/tier-4' },
      ],
    },
    {
      label: 'Stochastic',
      route: '/stochastic',
      children: [
        { label: 'Overview',                    route: '/stochastic' },
        { label: 'Naive — Tier 1',              route: '/stochastic/naive/tier-1' },
        { label: 'Naive — Tier 2',              route: '/stochastic/naive/tier-2' },
        { label: 'Naive — Tier 3',              route: '/stochastic/naive/tier-3' },
        { label: 'Correlated — Tier 1',         route: '/stochastic/correlated/tier-1' },
        { label: 'Correlated — Tier 2',         route: '/stochastic/correlated/tier-2' },
        { label: 'Correlated — Tier 3',         route: '/stochastic/correlated/tier-3' },
      ],
    },
  ];

  openMenu: string | null = null;

  toggleMenu(label: string): void {
    this.openMenu = this.openMenu === label ? null : label;
  }

  closeMenu(): void {
    this.openMenu = null;
  }
}