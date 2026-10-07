/** Una cancelación de cocina rompe el paquete completo; el remanente vuelve a precio individual. */
export function separarCombosCancelados<T extends { combo?: { instance: string } }>(lineas: T[], canceladas: { estado: string; commercial_component?: string | null }[]): { lines: T[]; changed: boolean } {
  const instancias = new Set(canceladas.filter(l => l.estado === 'CANCELADA' && l.commercial_component).map(l => JSON.parse(l.commercial_component!).instance));
  let changed = false;
  const lines = lineas.map(l => {
    if (!l.combo || !instancias.has(l.combo.instance)) return l;
    changed = true;
    return { ...l, combo: undefined };
  });
  return { lines, changed };
}
