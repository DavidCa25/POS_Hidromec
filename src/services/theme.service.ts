import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly KEY = 'inv-main-color';
  private readonly DARK_KEY = 'ui-dark';
  private invMain$ = new BehaviorSubject<string>(this.load());
  private dark$ = new BehaviorSubject<boolean>(this.loadDark());

  constructor() {
    this.apply(this.invMain$.value);
    this.applyDark(this.dark$.value);
  }

  setInvMain(color: string) {
    localStorage.setItem(this.KEY, color);
    this.invMain$.next(color);
    this.apply(color);
  }

  getInvMainSnapshot() {
    return this.invMain$.value;
  }

  // ---------- Modo oscuro ----------
  getDark$() { return this.dark$.asObservable(); }
  isDark(): boolean { return this.dark$.value; }
  toggleDark() { this.setDark(!this.dark$.value); }
  setDark(on: boolean) {
    localStorage.setItem(this.DARK_KEY, on ? '1' : '0');
    this.dark$.next(on);
    this.applyDark(on);
  }

  private load() {
    return localStorage.getItem(this.KEY) || '#1f2e86';
  }
  private loadDark(): boolean {
    return localStorage.getItem(this.DARK_KEY) === '1';
  }

  private apply(color: string) {
    document.documentElement.style.setProperty('--inv-main', color);
  }
  private applyDark(on: boolean) {
    document.documentElement.classList.toggle('dark', on);
  }
}
