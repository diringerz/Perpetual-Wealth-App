import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';

interface SatiricalRow {
  condition:    string;
  formula:      string;
  mathResult:   string;
  realityCheck: string;
  paradox:      string;
}

@Component({
  selector:    'app-satirical',
  standalone:  true,
  imports:     [CommonModule],
  styleUrls:   ['./satirical.component.scss'],
  templateUrl: './satirical.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SatiricalComponent {

  readonly rows: SatiricalRow[] = [
    {
      condition:    'Infinite return rate (i → ∞)',
      formula:      'W₀ = C₀ / r_real → 0',
      mathResult:   'Any positive wealth, no matter how small, sustains you forever',
      realityCheck: 'No asset class delivers infinite returns. If one did, capital would flow to it instantly and arbitrage would eliminate the excess return.',
      paradox:      'A penny in this economy makes you wealthier than every sovereign wealth fund in ours.',
    },
    {
      condition:    'Zero consumption (C₀ = 0)',
      formula:      'W₀ = 0 / r_real = 0',
      mathResult:   'No initial wealth required — you need nothing to sustain nothing',
      realityCheck: 'Zero consumption means no food, no shelter, no energy. The only known practitioners of this strategy have not left reviews.',
      paradox:      'The cheapest path to financial independence is to want nothing. Congratulations — you have optimised yourself out of existence.',
    },
    {
      condition:    'Zero inflation (π = 0) and zero return (i = 0)',
      formula:      'r_real = 0, W₀ = C₀ / 0 → ∞',
      mathResult:   'Infinite initial wealth required',
      realityCheck: 'An economy with zero inflation and zero return has no incentive for investment, saving, or capital allocation. It would not be an economy.',
      paradox:      'You need infinite wealth to sustain any finite spending. This is also called a mattress.',
    },
    {
      condition:    'Full taxation (T = 1)',
      formula:      'r_real = (1 + 0) / (1 + π) − 1 = −π/(1+π) < 0',
      mathResult:   'Perpetual wealth is impossible. The state claims all investment income, leaving only inflation-eroded principal.',
      realityCheck: 'A 100% investment income tax rate would collapse capital markets within a fiscal quarter.',
      paradox:      'The government has solved wealth inequality by ensuring no one can be wealthy.',
    },
    {
      condition:    'Welfare covers all consumption — S₀(1−T) ≥ C₀',
      formula:      'W₀ = (C₀ − S₀(1−T)) / r_real ≤ 0',
      mathResult:   'Zero initial wealth required. The state funds your lifestyle entirely.',
      realityCheck: 'A welfare benefit exceeding median consumption for every citizen would require a tax base larger than the economy itself.',
      paradox:      'Universal Basic Income set above the cost of living is self-funding, provided everyone is simultaneously the taxpayer and the beneficiary.',
    },
    {
      condition:    'Infinite initial wealth (W₀ → ∞)',
      formula:      'Any r_real > 0 satisfies the condition',
      mathResult:   'Even a 0.0001% real return sustains infinite consumption',
      realityCheck: 'Infinite wealth cannot exist in a finite economy. Attempting to invest it would own every asset on Earth, at which point you are the market.',
      paradox:      'You have so much money that money no longer means anything. The paradox of wealth: its value derives from scarcity, which you have abolished.',
    },
    {
      condition:    'Welfare grows faster than returns (g > r_real)',
      formula:      'D = S₀(1−T) / (r_real − g) < 0 — singularity flips sign',
      mathResult:   'Required wealth becomes negative — the system generates surplus unconditionally',
      realityCheck: 'Welfare growing faster than investment returns indefinitely implies the welfare program becomes the dominant economy. At some point, welfare is simply the economy.',
      paradox:      'The optimal financial strategy is to maximise your benefit payments. The state is a better investment than the market.',
    },
  ];
}
