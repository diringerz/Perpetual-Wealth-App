import { Injectable } from '@angular/core';
import {
  WealthParams, SweepRange, TierConfig,
  VariableMeta, SweepVariable
} from '../../shared/models/wealth.models';

@Injectable({ providedIn: 'root' })
export class DefaultParamsService {

  // ---------------------------------------------------------------------------
  // Default parameter values — passed down to all tier and graph components
  // ---------------------------------------------------------------------------

  readonly defaultParams: WealthParams = {
    C0:  80_000,
    i:   0.10,
    T:   0.25,
    pi:  0.03,
    S0:  0,
    g:   0,
  };

  readonly defaultSweepRange: SweepRange = {
    min:      0.01,
    max:      0.20,
    n_points: 200,
  };

  readonly defaultHorizon = 50;

  // ---------------------------------------------------------------------------
  // Variable metadata — labels, units, valid ranges, formatters
  // ---------------------------------------------------------------------------

  readonly variableMeta: Record<SweepVariable, VariableMeta> = {
    i: {
      key:         'i',
      label:       'Return rate',
      description: 'Nominal annual return on invested wealth',
      min:         0.001,
      max:         0.50,
      step:        0.001,
      unit:        '%',
      formatFn:    (v) => `${(v * 100).toFixed(2)}%`,
    },
    T: {
      key:         'T',
      label:       'Tax rate',
      description: 'Marginal tax rate applied to investment income',
      min:         0,
      max:         0.99,
      step:        0.01,
      unit:        '%',
      formatFn:    (v) => `${(v * 100).toFixed(1)}%`,
    },
    pi: {
      key:         'pi',
      label:       'Inflation rate',
      description: 'Annual consumer price inflation rate, reducing purchasing power of money',
      min:         0,
      max:         0.20,
      step:        0.001,
      unit:        '%',
      formatFn:    (v) => `${(v * 100).toFixed(2)}%`,
    },
    C0: {
      key:         'C0',
      label:       'Annual consumption',
      description: 'Annual spending required to maintain your lifestyle',
      min:         1_000,
      max:         2_000_000,
      step:        1_000,
      unit:        '$',
      formatFn:    (v) => `$${(v).toLocaleString()}`,
    },
    S0: {
      key:         'S0',
      label:       'Annual welfare',
      description: 'Annual subsidy or benefit income (pre-tax)',
      min:         0,
      max:         500_000,
      step:        1_000,
      unit:        '$',
      formatFn:    (v) => `$${v.toLocaleString()}`,
    },
    g: {
      key:         'g',
      label:       'Welfare growth rate',
      description: 'Annual rate at which welfare income grows',
      min:         0,
      max:         0.20,
      step:        0.001,
      unit:        '%',
      formatFn:    (v) => `${(v * 100).toFixed(2)}%`,
    },
  };

  // ---------------------------------------------------------------------------
  // Tier configuration
  // ---------------------------------------------------------------------------

  readonly tierConfigs: Record<number, TierConfig> = {
    1: {
      tier:        1,
      label:       'Tier 1 — Base',
      description: 'Constant consumption, no inflation adjustment. The simplest perpetual wealth condition: your after-tax real return must exactly fund fixed annual spending.',
      variables:   ['i', 'T', 'pi', 'C0'],
    },
    2: {
      tier:        2,
      label:       'Tier 2 — Inflation-adjusted consumption',
      description: 'Consumption grows with inflation each year. Your real return must exceed inflation to sustain purchasing power indefinitely.',
      variables:   ['i', 'T', 'pi', 'C0'],
    },
    3: {
      tier:        3,
      label:       'Tier 3 — Welfare subsidy',
      description: 'After-tax welfare income reduces the wealth required. If welfare grows faster than inflation, required initial wealth falls over time.',
      variables:   ['i', 'T', 'pi', 'C0', 'S0', 'g'],
    }
  };
/*
    ,
    4: {
      tier:        4,
      label:       'Tier 4 — Welfare reinvested',
      description: 'Welfare income is deposited into the wealth pool before interest accrues each period, compounding its effect on the system.',
      variables:   ['i', 'T', 'pi', 'C0', 'S0', 'g'],
    },
    */
  // ---------------------------------------------------------------------------
  // Default sweep ranges per variable
  // ---------------------------------------------------------------------------

  readonly sweepRangeDefaults: Record<SweepVariable, SweepRange> = {
    i:   { min: 0.01,    max: 0.30,       n_points: 200 },
    T:   { min: 0,       max: 0.95,       n_points: 200 },
    pi:  { min: 0,       max: 0.15,       n_points: 200 },
    C0:  { min: 10_000,  max: 500_000,    n_points: 200 },
    S0:  { min: 0,       max: 200_000,    n_points: 200 },
    g:   { min: 0,       max: 0.15,       n_points: 200 },
  };
}
