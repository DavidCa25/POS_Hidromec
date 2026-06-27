import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ConfigDrawerService {
  private _close = new Subject<void>();
  readonly close$ = this._close.asObservable();

  requestClose() {
    this._close.next();
  }
}
