import QRCode from 'qrcode';
import { urlDelQr, nombreComprobante, normalizarLinea } from './comprobanteAfip';

// ════════════════════════════════════════════
//  Comprobante impreso
//
//  Desde abril de 2021 (RG 4892/2020) todo comprobante electrónico tiene que
//  llevar impreso un código QR. La versión anterior no lo incluía, con lo cual
//  los comprobantes que emitía el sistema no cumplían la resolución.
//
//  También faltaban datos del emisor que la RG 1415 exige en el encabezado:
//  CUIT, domicilio y condición frente al IVA.
// ════════════════════════════════════════════

const escapar = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pesos = (n) =>
  Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Imprime un comprobante.
 *
 * @param {object} data
 * @param {object} [data.empresa] Datos fiscales del emisor: name, cuit,
 *   address, tax_condition. Sin ellos el comprobante sale incompleto.
 */
export const printInvoice = async (data) => {
  const empresa = data.empresa || {};
  const companyName = data.companyName || data.empresaNombre || empresa.name || 'Mi Empresa';

  const esInterno = !!data.isInternal;

  const titulo = esInterno
    ? data.typeStr
    : nombreComprobante(data.type);

  const nroString = esInterno
    ? 'Comprobante interno'
    : `Nro: ${String(data.pointOfSale).padStart(5, '0')} - ${String(data.voucherNumber).padStart(8, '0')}`;

  const lineas = (data.items || []).map(normalizarLinea);

  // ── QR de ARCA ──
  // Solo para comprobantes fiscales. Si falta algún dato obligatorio,
  // urlDelQr devuelve null y no se imprime nada: es preferible a imprimir un
  // QR que ARCA rechace al escanearlo.
  let qrDataUrl = null;

  if (!esInterno) {
    const url = urlDelQr({
      fecha: data.fechaIso || data.date,
      cuitEmisor: empresa.cuit,
      puntoDeVenta: data.pointOfSale,
      tipoComprobante: data.type,
      numeroComprobante: data.voucherNumber,
      importe: data.total,
      documentoReceptor: data.customer,
      cae: data.cae,
    });

    if (url) {
      try {
        qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 160 });
      } catch {
        // Si falla la generación del QR, el comprobante se imprime igual: es
        // peor no entregar nada al cliente.
        qrDataUrl = null;
      }
    }
  }

  const datosEmisor = [
    empresa.cuit ? `CUIT: ${escapar(empresa.cuit)}` : null,
    empresa.address ? escapar(empresa.address) : null,
    empresa.tax_condition ? `Cond. IVA: ${escapar(empresa.tax_condition)}` : null,
  ].filter(Boolean);

  const pieFiscal = esInterno
    ? '<p><strong>Documento no válido como factura</strong></p>'
    : [
        `<p>CAE: ${escapar(data.cae)}</p>`,
        `<p>Vto. CAE: ${escapar(data.expiration)}</p>`,
        qrDataUrl
          ? `<img class="qr" src="${qrDataUrl}" alt="Código QR AFIP" />`
          : '<p class="alerta">Sin código QR: faltan datos fiscales del emisor</p>',
      ].join('');

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <html>
      <head>
        <title>Comprobante</title>
        <style>
          body { font-family: 'Courier New', Courier, monospace; padding: 20px; font-size: 13px; max-width: 400px; margin: auto; }
          .header { text-align: center; margin-bottom: 16px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
          .header h2 { margin: 0 0 4px; }
          .emisor { font-size: 11px; line-height: 1.4; margin: 6px 0 0; }
          .item { display: flex; justify-content: space-between; margin-bottom: 4px; gap: 8px; }
          .item span:first-child { flex: 1; }
          .total { font-weight: bold; font-size: 17px; text-align: right; margin-top: 16px; border-top: 1px dashed #000; padding-top: 10px; }
          .footer { margin-top: 24px; text-align: center; font-size: 11px; border-top: 1px dashed #000; padding-top: 10px; }
          .qr { display: block; margin: 10px auto 0; }
          .alerta { color: #a00; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>${escapar(companyName)}</h2>
          ${datosEmisor.length ? `<div class="emisor">${datosEmisor.join('<br/>')}</div>` : ''}
          <p><strong>${escapar(titulo)}</strong></p>
          <p>${escapar(nroString)}</p>
          <p>Fecha: ${escapar(data.date)}</p>
          <p>${data.customer ? `Cliente: ${escapar(data.customer)}` : 'Consumidor Final'}</p>
        </div>
        <div>
          ${lineas.map((l) => `
            <div class="item">
              <span>${l.cantidad} x ${escapar(l.nombre)}</span>
              <span>$${pesos(l.subtotal)}</span>
            </div>
          `).join('')}
        </div>
        <div class="total">TOTAL: $${pesos(data.total)}</div>
        <div class="footer">${pieFiscal}</div>
        <script>
          window.onload = function () { window.print(); window.close(); }
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};
