# Cómo obtenemos la hora de entrada de cada empleado

## Fuentes de datos

Toda la información viene de **SQL Server (Bit2)** a través de dos vistas:

### 1. `dbo.view_calculatedAttendance`

Contiene el registro diario de asistencia de cada empleado.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | int | ID único del registro de asistencia |
| `idEmployee` | int | ID del empleado |
| `fullName` | varchar | Nombre completo |
| `codeEmployee` | varchar | Código del empleado |
| `_date` | date | Fecha del día |
| `startEnroll` | datetime | **Marca real de entrada** (timestamp del reloj checador) |
| `endEnroll` | datetime | Marca real de salida |
| `idSchedule` | int | ID del horario asignado ese día |
| `codeSchedule` | varchar | Código del horario |
| `idGroup` | int | ID del grupo/coordinador |
| `nameGroup` | varchar | Nombre del coordinador |

### 2. `dbo.view_schedules`

Contiene la definición de los horarios configurados en Bit2.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | int | ID del horario |
| `name` | varchar | Nombre del horario (ej: "Turno Matutino") |
| `InOutStr` | varchar | **Rango de entrada/salida esperado** en formato texto (ej: `"08:00 - 17:00"`) |

## Relación entre ambas vistas

```sql
SELECT
  a.idEmployee,
  a.fullName,
  a._date,
  a.startEnroll,       -- hora real de entrada
  s.InOutStr           -- horario esperado (ej: "08:00 - 17:00")
FROM dbo.view_calculatedAttendance a
LEFT JOIN dbo.view_schedules s ON a.idSchedule = s.id
```

## Cómo se extrae la hora esperada de entrada

El campo `InOutStr` es un string con formato `"HH:MM - HH:MM"` (entrada - salida).

En el proyecto ya existe la función `parseScheduleRange()` en `src/overtimeService.js`:

```javascript
function parseScheduleRange(scheduleRange) {
  if (!scheduleRange) return null;
  const match = String(scheduleRange).match(/(\d{2}:\d{2}).*(\d{2}:\d{2})/);
  if (!match) return null;
  return { inTime: match[1], outTime: match[2] };
}
```

Ejemplo:
- Input: `"08:00 - 17:00"`
- Output: `{ inTime: "08:00", outTime: "17:00" }`

## Resumen del flujo

1. Leemos `view_calculatedAttendance` para obtener `startEnroll` (marca real) y `idSchedule`.
2. Hacemos JOIN con `view_schedules` para obtener `InOutStr` (horario asignado).
3. Parseamos `InOutStr` con `parseScheduleRange()` para obtener `inTime` (hora esperada de entrada).
4. Comparamos `startEnroll` vs `inTime` → de aquí salen las reglas de tardanza.

## Datos relevantes para reglas de tardanza

| Dato | Origen | Ejemplo |
|------|--------|---------|
| Hora real de entrada | `a.startEnroll` | `2025-06-18 08:12:00` |
| Hora esperada de entrada | `parseScheduleRange(s.InOutStr).inTime` | `"08:00"` |
| Diferencia (minutos tarde) | cálculo en código | `12` |
| Día de la semana | `a._date` | Para excluir fines de semana |
| Empleado sin marca | `a.startEnroll IS NULL` | Ausencia o falta de registro |
