export const printInvoice = (data) => {
  const printWindow = window.open('', '_blank');
  
  const headerTitle = data.isInternal 
    ? data.typeStr 
    : `FACTURA TIPO ${data.type === 1 ? 'A' : data.type === 6 ? 'B' : 'C'}`;
    
  const nroString = data.isInternal 
    ? `Comprobante Interno` 
    : `Nro: ${String(data.pointOfSale).padStart(4, '0')} - ${String(data.voucherNumber).padStart(8, '0')}`;
    
  const footerHtml = data.isInternal 
    ? '<p>Documento no válido como factura fiscal</p>' 
    : `<p>CAE: ${data.cae}</p><p>Vto CAE: ${data.expiration}</p>`;

  printWindow.document.write(`
    <html>
      <head>
        <title>Comprobante</title>
        <style>
          body { font-family: 'Courier New', Courier, monospace; padding: 20px; font-size: 14px; max-width: 400px; margin: auto; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
          .item { display: flex; justify-content: space-between; margin-bottom: 5px; }
          .total { font-weight: bold; font-size: 18px; text-align: right; margin-top: 20px; border-top: 1px dashed #000; padding-top: 10px; }
          .footer { margin-top: 30px; text-align: center; font-size: 12px; border-top: 1px dashed #000; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>COMPRAFIT</h2>
          <p>${headerTitle}</p>
          <p>${nroString}</p>
          <p>Fecha: ${data.date}</p>
          ${data.customer ? `<p>Cliente: ${data.customer}</p>` : '<p>Consumidor Final</p>'}
        </div>
        <div>
          ${data.items.map(item => `
            <div class="item">
              <span>${item.qty}x ${item.name || item.product_name}</span>
              <span>$${((item.price || item.unit_price) * item.qty).toLocaleString()}</span>
            </div>
          `).join('')}
        </div>
        <div class="total">
          TOTAL: $${Number(data.total).toLocaleString()}
        </div>
        <div class="footer">
          ${footerHtml}
        </div>
        <script>
          window.onload = function() { window.print(); window.close(); }
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};
