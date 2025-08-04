import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-cajon',
  templateUrl: './cajon.html',
  imports: [RouterOutlet, FormsModule],
  styleUrls: ['./cajon.css']
})
export class Cajon {
//   menuOpen = true;

//   toggleMenu() {
//     this.menuOpen = !this.menuOpen;
//   }
}
