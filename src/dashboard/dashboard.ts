import { Component, HostListener  } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgClass, NgIf } from '@angular/common';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  imports: [RouterOutlet, FormsModule, RouterLink, RouterLinkActive, NgClass, NgIf],
  styleUrls: ['./dashboard.css']
})
export class Dashboard {
  menuOpen = true;
  isMobile = false;
  showOverlay = false;
  isOperacionesOpen = false;

  @HostListener('window:resize')
  onResize() {
    this.isMobile = window.innerWidth < 900;
    this.menuOpen = !this.isMobile; // abierto en desktop, cerrado en mobile por default
    this.showOverlay = this.isMobile && this.menuOpen;
  }
  ngOnInit() { this.onResize(); }
  toggleMenu() {
    this.menuOpen = !this.menuOpen;
    this.showOverlay = this.isMobile && this.menuOpen;
  }

  
  toggleOperaciones() {
    this.isOperacionesOpen = !this.isOperacionesOpen;
  }

  @HostListener('document:click', ['$event'])
  handleClickOutside(event: Event) {
    const dropdown = document.getElementById('operaciones-dropdown');
    if (!dropdown) return;
    if (!dropdown.contains(event.target as Node)) {
      this.isOperacionesOpen = false;
    }
  }

}
