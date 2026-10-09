import {
  Component,
  Input,
  Output,
  EventEmitter,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
@Component({
  selector: 'app-receipt-email',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `<dialog #dialog class="wx-dialogo email" (cancel)="close.emit()">
    <header>
      <h3>Enviar ticket por correo</h3>
    </header>
    <p>Venta #{{ saleId }} · se adjuntará su PDF.</p>
    <label
      >Correo del cliente<input
        type="email"
        class="form-control"
        [(ngModel)]="email"
        maxlength="254"
        [disabled]="busy"
        autocomplete="email"
        (keydown.enter)="send()"
    /></label>
    <p role="status" *ngIf="sent">
      El proveedor aceptó el correo. La entrega depende del destinatario.
    </p>
    <p role="alert" *ngIf="error">
      {{ error }} Puedes reintentar sin volver a cobrar.
    </p>
    <footer>
      <button
        type="button"
        class="btn btn-light"
        [disabled]="busy"
        (click)="close.emit()"
      >
        Cerrar</button
      ><button
        type="button"
        class="btn btn-primary"
        [disabled]="busy || sent"
        (click)="send()"
      >
        {{ busy ? 'Enviando…' : 'Enviar PDF' }}
      </button>
    </footer>
  </dialog>`,
  styles: [
    `
      .email {
        width: min(460px, 92vw);
        padding: 24px;
      }
      .email::backdrop {
        background: var(--wx-dialogo-velo);
      }
      header,
      footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      footer {
        margin-top: 20px;
        justify-content: flex-end;
      }
      label {
        display: block;
      }
      input {
        margin-top: 8px;
      }
    `,
  ],
})
export class ReceiptEmail implements AfterViewInit, OnDestroy {
  @Input() saleId!: number;
  @Input() email = '';
  @Output() close = new EventEmitter<void>();
  @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;
  busy = false;
  sent = false;
  error = '';
  ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
  }
  ngOnDestroy() {
    this.dialog?.nativeElement.close();
  }
  async send() {
    if (this.busy || this.sent) return;
    if (!/^\S+@\S+\.\S+$/.test(this.email)) {
      this.error = 'Indica un correo válido.';
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      const r = await (window as any).electronAPI.ticketEmail({
        saleId: this.saleId,
        email: this.email,
      });
      if (!r?.success) throw Error(r?.error || 'No se confirmó el envío.');
      this.sent = true;
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.busy = false;
    }
  }
}
