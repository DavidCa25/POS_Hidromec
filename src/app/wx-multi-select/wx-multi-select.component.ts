import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WxOpcion } from '../wx-select/wx-select.component';
@Component({
  selector: 'wx-multi-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './wx-multi-select.component.html',
  styleUrls: ['./wx-multi-select.component.css'],
})
export class WxMultiSelectComponent {
  @Input() opciones: WxOpcion[] = [];
  @Input() values: string[] | undefined = [];
  @Input() etiqueta = 'Productos';
  @Input() placeholder = 'Agregar selección';
  @Input() disabled = false;
  @Output() valuesChange = new EventEmitter<string[]>();
  @ViewChild('search') search?: ElementRef<HTMLInputElement>;
  @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('panel') panel?: ElementRef<HTMLElement>;
  readonly id = 'wxmulti-' + crypto.randomUUID();
  readonly anchor = '--' + this.id;
  filter = '';
  open = false;
  get selected() {
    return (this.values ?? []).map(
      (v) =>
        this.opciones.find((o) => o.valor === v) ?? {
          valor: v,
          etiqueta: 'Selección no disponible',
        },
    );
  }
  get visible() {
    const q = this.filter
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return this.opciones.filter((o) =>
      (o.etiqueta + ' ' + (o.nota ?? '') + ' ' + (o.busca ?? ''))
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes(q),
    );
  }
  toggle(value: string) {
    if (this.disabled) return;
    const next = new Set(this.values ?? []);
    next.has(value) ? next.delete(value) : next.add(value);
    this.valuesChange.emit([...next]);
  }
  trackOption(_index: number, option: WxOpcion) {
    return option.valor;
  }
  onToggle(e: Event) {
    this.open = (e as ToggleEvent).newState === 'open';
    if (this.open) {
      this.filter = '';
      setTimeout(() => {
        if (this.open) this.search?.nativeElement.focus();
      });
    }
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.panel?.nativeElement.hidePopover();
    setTimeout(() => this.trigger?.nativeElement.focus());
  }
}
