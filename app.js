(() => {
  const STORAGE_KEY = "klass-attendance-v2";
  const LEGACY_KEY = "klass-attendance-v1";
  const AVATARS = ["#1b6b52", "#d4622b", "#3d6fa5", "#8b5e83", "#b0892e", "#4d7c59", "#c45c4a", "#2f6f7e"];

  const $ = (id) => document.getElementById(id);

  const ui = {
    view: "home",
    query: "",
    attendanceId: null,
    pendingSeat: null,
    editingClassId: null,
  };

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function makeDesk(capacity = 2) {
    return { id: uid("dk"), capacity: Number(capacity) === 1 ? 1 : 2 };
  }

  function defaultLayout(rowCount, desksPerRow) {
    return Array.from({ length: rowCount }, () =>
      Array.from({ length: desksPerRow }, () => makeDesk(2))
    );
  }

  function emptyClass(name) {
    return {
      id: uid("cl"),
      name: name || "Мой класс",
      layout: defaultLayout(4, 3),
      students: [],
      seats: {},
      sessions: [],
    };
  }

  function defaultState() {
    const first = emptyClass("Мой класс");
    return { currentClassId: first.id, classes: [first] };
  }

  let state = defaultState();

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function buildLayout(raw) {
    if (Array.isArray(raw?.layout) && raw.layout.length) {
      return raw.layout.map((row) => {
        const desks = Array.isArray(row) ? row : row?.desks;
        if (!Array.isArray(desks) || !desks.length) return [];
        return desks.map((desk) => ({
          id: desk.id || uid("dk"),
          capacity: Number(desk.capacity) === 1 ? 1 : 2,
        }));
      });
    }
    const rows = Number(raw?.rows) > 0 ? Number(raw.rows) : 4;
    const desksPerRow = Number(raw?.desksPerRow) > 0 ? Number(raw.desksPerRow) : 3;
    return defaultLayout(rows, desksPerRow);
  }

  function migrateSeats(rawSeats, layout) {
    const seats = {};
    if (!rawSeats || typeof rawSeats !== "object") return seats;
    for (const [key, studentId] of Object.entries(rawSeats)) {
      if (!studentId) continue;
      if (String(key).includes(":")) {
        seats[key] = studentId;
        continue;
      }
      const [row, desk, side] = String(key).split("-").map(Number);
      const found = layout[row]?.[desk];
      if (found && Number.isInteger(side)) seats[`${found.id}:${side}`] = studentId;
    }
    return seats;
  }

  function normalizeClass(raw, fallbackName) {
    const sessions = Array.isArray(raw?.sessions)
      ? raw.sessions.map((session) => ({
          ...session,
          entries: Array.isArray(session.entries) ? session.entries : [],
        }))
      : [];
    const layout = buildLayout(raw);
    return {
      id: raw?.id || uid("cl"),
      name: raw?.name || raw?.className || fallbackName || "Мой класс",
      layout,
      students: Array.isArray(raw?.students) ? raw.students : [],
      seats: migrateSeats(raw?.seats, layout),
      sessions,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.classes) && parsed.classes.length) {
        const classes = parsed.classes.map((item) => normalizeClass(item));
        const currentClassId = classes.some((item) => item.id === parsed.currentClassId)
          ? parsed.currentClassId
          : classes[0].id;
        state = { classes, currentClassId };
        return;
      }
      const migrated = normalizeClass(parsed, parsed.className);
      state = { currentClassId: migrated.id, classes: [migrated] };
    } catch {
      state = defaultState();
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function klass() {
    if (!Array.isArray(state.classes) || !state.classes.length) state = defaultState();
    let current = state.classes.find((item) => item.id === state.currentClassId);
    if (!current) {
      current = state.classes[0];
      state.currentClassId = current.id;
    }
    if (!Array.isArray(current.layout) || !current.layout.length) {
      current.layout = defaultLayout(4, 3);
    }
    return current;
  }

  function classById(id) {
    return state.classes.find((item) => item.id === id);
  }

  function studentById(id) {
    return klass().students.find((s) => s.id === id);
  }

  function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name).trim().slice(0, 2).toUpperCase() || "?";
  }

  function shortName(name) {
    return String(name).trim().split(/\s+/)[0] || "";
  }

  function avatarColor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return AVATARS[Math.abs(hash) % AVATARS.length];
  }

  function seatKey(deskId, side) {
    return `${deskId}:${side}`;
  }

  function parseSeatKey(key) {
    const raw = String(key);
    const split = raw.lastIndexOf(":");
    if (split === -1) {
      const [row, desk, side] = raw.split("-").map(Number);
      return { deskId: null, row, desk, side };
    }
    return { deskId: raw.slice(0, split), side: Number(raw.slice(split + 1)) };
  }

  function findDesk(deskId, layout = klass().layout) {
    for (let row = 0; row < layout.length; row += 1) {
      const deskIndex = layout[row].findIndex((desk) => desk.id === deskId);
      if (deskIndex >= 0) return { row, deskIndex, desk: layout[row][deskIndex] };
    }
    return null;
  }

  function deskCount(item = klass()) {
    return (item.layout || []).reduce((sum, row) => sum + row.length, 0);
  }

  function findSeatOf(studentId) {
    return Object.entries(klass().seats).find(([, id]) => id === studentId)?.[0] || null;
  }

  function seatLabel(key) {
    const { deskId, side } = parseSeatKey(key);
    const found = deskId ? findDesk(deskId) : null;
    if (!found) return "За партой";
    const place = `Ряд ${found.row + 1}, парта ${found.deskIndex + 1}`;
    if (found.desk.capacity === 1) return place;
    return `${place}, ${side === 0 ? "слева" : "справа"}`;
  }

  function placeStudent(studentId, deskId, side) {
    const dest = seatKey(deskId, side);
    const occupant = klass().seats[dest];
    const from = findSeatOf(studentId);
    if (from) delete klass().seats[from];
    if (occupant && occupant !== studentId && from) klass().seats[from] = occupant;
    klass().seats[dest] = studentId;
  }

  function pruneSeats() {
    const seats = klass().seats;
    for (const key of Object.keys(seats)) {
      const { deskId, side } = parseSeatKey(key);
      const found = deskId ? findDesk(deskId) : null;
      if (!found || side < 0 || side >= found.desk.capacity || !studentById(seats[key])) {
        delete seats[key];
      }
    }
  }

  function unassignedStudents() {
    const taken = new Set(Object.values(klass().seats));
    return klass().students.filter((s) => !taken.has(s.id));
  }

  function totalSeats(item = klass()) {
    return (item.layout || []).reduce(
      (sum, row) => sum + row.reduce((rowSum, desk) => rowSum + (desk.capacity === 1 ? 1 : 2), 0),
      0
    );
  }

  function assignedCount() {
    return Object.keys(klass().seats).length;
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return "Доброе утро";
    if (h < 18) return "Добрый день";
    return "Добрый вечер";
  }

  function formatLongDate(iso) {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
  }

  function formatMonth(iso) {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  }

  function todayIso() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function vibrate(ms = 12) {
    try { navigator.vibrate?.(ms); } catch { /* ignore */ }
  }

  function openSheet(html) {
    $("sheet-content").innerHTML = html;
    const backdrop = $("backdrop");
    backdrop.hidden = false;
    backdrop.classList.remove("hidden");
    const input = backdrop.querySelector("input");
    if (input) setTimeout(() => input.focus(), 80);
  }

  function closeSheet() {
    const backdrop = $("backdrop");
    backdrop.classList.add("hidden");
    backdrop.hidden = true;
    ui.pendingSeat = null;
  }

  function closeOverlay() {
    const overlay = $("overlay");
    overlay.classList.add("hidden");
    overlay.hidden = true;
    overlay.innerHTML = "";
    ui.attendanceId = null;
    document.getElementById("tabbar").style.display = "";
  }

  function sessionById(id) {
    return klass().sessions.find((s) => s.id === id);
  }

  function snapshotEntries() {
    const seated = [];
    klass().layout.forEach((desks, row) => {
      desks.forEach((desk, deskIndex) => {
        const capacity = desk.capacity === 1 ? 1 : 2;
        for (let side = 0; side < capacity; side += 1) {
          const id = klass().seats[seatKey(desk.id, side)];
          if (!id) continue;
          const student = studentById(id);
          if (!student) continue;
          seated.push({
            studentId: student.id,
            name: student.name,
            deskId: desk.id,
            row,
            desk: deskIndex,
            side,
            status: "unmarked",
          });
        }
      });
    });
    const taken = new Set(seated.map((e) => e.studentId));
    const rest = klass().students
      .filter((s) => !taken.has(s.id))
      .map((s) => ({
        studentId: s.id,
        name: s.name,
        deskId: null,
        row: null,
        desk: null,
        side: null,
        status: "unmarked",
      }));
    return seated.concat(rest);
  }

  function sessionStats(session) {
    const present = session.entries.filter((e) => e.status === "present").length;
    const absent = session.entries.filter((e) => e.status === "absent").length;
    const unmarked = session.entries.filter((e) => e.status === "unmarked").length;
    return { present, absent, unmarked, total: session.entries.length };
  }

  function cycleStatus(status) {
    if (status === "unmarked") return "present";
    if (status === "present") return "absent";
    return "unmarked";
  }

  function navigate(view) {
    ui.view = view;
    ui.query = "";
    closeSheet();
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.view === view);
    });
    document.querySelectorAll(".view").forEach((section) => {
      section.classList.toggle("is-active", section.id === `view-${view}`);
    });
    render();
    window.scrollTo(0, 0);
  }

  function renderTopbar() {
    const titles = {
      home: { title: "Классы", sub: klass().name },
      class: { title: "Рассадка", sub: klass().name },
      students: { title: "Ученики", sub: `${klass().name} · ${klass().students.length}` },
      journal: { title: "Журнал", sub: klass().name },
    };
    const t = titles[ui.view];
    $("topbar").innerHTML = `
      <div>
        <h1>${escapeHtml(t.title)}</h1>
        <div class="sub">${escapeHtml(t.sub)}</div>
      </div>
      <button class="icon-btn" type="button" data-action="open-classes" aria-label="Список классов">
        <svg viewBox="0 0 24 24"><path d="M4 5h16v4H4V5Zm0 6h16v4H4v-4Zm0 6h16v4H4v-4Z"/></svg>
      </button>
    `;
  }

  function renderHome() {
    const last = [...klass().sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
    const todaySession = klass().sessions.find((s) => s.date === todayIso());
    $("view-home").innerHTML = `
      <div class="hero">
        <div class="greet">${escapeHtml(greeting())}</div>
        <div class="classname">
          <button type="button" data-action="open-classes">${escapeHtml(klass().name)}</button>
          <span class="edit-dot" data-action="open-classes" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
          </span>
        </div>
        <button class="hero-cta" type="button" data-action="take-attendance">
          <span class="mark">
            <svg viewBox="0 0 24 24"><path d="M9.5 16.2 5.8 12.5l-1.4 1.4 5.1 5.1 10.2-10.2-1.4-1.4z"/></svg>
          </span>
          <span>
            <strong>Отметить посещаемость</strong>
            <small>${todaySession ? "Сегодня уже есть запись — можно создать ещё" : "Откроется класс с партами"}</small>
          </span>
        </button>
      </div>
      <div class="stats">
        <div class="stat"><b>${klass().students.length}</b><span>учеников</span></div>
        <div class="stat"><b>${deskCount()}</b><span>парт</span></div>
        <div class="stat"><b>${assignedCount()}/${totalSeats()}</b><span>мест занято</span></div>
      </div>
      <div class="class-chips">
        ${state.classes.map((item) => `
          <button class="class-chip${item.id === klass().id ? " is-active" : ""}" type="button" data-action="switch-class" data-id="${item.id}">${escapeHtml(item.name)}</button>
        `).join("")}
        <button class="class-chip add" type="button" data-action="add-class">+ Класс</button>
      </div>
      <div class="section-title">
        <span>Последние отметки</span>
        <button type="button" data-action="nav" data-view="journal">Все</button>
      </div>
      <div class="card">
        ${last.length ? last.map(sessionRow).join("") : emptyBlock("Пока нет отметок", "Нажмите «Отметить посещаемость», когда будете готовы.")}
      </div>
    `;
  }

  function sessionRow(session) {
    const stats = sessionStats(session);
    return `
      <button class="session-row" type="button" data-action="open-session" data-id="${session.id}">
        <div class="avatar" style="background:${avatarColor(session.id)}">${escapeHtml(String(new Date(`${session.date}T12:00:00`).getDate()))}</div>
        <div class="meta">
          <div class="name">${escapeHtml(formatLongDate(session.date))}</div>
          <div class="hint">${stats.present} на месте · ${stats.absent} нет${stats.unmarked ? ` · ${stats.unmarked} не отмечены` : ""}</div>
        </div>
        <span class="pill">${stats.present}/${stats.total}</span>
        <span class="chev">›</span>
      </button>
    `;
  }

  function emptyBlock(title, text) {
    return `
      <div class="empty">
        <div class="blob">
          <svg viewBox="0 0 24 24"><path d="M7 3h10a2 2 0 0 1 2 2v15l-7-3-7 3V5a2 2 0 0 1 2-2Z"/></svg>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
      </div>
    `;
  }

  function renderClass() {
    pruneSeats();
    const free = unassignedStudents();
    $("view-class").innerHTML = `
      <div class="card grid-card">
        <div class="step-row">
          <div class="label"><b>Ряды</b><span>сколько рядов в глубину</span></div>
          <div class="stepper">
            <button type="button" data-action="grid" data-field="rows" data-delta="-1">−</button>
            <div class="val">${klass().layout.length}</div>
            <button type="button" data-action="grid" data-field="rows" data-delta="1">+</button>
          </div>
        </div>
        <div class="note">«+» в конце ряда добавляет парту. На парте нажмите ··· — можно оставить одно место или убрать парту. Всего мест: ${totalSeats()}.</div>
      </div>
      ${renderClassroom({ mode: "seat" })}
      <div class="section-title"><span>Без парты</span><span>${free.length}</span></div>
      <div class="card">
        ${free.length ? free.map((s) => personRow(s, "Не рассажен")).join("") : `<div class="empty"><p>${klass().students.length ? "Все ученики сидят за партами." : "Сначала добавьте учеников."}</p></div>`}
      </div>
    `;
  }

  function personRow(student, hint) {
    const seat = findSeatOf(student.id);
    const seatHint = seat ? seatLabel(seat) : hint;
    return `
      <button class="person-row" type="button" data-action="edit-student" data-id="${student.id}">
        <div class="avatar" style="background:${avatarColor(student.id)}">${escapeHtml(initials(student.name))}</div>
        <div class="meta">
          <div class="name">${escapeHtml(student.name)}</div>
          <div class="hint">${escapeHtml(seatHint)}</div>
        </div>
        <span class="chev">›</span>
      </button>
    `;
  }

  function sessionLayout(session) {
    if (Array.isArray(session?.layout) && session.layout.length) return session.layout;
    const seated = (session?.entries || []).filter((entry) => entry.row != null);
    const rowCount = session?.rows || (seated.length ? Math.max(...seated.map((entry) => entry.row)) + 1 : klass().layout.length);
    const deskCountValue = session?.desksPerRow || (seated.length ? Math.max(...seated.map((entry) => entry.desk)) + 1 : 3);
    return Array.from({ length: rowCount }, (_, row) =>
      Array.from({ length: deskCountValue }, (_, desk) => ({ id: `legacy-${row}-${desk}`, capacity: 2 }))
    );
  }

  function renderClassroom({ mode, session }) {
    const layout = mode === "attend" ? sessionLayout(session) : klass().layout;
    const rowsHtml = layout.map((desks, row) => `
      <div class="desk-row">
        <div class="row-index">${row + 1}</div>
        ${desks.map((desk, deskIndex) => renderDesk(desk, row, deskIndex, mode, session)).join("")}
        ${mode === "seat" ? `<button class="add-desk" type="button" data-action="add-desk" data-row="${row}" aria-label="Добавить парту в ряд">+</button>` : ""}
      </div>
    `).join("");
    return `
      <div class="classroom-wrap">
        <div class="classroom">
          <div class="board">доска</div>
          ${rowsHtml}
        </div>
      </div>
    `;
  }

  function findSessionEntry(session, desk, row, deskIndex, side) {
    return session.entries.find((entry) => {
      if (entry.deskId && desk.id && !String(desk.id).startsWith("legacy-")) {
        return entry.deskId === desk.id && entry.side === side;
      }
      return entry.row === row && entry.desk === deskIndex && entry.side === side;
    });
  }

  function renderDesk(desk, row, deskIndex, mode, session) {
    const capacity = desk.capacity === 1 ? 1 : 2;
    const setup = mode === "seat" ? `
      <button class="desk-setup" type="button" data-action="desk-setup" data-desk="${desk.id}" aria-label="Настроить парту">
        <svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>
      </button>
    ` : "";
    return `
      <div class="desk${capacity === 1 ? " single" : ""}">
        ${setup}
        ${Array.from({ length: capacity }, (_, side) => renderSeat(desk, row, deskIndex, side, mode, session)).join("")}
      </div>
    `;
  }

  function renderSeat(desk, row, deskIndex, side, mode, session) {
    if (mode === "attend") {
      const entry = findSessionEntry(session, desk, row, deskIndex, side);
      if (!entry) {
        return `<div class="seat empty"><span class="plus">·</span></div>`;
      }
      const markClass = entry.status === "present" ? "present" : entry.status === "absent" ? "absent" : "unmarked filled";
      const badge = entry.status === "present"
        ? `<span class="badge ok">✓</span>`
        : entry.status === "absent"
          ? `<span class="badge no">✕</span>`
          : "";
      return `
        <button class="seat filled ${markClass}" type="button" data-action="toggle-entry" data-sid="${entry.studentId}">
          <span class="ini">${escapeHtml(initials(entry.name))}</span>
          <span class="sn">${escapeHtml(shortName(entry.name))}</span>
          ${badge}
        </button>
      `;
    }

    const id = klass().seats[seatKey(desk.id, side)];
    const student = id ? studentById(id) : null;
    if (!student) {
      return `
        <button class="seat empty" type="button" data-action="pick-seat" data-desk="${desk.id}" data-side="${side}">
          <span class="plus">+</span>
        </button>
      `;
    }
    return `
      <button class="seat filled" type="button" data-action="pick-seat" data-desk="${desk.id}" data-side="${side}" style="background:${avatarColor(student.id)}1a">
        <span class="ini">${escapeHtml(initials(student.name))}</span>
        <span class="sn">${escapeHtml(shortName(student.name))}</span>
      </button>
    `;
  }

  function renderStudents() {
    const q = ui.query.trim().toLowerCase();
    const list = klass().students
      .filter((s) => s.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    $("view-students").innerHTML = `
      <input class="search" type="search" placeholder="Найти ученика" value="${escapeHtml(ui.query)}" data-action="search">
      <div class="card">
        ${list.length ? list.map((s) => personRow(s, "Не за партой")).join("") : emptyBlock(klass().students.length ? "Никого не нашли" : "Пока никого нет", "Добавьте учеников — потом рассадите их в разделе «Класс».")}
      </div>
      <button class="fab" type="button" data-action="add-student" aria-label="Добавить ученика">
        <svg viewBox="0 0 24 24"><path d="M11 5h2v14h-2zM5 11h14v2H5z"/></svg>
      </button>
    `;
  }

  function renderJournal() {
    const sessions = [...klass().sessions].sort((a, b) => {
      if (a.date === b.date) return b.createdAt - a.createdAt;
      return a.date < b.date ? 1 : -1;
    });
    let lastMonth = "";
    const blocks = [];
    for (const session of sessions) {
      const month = formatMonth(session.date);
      if (month !== lastMonth) {
        blocks.push(`<div class="month-label">${escapeHtml(month)}</div>`);
        lastMonth = month;
      }
      blocks.push(`<div class="card" style="margin-bottom:8px">${sessionRow(session)}</div>`);
    }
    $("view-journal").innerHTML = sessions.length
      ? blocks.join("")
      : `<div class="card">${emptyBlock("Журнал пуст", "Отметки появятся здесь после первой переклички.")}</div>`;
  }

  function openAttendance(sessionId) {
    let session = sessionById(sessionId);
    if (!session) {
      if (!klass().students.length) {
        toast("Сначала добавьте учеников");
        navigate("students");
        return;
      }
      session = {
        id: uid("att"),
        date: todayIso(),
        createdAt: Date.now(),
        layout: JSON.parse(JSON.stringify(klass().layout)),
        entries: snapshotEntries(),
      };
      klass().sessions.unshift(session);
      save();
    }
    ui.attendanceId = session.id;
    document.getElementById("tabbar").style.display = "none";
    const overlay = $("overlay");
    overlay.hidden = false;
    overlay.classList.remove("hidden");
    renderAttendance();
  }

  function renderAttendance() {
    const session = sessionById(ui.attendanceId);
    if (!session) {
      closeOverlay();
      return;
    }
    const stats = sessionStats(session);
    const unseated = session.entries.filter((e) => e.row == null);
    $("overlay").innerHTML = `
      <div class="overlay-panel">
        <div class="overlay-head">
          <button class="icon-btn" type="button" data-action="close-attendance" aria-label="Назад">
            <svg viewBox="0 0 24 24"><path d="M15.5 5 8 12.5 15.5 20l1.4-1.4-6.1-6.1 6.1-6.1Z"/></svg>
          </button>
          <h2>Посещаемость</h2>
          <button class="save-btn" type="button" data-action="save-attendance">Готово</button>
        </div>
        <div class="date-field">
          <span>Дата</span>
          <input type="date" value="${session.date}" data-action="session-date">
        </div>
        <div class="counter">${stats.present} здесь · ${stats.absent} нет · ${stats.unmarked} не отмечены</div>
        <div class="tiny-actions">
          <button class="ok" type="button" data-action="mark-all" data-status="present">Все здесь</button>
          <button class="no" type="button" data-action="mark-all" data-status="absent">Все отсутствуют</button>
        </div>
        <div class="legend">
          <span><i style="background:#c5cec9"></i>не отмечен</span>
          <span><i style="background:var(--present)"></i>здесь</span>
          <span><i style="background:var(--absent)"></i>нет</span>
        </div>
        <p class="lead" style="text-align:center;color:var(--muted);font-size:12px;font-weight:700;margin-bottom:10px">Нажмите на ученика: здесь → нет → сброс</p>
        ${renderClassroom({ mode: "attend", session })}
        ${unseated.length ? `
          <div class="unseated">
            <h3>Без закреплённой парты</h3>
            ${unseated.map((e) => `
              <button class="mark-chip ${e.status}" type="button" data-action="toggle-entry" data-sid="${e.studentId}">
                <div class="avatar" style="background:${avatarColor(e.studentId)}">${escapeHtml(initials(e.name))}</div>
                <div class="meta">
                  <div class="name">${escapeHtml(e.name)}</div>
                  <div class="hint">${e.status === "present" ? "Присутствует" : e.status === "absent" ? "Отсутствует" : "Не отмечен"}</div>
                </div>
              </button>
            `).join("")}
          </div>
        ` : ""}
        <div style="margin-top:16px">
          <button class="danger" type="button" data-action="delete-session">Удалить эту отметку</button>
        </div>
      </div>
    `;
  }

  function pickSeatSheet(deskId, side) {
    const found = findDesk(deskId);
    if (!found) return;
    ui.pendingSeat = { deskId, side: Number(side) };
    const key = seatKey(deskId, side);
    const currentId = klass().seats[key];
    const current = currentId ? studentById(currentId) : null;
    const others = klass().students.filter((s) => s.id !== current?.id);
    const place = found.desk.capacity === 1
      ? `Ряд ${found.row + 1}, парта ${found.deskIndex + 1}`
      : `Ряд ${found.row + 1}, парта ${found.deskIndex + 1}, ${Number(side) === 0 ? "слева" : "справа"}`;
    openSheet(`
      <h2>${current ? "Место занято" : "Кто сидит здесь?"}</h2>
      <p class="lead">${place}</p>
      ${current ? `
        <div class="person-row" style="background:#f7f1e7">
          <div class="avatar" style="background:${avatarColor(current.id)}">${escapeHtml(initials(current.name))}</div>
          <div class="meta"><div class="name">${escapeHtml(current.name)}</div><div class="hint">Сейчас на этом месте</div></div>
        </div>
        <button class="ghost" type="button" data-action="unassign" style="margin:10px 0 14px">Убрать с парты</button>
      ` : ""}
      <div class="sheet-list">
        ${others.length ? others.map((s) => {
          const seat = findSeatOf(s.id);
          const hint = seat ? `Пересадить: ${seatLabel(seat)}` : "Свободен";
          return `
          <button class="person-row" type="button" data-action="assign" data-id="${s.id}">
            <div class="avatar" style="background:${avatarColor(s.id)}">${escapeHtml(initials(s.name))}</div>
            <div class="meta"><div class="name">${escapeHtml(s.name)}</div><div class="hint">${escapeHtml(hint)}</div></div>
          </button>
        `;
        }).join("") : `<p class="lead">${klass().students.length ? "Других учеников нет." : "Сначала добавьте учеников."}</p>`}
      </div>
      <button class="primary" type="button" data-action="add-student">+ Новый ученик</button>
    `);
  }

  function deskSetupSheet(deskId) {
    const found = findDesk(deskId);
    if (!found) return;
    const { row, deskIndex, desk } = found;
    openSheet(`
      <h2>Парта</h2>
      <p class="lead">Ряд ${row + 1}, парта ${deskIndex + 1}. Можно оставить одно место или убрать парту из ряда.</p>
      <div class="tiny-actions">
        <button class="${desk.capacity === 1 ? "is-active" : ""}" type="button" data-action="set-capacity" data-desk="${desk.id}" data-capacity="1">1 ученик</button>
        <button class="${desk.capacity === 2 ? "is-active" : ""}" type="button" data-action="set-capacity" data-desk="${desk.id}" data-capacity="2">2 ученика</button>
      </div>
      <button class="danger" type="button" data-action="delete-desk" data-desk="${desk.id}">Убрать парту из ряда</button>
    `);
  }

  function studentSheet(id) {
    const student = id ? studentById(id) : null;
    openSheet(`
      <h2>${student ? "Ученик" : "Новый ученик"}</h2>
      <p class="lead">${student ? "Можно изменить имя или удалить из класса." : "Имя появится в списке и на рассадке."}</p>
      <div class="field">
        <label for="student-name">Фамилия и имя</label>
        <input id="student-name" type="text" maxlength="60" placeholder="Иванов Пётр" value="${escapeHtml(student?.name || "")}" autocomplete="off" enterkeyhint="done">
      </div>
      <button class="primary" type="button" data-action="save-student" ${student ? `data-id="${student.id}"` : ""}>Сохранить</button>
      ${student ? `<button class="danger" type="button" data-action="delete-student" data-id="${student.id}" style="margin-top:8px">Удалить</button>` : ""}
    `);
  }

  function openClassesSheet() {
    ui.editingClassId = null;
    openSheet(`
      <h2>Классы</h2>
      <p class="lead">У каждого класса свои парты, ученики и журнал.</p>
      <div class="sheet-list">
        ${state.classes.map((item) => `
          <div class="class-row${item.id === klass().id ? " is-current" : ""}">
            <button class="person-row" type="button" data-action="switch-class" data-id="${item.id}">
              <div class="avatar" style="background:${avatarColor(item.id)}">${escapeHtml(initials(item.name))}</div>
              <div class="meta">
                <div class="name">${escapeHtml(item.name)}</div>
                <div class="hint">${item.students.length} уч. · ${deskCount(item)} парт · ${(item.layout || []).length} ряд.${item.id === klass().id ? " · сейчас" : ""}</div>
              </div>
            </button>
            <button class="icon-btn" type="button" data-action="edit-class" data-id="${item.id}" aria-label="Изменить класс">
              <svg viewBox="0 0 24 24"><path d="M4 17.3V20h2.7l8-8-2.7-2.7-8 8ZM18.7 7.3a.8.8 0 0 0 0-1.1l-1.9-1.9a.8.8 0 0 0-1.1 0l-1.5 1.5 3 3 1.5-1.5Z"/></svg>
            </button>
          </div>
        `).join("")}
      </div>
      <button class="primary" type="button" data-action="add-class">+ Новый класс</button>
    `);
  }

  function addClassSheet() {
    ui.editingClassId = null;
    const nextName = `Класс ${state.classes.length + 1}`;
    openSheet(`
      <h2>Новый класс</h2>
      <p class="lead">Появятся пустые парты и свой список учеников.</p>
      <div class="field">
        <label for="class-name">Название</label>
        <input id="class-name" type="text" maxlength="40" value="${escapeHtml(nextName)}" autocomplete="off" enterkeyhint="done">
      </div>
      <button class="primary" type="button" data-action="save-new-class">Создать</button>
    `);
  }

  function editClassSheet(id) {
    const item = classById(id);
    if (!item) return;
    ui.editingClassId = item.id;
    openSheet(`
      <h2>Класс</h2>
      <p class="lead">Переименуйте или удалите. Парты, ученики и журнал этого класса не смешаются с другими.</p>
      <div class="field">
        <label for="class-name">Название</label>
        <input id="class-name" type="text" maxlength="40" value="${escapeHtml(item.name)}" autocomplete="off" enterkeyhint="done">
      </div>
      <button class="primary" type="button" data-action="save-class-name" data-id="${item.id}">Сохранить</button>
      ${state.classes.length > 1 ? `<button class="danger" type="button" data-action="delete-class" data-id="${item.id}" style="margin-top:8px">Удалить класс</button>` : `<p class="lead">Это единственный класс, его нельзя удалить.</p>`}
    `);
  }

  function switchClass(id) {
    const item = classById(id);
    if (!item) return;
    if (ui.attendanceId) closeOverlay();
    state.currentClassId = item.id;
    ui.query = "";
    save();
    closeSheet();
    render();
  }

  function confirmSheet({ title, text, action, id, label }) {
    openSheet(`
      <h2>${escapeHtml(title)}</h2>
      <p class="lead">${escapeHtml(text)}</p>
      <button class="danger" type="button" data-action="${action}" data-id="${id || ""}" data-confirm="1">${escapeHtml(label)}</button>
      <button class="ghost" type="button" data-action="close-sheet" style="margin-top:8px">Отмена</button>
    `);
  }

  function render() {
    pruneSeats();
    renderTopbar();
    if (ui.view === "home") renderHome();
    if (ui.view === "class") renderClass();
    if (ui.view === "students") renderStudents();
    if (ui.view === "journal") renderJournal();
    if (ui.attendanceId) renderAttendance();
  }

  function onClick(event) {
    const hit = event.target.closest("[data-action]");
    if (!hit) {
      if (event.target.id === "backdrop") closeSheet();
      return;
    }
    const action = hit.dataset.action;

    if (action === "nav") {
      navigate(hit.dataset.view);
      return;
    }
    if (action === "close-sheet") {
      closeSheet();
      return;
    }
    if (action === "open-classes") {
      openClassesSheet();
      return;
    }
    if (action === "add-class") {
      addClassSheet();
      return;
    }
    if (action === "save-new-class") {
      const value = $("sheet-content").querySelector("#class-name").value.trim();
      if (!value) return toast("Введите название");
      if (ui.attendanceId) closeOverlay();
      const created = emptyClass(value);
      state.classes.push(created);
      state.currentClassId = created.id;
      ui.query = "";
      save();
      closeSheet();
      render();
      toast("Класс создан");
      return;
    }
    if (action === "switch-class") {
      switchClass(hit.dataset.id);
      return;
    }
    if (action === "edit-class") {
      event.stopPropagation();
      editClassSheet(hit.dataset.id);
      return;
    }
    if (action === "save-class-name") {
      const value = $("sheet-content").querySelector("#class-name").value.trim();
      if (!value) return toast("Введите название");
      const item = classById(hit.dataset.id || ui.editingClassId) || klass();
      item.name = value;
      save();
      closeSheet();
      render();
      return;
    }
    if (action === "delete-class") {
      if (state.classes.length < 2) return toast("Нужен хотя бы один класс");
      if (hit.dataset.confirm !== "1") {
        confirmSheet({
          title: "Удалить класс?",
          text: "Пропадут его ученики, рассадка и журнал. Другие классы не изменятся.",
          action: "delete-class",
          id: hit.dataset.id,
          label: "Удалить класс",
        });
        return;
      }
      if (ui.attendanceId) closeOverlay();
      state.classes = state.classes.filter((item) => item.id !== hit.dataset.id);
      if (state.currentClassId === hit.dataset.id) state.currentClassId = state.classes[0].id;
      ui.editingClassId = null;
      save();
      closeSheet();
      render();
      toast("Класс удалён");
      return;
    }
    if (action === "grid") {
      const delta = Number(hit.dataset.delta);
      const layout = klass().layout;
      const next = layout.length + delta;
      if (next < 1 || next > 10) return;
      if (delta > 0) {
        const prev = layout[layout.length - 1] || [];
        const copy = prev.length
          ? prev.map((desk) => makeDesk(desk.capacity))
          : [makeDesk(2), makeDesk(2), makeDesk(2)];
        layout.push(copy);
      } else {
        layout.pop();
      }
      pruneSeats();
      save();
      render();
      return;
    }
    if (action === "add-desk") {
      const row = Number(hit.dataset.row);
      if (!klass().layout[row]) return;
      if (klass().layout[row].length >= 8) return toast("В ряду уже максимум парт");
      klass().layout[row].push(makeDesk(2));
      save();
      render();
      return;
    }
    if (action === "desk-setup") {
      deskSetupSheet(hit.dataset.desk);
      return;
    }
    if (action === "set-capacity") {
      const found = findDesk(hit.dataset.desk);
      if (!found) return;
      found.desk.capacity = Number(hit.dataset.capacity) === 1 ? 1 : 2;
      pruneSeats();
      save();
      closeSheet();
      render();
      toast(found.desk.capacity === 1 ? "За партой один ученик" : "За партой двое");
      return;
    }
    if (action === "delete-desk") {
      const found = findDesk(hit.dataset.desk);
      if (!found) return;
      if (deskCount() <= 1) return toast("Оставьте хотя бы одну парту");
      klass().layout[found.row].splice(found.deskIndex, 1);
      pruneSeats();
      save();
      closeSheet();
      render();
      toast("Парта убрана");
      return;
    }
    if (action === "pick-seat") {
      pickSeatSheet(hit.dataset.desk, Number(hit.dataset.side));
      return;
    }
    if (action === "assign") {
      if (!ui.pendingSeat) return;
      const { deskId, side } = ui.pendingSeat;
      placeStudent(hit.dataset.id, deskId, side);
      save();
      closeSheet();
      render();
      return;
    }
    if (action === "unassign") {
      if (!ui.pendingSeat) return;
      const { deskId, side } = ui.pendingSeat;
      delete klass().seats[seatKey(deskId, side)];
      save();
      closeSheet();
      render();
      toast("Место свободно");
      return;
    }
    if (action === "add-student") {
      studentSheet(null);
      return;
    }
    if (action === "edit-student") {
      studentSheet(hit.dataset.id);
      return;
    }
    if (action === "save-student") {
      const name = $("sheet-content").querySelector("#student-name").value.trim();
      if (!name) return toast("Введите имя");
      if (hit.dataset.id) {
        const student = studentById(hit.dataset.id);
        if (student) student.name = name;
      } else {
        const student = { id: uid("st"), name };
        klass().students.push(student);
        if (ui.pendingSeat) {
          const { deskId, side } = ui.pendingSeat;
          placeStudent(student.id, deskId, side);
        }
      }
      save();
      closeSheet();
      render();
      toast("Сохранено");
      return;
    }
    if (action === "delete-student") {
      if (hit.dataset.confirm !== "1") {
        confirmSheet({
          title: "Удалить ученика?",
          text: "Он исчезнет из списка и с парты. Старые отметки в журнале сохранятся.",
          action: "delete-student",
          id: hit.dataset.id,
          label: "Удалить",
        });
        return;
      }
      klass().students = klass().students.filter((s) => s.id !== hit.dataset.id);
      for (const [key, id] of Object.entries(klass().seats)) {
        if (id === hit.dataset.id) delete klass().seats[key];
      }
      save();
      closeSheet();
      render();
      toast("Ученик удалён");
      return;
    }
    if (action === "take-attendance") {
      openAttendance(null);
      return;
    }
    if (action === "open-session") {
      openAttendance(hit.dataset.id);
      return;
    }
    if (action === "close-attendance") {
      save();
      closeOverlay();
      render();
      return;
    }
    if (action === "save-attendance") {
      save();
      closeOverlay();
      render();
      toast("Посещаемость сохранена");
      return;
    }
    if (action === "toggle-entry") {
      const session = sessionById(ui.attendanceId);
      const entry = session?.entries.find((e) => e.studentId === hit.dataset.sid);
      if (!entry) return;
      entry.status = cycleStatus(entry.status);
      save();
      vibrate();
      renderAttendance();
      return;
    }
    if (action === "mark-all") {
      const session = sessionById(ui.attendanceId);
      if (!session) return;
      session.entries.forEach((e) => { e.status = hit.dataset.status; });
      save();
      renderAttendance();
      return;
    }
    if (action === "delete-session") {
      if (hit.dataset.confirm !== "1") {
        confirmSheet({
          title: "Удалить отметку?",
          text: "Запись исчезнет из журнала. Это нельзя отменить.",
          action: "delete-session",
          label: "Удалить запись",
        });
        return;
      }
      klass().sessions = klass().sessions.filter((s) => s.id !== ui.attendanceId);
      save();
      closeSheet();
      closeOverlay();
      render();
      toast("Запись удалена");
    }
  }

  function onInput(event) {
    const hit = event.target.closest("[data-action]");
    if (!hit) return;
    if (hit.dataset.action === "search") {
      ui.query = hit.value;
      const card = $("view-students").querySelector(".card");
      if (!card) return;
      const q = ui.query.trim().toLowerCase();
      const list = klass().students
        .filter((s) => s.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
      card.innerHTML = list.length
        ? list.map((s) => personRow(s, "Не за партой")).join("")
        : emptyBlock(klass().students.length ? "Никого не нашли" : "Пока никого нет", "Добавьте учеников — потом рассадите их в разделе «Класс».");
    }
    if (hit.dataset.action === "session-date") {
      const session = sessionById(ui.attendanceId);
      if (!session || !hit.value) return;
      session.date = hit.value;
      save();
    }
  }

  function bind() {
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onInput);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (!$("backdrop").hidden) closeSheet();
        else if (!$("overlay").hidden) {
          closeOverlay();
          render();
        }
      }
      if (event.key === "Enter" && !$("backdrop").hidden) {
        const saveBtn = $("sheet-content").querySelector("[data-action='save-student'], [data-action='save-class-name'], [data-action='save-new-class']");
        if (saveBtn) {
          event.preventDefault();
          saveBtn.click();
        }
      }
    });
  }

  load();
  bind();
  navigate("home");
})();
