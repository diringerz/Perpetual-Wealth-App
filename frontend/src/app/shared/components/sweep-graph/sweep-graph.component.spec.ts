import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SweepGraphComponent } from './sweep-graph.component';
import { WealthApiService } from '../../../core/services/wealth-api.service';
import { DefaultParamsService } from '../../../core/services/default-params.service';
import { SweepResponse } from '../../models/wealth.models';

const mockParams = { C0: 80000, i: 0.10, T: 0.25, pi: 0.03, S0: 0, g: 0 };

const mockResponse: SweepResponse = {
  sweep_var: 'i',
  points: [
    { x: 0.10, W0: 1_200_000, edge_case: null },
    { x: 0.15, W0: 900_000,   edge_case: null },
    { x: 0.20, W0: 700_000,   edge_case: null },
  ],
  asymptotes: [],
  infeasible_regions: [],
  base_point:          { x: 0.10, W0: 1_200_000, edge_case: null },
  sensitivity_at_base: { variable: 'i', dW0_dx: -5_000_000, elasticity: -3.14, d2W0_dx2: 0 },
};

describe('SweepGraphComponent', () => {
  let fixture:   ComponentFixture<SweepGraphComponent>;
  let component: SweepGraphComponent;
  let apiSpy:    jasmine.SpyObj<WealthApiService>;

  beforeEach(async () => {
    apiSpy = jasmine.createSpyObj('WealthApiService', ['sweep']);
    apiSpy.sweep.and.returnValue(of(mockResponse));

    await TestBed.configureTestingModule({
      imports:   [SweepGraphComponent],
      providers: [
        { provide: WealthApiService, useValue: apiSpy },
        DefaultParamsService,
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(SweepGraphComponent);
    component = fixture.componentInstance;

    component.sweepVar   = 'i';
    component.baseParams = mockParams;
    component.sweepRange = { min: 0.01, max: 0.30, n_points: 200 };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call sweep API on init', () => {
    expect(apiSpy.sweep).toHaveBeenCalledTimes(1);
  });

  it('should build chart data from response', () => {
    expect(component.chartData.length).toBe(1);
    expect(component.chartData[0].series.length).toBe(3);
  });

  it('should filter null W0 points from chart data', () => {
    apiSpy.sweep.and.returnValue(of({
      ...mockResponse,
      points: [
        { x: 0.05, W0: null, edge_case: 'infeasible' },
        { x: 0.10, W0: 1_200_000, edge_case: null },
      ],
    }));
    component.refresh();
    expect(component.chartData[0].series.length).toBe(1);
  });

  it('should snapshot params at fetch time', () => {
    expect(component.snapshot).not.toBeNull();
    expect(component.snapshot!.params).toEqual(mockParams);
    expect(component.snapshot!.sweepVar).toBe('i');
  });

  it('should not auto-refresh when baseParams input changes', () => {
    apiSpy.sweep.calls.reset();
    component.ngOnChanges({
      baseParams: {
        currentValue:  { ...mockParams, C0: 100_000 },
        previousValue: mockParams,
        firstChange:   false,
        isFirstChange: () => false,
      },
    });
    expect(apiSpy.sweep).not.toHaveBeenCalled();
  });

  it('should re-fetch on refresh()', () => {
    apiSpy.sweep.calls.reset();
    component.refresh();
    expect(apiSpy.sweep).toHaveBeenCalledTimes(1);
  });

  it('should set error state on API failure', () => {
    apiSpy.sweep.and.returnValue(throwError(() => new Error('Network error')));
    component.refresh();
    expect(component.error).not.toBeNull();
    expect(component.loading).toBeFalse();
  });

  it('should detect asymptote from response', () => {
    apiSpy.sweep.and.returnValue(of({
      ...mockResponse,
      asymptotes: [0.0812],
    }));
    component.refresh();
    expect(component.asymptoteX).toBe(0.0812);
  });
});
