// ════════════════════════════════════════════
//  ADMINAPP · Lo que se lee cuando un control está apagado por permiso
//
//  ── Por qué esto es una función y no una frase escrita en cada pantalla ──
//
//  Estaba escrita a mano en dieciocho lugares, y ya había divergido: el
//  comparador decía «Te falta el permiso «X». Pediselo a quien administra la
//  empresa» —copiado del mensaje del servidor— y los otros diecisiete decían
//  «Necesitás el permiso «X»». Dos formas de decir lo mismo en la misma sesión
//  se leen como dos cosas distintas, y la persona empieza a buscar la diferencia
//  que no existe.
//
//  Diecinueve copias no se mantienen iguales: se mantiene una.
//
//  ── Por qué NOMBRA el permiso ──
//
//  Porque el usuario no puede pedir lo que no puede nombrar. «No tenés permiso
//  para esto» deja a alguien parado con el formulario completo y sin nada
//  concreto que decirle a quien administra la empresa; «necesitás el permiso
//  proveedores.editar» se reenvía por mensaje y se resuelve en un minuto.
//
//  ── Y por qué esto va en el `title` de un control DESHABILITADO ──
//
//  Porque la regla del sistema es apagar con el motivo, y no esconder. Un botón
//  que desaparece deja a la persona buscando algo que el texto de al lado le
//  está pidiendo que apriete.
//
//  ⚠ El control apagado **no** puede llevar `disabled:pointer-events-none`: eso
//  lo saca del hit-testing y el navegador nunca muestra el `title`, o sea que
//  apaga justamente la explicación. Está en `components/TablaGrid.jsx` y en
//  `docs/REGLAS-DISENO.md`.
// ════════════════════════════════════════════

/**
 * El motivo por el que un control está apagado, para poner en su `title`.
 *
 * @param {string} codigo El permiso que falta, tal como lo pide el servidor.
 */
export function faltaElPermiso(codigo) {
  return `Necesitás el permiso «${codigo}»`;
}
