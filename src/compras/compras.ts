import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-compras',
  templateUrl: './compras.html',
  imports: [RouterOutlet, FormsModule],
  styleUrls: ['./compras.css']
})
export class Compras {
  menuOpen = true;

  toggleMenu() {
    this.menuOpen = !this.menuOpen;
  }
}
