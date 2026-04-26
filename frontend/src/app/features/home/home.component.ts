import { Component, ChangeDetectionStrategy, ChangeDetectorRef  } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector:    'app-home',
  standalone:  true,
  imports:     [RouterModule],
  templateUrl: './home.component.html',
  styleUrls:   ['./home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {}
