import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TopMenuComponent } from './top-menu.component';

describe('TopMenuComponent', () => {
  let fixture:   ComponentFixture<TopMenuComponent>;
  let component: TopMenuComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopMenuComponent, RouterTestingModule],
    }).compileComponents();

    fixture   = TestBed.createComponent(TopMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have two top-level nav items', () => {
    expect(component.navItems.length).toBe(2);
  });

  it('deterministic nav item should have 6 children', () => {
    const det = component.navItems.find((n) => n.label === 'Deterministic');
    expect(det?.children.length).toBe(6);
  });

  it('toggleMenu should open a menu', () => {
    component.toggleMenu('Deterministic');
    expect(component.openMenu).toBe('Deterministic');
  });

  it('toggleMenu called twice should close the menu', () => {
    component.toggleMenu('Deterministic');
    component.toggleMenu('Deterministic');
    expect(component.openMenu).toBeNull();
  });

  it('closeMenu should set openMenu to null', () => {
    component.openMenu = 'Stochastic';
    component.closeMenu();
    expect(component.openMenu).toBeNull();
  });
});
