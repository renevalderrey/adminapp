// ════════════════════════════════════════════
//  FAVALIO · Cuánto espera un buscador antes de preguntarle al servidor
//
//  ── Por qué es una sola constante ──
//
//  Había cuatro, escritas por separado: 250 ms en Proveedores, 250 en Órdenes
//  de compra, 300 en TiendaNube y 350 en Historial de ventas. Ninguna estaba
//  mal —las cuatro hacen lo mismo— pero **las cuatro pantallas se sienten
//  distinto**, y eso no se nota mirando una: se nota al pasar de una a otra,
//  que es lo que hace alguien que usa el sistema todo el día.
//
//  Un buscador que responde a distinta velocidad según la pantalla se lee como
//  que unas están más pesadas que otras.
//
//  ── Por qué 300 y no 250 ni 350 ──
//
//  Con 250 el pedido sale mientras la persona todavía está tipeando la palabra:
//  se gastan consultas que nadie va a mirar, y en el `iLike '%…%'` del historial
//  de ventas cada una barre la tabla. Con 350 se siente la demora: escribir y
//  esperar más de un tercio de segundo con la lista vieja a la vista se lee como
//  que el sistema se colgó.
//
//  ⚠ **Inventario NO usa esto, y es correcto.** Filtra en el navegador sobre lo
//  que ya tiene cargado, así que no hay pedido que rebotar y esperar 300 ms
//  sería demora pura. La regla es de los buscadores que preguntan al servidor.
// ════════════════════════════════════════════

/** Cuánto se espera después de la última tecla antes de consultar. */
export const ESPERA_DE_BUSQUEDA = 300
