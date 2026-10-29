import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';
import { formatDate } from '@angular/common';
import { fechaDeSql, zonaDeSql } from './fechas';

/**
 * UNA FECHA DE LA BASE, CON LA HORA QUE TIENE EN LA BASE.
 *
 * Casi toda la base guarda HORA DE PARED: `GETDATE()`, `SYSDATETIME()`, o un
 * `DATE` sin hora. `mssql` lee ese valor como si fuera UTC: las 09:35 de la
 * caja llegan como 09:35Z. El pipe `date` lo pasa a la zona del equipo y en
 * Mexico (UTC-6) sale 03:35; un `DATE` -medianoche Z- sale como el dia
 * anterior. Asi se veia el «Abierto 02:14» del corte de un turno abierto a las
 * 08:14.
 *
 * `fechaSql` formatea en UTC, que es devolverle su hora de pared. Un texto sin
 * zona (lo que entrega `FOR JSON`: "2026-10-18T09:35:00") se trata igual. Un
 * texto CON zona ("...Z", "...-06:00", lo que manda la nube) ya es un instante
 * de verdad y sale en la hora del equipo, como con `date`.
 *
 *     {{ venta.datee | fechaSql:'dd/MM/yyyy HH:mm' }}
 *
 * CUANDO NO
 * ---------
 * Las columnas que se guardan en UTC (`DEFAULT SYSUTCDATETIME()`: sync,
 * dispositivos, licencia) y los instantes de JavaScript (`new Date()`, un ISO
 * con `Z`) ya son instantes de verdad: van con `date`, que los pasa bien a la
 * hora local. La regla es la columna, no la pantalla: mira su DEFAULT en
 * sql/schema/tables o con que reloj la escribe su procedure.
 */
@Pipe({ name: 'fechaSql', standalone: true })
export class FechaSqlPipe implements PipeTransform {
  private readonly localeApp = inject(LOCALE_ID);

  transform(valor: unknown, formato = 'dd/MM/yyyy HH:mm', locale?: string): string | null {
    const d = fechaDeSql(valor);
    return d ? formatDate(d, formato, locale || this.localeApp, zonaDeSql(valor)) : null;
  }
}
