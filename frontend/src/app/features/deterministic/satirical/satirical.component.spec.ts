import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SatiricalComponent } from './satirical.component';

describe('SatiricalComponent', () => {
  let fixture:   ComponentFixture<SatiricalComponent>;
  let component: SatiricalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SatiricalComponent],
    }).compileComponents();

    fixture   = TestBed.createComponent(SatiricalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have at least one satirical row', () => {
    expect(component.rows.length).toBeGreaterThan(0);
  });

  it('every row should have all required fields', () => {
    component.rows.forEach((row) => {
      expect(row.condition).toBeTruthy();
      expect(row.formula).toBeTruthy();
      expect(row.mathResult).toBeTruthy();
      expect(row.realityCheck).toBeTruthy();
      expect(row.paradox).toBeTruthy();
    });
  });

  it('should render a table row for each satirical condition', () => {
    const el: HTMLElement = fixture.nativeElement;
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(component.rows.length);
  });
});
