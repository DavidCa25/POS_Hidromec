import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
@Component({
  selector: 'app-receipt-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `<dialog #dialog class="wx-dialogo receipt" (cancel)="close.emit()">
    <header>
      <h3>
        {{ document === 'closure' ? 'Corte de caja' : 'Ticket de venta' }} · #{{
          id
        }}
      </h3>
    </header>
    <p *ngIf="error" role="alert">{{ error }}</p>
    <div class="receipt-paper">
      <iframe
        *ngIf="html"
        sandbox=""
        title="Vista previa antes de imprimir"
        [srcdoc]="html"
        [style.width.mm]="width"
        [style.height.mm]="height || 200"
      ></iframe>
    </div>
    <footer>
      <button type="button" class="btn btn-light" (click)="close.emit()">
        Cerrar</button
      ><button
        type="button"
        class="btn btn-primary"
        [disabled]="busy || !html"
        (click)="print()"
      >
        <i class="ph ph-printer"></i>Imprimir
      </button>
    </footer>
  </dialog>`,
  styles: [
    `
      .receipt {
        padding: 20px;
        width: min(680px, 95vw);
        max-height: 92vh;
      }
      .receipt::backdrop {
        background: var(--wx-dialogo-velo);
      }
      header,
      footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      footer {
        justify-content: flex-end;
        margin-top: 12px;
      }
      .receipt-paper {
        background: var(--wx-raised);
        max-height: 68vh;
        overflow: auto;
        padding: 16px;
      }
      iframe {
        display: block;
        border: 0;
        max-width: 100%;
        margin: auto;
        background: white;
      }
    `,
  ],
})
export class ReceiptViewer implements OnInit, AfterViewInit, OnDestroy {
  @Input() id!: number;
  @Input() document: 'sale' | 'closure' = 'sale';
  @Output() close = new EventEmitter<void>();
  @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;
  html: SafeHtml = '';
  width = 80;
  height = 0;
  busy = false;
  error = '';
  private sanitizer = inject(DomSanitizer);
  private get api() {
    return (window as any).electronAPI;
  }
  ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
  }
  ngOnDestroy() {
    this.dialog?.nativeElement.close();
  }
  async ngOnInit() {
    try {
      const r = await this.api.ticketPreview({
        document: this.document,
        id: this.id,
      });
      if (!r?.success) throw Error(r?.error || 'No se pudo cargar.');
      this.html = this.sanitizer.bypassSecurityTrustHtml(r.data.html);
      this.width = r.data.profile.width;
      this.height = r.data.profile.height;
    } catch (e: any) {
      this.error = e.message;
    }
  }
  async print() {
    this.busy = true;
    this.error = '';
    try {
      const r = await this.api.ticketPrintDocument({
        document: this.document,
        id: this.id,
      });
      if (!r?.success) throw Error(r?.error || 'No se pudo imprimir.');
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.busy = false;
    }
  }
}
