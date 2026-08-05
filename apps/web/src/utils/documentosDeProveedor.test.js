import { describe, it, expect } from 'vitest'
import { TIPOS, nubeDelEnlace, esEnlaceAceptable } from './documentosDeProveedor'

// ════════════════════════════════════════════
//  Los documentos de un proveedor: qué enlace entra y de qué nube salió
//
//  Los dos defectos que estos tests atajan tiran para lados opuestos, y por eso
//  van juntos en el mismo archivo:
//
//  · **Demasiado flojo**: se guarda cualquier cosa que se haya escrito en el
//    campo. El documento queda cargado, el aviso de «sin factura» del proveedor
//    se apaga (FR-086), y el respaldo no existe. Se descubre cuando alguien
//    busca la factura, meses después, y encuentra el texto «factura enero.pdf»
//    donde tendría que haber un enlace.
//
//  · **Demasiado estricto**: la lista de nubes se convierte en lista blanca y
//    quien guarda las facturas en Box, en un WeTransfer o en el servidor de la
//    contadora no puede cargar ninguna. Ahí el aviso de «sin factura» queda
//    encendido para siempre, y un aviso que no se puede apagar deja de mirarse.
//
//  La spec resolvió el caso de borde de forma explícita: «Se acepta si empieza
//  con `http` y se etiqueta otro».
// ════════════════════════════════════════════

describe('esEnlaceAceptable · lo único que se puede verificar sin salir del navegador', () => {
  it('un enlace sin http NO se acepta', () => {
    // El error real no es escribir mal la URL: es pegar en el campo del enlace
    // lo que se tenía en el portapapeles, que casi siempre es el nombre del
    // archivo. Sin esta validación la llamada sale, el servidor la guarda —la
    // columna es un TEXT sin validación— y el proveedor queda con un
    // «documento» que no lleva a ningún lado.
    expect(esEnlaceAceptable('Factura 0001-00043212.pdf')).toBe(false)
    expect(esEnlaceAceptable('drive.google.com/file/d/1a2b3c/view')).toBe(false)
    expect(esEnlaceAceptable('www.dropbox.com/s/abc/factura.pdf')).toBe(false)
    expect(esEnlaceAceptable('ftp://servidor.interno/facturas/enero.pdf')).toBe(false)

    // Y el que sí empieza con http entra, con las dos variantes del esquema:
    // rechazarlas sería el mismo bug al revés.
    expect(esEnlaceAceptable('https://drive.google.com/file/d/1a2b3c/view')).toBe(true)
    expect(esEnlaceAceptable('http://drive.google.com/file/d/1a2b3c/view')).toBe(true)
  })

  it('un enlace con espacios o vacío tampoco', () => {
    // Un espacio en el medio es un enlace CORTADO: el chat lo partió en dos y
    // se pegó la primera mitad más una palabra suelta. Abre en una página de
    // error, pero el aviso de «sin factura» se apaga igual.
    expect(esEnlaceAceptable('https://drive.google.com/file/d/1a2b factura.pdf')).toBe(false)
    expect(esEnlaceAceptable('https://drive.google.com/file\nd/1a2b')).toBe(false)

    // Vacío, todo espacios, y lo que ni siquiera es texto: el campo puede
    // llegar en `null` desde un documento viejo sin `url` —la columna permite
    // nulos (`models/Supplier.js`)— y esto no puede tirar.
    expect(esEnlaceAceptable('')).toBe(false)
    expect(esEnlaceAceptable('     ')).toBe(false)
    expect(esEnlaceAceptable(null)).toBe(false)
    expect(esEnlaceAceptable(undefined)).toBe(false)

    // Los espacios de los BORDES no cuentan: pegar desde WhatsApp arrastra un
    // salto de línea al final y rechazar eso es hacer perder el tiempo por algo
    // que se arregla solo. Quien guarda manda `url.trim()`.
    expect(esEnlaceAceptable('  https://drive.google.com/file/d/1a2b3c/view\n')).toBe(true)
  })
})

describe('nubeDelEnlace · de dónde salió el documento, y por qué la lista no es una lista blanca', () => {
  it('reconoce las tres nubes y etiqueta el resto como otro', () => {
    expect(nubeDelEnlace('https://drive.google.com/file/d/1a2b3c/view').etiqueta).toBe(
      'Google Drive'
    )
    expect(nubeDelEnlace('https://docs.google.com/spreadsheets/d/1a2b3c/edit').etiqueta).toBe(
      'Google Drive'
    )
    expect(nubeDelEnlace('https://www.dropbox.com/s/abc/factura.pdf').etiqueta).toBe('Dropbox')
    expect(nubeDelEnlace('https://1drv.ms/b/s!AabbCc').etiqueta).toBe('OneDrive')
    expect(nubeDelEnlace('https://comprafit-my.sharepoint.com/personal/x/factura.pdf').etiqueta)
      .toBe('OneDrive')

    // El legacy miraba el enlace ENTERO con `includes('dropbox')`
    // (`legacy:8190-8193`), así que cualquier cosa que nombrara la nube más
    // adelante —una carpeta, un parámetro de redirección— quedaba etiquetada
    // con ella. La etiqueta sale del host y de ningún otro lado: es el único
    // lugar de una URL donde el dominio dice de quién es el archivo.
    expect(nubeDelEnlace('https://mi-servidor.com/backup/dropbox.com/factura.pdf').codigo).toBe(
      'otro'
    )
    expect(nubeDelEnlace('https://acortador.ar/r?to=https://drive.google.com/x').codigo).toBe(
      'otro'
    )
    expect(nubeDelEnlace('https://mi-servidor.com/dropbox/factura.pdf').codigo).toBe('otro')

    // Y lo que no se puede leer como enlace tampoco puede romper la fila: el
    // documento se dibuja igual, con la etiqueta neutra.
    expect(nubeDelEnlace('no soy un enlace').codigo).toBe('otro')
    expect(nubeDelEnlace(null).codigo).toBe('otro')
  })

  it('un enlace de una nube desconocida se acepta igual', () => {
    // Este es el caso de borde de la spec, y lo que impide que alguien
    // convierta las tres nubes en una lista blanca: quien guarda las facturas
    // en Box o en el servidor de la contadora tiene que poder cargarlas, o el
    // aviso de «sin factura» le queda encendido para siempre.
    const ajenos = [
      'https://app.box.com/s/abc123',
      'https://we.tl/t-abc123',
      'https://facturas.estudio-contable.com.ar/2026/01/0001-00043212.pdf',
    ]

    for (const enlace of ajenos) {
      expect(esEnlaceAceptable(enlace)).toBe(true)
      expect(nubeDelEnlace(enlace).codigo).toBe('otro')
    }
  })
})

describe('TIPOS · los cuatro del modelo', () => {
  it('el tipo que el formulario deja elegido es el defaultValue de la columna', () => {
    // `SupplierDocument.type` tiene `defaultValue: 'factura'`
    // (`apps/api/src/models/Supplier.js:163`). Si el primero de la lista fuera
    // otro, el formulario mostraría «Presupuesto» y guardaría «presupuesto»
    // sobre lo que casi siempre es una factura, sin que nada falle.
    expect(TIPOS.map((t) => t.codigo)).toEqual(['factura', 'remito', 'presupuesto', 'otro'])
  })
})
