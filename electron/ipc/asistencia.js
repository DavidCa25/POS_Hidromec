/*
 * ASISTENCIA (0071): entradas, descansos y salidas; horas trabajadas y extra.
 *
 *   asistencia:estado           como esta quien tiene la sesion (para Checar)
 *   asistencia:marcar           su marca: ENTRADA, INICIO_DESCANSO, FIN_DESCANSO, SALIDA
 *   asistencia:mis-horas        sus horas de un rango
 *   asistencia:reglas           las reglas del negocio
 *   asistencia:activar          contestar las preguntas y encender la aplicacion
 *   asistencia:reglas-guardar   cambiar las respuestas despues
 *   asistencia:resumen          la tabla: persona x dia
 *   asistencia:jornadas         el detalle de una persona
 *   asistencia:corregir         un encargado corrige o registra una jornada
 *   asistencia:horario          el horario de una persona (o de todas)
 *   asistencia:horario-guardar  guardarlo
 *
 * Checar es de la persona con la sesion abierta: su id sale de la sesion,
 * nunca del payload. Por eso no hay PIN: quien entro a la caja es quien
 * checa. Las reglas y el calculo viven en SQL.
 */
const sesion = require("../seguridad/sesion");

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS = ["ENTRADA", "INICIO_DESCANSO", "FIN_DESCANSO", "SALIDA"];
/* mssql entrega la hora de pared como si fuera UTC: su ISO sin zona es la
   hora que guardo la base (ver fechaSql en el renderer). */
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 19) : v);
const limpia = (fila) => Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, iso(v)]));
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const bit = (v) => (v === true || v === 1 || v === "1" ? 1 : 0);
const fecha = (v, campo) => {
  const s = String(v ?? "").slice(0, 10);
  if (!FECHA.test(s)) throw Error(`Indica una fecha valida (${campo}).`);
  return s;
};
/* Una hora de pared que escribe el encargado ("2026-10-29T16:40"): se manda
   como UTC para que mssql la guarde tal cual (ver horaParedLocal). */
const pared = (v, campo) => {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) throw Error(`Indica una hora valida (${campo}).`);
  return new Date(s.length === 16 ? `${s}:00Z` : `${s}Z`);
};
/* `sesion.proteger` agrega la sesion como ULTIMO argumento. Si el renderer no
   mando payload (asistencia:estado, asistencia:reglas), la sesion es el UNICO
   argumento: tomarla por payload dejaba a Checar sin saber quien es. */
function argumentos(args) {
  const ses = args.length ? args[args.length - 1] : null;
  const p = args.length > 1 && args[0] && typeof args[0] === "object" ? args[0] : {};
  return { p, quien: Number(ses?.userId) || null };
}

function registrar({ ipcMain, sql, poolPromise }) {
  /* Cada canal se escribe con su nombre literal en `ipcMain.handle` y en
     `sesion.proteger`: las pruebas de seguridad lo leen del fuente. */
  const ejecutar = (nombre, construir, formar = (r) => (r.recordset ?? []).map(limpia)) =>
    async (_e, ...args) => {
      const { p, quien } = argumentos(args);
      try {
        const req = (await poolPromise).request();
        construir(req, p, quien);
        const r = await req.execute(nombre);
        return { success: true, data: formar(r) };
      } catch (e) {
        const msg = String(e.message || e);
        console.error(`[ASISTENCIA] ${nombre}:`, msg);
        return { success: false, error: msg };
      }
    };
  const primera = (r) => (r.recordset?.[0] ? limpia(r.recordset[0]) : null);
  const reglas = (req, p, quien) => req
    .input("cuenta_extra", sql.Bit, bit(p.cuentaExtra))
    .input("tolerancia", sql.Bit, bit(p.tolerancia))
    .input("descanso_pagado", sql.Bit, bit(p.descansoPagado))
    .input("dia_libre_extra", sql.Bit, bit(p.diaLibreExtra))
    .input("marca_retardos", sql.Bit, bit(p.marcaRetardos))
    .input("entrada_para_vender", sql.Bit, bit(p.entradaParaVender))
    .input("user_id", sql.Int, quien);
  const resumen = (r) => ({
    dias: (r.recordsets?.[0] ?? []).map(limpia),
    personas: (r.recordsets?.[1] ?? []).map(limpia),
    horarios: (r.recordsets?.[2] ?? []).map(limpia),
  });

  ipcMain.handle("asistencia:estado", sesion.proteger("asistencia:estado", ejecutar("sp_asistencia_estado",
    (req, _p, quien) => req.input("user_id", sql.Int, quien), primera)));

  ipcMain.handle("asistencia:marcar", sesion.proteger("asistencia:marcar", ejecutar("sp_asistencia_marcar", (req, p, quien) => {
    const tipo = String(p.tipo || "").toUpperCase();
    if (!TIPOS.includes(tipo)) throw Error("Marca no valida.");
    req.input("user_id", sql.Int, quien).input("tipo", sql.VarChar(16), tipo)
      .input("register_id", sql.Int, num(p.registerId));
  }, primera)));

  ipcMain.handle("asistencia:mis-horas", sesion.proteger("asistencia:mis-horas", ejecutar("sp_asistencia_resumen",
    (req, p, quien) => req.input("desde", sql.Date, fecha(p.desde, "desde")).input("hasta", sql.Date, fecha(p.hasta, "hasta"))
      .input("persona_id", sql.Int, quien), resumen)));

  ipcMain.handle("asistencia:reglas", sesion.proteger("asistencia:reglas", ejecutar("sp_asistencia_reglas_get", () => {}, primera)));

  ipcMain.handle("asistencia:activar", sesion.proteger("asistencia:activar", ejecutar("sp_asistencia_reglas_guardar",
    (req, p, quien) => reglas(req, p, quien).input("activar", sql.Bit, 1), primera)));

  ipcMain.handle("asistencia:reglas-guardar", sesion.proteger("asistencia:reglas-guardar", ejecutar("sp_asistencia_reglas_guardar",
    (req, p, quien) => reglas(req, p, quien).input("activar", sql.Bit, 0), primera)));

  ipcMain.handle("asistencia:resumen", sesion.proteger("asistencia:resumen", ejecutar("sp_asistencia_resumen",
    (req, p) => req.input("desde", sql.Date, fecha(p.desde, "desde")).input("hasta", sql.Date, fecha(p.hasta, "hasta"))
      .input("persona_id", sql.Int, num(p.personaId)), resumen)));

  ipcMain.handle("asistencia:jornadas", sesion.proteger("asistencia:jornadas", ejecutar("sp_asistencia_jornadas", (req, p) => {
    const persona = num(p.personaId);
    if (!persona) throw Error("Falta la persona.");
    req.input("persona_id", sql.Int, persona).input("desde", sql.Date, fecha(p.desde, "desde")).input("hasta", sql.Date, fecha(p.hasta, "hasta"));
  }, (r) => ({
    jornadas: (r.recordsets?.[0] ?? []).map(limpia),
    descansos: (r.recordsets?.[1] ?? []).map(limpia),
    correcciones: (r.recordsets?.[2] ?? []).map(limpia),
  }))));

  ipcMain.handle("asistencia:corregir", sesion.proteger("asistencia:corregir", ejecutar("sp_asistencia_corregir", (req, p, quien) => {
    req.input("jornada_id", sql.Int, num(p.jornadaId))
      .input("persona_id", sql.Int, num(p.personaId))
      .input("entrada", sql.DateTime2(0), pared(p.entrada, "entrada"))
      .input("salida", sql.DateTime2(0), pared(p.salida, "salida"))
      .input("motivo", sql.NVarChar(255), String(p.motivo ?? "").slice(0, 255))
      .input("user_id", sql.Int, quien);
  }, primera)));

  ipcMain.handle("asistencia:horario", sesion.proteger("asistencia:horario", ejecutar("sp_asistencia_horario_get",
    (req, p) => req.input("persona_id", sql.Int, num(p.personaId)))));

  ipcMain.handle("asistencia:horario-guardar", sesion.proteger("asistencia:horario-guardar", ejecutar("sp_asistencia_horario_guardar", (req, p, quien) => {
    const persona = num(p.personaId);
    if (!persona) throw Error("Falta la persona.");
    const dias = (Array.isArray(p.dias) ? p.dias : []).slice(0, 7).map((d) => ({
      weekday: num(d.weekday), entrada: String(d.entrada ?? "").slice(0, 5),
      salida: String(d.salida ?? "").slice(0, 5), descanso_min: num(d.descansoMin) ?? 0,
    }));
    req.input("persona_id", sql.Int, persona).input("dias", sql.NVarChar(sql.MAX), JSON.stringify(dias))
      .input("user_id", sql.Int, quien);
  })));
}

/**
 * ¿La regla «hay que checar entrada antes de vender» frena esta venta?
 *
 * La llama el canal de cobro antes de registrar la venta. Devuelve el mensaje
 * para la caja, o null si puede cobrar. Si Asistencia no esta activada, o la
 * base no tiene la aplicacion, no frena nada: una falla aqui nunca debe
 * impedir vender.
 */
async function frenaLaVenta(pool, sql, userId) {
  try {
    if (!userId) return null;
    const r = await pool.request().input("user_id", sql.Int, userId).execute("sp_asistencia_estado");
    const e = r.recordset?.[0];
    if (!e || !e.activa || !e.entrada_para_vender || e.jornada_id) return null;
    return "Checa tu entrada antes de cobrar.";
  } catch {
    return null;
  }
}

module.exports = { registrar, frenaLaVenta, argumentos };
