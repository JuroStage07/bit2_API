const { getSqlPool } = require("./sql");
const { db, FieldValue } = require("./firebaseAdmin");
const { safe } = require("./auth");

/* ─── Helpers de cálculo (portados de las Cloud Functions) ─── */

function parseScheduleRange(scheduleRange) {
  if (!scheduleRange) return null;
  const match = String(scheduleRange).match(/(\d{2}:\d{2}).*(\d{2}:\d{2})/);
  if (!match) return null;
  return { inTime: match[1], outTime: match[2] };
}

function formatMinutesToHHMM(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(restMinutes).padStart(2, "0")}`;
}

function calculateCompanyOvertime({ startEnroll, endEnroll, scheduleRange }) {
  if (!endEnroll || !scheduleRange) {
    return { minutes: 0, hhmm: "00:00", reason: "missing-data" };
  }
  const parsedSchedule = parseScheduleRange(scheduleRange);
  if (!parsedSchedule) {
    return { minutes: 0, hhmm: "00:00", reason: "invalid-schedule" };
  }
  const endDate = new Date(endEnroll);
  if (Number.isNaN(endDate.getTime())) {
    return { minutes: 0, hhmm: "00:00", reason: "invalid-end-enroll" };
  }
  const [outHour, outMinute] = parsedSchedule.outTime.split(":").map(Number);
  const scheduledOutDate = new Date(endDate);
  scheduledOutDate.setUTCHours(outHour, outMinute, 0, 0);
  if (startEnroll) {
    const startDate = new Date(startEnroll);
    if (!Number.isNaN(startDate.getTime()) && scheduledOutDate < startDate) {
      scheduledOutDate.setDate(scheduledOutDate.getDate() + 1);
    }
  }
  const diffMinutes = Math.floor(
    (endDate.getTime() - scheduledOutDate.getTime()) / 60000
  );
  if (diffMinutes <= 30) {
    return { minutes: 0, hhmm: "00:00", reason: "below-threshold" };
  }
  return {
    minutes: diffMinutes,
    hhmm: formatMinutesToHHMM(diffMinutes),
    reason: "calculated",
  };
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

const DAY_NAMES_ES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

function getDayNameES(rawDate) {
  if (!rawDate) return null;
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return null;
  return DAY_NAMES_ES[d.getUTCDay()];
}

function isWeekendDate(rawDate) {
  if (!rawDate) return false;
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function calculateWeekendOvertime({ startEnroll, endEnroll }) {
  if (!startEnroll || !endEnroll) {
    return { minutes: 0, hhmm: "00:00", reason: "missing-data" };
  }
  const start = new Date(startEnroll);
  const end = new Date(endEnroll);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { minutes: 0, hhmm: "00:00", reason: "invalid-data" };
  }
  let diff = Math.floor((end.getTime() - start.getTime()) / 60000);
  if (diff < 0) diff = 0;
  return {
    minutes: diff,
    hhmm: formatMinutesToHHMM(diff),
    reason: "weekend-all",
  };
}

function buildOvertimeRecord({ row, approval, startEnroll, endEnroll, overtime, isWeekend }) {
  const hasSystemOvertime = Boolean(
    row.strTotalOverTime && String(row.strTotalOverTime).trim()
  );
  return {
    attendanceId: Number(row.id),
    idEmployee: Number(row.idEmployee),
    fullName: row.fullName,
    codeEmployee: row.codeEmployee,
    nameJobPosition: row.nameJobPosition || null,
    date: row._date ? new Date(row._date).toISOString().slice(0, 10) : null,
    dayName: getDayNameES(row._date),
    isWeekend,
    groupId: row.idGroup ? Number(row.idGroup) : null,
    coordinatorName: row.nameGroup || null,
    groupCode: row.codeGroup || null,
    idSchedule: row.idSchedule,
    codeSchedule: row.codeSchedule,
    scheduleName: row.scheduleName,
    scheduleRange: row.InOutStr,
    authorizeOverTime: row.AuthorizeOverTime,
    startEnroll: startEnroll
      ? new Date(startEnroll).toISOString().slice(11, 16)
      : null,
    endEnroll: endEnroll
      ? new Date(endEnroll).toISOString().slice(11, 16)
      : null,
    strTotal: row.strTotal,
    strRealTotal: row.strRealTotal,
    systemOvertime: row.strTotalOverTime || "00:00",
    companyOvertime: overtime.hhmm,
    companyOvertimeMinutes: overtime.minutes,
    companyOvertimeReason: overtime.reason,
    hasCompanyOvertime: overtime.minutes > 0,
    hasSystemOvertime,
    overtime: overtime.hhmm,
    status: approval?.status || "pending",
    decidedByUid: approval?.decidedByUid || null,
    decidedByEmail: approval?.decidedByEmail || null,
    decidedAt: approval?.decidedAt || null,
    note: approval?.note || "",
  };
}

/* ─── Operaciones ─── */

/**
 * Lee y arma los registros de horas extra desde SQL Bit2 + Firestore.
 * Aplica la restricción por coordinador salvo para el rol "dev".
 */
async function getOvertimeRecords({ email, role }) {
  const pool = await getSqlPool();
  const callerEmail = safe(email).toLowerCase();
  const callerRole = safe(role).toLowerCase();
  const isUnrestricted = callerRole === "dev";

  const result = await pool.request().query(`
    SELECT TOP 100
      a.id,
      a.idEmployee,
      a.fullName,
      a.codeEmployee,
      a.nameJobPosition,
      a._date,
      a.startEnroll,
      a.endEnroll,
      a.idGroup,
      a.nameGroup,
      a.codeGroup,
      a.idSchedule,
      a.codeSchedule,
      s.name AS scheduleName,
      s.InOutStr,
      s.AuthorizeOverTime,
      a.strTotal,
      a.strRealTotal,
      a.strTotalOverTime
    FROM dbo.view_calculatedAttendance a
    LEFT JOIN dbo.view_schedules s
      ON a.idSchedule = s.id
    WHERE NULLIF(LTRIM(RTRIM(a.strTotalOverTime)), '') IS NOT NULL
       OR (
            ((DATEPART(WEEKDAY, a._date) + @@DATEFIRST) % 7) IN (0, 1)
            AND a.startEnroll IS NOT NULL
            AND a.endEnroll IS NOT NULL
          )
    ORDER BY a._date DESC, a.id DESC
  `);

  const rows = result.recordset;

  // Consolidación: entre semana 1 fila = 1 registro; fin de semana se agrupa
  // por empleado+fecha (entrada más temprana / salida más tardía).
  const weekdayRows = [];
  const weekendGroups = new Map();

  for (const row of rows) {
    const dateKey = row._date
      ? new Date(row._date).toISOString().slice(0, 10)
      : "";

    if (!isWeekendDate(row._date)) {
      weekdayRows.push(row);
      continue;
    }

    const key = `${row.idEmployee}|${dateKey}`;
    const start = row.startEnroll ? new Date(row.startEnroll) : null;
    const end = row.endEnroll ? new Date(row.endEnroll) : null;

    if (!weekendGroups.has(key)) {
      weekendGroups.set(key, { minStart: start, maxEnd: end, minStartRow: row });
    } else {
      const g = weekendGroups.get(key);
      if (start && (!g.minStart || start < g.minStart)) {
        g.minStart = start;
        g.minStartRow = row;
      }
      if (end && (!g.maxEnd || end > g.maxEnd)) {
        g.maxEnd = end;
      }
    }
  }

  const effectiveItems = [
    ...weekdayRows.map((row) => ({
      row,
      isWeekend: false,
      startEnroll: row.startEnroll,
      endEnroll: row.endEnroll,
    })),
    ...Array.from(weekendGroups.values()).map((g) => ({
      row: g.minStartRow,
      isWeekend: true,
      startEnroll: g.minStart ? g.minStart.toISOString() : null,
      endEnroll: g.maxEnd ? g.maxEnd.toISOString() : null,
    })),
  ];

  // Mapa coordinador -> email permitido
  let allowedCoordinatorNames = null;
  if (!isUnrestricted) {
    const cfgSnap = await db.doc("appConfig/overtimeCoordinatorEmails").get();
    const stored = cfgSnap.exists ? cfgSnap.data().coordinators || [] : [];
    allowedCoordinatorNames = new Set(
      stored
        .filter((c) => safe(c?.email).toLowerCase() === callerEmail && safe(c?.name))
        .map((c) => safe(c.name))
    );
  }

  const approvalRefs = effectiveItems.map((item) =>
    db.collection("overtimeApprovals").doc(String(item.row.id))
  );

  const approvalsById = {};
  if (approvalRefs.length > 0) {
    const approvalSnaps = await db.getAll(...approvalRefs);
    approvalSnaps.forEach((snap) => {
      if (snap.exists) approvalsById[snap.id] = snap.data();
    });
  }

  const records = effectiveItems.map((item) => {
    const { row, isWeekend, startEnroll, endEnroll } = item;
    const approval = approvalsById[String(row.id)];
    const overtime = isWeekend
      ? calculateWeekendOvertime({ startEnroll, endEnroll })
      : calculateCompanyOvertime({ startEnroll, endEnroll, scheduleRange: row.InOutStr });
    return buildOvertimeRecord({ row, approval, startEnroll, endEnroll, overtime, isWeekend });
  });

  const visibleRecords = isUnrestricted
    ? records
    : records.filter(
        (r) => r.coordinatorName && allowedCoordinatorNames.has(safe(r.coordinatorName))
      );

  return {
    ok: true,
    records: visibleRecords,
    scope: { email: callerEmail || null, role: callerRole || null, unrestricted: isUnrestricted },
  };
}

/** Aprueba o rechaza un registro de horas extra. */
async function decideOvertimeRecord({ attendanceId, status, note = "", record = null, user }) {
  if (!attendanceId) {
    const err = new Error("attendanceId es requerido.");
    err.status = 400;
    throw err;
  }
  if (!["approved", "rejected"].includes(status)) {
    const err = new Error("status debe ser approved o rejected.");
    err.status = 400;
    throw err;
  }

  await db
    .collection("overtimeApprovals")
    .doc(String(attendanceId))
    .set(
      {
        attendanceId: Number(attendanceId),
        status,
        note,
        record,
        decidedByUid: user?.uid || "unknown",
        decidedByEmail: user?.email || "unknown",
        decidedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true, attendanceId, status };
}

/** Lista los coordinadores (nameGroup) de Bit2 + email guardado en Firestore. */
async function getOvertimeCoordinators() {
  const pool = await getSqlPool();
  const result = await pool.request().query(`
    SELECT DISTINCT a.nameGroup
    FROM dbo.view_calculatedAttendance a
    WHERE NULLIF(LTRIM(RTRIM(a.nameGroup)), '') IS NOT NULL
    ORDER BY a.nameGroup
  `);

  const names = result.recordset.map((r) => safe(r.nameGroup)).filter(Boolean);

  const snap = await db.doc("appConfig/overtimeCoordinatorEmails").get();
  const stored = snap.exists ? snap.data().coordinators || [] : [];
  const emailByName = {};
  stored.forEach((c) => {
    if (c && c.name) emailByName[safe(c.name)] = safe(c.email);
  });

  const coordinators = names.map((name) => ({ name, email: emailByName[name] || "" }));
  return { ok: true, coordinators };
}

/** Guarda el mapeo coordinador -> email. */
async function saveCoordinatorEmails({ coordinators = [], user }) {
  if (!Array.isArray(coordinators)) {
    const err = new Error("coordinators debe ser un arreglo.");
    err.status = 400;
    throw err;
  }

  const clean = [];
  for (const c of coordinators) {
    const name = safe(c?.name);
    const email = safe(c?.email);
    if (!name) continue;
    if (email && !isValidEmail(email)) {
      const err = new Error(`Correo inválido para ${name}: ${email}`);
      err.status = 400;
      throw err;
    }
    clean.push({ name, email });
  }

  await db.doc("appConfig/overtimeCoordinatorEmails").set(
    {
      coordinators: clean,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: user?.uid || "unknown",
      updatedByEmail: user?.email || "unknown",
    },
    { merge: true }
  );

  return { ok: true, count: clean.length };
}

module.exports = {
  getOvertimeRecords,
  decideOvertimeRecord,
  getOvertimeCoordinators,
  saveCoordinatorEmails,
};
