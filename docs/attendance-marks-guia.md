# Guía para el API: de dónde leer las marcas REALES (`GET /attendance/marks`)

> **Para quien mantiene la bit2-api.** El endpoint `/attendance/marks` está
> devolviendo las marcas mal. La buena noticia: **el endpoint `/overtime` ya las
> lee bien**. Esta guía documenta cómo lo hace `/overtime` para que repliques esa
> misma fuente y lógica en `/attendance/marks`.

---

## 1. Síntomas actuales de `/attendance/marks` (con datos reales)

Verificado desde el front (`AttendanceMarks.jsx`) contra el endpoint real:

| Síntoma | Ejemplo observado |
|---------|-------------------|
| **Empleados repetidos** | ALESSANDRO MONTERO QUIROS aparece 3 veces el mismo día (07:00, 08:32, 16:06) |
| **Marcas de SALIDA tratadas como entrada** | `startEnroll = 16:06` en un TURNO 3 (07:00→17:30) → eso es una salida/re-fichada, no la entrada |
| **Hoy devuelve 0** | `?date=2026-06-18` → `records: []` (y el default sin `?date` también) |
| **Subcuenta** | Una fecha con muchísimos empleados devolvió solo 7 |

**Diagnóstico:** `/attendance/marks` está leyendo **punches crudos** (cada fichada
es una fila) en vez de la **vista consolidada** que usa `/overtime`, y/o filtra de
más (INNER JOIN, scope por grupo, comparación de fecha por `datetime` exacto).

---

## 2. La referencia que SÍ funciona: `GET /overtime`

`/overtime` alimenta `src/pages/OvertimeApprovals.jsx` y entrega, **por cada
empleado y día, UNA sola fila** con la entrada y la salida reales ya resueltas:

```jsonc
{
  "attendanceId": 12345,
  "idEmployee": 100,
  "fullName": "Juan Pérez",
  "codeEmployee": "EMP001",
  "nameJobPosition": "Operario",
  "date": "2026-06-17",
  "startEnroll": "2026-06-17T07:00:00.000Z",   // entrada real (una sola)
  "endEnroll":   "2026-06-17T17:05:00.000Z",   // salida real (una sola)
  "scheduleName": "Turno 3",
  "scheduleRange": "07:00 - 17:30",
  "coordinatorName": "Keilyn Alfaro Quiros",
  "isWeekend": false
}
```

El hecho de que `/overtime` muestre la entrada y la salida correctas, **sin
duplicados**, demuestra que la query contra `dbo.view_calculatedAttendance` con
deduplicación **ya existe en la bit2-api**. `/attendance/marks` debe reutilizarla.

> **Acción #1:** abrí el código de `/overtime` en la bit2-api y mirá su `SELECT`.
> Esa query es la fuente de verdad. `/attendance/marks` = esa misma query, pero
> **sin** los cálculos/filtros de horas extra y filtrando por la fecha pedida.

---

## 3. La fuente correcta de las marcas

`dbo.view_calculatedAttendance` ya entrega **una fila por empleado por día**, con
`startEnroll` (entrada) y `endEnroll` (salida) como **columnas separadas y
consolidadas** (ver `docs/marcas-entrada.md`).

- ✅ **Leé de `view_calculatedAttendance`** → la entrada/salida ya vienen resueltas.
- ❌ **NO leas de la tabla de punches crudos sin consolidar** → ahí cada fichada es
  una fila, y por eso aparecen empleados repetidos y "marcas de salida" como si
  fueran entradas.

---

## 4. Query canónica recomendada para `/attendance/marks`

```sql
;WITH att AS (
  SELECT
    a.id            AS attendanceId,
    a.idEmployee,
    a.fullName,
    a.codeEmployee,
    a._date,
    a.startEnroll,
    a.endEnroll,
    a.idSchedule,
    a.codeSchedule,
    a.idGroup,
    a.nameGroup,
    ROW_NUMBER() OVER (
      PARTITION BY a.idEmployee, CAST(a._date AS DATE)
      ORDER BY a.startEnroll ASC          -- la ENTRADA real = la marca más temprana
    ) AS rn
  FROM dbo.view_calculatedAttendance a
  WHERE CAST(a._date AS DATE) = @date     -- @date = fecha pedida (default = hoy)
    AND a.startEnroll IS NOT NULL          -- solo quienes marcaron entrada
)
SELECT
  att.attendanceId,
  att.idEmployee,
  att.fullName,
  att.codeEmployee,
  CONVERT(varchar(10), att._date, 23)   AS [date],       -- YYYY-MM-DD
  att.startEnroll,
  att.endEnroll,
  att.idSchedule,
  att.codeSchedule,
  s.name                                AS scheduleName,
  s.InOutStr                            AS scheduleRange,
  att.idGroup                           AS groupId,
  att.nameGroup                         AS coordinatorName
FROM att
LEFT JOIN dbo.view_schedules s ON att.idSchedule = s.id   -- LEFT, NUNCA INNER
WHERE att.rn = 1;                                          -- una fila por empleado/día
```

### Los 5 puntos que arreglan los síntomas

1. **`ROW_NUMBER() PARTITION BY idEmployee, _date`** → una sola fila por
   empleado/día. Mata los **duplicados**.
2. **`ORDER BY a.startEnroll ASC` + `rn = 1`** → te quedás con la **primera**
   marca = la entrada real. Mata las **"marcas de salida"** (16:06, etc.).
3. **`LEFT JOIN dbo.view_schedules`** (no `INNER`) → no descarta empleados sin
   horario asignado. Arregla la **subcuenta**.
4. **Sin `WHERE idGroup = …` / sin scope por el usuario que llama** → trae a
   **todos** los que marcaron, no solo un coordinador.
5. **`CAST(a._date AS DATE) = @date`** → compara por **día**, no por `datetime`
   exacto (si comparás `_date = @date` con horas, solo matchean los de medianoche).

> El backend ya parsea `InOutStr` con `parseScheduleRange()` para devolver
> `expectedIn` / `expectedOut` — mantené eso (el front los usa para la tardanza).

---

## 5. El caso especial: "HOY" devuelve 0

`view_calculatedAttendance` suele ser una vista **calculada** que consolida un día
**una vez cerrado** (job nocturno, o cuando ya hay `endEnroll`). El día en curso
puede no estar todavía.

**Verificá primero:**

```sql
-- ¿La vista tiene filas para hoy?
SELECT COUNT(*) FROM dbo.view_calculatedAttendance
WHERE CAST(_date AS DATE) = CAST(GETDATE() AS DATE);
```

- **Si da > 0** → el problema es solo la query del punto 4 (date/JOIN). Listo.
- **Si da 0 pero la gente sí marcó hoy** → para ver el **día en curso en tiempo
  real** hay que leer la **tabla de punches crudos** del reloj (la que registra
  cada fichada al instante), **pero consolidando igual que arriba**:

  ```sql
  -- Pseudo: entrada del día = MIN(punch) por empleado/día desde la tabla cruda
  SELECT idEmployee, CAST(punchTime AS DATE) AS _date, MIN(punchTime) AS startEnroll
  FROM <tabla_de_punches_crudos>
  WHERE CAST(punchTime AS DATE) = @date
  GROUP BY idEmployee, CAST(punchTime AS DATE);
  ```

  Es decir: **una entrada por empleado** = la fichada más temprana del día. **No
  devuelvas cada punch.**

> **Pregunta para definir esto:** ¿cuál es la tabla/vista de marcas crudas del
> reloj (la que se llena en tiempo real)? Con ese nombre cerramos el modo "hoy".

---

## 6. Checklist de verificación en SQL

Corré esto directo en SQL Server para separar "bug de query" de "no hay datos":

```sql
-- (a) Universo real de empleados que marcaron ese día
SELECT COUNT(DISTINCT idEmployee)
FROM dbo.view_calculatedAttendance
WHERE CAST(_date AS DATE) = '2026-06-17';

-- (b) ¿Cuántas filas por empleado? (si > 1, hay duplicados que dedup arregla)
SELECT idEmployee, COUNT(*) AS filas
FROM dbo.view_calculatedAttendance
WHERE CAST(_date AS DATE) = '2026-06-17'
GROUP BY idEmployee
HAVING COUNT(*) > 1;

-- (c) ¿La vista cubre hoy?
SELECT COUNT(*) FROM dbo.view_calculatedAttendance
WHERE CAST(_date AS DATE) = CAST(GETDATE() AS DATE);
```

- (a) alto + endpoint devuelve pocos → es el JOIN/scope (punto 3 y 4).
- (b) con resultados → faltaba el `ROW_NUMBER`/dedup (punto 1 y 2).
- (c) en 0 → caso "hoy" (punto 5): leer de la tabla cruda.

---

## 7. Contrato de respuesta (no cambia)

El front ya consume este shape — manténlo:

```jsonc
{
  "ok": true,
  "date": "2026-06-18",
  "records": [ /* UNA entrada por empleado, ver §2 */ ]
}
```

El front (`AttendanceMarks.jsx`) además deduplica defensivamente por empleado
quedándose con la marca más temprana, así que si el server ya viene consolidado,
no hay doble trabajo — pero **la consolidación correcta debe vivir en el server**
(eficiencia + es la fuente de verdad).

---

### TL;DR

> `/overtime` ya lee las marcas bien desde `dbo.view_calculatedAttendance` con
> dedup por `ROW_NUMBER`. Copiá esa query para `/attendance/marks`, sacale los
> filtros de horas extra, usá `LEFT JOIN` al horario, filtrá por
> `CAST(_date AS DATE) = @date`, y quedate con `rn = 1` ordenando por
> `startEnroll ASC`. Para el día en curso, si la vista calculada no lo tiene, leé
> la tabla de punches crudos tomando `MIN(punch)` por empleado.
