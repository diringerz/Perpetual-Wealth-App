import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { HomeComponent } from './home.component';

describe('HomeComponent', () => {
  let fixture:   ComponentFixture<HomeComponent>;
  let component: HomeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeComponent, RouterTestingModule],
    }).compileComponents();

    fixture   = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the app title', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h1')?.textContent).toContain('Perpetual Wealth');
  });

  it('should render links to both modes', () => {
    const el: HTMLElement = fixture.nativeElement;
    const links = el.querySelectorAll('a[routerLink]');
    const hrefs = Array.from(links).map((l) => l.getAttribute('routerLink'));
    expect(hrefs).toContain('/deterministic');
    expect(hrefs).toContain('/stochastic');
  });
});
