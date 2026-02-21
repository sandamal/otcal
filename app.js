// ------------------- DOM Elements -------------------
const views = document.querySelectorAll('.view');
const authContainer = document.querySelector('.auth-container');
const tabBtns = document.querySelectorAll('.tab-btn');
const authForms = document.querySelectorAll('.auth-form');
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

let currentUser = null;
let currentTellerId = null;
let currentTellerProfile = null;

// ------------------- Init -------------------
document.addEventListener('DOMContentLoaded', () => {
    setupAuthTabs();
    setupNav();
    setupAuthForms();

    // Check Auth
    FB.auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            const snapshot = await FB.db.collection('tellers').where('uid', '==', user.uid).get();
            if (!snapshot.empty) {
                currentTellerProfile = snapshot.docs[0].data();
                currentTellerId = snapshot.docs[0].id;
                showDashboard();
            } else {
                alert("Profile not found. Contact admin.");
                FB.logoutUser();
            }
        } else {
            showAuth();
        }
    });

    document.getElementById('logout-btn').addEventListener('click', () => FB.logoutUser());

    const monthInput = document.getElementById('attendance-month');
    const reportMonthInput = document.getElementById('report-month');

    monthInput.addEventListener('change', () => {
        loadAttendanceTable();
        reportMonthInput.value = monthInput.value;
    });

    document.getElementById('generate-report-btn').addEventListener('click', generateReport);

    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    monthInput.value = monthStr;
    reportMonthInput.value = monthStr;
});

// ------------------- UI Navigation -------------------
function switchView(viewId) {
    views.forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}
function showAuth() { switchView('auth-view'); }
async function showDashboard() {
    switchView('dashboard-view');
    document.getElementById('user-display-name').textContent = currentTellerProfile?.name || 'User';

    // Admin: show teller selectors
    if (currentTellerProfile?.role === 'admin') {
        await populateAdminTellerSelectors();
    }

    loadAttendanceTable();
    loadReportTellers();
}

async function populateAdminTellerSelectors() {
    const allTellers = await FB.getAllTellersWithIds();
    const attSelect = document.getElementById('attendance-teller-select');
    attSelect.classList.remove('hidden');
    attSelect.innerHTML = '';

    allTellers.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.name} (${t.nick || t.id})`;
        if (t.id === currentTellerId) opt.selected = true;
        attSelect.appendChild(opt);
    });

    // Re-load attendance when admin switches teller
    attSelect.addEventListener('change', () => loadAttendanceTable());
}
function setupAuthTabs() {
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            authForms.forEach(f => f.classList.remove('active'));
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });
}
function setupNav() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            tabContents.forEach(t => t.classList.remove('active'));
            document.getElementById(item.dataset.view).classList.add('active');

            if (item.dataset.view === 'reports-tab') {
                const attendanceMonth = document.getElementById('attendance-month').value;
                document.getElementById('report-month').value = attendanceMonth;

                // Sync selected teller if admin
                if (currentTellerProfile?.role === 'admin') {
                    const attSelect = document.getElementById('attendance-teller-select');
                    const repSelect = document.getElementById('report-teller-select');
                    if (attSelect.value && repSelect.options.length > 0) {
                        repSelect.value = attSelect.value;
                    }
                }

                generateReport();
            }
        });
    });
}

// ------------------- Auth Forms -------------------
function setupAuthForms() {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        try { await FB.loginUser(email, pass); }
        catch (err) { document.getElementById('login-error').textContent = err.message; }
    });

    document.getElementById('signup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tellerId = document.getElementById('signup-teller-id').value;
        const email = document.getElementById('signup-email').value;
        const pass = document.getElementById('signup-password').value;

        const isAdmin = document.getElementById('signup-admin').checked;
        const data = {
            tellerId,
            name: document.getElementById('signup-name').value,
            nick: document.getElementById('signup-nick').value,
            team: document.getElementById('signup-team').value,
            mobile: document.getElementById('signup-mobile').value,
            pf: document.getElementById('signup-pf').value,
            basic: Number(document.getElementById('signup-basic').value),
            role: isAdmin ? 'admin' : 'user'
        };

        try {
            const userCredential = await FB.auth.createUserWithEmailAndPassword(email, pass);
            const user = userCredential.user;
            await FB.db.collection('tellers').doc(tellerId).set({ ...data, uid: user.uid, createdAt: new Date() });
        } catch (err) { document.getElementById('signup-error').textContent = err.message; }
    });
}

// ------------------- Attendance -------------------
async function loadAttendanceTable() {
    if (!currentTellerId) return;

    // Admin: use selected teller, else use own ID
    let viewTellerId = currentTellerId;
    let viewTellerProfile = currentTellerProfile;
    if (currentTellerProfile?.role === 'admin') {
        const sel = document.getElementById('attendance-teller-select');
        if (sel.value) {
            viewTellerId = sel.value;
            if (viewTellerId !== currentTellerId) {
                viewTellerProfile = await FB.getTellerProfile(viewTellerId);
            }
        }
    }

    const monthStr = document.getElementById('attendance-month').value;
    const tbody = document.getElementById('attendance-body');
    tbody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

    try {
        const [year, month] = monthStr.split('-');
        const daysInMonth = new Date(year, month, 0).getDate();
        const attRecords = await FB.getMonthlyAttendance(viewTellerId, monthStr);
        const attMap = new Map(attRecords.map(r => [r.date, r]));
        const team = viewTellerProfile?.team || 'team1';

        const rows = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${month}-${String(d).padStart(2, '0')}`;
            const roster = await FB.getRoster(team, dateStr);

            let rosterEntry = null, isOff = false;
            if (roster) {
                if (roster.offDay) isOff = true;
                else rosterEntry = roster.tellers?.find(t => t.teller === viewTellerId) || null;
            }

            const shift = rosterEntry?.shift?.toUpperCase() || (isOff ? 'OFF' : null);
            let arrival = attMap.get(dateStr)?.arrival || '';
            let departure = attMap.get(dateStr)?.departure || '';
            let booth = rosterEntry ? (rosterEntry.booth6 || rosterEntry.booth8 || '-') : '-';
            let workHours = 0, ot = 0, status = 'Pending';

            if (shift === 'OFF') status = 'OFF';
            else if (arrival && departure) {
                const stats = calculateDailyStats(arrival, departure, shift);
                workHours = stats.workHours;
                ot = stats.ot;
                status = stats.status;
            } else if (shift) status = 'Absent';
            else status = '-';

            rows.push({ dateStr, tellerId: viewTellerId, rosterEntry, isOff, arrival, departure, booth, status, ot, workHours, shift });
        }

        renderTable(applyMonthlyEscalation(rows));

    } catch (e) { tbody.innerHTML = `<tr><td colspan="7">Error: ${e.message}</td></tr>`; }
}

function renderTable(rows) {
    const tbody = document.getElementById('attendance-body');
    tbody.innerHTML = '';

    rows.forEach(row => {
        const tr = document.createElement('tr');

        // Status class for styling
        let statusClass = '';
        if (row.status?.includes('Late')) statusClass = 'status-late';
        if (row.status?.includes('Approved')) statusClass = 'status-approved';
        if (row.status?.includes('Short')) statusClass = 'status-short-leave';
        if (row.status?.includes('Half')) statusClass = 'status-half-day';
        if (row.status?.includes('Pending')) statusClass = 'status-pending';
        if (row.isOff) statusClass = 'status-off';
        tr.className = statusClass;

        // --- Default Shift Times ---
        let defaultArrival = '';
        let defaultDeparture = '';

        const shift = row.rosterEntry?.shift?.toUpperCase() || (row.isOff ? 'OFF' : '');

        if (!row.arrival && !row.departure) {
            if (shift === 'DAY') {
                defaultArrival = '06:30';
                defaultDeparture = '19:30';
            } else if (shift === 'NIGHT') {
                defaultArrival = '18:30';
                defaultDeparture = '07:30';
            }
        }

        // --- Calculate Work Hours ---
        const actualArrival = row.arrival || defaultArrival;
        const actualDeparture = row.departure || defaultDeparture;

        let workHours = 0;
        let status = row.status;

        if (actualArrival && actualDeparture) {
            const stats = calculateDailyStats(actualArrival, actualDeparture, shift);
            workHours = stats.workHours;
            status = shift === 'OFF' ? 'OFF (Worked)' : stats.status;
        }
        else if (shift === 'OFF') {
            status = 'OFF';
        }
        else if (shift && (!row.arrival && !row.departure)) {
            status = 'Absent';
        }

        tr.innerHTML = `
            <td>${row.dateStr}</td>
            <td>${shift || '-'}</td>
            <td>
                <input type="time" class="time-in" data-date="${row.dateStr}" 
                       value="${actualArrival}" step="60">
            </td>
            <td>
                <input type="time" class="time-out" data-date="${row.dateStr}" 
                       value="${actualDeparture}" step="60">
            </td>
            <td>${row.booth}</td>
            <td class="work-hours-cell">${workHours.toFixed(2)}</td>
            <td class="status-cell">${status}</td>
        `;

        // Auto-save on change
        const inputs = tr.querySelectorAll('input');
        inputs.forEach(inp => {
            inp.addEventListener('change', () =>
                handleAttendanceChange(row.tellerId, row.dateStr, tr)
            );
        });

        tbody.appendChild(tr);
    });
}




function getStatusClass(status) {
    if (status.includes('Late')) return 'status-late';
    if (status.includes('Approved')) return 'status-approved';
    if (status.includes('Short')) return 'status-short-leave';
    if (status.includes('Half')) return 'status-half-day';
    if (status.includes('Pending')) return 'status-pending';
    if (status.includes('OFF')) return 'status-off';
    return '';
}

async function handleAttendanceChange(tellerId, dateStr, tr) {
    try {
        const arrInput = tr.querySelector('.time-in').value;
        const depInput = tr.querySelector('.time-out').value;
        const shift = tr.children[1].textContent.toUpperCase();

        let workHours = 0, status = '';

        if (!arrInput || !depInput) {
            status = shift === 'OFF' ? 'OFF' : 'Absent';
        } else {
            const stats = calculateDailyStats(arrInput, depInput, shift);
            workHours = stats.workHours;
            status = shift === 'OFF' ? 'OFF (Worked)' : stats.status;
        }

        // Save to Firebase
        await FB.saveAttendance(tellerId, dateStr, {
            arrival: arrInput || '',
            departure: depInput || '',
            ot: 0,
            workHours: workHours,
            status: status,
            calculatedAt: new Date()
        });

        // ===== Instant Row Update (No full table reload) =====
        tr.querySelector('.work-hours-cell').textContent = workHours.toFixed(2);
        tr.querySelector('.status-cell').textContent = status;

        // Optional: highlight changed row briefly
        tr.style.backgroundColor = '#e8f5e9';
        setTimeout(() => tr.style.backgroundColor = '', 400);

    } catch (err) {
        alert("Error saving attendance: " + err.message);
    }
}


// ------------------- HR Rules -------------------
function calculateDailyStats(arr, dep, shift) {
    if (!arr || !dep) return { status: 'Absent', workHours: 0, ot: 0 };
    const { start, end } = normalizeTimes(arr, dep);
    let workHours = ((end - start) / 60).toFixed(2);
    let status = 'Present', ot = 0;

    // OFF days: just calculate hours, skip late/short/half rules
    if (shift === 'OFF') return { status: 'Present', workHours: Number(workHours), ot: 0 };

    let shiftStart, shiftEnd;
    if (shift === 'DAY') { shiftStart = toMinutes('06:40'); shiftEnd = toMinutes('19:30'); }
    else if (shift === 'NIGHT') { shiftStart = toMinutes('18:45'); shiftEnd = toMinutes('07:30') + 1440; }
    else { shiftStart = start; shiftEnd = end; }

    // Half Day
    const halfArrStart = toMinutes('08:01'), halfArrEnd = toMinutes('12:30');
    const halfDepStart = toMinutes('13:00'), halfDepEnd = toMinutes('17:59');
    const isHalfArrival = start >= halfArrStart && start <= halfArrEnd;
    const isHalfDeparture = end >= halfDepStart && end <= halfDepEnd;
    if (isHalfArrival && isHalfDeparture) status = 'Absent';
    else if (isHalfArrival || isHalfDeparture) status = 'Half Day';

    // Short Leave
    const shortArrStart = toMinutes('06:46'), shortArrEnd = toMinutes('08:00');
    const shortDepStart = toMinutes('06:00'), shortDepEnd = toMinutes('07:30');
    if ((start >= shortArrStart && start <= shortArrEnd) || (end >= shortDepStart && end <= shortDepEnd)) status = 'Short Leave';

    // Late
    const lateStart = toMinutes(shift === 'DAY' ? '06:31' : '18:31');
    const lateEnd = toMinutes(shift === 'DAY' ? '06:45' : '18:45');
    if (start >= lateStart && start <= lateEnd) status = 'Late';

    return { status, workHours: Number(workHours), ot };
}

function toMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function normalizeTimes(arr, dep) { let start = toMinutes(arr), end = toMinutes(dep); if (end <= start) end += 1440; return { start, end }; }

// ------------------- Escalation -------------------
function applyMonthlyEscalation(dailyResults) {
    let lateCount = 0, shortCount = 0;
    return dailyResults.map(day => {
        let status = day.status;
        if (status.includes("Late")) { lateCount++; if (lateCount > 4) { lateCount = 0; shortCount++; status = "Short Leave (Esc)"; } }
        else if (status.includes("Short")) { shortCount++; if (shortCount > 2) { shortCount = 0; status = "Half Day (Esc)"; } }
        return { ...day, status };
    });
}

// ------------------- Reports -------------------
async function loadReportTellers() {
    const sel = document.getElementById('report-teller-select');
    sel.innerHTML = '';

    if (currentTellerProfile?.role === 'admin') {
        // Admin: show all tellers
        const allTellers = await FB.getAllTellersWithIds();
        allTellers.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.name} (${t.nick || t.id})`;
            if (t.id === currentTellerId) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.disabled = false;
    } else if (currentTellerProfile && currentTellerId) {
        const opt = document.createElement('option');
        opt.value = currentTellerId;
        opt.textContent = `${currentTellerProfile.name} (${currentTellerProfile.nick})`;
        opt.selected = true; sel.appendChild(opt); sel.disabled = true;
    }
}

async function generateReport() {
    const tellerId = document.getElementById('report-teller-select').value;
    const monthStr = document.getElementById('report-month').value;

    if (!tellerId || !monthStr) return alert("Select teller and month");
    if (currentTellerProfile?.role !== 'admin' && tellerId !== currentTellerId) return alert("Authorization Error: You can only view your own reports.");

    const [year, month] = monthStr.split('-');
    const daysInMonth = new Date(year, month, 0).getDate();

    let stats = {
        working: 0, off: 0, ot: 0, lates: 0, shorts: 0, halfs: 0, mercantile: 0,
        totalWorkedHours: 0, leaveHours: 0
    };

    const resultsDiv = document.getElementById('report-results');
    resultsDiv.classList.remove('hidden');

    const tellerProfile = await FB.getTellerProfile(tellerId);
    if (!tellerProfile) return alert("Teller profile not found");
    const team = tellerProfile.team;

    const attendanceRecords = await FB.getMonthlyAttendance(tellerId, monthStr);
    const attendanceMap = new Map(attendanceRecords.map(r => [r.date, r]));

    const records = [];

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${month}-${String(d).padStart(2, '0')}`;
        const roster = await FB.getRoster(team, dateStr);
        let att = attendanceMap.get(dateStr) || {};

        let shift = '-';
        let arr = att?.arrival || '';
        let dep = att?.departure || '';
        let status = att?.status || 'Absent';
        let workHours = att?.workHours || 0;

        if (roster) {
            if (roster.offDay) shift = 'OFF';
            else if (roster.tellers?.length) {
                const entry = roster.tellers.find(t => t.teller === tellerId);
                shift = entry?.shift?.toUpperCase() || 'Not Scheduled';
            }
        } else shift = 'No Roster';

        // --- Apply default shift times (same as attendance table) ---
        if (!arr && !dep) {
            if (shift === 'DAY') {
                arr = '06:30';
                dep = '19:30';
            } else if (shift === 'NIGHT') {
                arr = '18:30';
                dep = '07:30';
            }
        }

        // Calculate workHours & status using actual or default times
        if (arr && dep) {
            const stats = calculateDailyStats(arr, dep, shift);
            workHours = stats.workHours;
            // Respect manually set status if it's Mercantile Holiday or similar override
            if (status !== 'Mercantile Holiday') {
                status = shift === 'OFF' ? 'OFF (Worked)' : stats.status;
            }
        } else if (shift === 'OFF') {
            workHours = 0;
            if (status !== 'Mercantile Holiday') status = 'OFF';
        } else {
            workHours = 0;
            if (status !== 'Mercantile Holiday') status = 'Absent';
        }

        // Update stats
        if (status === 'OFF') stats.off++;
        else if (status === 'Mercantile Holiday') stats.mercantile++;
        else if (status !== 'Absent') {
            stats.working++;
            stats.totalWorkedHours += workHours;
            if (status.includes('Late')) stats.lates++;
            if (status.includes('Short')) stats.shorts++;
            if (status.includes('Half')) stats.halfs++;
        } else {
            stats.leaveHours += 8; // Absent = 8H
        }

        records.push({ dateStr, shift, arr, dep, workHours, status });
    }

    // ===== Render Table =====
    const tbody = document.getElementById('report-body');
    tbody.innerHTML = '';
    records.forEach(r => {
        const tr = document.createElement('tr');
        if (r.status === 'Absent') tr.style.color = 'red';
        if (r.shift === 'OFF') tr.style.backgroundColor = 'rgba(0,0,0,0.05)';

        tr.innerHTML = `
            <td>${r.dateStr}</td>
            <td>${r.shift}</td>
            <td>
                <input type="time" class="report-time-in" data-date="${r.dateStr}" 
                       value="${r.arr}" step="60">
            </td>
            <td>
                <input type="time" class="report-time-out" data-date="${r.dateStr}" 
                       value="${r.dep}" step="60">
            </td>
            <td class="work-hours-cell">${Number(r.workHours).toFixed(2)}</td>
            <td>
                <div class="status-container" data-date="${r.dateStr}">
                    <!-- dynamic status rows -->
                </div>
            </td>
        `;

        // Helper to create status select row
        const createStatusRow = (selectedValue, isFirst = false) => {
            const row = document.createElement('div');
            row.className = 'status-row';

            const select = document.createElement('select');
            select.className = 'status-edit';
            select.innerHTML = `
                <option value="Present">Present</option>
                <option value="Late">Late</option>
                <option value="Absent">Absent</option>
                <option value="Short Leave">Short Leave</option>
                <option value="Half Day">Half Day</option>
                <option value="OFF">OFF</option>
                <option value="OFF (Worked)">OFF (Worked)</option>
                <option value="Mercantile Holiday">Mercantile Holiday</option>
            `;
            select.value = selectedValue || 'Present';

            row.appendChild(select);

            if (isFirst) {
                const addBtn = document.createElement('button');
                addBtn.className = 'status-btn add';
                addBtn.textContent = '+';
                addBtn.onclick = () => {
                    const newRow = createStatusRow('Present');
                    const container = tr.querySelector('.status-container');
                    container.appendChild(newRow);
                    updateStatusAndSave();
                };
                row.appendChild(addBtn);
            } else {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'status-btn remove';
                removeBtn.textContent = '-';
                removeBtn.onclick = () => {
                    row.remove();
                    updateStatusAndSave();
                };
                row.appendChild(removeBtn);
            }

            select.addEventListener('change', () => updateStatusAndSave());

            return row;
        };

        const container = tr.querySelector('.status-container');

        // Function to gather all statuses, save, and update summary
        const updateStatusAndSave = async () => {
            const selects = container.querySelectorAll('select');
            const selectedValues = Array.from(selects).map(s => s.value);
            const newStatusString = selectedValues.join(',');

            const date = r.dateStr;
            const newArr = tr.querySelector('.report-time-in').value;
            const newDep = tr.querySelector('.report-time-out').value;
            let att = attendanceMap.get(date) || {};

            let newWorkHours = 0;

            if (newArr && newDep && !selectedValues.includes('Absent')) {
                const stats = calculateDailyStats(newArr, newDep, r.shift);
                newWorkHours = stats.workHours;
            } else {
                if (selectedValues.includes('Half Day')) newWorkHours = 4;
                else if (selectedValues.includes('Short Leave')) newWorkHours = 1.5;
            }

            await FB.saveAttendance(tellerId, date, {
                ...att,
                arrival: newArr,
                departure: newDep,
                status: newStatusString,
                workHours: newWorkHours,
                calculatedAt: new Date()
            });

            // Update row instantly
            tr.querySelector('.work-hours-cell').textContent = Number(newWorkHours).toFixed(2);

            // Update summary totals
            updateReportSummary();
        };

        // Initial render of statuses
        const currentStatuses = (r.status || 'Absent').split(',');
        currentStatuses.forEach((status, index) => {
            container.appendChild(createStatusRow(status.trim(), index === 0));
        });
        // Inline time edit — recalculate and save on change
        const timeInputs = tr.querySelectorAll('.report-time-in, .report-time-out');
        timeInputs.forEach(inp => {
            inp.addEventListener('change', async () => {
                updateStatusAndSave();

                // Brief highlight
                tr.style.backgroundColor = '#e8f5e9';
                setTimeout(() => tr.style.backgroundColor = '', 400);
            });
        });

        tbody.appendChild(tr);
    });

    // ===== Calculate Total OT & Payable =====
    // Mercantile Holiday handling: usually treated as paid leave or off day? 
    // If it is a paid holiday, it doesn't subtract from basic salary (so not absent).
    // Does it count towards worked hours? usually no. 
    // Does it reduce OT threshold? 
    // For now, let's treat it similar to OFF day for OT calculation (neutral).

    // ===== Calculate Total OT & Payable =====
    // Mercantile Holiday handling: usually treated as paid leave or off day? 
    // If it is a paid holiday, it doesn't subtract from basic salary (so not absent).
    // Does it count towards worked hours? usually no. 
    // Does it reduce OT threshold? 
    // User requested each Mercantile Holiday deducts 8 hours from Total OT.

    let totalOTHours = 180
        - (stats.leaveHours + (stats.shorts * 1.5) + (stats.halfs * 4) + (stats.mercantile * 8));

    let payableHours = stats.totalWorkedHours - totalOTHours;

    // ===== Calculate total worked hours from table =====
    let tableWorkedHours = 0;
    document.querySelectorAll('#report-body .work-hours-cell').forEach(cell => {
        tableWorkedHours += parseFloat(cell.textContent) || 0;
    });

    // ===== Update Summary =====
    document.getElementById('report-total-ot').textContent = totalOTHours.toFixed(2);
    document.getElementById('report-pending-ot').textContent = payableHours.toFixed(2);
    document.getElementById('report-total-worked-hours').textContent = tableWorkedHours.toFixed(2);
    document.getElementById('report-leave-hours').textContent = stats.leaveHours.toFixed(2);

    document.getElementById('report-working-days').textContent = stats.working;
    document.getElementById('report-off-days').textContent = stats.off;
    document.getElementById('report-mercantile-holidays').textContent = stats.mercantile;
    document.getElementById('report-lates').textContent = stats.lates % 4;
    document.getElementById('report-short-leaves').textContent = stats.shorts % 2;
    document.getElementById('report-half-days').textContent = stats.halfs;
}

// ------------------- Live Report Summary Update -------------------
function updateReportSummary() {
    let tableWorkedHours = 0;
    let working = 0, off = 0, lates = 0, shorts = 0, halfs = 0, leaveHours = 0, mercantile = 0;

    document.querySelectorAll('#report-body tr').forEach(tr => {
        const workHoursCell = tr.querySelector('.work-hours-cell');
        const selects = tr.querySelectorAll('.status-edit');
        if (!workHoursCell || selects.length === 0) return;

        const wh = parseFloat(workHoursCell.textContent) || 0;
        tableWorkedHours += wh;

        const statuses = Array.from(selects).map(s => s.value);
        let dayHasAbsent = false;
        let dayHasOff = false;
        let dayHasMercantile = false;

        statuses.forEach(status => {
            if (status === 'OFF') {
                if (!dayHasOff) { off++; dayHasOff = true; }
            }
            else if (status === 'Mercantile Holiday') {
                if (!dayHasMercantile) { mercantile++; dayHasMercantile = true; }
            }
            else if (status === 'Absent') {
                if (!dayHasAbsent) { leaveHours += 8; dayHasAbsent = true; }
            }
            else {
                if (status.includes('Late')) lates++;
                if (status.includes('Short')) shorts++;
                if (status.includes('Half')) halfs++;
            }
        });

        // Determine if the day counts as a 'working day' based on if it contains
        // any status that indicates working (i.e. not OFF/Absent/Mercantile)
        const isWorking = statuses.some(s => s !== 'Absent' && s !== 'OFF' && s !== 'Mercantile Holiday'); if (isWorking) working++;
    });

    let totalOTHours = 180 - (leaveHours + (shorts * 1.5) + (halfs * 4) + (mercantile * 8));
    let payableHours = tableWorkedHours - totalOTHours;

    document.getElementById('report-total-ot').textContent = totalOTHours.toFixed(2);
    document.getElementById('report-pending-ot').textContent = payableHours.toFixed(2);
    document.getElementById('report-total-worked-hours').textContent = tableWorkedHours.toFixed(2);
    document.getElementById('report-leave-hours').textContent = leaveHours.toFixed(2);
    document.getElementById('report-working-days').textContent = working;
    document.getElementById('report-off-days').textContent = off;
    document.getElementById('report-mercantile-holidays').textContent = mercantile;
    document.getElementById('report-lates').textContent = lates % 4;
    document.getElementById('report-short-leaves').textContent = shorts % 2;
    document.getElementById('report-half-days').textContent = halfs;
}


