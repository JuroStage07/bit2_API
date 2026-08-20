# bit2-api

API interna para el módulo de **Horas Extra** y **Marcas de asistencia** de
AppoloDesk.

Corre en una máquina **dentro de la red interna** (la única con acceso al SQL
Server Bit2), consulta SQL + Firestore y expone endpoints REST que consume el
frontend (AppoloDesk en Firebase Hosting).

```
Navegador (HTTPS, Firebase Hosting)
        │
        ▼
Túnel ngrok (HTTPS)  ──►  bit2-api (HTTP, esta máquina)  ──►  SQL Server Bit2 (red interna)
                                          │
                                          └──►  Firestore (firebase-admin)
```

## Requisitos

- Node.js 18+
- Acceso de red al SQL Server Bit2
- Binarios en `tools/` que **no** se versionan (ver más abajo)

## Configuración

`.env` y `service-account.json` **están versionados en este repo privado**, así
que clonar y arrancar alcanza:

```bash
git clone https://github.com/JuroStage07/bit2_API.git
cd bit2_API
npm install
npm start
```

Verificar: http://127.0.0.1:8090/health → `{ "ok": true, "service": "bit2-api" }`

> **Ojo:** al estar versionado, `.env` es un archivo **compartido**. Si cambiás
> `PORT` o `CORS_ORIGINS` para tu máquina, no lo commitees: le pisás la config al
> resto y, si tocás las `SQL_*`, rompés el host de producción. Para evitar
> commits accidentales:
>
> ```bash
> git update-index --skip-worktree .env
> ```

### Binarios que se descargan aparte

Están en `.gitignore` por tamaño y por contener secretos:

| Archivo | De dónde sale |
| --- | --- |
| `tools/ngrok.exe` | https://ngrok.com/download |
| `tools/nssm.exe` | https://nssm.cc/download (gestor de servicios) |
| `tools/ngrok.yml` | Config con el `authtoken` de ngrok (secreto) |
| `tools/cloudflared.exe` | Solo si se migra a Cloudflare Tunnel |

`tools/ngrok.yml` tiene esta forma:

```yaml
version: "3"
agent:
  authtoken: <tu-authtoken-de-ngrok>
```

## Endpoints

Todos menos `/health` requieren header `Authorization: Bearer <Firebase ID token>`.

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/health` | (público) | Health check |
| GET | `/overtime` | administrativo, dev | Registros de horas extra (filtrados por coordinador; `dev` ve todo) |
| POST | `/overtime/decide` | administrativo, dev | Aprobar / rechazar `{ attendanceId, status, note, record }` |
| GET | `/overtime/coordinators` | dev | Lista coordinadores + email |
| POST | `/overtime/coordinators` | dev | Guarda `{ coordinators: [{ name, email, role, excluded }] }` |
| GET | `/overtime/users-sync` | administrativo, dev | Empleados distintos de Bit2 con su horario |
| GET | `/attendance/marks?date=YYYY-MM-DD` | administrativo, dev | Marcas del día (default hoy; cae al último día con datos) |

## Servicios de Windows (arranca solo, sin sesión abierta)

La API y el túnel corren como servicios vía [NSSM](https://nssm.cc/), con
arranque automático y reinicio si se caen:

```powershell
powershell -ExecutionPolicy Bypass -File tools\install-services.ps1
```

Instala dos servicios (`bit2-ngrok` depende de `bit2-api`):

| Servicio | Qué corre |
| --- | --- |
| `bit2-api` | `node src\index.js` en `127.0.0.1:8090` |
| `bit2-ngrok` | Túnel HTTPS al dominio fijo |

Después de editar código, para aplicar los cambios:

```powershell
powershell -ExecutionPolicy Bypass -File tools\restart-services.ps1
```

Otros scripts: `tools\start-all.ps1` (arranque manual en primer plano, útil para
ver errores), `tools\uninstall-services.ps1`, `tools\test-sql.ps1` (prueba la
conexión a Bit2).

Los logs quedan en `tools\logs\` (`api.log`, `api.err.log`, `ngrok.log`).

## Exponer por HTTPS con ngrok

El frontend está en HTTPS (Firebase Hosting) y no puede llamar a un endpoint
HTTP. El túnel publica esta API sin abrir puertos en el firewall, en un dominio
fijo:

```
https://pleading-evaporate-crawfish.ngrok-free.dev
```

En el frontend (AppoloDesk):

```
VITE_OVERTIME_API_URL=https://pleading-evaporate-crawfish.ngrok-free.dev
```

### ⚠️ El header `ngrok-skip-browser-warning` es obligatorio

ngrok en plan free intercepta las requests con User-Agent de navegador y
devuelve una **página de advertencia HTML con status 200** en lugar de la
respuesta de la API. El síntoma en el frontend es un `Unexpected token '<'` al
parsear JSON — parece un bug de la API, pero no lo es.

Toda request desde el navegador debe mandar el header:

```js
fetch(`${API_URL}/overtime`, {
  headers: {
    Authorization: `Bearer ${idToken}`,
    "ngrok-skip-browser-warning": "1",
  },
})
```

El CORS de la API ya lo permite (el paquete `cors` refleja
`Access-Control-Request-Headers`), no hay que cambiar nada del lado del server.

Para comprobar el túnel de punta a punta:

```bash
curl -H "ngrok-skip-browser-warning: 1" \
  https://pleading-evaporate-crawfish.ngrok-free.dev/health
```

Si devuelve HTML en vez de `{"ok":true,...}`, falta el header.

### CORS

`CORS_ORIGINS` en `.env` es la lista blanca (separada por comas, **sin barra
final**). Un origen que no esté ahí recibe error de CORS. Ya incluye los hosts de
Firebase Hosting y `http://localhost:5173` para dev local.

### Alternativa: Cloudflare Tunnel

Cloudflare Tunnel no tiene interstitial (no haría falta el header) y permite un
dominio propio como `bit2-api.ologistics.com`, pero requiere control del DNS de
`ologistics.com`. Hoy **no está configurado**: ese hostname no resuelve.
