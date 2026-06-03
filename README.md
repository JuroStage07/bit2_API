# bit2-api

API interna para el módulo de **Horas Extra** de AppoloDesk.

Corre en una máquina **dentro de la red interna** (la única con acceso al SQL
Server Bit2), consulta SQL + Firestore y expone endpoints REST que consume el
frontend (AppoloDesk en Firebase Hosting).

```
Navegador (HTTPS, Firebase Hosting)
        │
        ▼
Cloudflare Tunnel  ──►  bit2-api (HTTP, esta máquina)  ──►  SQL Server Bit2 (red interna)
                                          │
                                          └──►  Firestore (firebase-admin)
```

## Requisitos

- Node.js 18+
- Acceso de red al SQL Server Bit2
- Service account key de Firebase (`service-account.json`)

## Configuración

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Copiar `.env.example` a `.env` y completar credenciales de SQL y CORS:

   ```bash
   copy .env.example .env
   ```

3. Colocar el service account key de Firebase como `service-account.json` en la
   raíz del proyecto (o apuntar `GOOGLE_APPLICATION_CREDENTIALS` a su ruta).
   Se genera en: Firebase Console → ⚙️ Configuración del proyecto →
   Cuentas de servicio → "Generar nueva clave privada".

   > `service-account.json` y `.env` están en `.gitignore`. No los subas al repo.

4. Probar localmente:

   ```bash
   npm start
   ```

   Verificar: http://127.0.0.1:8090/health → `{ "ok": true, ... }`

## Endpoints

Todos requieren header `Authorization: Bearer <Firebase ID token>`.

| Método | Ruta                       | Rol            | Descripción                                  |
| ------ | -------------------------- | -------------- | -------------------------------------------- |
| GET    | `/overtime`                | administrativo, dev | Registros de horas extra (filtrados por coordinador; dev ve todo) |
| POST   | `/overtime/decide`         | administrativo, dev | Aprobar / rechazar `{ attendanceId, status, note, record }` |
| GET    | `/overtime/coordinators`   | dev            | Lista coordinadores + email                  |
| POST   | `/overtime/coordinators`   | dev            | Guarda `{ coordinators: [{ name, email }] }` |
| GET    | `/health`                  | (público)      | Health check                                 |

## Dejar la API como servicio de Windows (arranca sola)

Usando [PM2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2 pm2-windows-startup
pm2 start src/index.js --name bit2-api
pm2 save
pm2-startup install
```

Con esto la API arranca automáticamente al encender la máquina, sin emulador.

## Exponer por HTTPS con Cloudflare Tunnel

El frontend está en HTTPS (Firebase Hosting) y no puede llamar a un endpoint
HTTP. Cloudflare Tunnel publica esta API en `https://bit2-api.ologistics.com`
sin abrir puertos en el firewall.

1. Instalar `cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Autenticar y crear el túnel:

   ```bash
   cloudflared tunnel login
   cloudflared tunnel create bit2-api
   ```

3. Crear el archivo de config (`%USERPROFILE%\.cloudflared\config.yml`):

   ```yaml
   tunnel: <TUNNEL_ID>
   credentials-file: C:\Users\<usuario>\.cloudflared\<TUNNEL_ID>.json

   ingress:
     - hostname: bit2-api.ologistics.com
       service: http://127.0.0.1:8090
     - service: http_status:404
   ```

4. Crear el registro DNS y correr el túnel como servicio:

   ```bash
   cloudflared tunnel route dns bit2-api bit2-api.ologistics.com
   cloudflared service install
   ```

Luego, en el frontend (AppoloDesk) seteá:

```
VITE_OVERTIME_API_URL=https://bit2-api.ologistics.com
```
"# bit2_API" 
"# bit2_API" 
