import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { ModeHomeComponent } from './mode-home.component';

describe('ModeHomeComponent', () => {
  function createFixture(mode: string): ComponentFixture<ModeHomeComponent> {
    TestBed.configureTestingModule({
      imports: [ModeHomeComponent, RouterTestingModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { mode } } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ModeHomeComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('should create for deterministic mode', () => {
    const f = createFixture('deterministic');
    expect(f.componentInstance).toBeTruthy();
  });

  it('should show deterministic title', () => {
    const f   = createFixture('deterministic');
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('h1')?.textContent).toContain('Deterministic');
  });

  it('should not show coming-soon badge for deterministic', () => {
    const f  = createFixture('deterministic');
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.coming-soon-badge')).toBeNull();
  });

  it('should show coming-soon badge for stochastic', () => {
    const f  = createFixture('stochastic');
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.coming-soon-badge')).not.toBeNull();
  });

  it('should render tier links for deterministic', () => {
    const f   = createFixture('deterministic');
    const el: HTMLElement = f.nativeElement;
    const links = el.querySelectorAll('.link-card');
    expect(links.length).toBeGreaterThan(0);
  });

  it('should render no links for stochastic', () => {
    const f   = createFixture('stochastic');
    const el: HTMLElement = f.nativeElement;
    const section = el.querySelector('.mode-links');
    expect(section).toBeNull();
  });
});
