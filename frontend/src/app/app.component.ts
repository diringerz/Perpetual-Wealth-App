import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopMenuComponent } from './features/top-menu/top-menu.component';

@Component({
  selector:    'app-rootaodsoij',
  standalone:  true,
  imports:     [RouterOutlet, TopMenuComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {}
