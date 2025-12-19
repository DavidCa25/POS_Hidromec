import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly KEY = 'inv-main-color';
  private invMain$ = new BehaviorSubject<string>(this.load());

  constructor() {
    this.apply(this.invMain$.value);
  }

  setInvMain(color: string) {
    localStorage.setItem(this.KEY, color);
    this.invMain$.next(color);
    this.apply(color);
  }

  getInvMainSnapshot() {
    return this.invMain$.value;
  }

  private load() {
    return localStorage.getItem(this.KEY) || '#1f2e86';
  }

  private apply(color: string) {
    document.documentElement.style.setProperty('--inv-main', color);
  }
}
