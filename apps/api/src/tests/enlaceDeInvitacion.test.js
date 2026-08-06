const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  El enlace del mail de invitación apunta a algo que la aplicación atiende
//
//  ── El eslabón número dos ──
//
//  La cadena de la invitación tenía tres roturas independientes y ésta es la del
//  medio: `services/email.js` linkeaba a `${FRONTEND_URL}/accept-invite/<token>`
//  y **`App.jsx` no tiene esa ruta**. Quien abría el enlace entraba, el
//  `<Routes>` no matcheaba nada y el `<main>` quedaba en blanco. Sin error, sin
//  log, sin nada que mirar: la persona invitada veía una página vacía y quien
//  invitó veía «Invitación enviada».
//
//  ── Por qué esta guardia mira el HTML y también App.jsx ──
//
//  Porque lo que hay que afirmar no es «la URL cambió» sino «la URL apunta a algo
//  que la aplicación atiende», y eso son dos archivos de dos paquetes distintos.
//  Verificar solo el HTML dejaría la afirmación en pie el día que alguien saque
//  el `?invite=` de `App.jsx`; verificar solo `App.jsx` no diría nada sobre el
//  mail. Las dos mitades tienen que coincidir, y acá se comparan.
//
//  `apps/web` es otro paquete y sus tests corren con vitest, pero este archivo lo
//  **lee**, no lo importa: es una guardia estática sobre texto, igual que las
//  otras cinco de este directorio.
// ════════════════════════════════════════════

const { invitationEmail } = require('../services/email');

const RAIZ_WEB = path.join(__dirname, '..', '..', '..', 'web', 'src');

const FRONTEND_ANTERIOR = process.env.FRONTEND_URL;

/** Un token reconocible, para poder afirmar que viaja entero. */
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

beforeEach(() => {
  // Va acá y no en el entorno de quien corre los tests: sin FRONTEND_URL, la
  // función cae a '#' y la afirmación se volvería sobre un enlace que nadie
  // podría abrir. Un test que depende de una variable que nadie declaró falla
  // en el peor momento y por el motivo que menos se sospecha.
  process.env.FRONTEND_URL = 'https://app.adminapp.test';
});

afterAll(() => {
  if (FRONTEND_ANTERIOR === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = FRONTEND_ANTERIOR;
});

describe('el enlace del mail apunta a una ruta que App.jsx atiende, y /accept-invite/ no lo es', () => {
  it('el HTML linkea a /?invite=<token>', () => {
    const html = invitationEmail('Renée', 'Panadería del Centro', TOKEN);

    expect(html).toContain(`https://app.adminapp.test/?invite=${TOKEN}`);
  });

  it('el HTML NO contiene /accept-invite/, que es la ruta que no existe', () => {
    // Es la mitad que muerde: agregar el `?invite=` y dejar el enlace viejo en
    // el botón —o en un «si el botón no funciona, copiá este enlace»— dejaría el
    // defecto intacto para quien copia el segundo.
    const html = invitationEmail('Renée', 'Panadería del Centro', TOKEN);

    expect(html).not.toContain('/accept-invite/');
  });

  it('el token viaja entero: sin él, el enlace no sirve para nada', () => {
    const html = invitationEmail('Renée', 'Panadería del Centro', TOKEN);

    expect(html).toContain(TOKEN);
  });

  it('App.jsx lee ese mismo parámetro, que es lo que hace que el enlace funcione', () => {
    // Sin esta comprobación, «el enlace apunta a /?invite=» sería una afirmación
    // sobre un parámetro que del otro lado podría no leer nadie — que es
    // exactamente lo que pasaba con /accept-invite/.
    const app = fs.readFileSync(path.join(RAIZ_WEB, 'App.jsx'), 'utf8');

    expect(app).toContain("params.get('invite')");
  });

  it('y App.jsx sigue SIN una ruta /accept-invite: el enlace viejo llevaba a la nada', () => {
    const app = fs.readFileSync(path.join(RAIZ_WEB, 'App.jsx'), 'utf8');

    expect(app).not.toContain('accept-invite/:token');
    expect(app).not.toContain('path="/accept-invite');
  });
});
