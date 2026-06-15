const http = require('http');
const fs = require('fs');

const csvContent = 'Producto,Codigo Interno,Precio de Costo,Categoria\nMapeo Test 05,MP-005,2500,proteina\n';
const csvPath = 'C:\\Users\\renev\\AppData\\Local\\Temp\\test_direct.csv';
fs.writeFileSync(csvPath, csvContent);

const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
const mapping = JSON.stringify({Producto: 'name', 'Codigo Interno': 'sku', 'Precio de Costo': 'cost', Categoria: 'category'});

const nl = '\r\n';
let body = '';
body += '--' + boundary + nl;
body += 'Content-Disposition: form-data; name="file"; filename="test.csv"' + nl;
body += 'Content-Type: text/csv' + nl + nl;
body += csvContent + nl;
body += '--' + boundary + nl;
body += 'Content-Disposition: form-data; name="mapping"' + nl + nl;
body += mapping + nl;
body += '--' + boundary + '--' + nl;

const buf = Buffer.from(body);
const req = http.request({
  hostname: 'localhost',
  port: 5000,
  path: '/api/import/products',
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': buf.length,
    'X-Empresa-Id': '1'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('RESPONSE:', data));
});
req.write(buf);
req.end();
