<?php
// ════════════════════════════════════════════
//  COMPRAFIT · API Backend
//  Hostinger · MySQL
// ════════════════════════════════════════════

// ── Configuración ──────────────────────────
define('DB_HOST', 'localhost');
define('DB_NAME', 'u336213859_comprafit_app');
define('DB_USER', 'u336213859_comprafit');
define('DB_PASS', 'Comprafit.2025');   // <-- CAMBIÁ ESTO
define('APP_TOKEN', 'Comprafit.App.2025');   // <-- CAMBIÁ ESTO (clave secreta tuya)

// ── CORS y headers ─────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Autenticación simple ───────────────────
$token = $_SERVER['HTTP_X_TOKEN'] ?? '';
if ($token !== APP_TOKEN) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Unauthorized']);
    exit;
}

// ── Conexión MySQL ─────────────────────────
try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER, DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
         PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'DB connection failed']);
    exit;
}

// ── Crear tablas si no existen ─────────────
$pdo->exec("
    CREATE TABLE IF NOT EXISTS cf_datos (
        clave     VARCHAR(50) PRIMARY KEY,
        valor     LONGTEXT    NOT NULL,
        actualizado TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS cf_ventas (
        id        VARCHAR(40) PRIMARY KEY,
        fecha     DATE        NOT NULL,
        hora      VARCHAR(10) NOT NULL,
        items     LONGTEXT    NOT NULL,
        total     DECIMAL(12,2) NOT NULL DEFAULT 0,
        metodo    VARCHAR(20) NOT NULL DEFAULT 'ef',
        obs       TEXT,
        creado    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_fecha (fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");

// ── Router ────────────────────────────────
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$body   = json_decode(file_get_contents('php://input'), true) ?? [];

switch ($action) {

    // ── GET: cargar un dato ──────────────
    case 'get':
        $clave = $_GET['clave'] ?? '';
        if (!$clave) { resp(false, 'Falta clave'); break; }
        $stmt = $pdo->prepare('SELECT valor FROM cf_datos WHERE clave = ?');
        $stmt->execute([$clave]);
        $row = $stmt->fetch();
        resp(true, null, ['valor' => $row ? $row['valor'] : null]);
        break;

    // ── POST: guardar un dato ────────────
    case 'set':
        $clave = $body['clave'] ?? '';
        $valor = $body['valor'] ?? null;
        if (!$clave) { resp(false, 'Falta clave'); break; }
        $stmt = $pdo->prepare('
            INSERT INTO cf_datos (clave, valor)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE valor = VALUES(valor)
        ');
        $stmt->execute([$clave, is_string($valor) ? $valor : json_encode($valor, JSON_UNESCAPED_UNICODE)]);
        resp(true);
        break;

    // ── GET: cargar TODOS los datos de una vez ──
    case 'getall':
        $stmt = $pdo->query('SELECT clave, valor FROM cf_datos');
        $rows = $stmt->fetchAll();
        $data = [];
        foreach ($rows as $r) $data[$r['clave']] = $r['valor'];
        resp(true, null, ['datos' => $data]);
        break;

    // ── POST: guardar TODOS los datos (bulk) ──
    case 'setall':
        $datos = $body['datos'] ?? [];
        if (!is_array($datos)) { resp(false, 'Formato inválido'); break; }
        $stmt = $pdo->prepare('
            INSERT INTO cf_datos (clave, valor)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE valor = VALUES(valor)
        ');
        $pdo->beginTransaction();
        foreach ($datos as $clave => $valor) {
            $stmt->execute([
                $clave,
                is_string($valor) ? $valor : json_encode($valor, JSON_UNESCAPED_UNICODE)
            ]);
        }
        $pdo->commit();
        resp(true, null, ['guardados' => count($datos)]);
        break;

    // ── GET: listar ventas por fecha ─────
    case 'ventas_get':
        $fecha = $_GET['fecha'] ?? date('Y-m-d');
        $stmt  = $pdo->prepare('SELECT * FROM cf_ventas WHERE fecha = ? ORDER BY hora ASC');
        $stmt->execute([$fecha]);
        $ventas = $stmt->fetchAll();
        foreach ($ventas as &$v) $v['items'] = json_decode($v['items'], true);
        resp(true, null, ['ventas' => $ventas]);
        break;

    // ── POST: guardar venta ──────────────
    case 'venta_save':
        $v = $body;
        $stmt = $pdo->prepare('
            INSERT INTO cf_ventas (id, fecha, hora, items, total, metodo, obs)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE items=VALUES(items), total=VALUES(total),
                metodo=VALUES(metodo), obs=VALUES(obs)
        ');
        $stmt->execute([
            $v['id'] ?? uniqid('v'),
            $v['fecha'] ?? date('Y-m-d'),
            $v['hora'] ?? date('H:i'),
            json_encode($v['items'] ?? [], JSON_UNESCAPED_UNICODE),
            floatval($v['total'] ?? 0),
            $v['metodo'] ?? 'ef',
            $v['obs'] ?? ''
        ]);
        resp(true);
        break;

    // ── DELETE: eliminar venta ───────────
    case 'venta_del':
        $id = $body['id'] ?? '';
        if (!$id) { resp(false, 'Falta id'); break; }
        $stmt = $pdo->prepare('DELETE FROM cf_ventas WHERE id = ?');
        $stmt->execute([$id]);
        resp(true);
        break;

    // ── GET: ventas de todos los días (resumen) ──
    case 'ventas_resumen':
        $desde = $_GET['desde'] ?? date('Y-m-01');
        $hasta = $_GET['hasta'] ?? date('Y-m-d');
        $stmt  = $pdo->prepare('
            SELECT fecha,
                   COUNT(*) as cant,
                   SUM(total) as total,
                   metodo
            FROM cf_ventas
            WHERE fecha BETWEEN ? AND ?
            GROUP BY fecha, metodo
            ORDER BY fecha DESC
        ');
        $stmt->execute([$desde, $hasta]);
        resp(true, null, ['resumen' => $stmt->fetchAll()]);
        break;

    // ── GET: ping / health check ─────────
    case 'ping':
        resp(true, null, ['msg' => 'Comprafit API OK', 'time' => date('c')]);
        break;

    default:
        http_response_code(404);
        resp(false, 'Acción no encontrada: ' . $action);
}

// ── Helper respuesta JSON ─────────────────
function resp($ok, $error = null, $data = []) {
    echo json_encode(array_merge(
        ['ok' => $ok],
        $error ? ['error' => $error] : [],
        $data
    ), JSON_UNESCAPED_UNICODE);
    exit;
}
