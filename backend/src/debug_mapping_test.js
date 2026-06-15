const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const upload = multer({ dest: path.join(__dirname, 'uploads') });
const app = express();

app.post('/test', upload.single('file'), (req, res) => {
  const debugPath = path.join(__dirname, '..', '..', 'mapping_debug.txt');
  fs.writeFileSync(debugPath,
    'body keys: ' + Object.keys(req.body).join(', ') + '\n' +
    'mapping raw: ' + JSON.stringify(req.body.mapping) + '\n' +
    'mapping type: ' + typeof req.body.mapping + '\n'
  );
  res.json({ body: req.body });
});

const server = app.listen(0, () => {
  const port = server.address().port;
  const csvPath = path.join(__dirname, '..', '..', 'test_mapping_debug.csv');
  fs.writeFileSync(csvPath, 'Producto,Codigo Interno,Precio de Costo\nTest,SKU001,1500\n');

  const curlCmd = `curl.exe -s -X POST http://localhost:${port}/test -F "file=@${csvPath}" -F "mapping={\\"Producto\\":\\"name\\",\\"Codigo Interno\\":\\"sku\\"}"`;
  exec(curlCmd, (err, stdout, stderr) => {
    console.log('CURL OUT:', stdout);
    console.log('CURL ERR:', stderr);
    const debugPath = path.join(__dirname, '..', '..', 'mapping_debug.txt');
    const debug = fs.readFileSync(debugPath, 'utf-8');
    console.log('DEBUG:', debug);
    server.close();
  });
});
