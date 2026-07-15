import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CatalogoItem, CatalogosService } from '../../services/catalogos.service';

@Component({
  selector: 'app-clave-sat-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clave-sat-picker.component.html',
  styleUrls: ['./clave-sat-picker.component.css']
})
export class ClaveSatPicker {
  @Input() catalog = 'SatProductCodes';   
  @Input() label = 'Clave SAT';
  @Input() placeholder = 'Escribe para buscar...';
  @Input() valor: string | null = null;   
  @Input() descripcion: string | null = null; 
  @Output() valorChange = new EventEmitter<string>();
  @Output() seleccionado = new EventEmitter<CatalogoItem>();

  termino = '';
  resultados: CatalogoItem[] = [];
  abierto = false;
  buscando = false;
  private debounce: any = null;

  constructor(private catalogos: CatalogosService) {}

  get textoMostrado(): string {
    if (this.valor && this.descripcion) return `${this.valor} - ${this.descripcion}`;
    if (this.valor) return this.valor;
    return '';
  }

  onInput(term: string) {
    this.termino = term;
    this.abierto = true;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.buscar(), 350);
  }

  async buscar() {
    if (this.termino.trim().length < 2) { this.resultados = []; return; }
    this.buscando = true;
    try {
      this.resultados = await this.catalogos.search(this.catalog, this.termino);
    } catch {
      this.resultados = [];
    } finally {
      this.buscando = false;
    }
  }

  elegir(item: CatalogoItem) {
    this.valor = item.code;
    this.descripcion = item.description;
    this.valorChange.emit(item.code);
    this.seleccionado.emit(item);
    this.abierto = false;
    this.termino = '';
    this.resultados = [];
  }

  abrir() {
    this.abierto = true;
    this.termino = '';
    this.resultados = [];
  }

  limpiar() {
    this.valor = null;
    this.descripcion = null;
    this.valorChange.emit('');
  }
}