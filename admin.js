import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    doc, 
    getDoc, 
    getDocs,
    setDoc,
    addDoc, 
    updateDoc, 
    deleteDoc, 
    onSnapshot,
    query,
    where,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAjkdbUSY5yTqWmDVGWL_RSC0p2KbI49Rg",
    authDomain: "digital-borrowing-system.firebaseapp.com",
    projectId: "digital-borrowing-system",
    storageBucket: "digital-borrowing-system.firebasestorage.app",
    messagingSenderId: "446897129489",
    appId: "1:446897129489:web:8cc4aab0bbaef6b5ea49b0",
    measurementId: "G-R3BMR771SN"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const PICKUP_WINDOW_MS = 5 * 60 * 1000; // 5 Minutes Expiration

// Operating Hours Default Configuration
let labOperatingHours = {
    open_time: "08:00",
    close_time: "17:00"
};

// DOM Elements
const userEmailSpan = document.getElementById('user-email');
const logoutBtn = document.getElementById('logout-btn');
const assetsTbody = document.getElementById('assets-tbody');
const inspectionsTbody = document.getElementById('inspections-tbody');
const maintenanceTbody = document.getElementById('maintenance-tbody');
const activeBorrowingsTbody = document.getElementById('active-borrowings-tbody');
const pendingCountBadge = document.getElementById('pending-count-badge');
const exportCsvBtn = document.getElementById('export-csv-btn');

// Lab Hours Elements
const labHoursForm = document.getElementById('lab-hours-form');
const labOpenTimeInput = document.getElementById('lab-open-time');
const labCloseTimeInput = document.getElementById('lab-close-time');

// User Hold Search Elements
const userSearchForm = document.getElementById('user-search-form');
const userSearchEmail = document.getElementById('user-search-email');
const userSearchResult = document.getElementById('user-search-result');
const searchedUserEmail = document.getElementById('searched-user-email');
const searchedUserRole = document.getElementById('searched-user-role');
const searchedUserHoldBadge = document.getElementById('searched-user-hold-badge');
const toggleHoldBtn = document.getElementById('toggle-hold-btn');
const userSearchMsg = document.getElementById('user-search-msg');

let currentFoundUser = null;
let currentInspectingRecord = null;
let usersCache = {}; // Global Map for fast student lookup

// Asset Modal Elements
const assetModal = document.getElementById('asset-modal');
const assetForm = document.getElementById('asset-form');
const modalTitle = document.getElementById('modal-title');
const openAddModalBtn = document.getElementById('open-add-modal-btn');
const closeAssetModalBtn = document.getElementById('close-asset-modal-btn');

// Damage Modal Elements
const damageModal = document.getElementById('damage-modal');
const damageForm = document.getElementById('damage-form');
const damageNotes = document.getElementById('damage-notes');
const cancelDamageBtn = document.getElementById('cancel-damage-btn');

// SECURITY GATE
onAuthStateChanged(auth, async (user) => {
    if (!user || !user.email.endsWith('@addu.edu.ph')) {
        window.location.href = 'login.html';
        return;
    }

    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists() || userSnap.data().role !== 'admin') {
            window.location.href = 'student.html';
            return;
        }

        userEmailSpan.textContent = user.email;
        initAdminDashboard();

    } catch (error) {
        console.error("Security Gate Error:", error);
        window.location.href = 'login.html';
    }
});

logoutBtn.addEventListener('click', () => signOut(auth).then(() => window.location.href = 'login.html'));

// ==========================================
// TAB NAVIGATION HANDLER
// ==========================================
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTabId = btn.getAttribute('data-tab');

        // Reset styling on all tab buttons
        tabBtns.forEach(b => {
            b.classList.remove('border-blue-600', 'text-blue-600', 'bg-blue-50/50', 'font-bold');
            b.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300', 'font-medium');
        });

        // Hide all tab content sections
        tabContents.forEach(content => content.classList.add('hidden'));

        // Activate clicked tab button styling
        btn.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300', 'font-medium');
        btn.classList.add('border-blue-600', 'text-blue-600', 'bg-blue-50/50', 'font-bold');

        // Reveal active tab content section
        const targetContent = document.getElementById(targetTabId);
        if (targetContent) {
            targetContent.classList.remove('hidden');
        }
    });
});

// REAL-TIME DASHBOARD LISTENERS
function initAdminDashboard() {
    listenToLabHours();
    listenToAssets();
    listenToPendingRequests();
    listenToPendingInspections();
    listenToMaintenanceQueue();
    listenToStudentDirectory();
    listenToActiveBorrowings();
    listenToHoldCount();

    // Auto-sweep expired requests every 10 seconds
    setInterval(sweepExpiredRequests, 10000);
}

// ==========================================
// LAB OPERATING HOURS SETTINGS
// ==========================================
function listenToLabHours() {
    const hoursDocRef = doc(db, "settings", "operating_hours");
    onSnapshot(hoursDocRef, (docSnap) => {
        if (docSnap.exists()) {
            labOperatingHours = docSnap.data();
            if (labOpenTimeInput) labOpenTimeInput.value = labOperatingHours.open_time || "08:00";
            if (labCloseTimeInput) labCloseTimeInput.value = labOperatingHours.close_time || "17:00";
        }
    });
}

if (labHoursForm) {
    labHoursForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const openVal = labOpenTimeInput.value;
        const closeVal = labCloseTimeInput.value;

        try {
            await setDoc(doc(db, "settings", "operating_hours"), {
                open_time: openVal,
                close_time: closeVal,
                updated_at: serverTimestamp()
            });
            alert(`Operating Hours updated: Open ${openVal} - Close ${closeVal}`);
        } catch (err) {
            alert("Failed to save lab hours: " + err.message);
        }
    });
}

// ==========================================
// REAL-TIME ACTIVELY BORROWED MONITOR
// ==========================================
function listenToActiveBorrowings() {
    if (!activeBorrowingsTbody) return;

    onSnapshot(collection(db, "borrow_records"), (snapshot) => {
        try {
            if (snapshot.empty) {
                activeBorrowingsTbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-gray-400">No active borrowings recorded.</td></tr>`;
                return;
            }

            const records = [];
            snapshot.forEach(d => {
                const data = d.data();
                if (['BORROWED', 'STAGED', 'RETURNED', 'RETURNED_DAMAGED', 'REQUESTED'].includes(data.status)) {
                    records.push({ id: d.id, ...data });
                }
            });

            if (records.length === 0) {
                activeBorrowingsTbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-gray-400">No active borrowings recorded.</td></tr>`;
                return;
            }

            // Sort by most recent
            records.sort((a, b) => {
                const timeA = a.borrowed_at?.toDate ? a.borrowed_at.toDate().getTime() : (a.requested_at?.toDate ? a.requested_at.toDate().getTime() : 0);
                const timeB = b.borrowed_at?.toDate ? b.borrowed_at.toDate().getTime() : (b.requested_at?.toDate ? b.requested_at.toDate().getTime() : 0);
                return timeB - timeA;
            });

            activeBorrowingsTbody.innerHTML = '';
            records.forEach(rec => {
                // Student details lookup from cache or fallbacks
                const student = usersCache[rec.student_uid] || usersCache[rec.student_email] || {};
                const studentName = student.name || rec.student_name || 'Student Account';
                const program = student.course || student.program || 'AdDU Student';
                const yearLevel = student.year_level || student.year || 'Undergraduate';

                // Safe Time Formatting
                const checkedOutTime = rec.borrowed_at?.toDate 
                    ? rec.borrowed_at.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                    : (rec.requested_at?.toDate ? rec.requested_at.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending');

                const returnedTime = (rec.status === 'RETURNED' || rec.status === 'RETURNED_DAMAGED') && rec.returned_at?.toDate
                    ? rec.returned_at.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '-';

                const statusBadge = computeBorrowStatusBadge(rec);

                const tr = document.createElement('tr');
                tr.className = "hover:bg-gray-50 transition";
                tr.innerHTML = `
                    <td class="p-3 font-semibold text-gray-900">${escapeHtml(rec.asset_name || 'N/A')}</td>
                    <td class="p-3"><span class="bg-gray-100 text-gray-700 text-[11px] px-2 py-0.5 rounded-full font-medium">Equipment</span></td>
                    <td class="p-3 font-medium text-gray-900">${escapeHtml(studentName)}</td>
                    <td class="p-3 font-mono text-gray-600 text-xs">${escapeHtml(rec.student_email || 'N/A')}</td>
                    <td class="p-3">
                        <div class="font-bold text-gray-900 text-xs">${escapeHtml(program)}</div>
                        <div class="text-[11px] text-gray-500 font-medium">${escapeHtml(yearLevel)}</div>
                    </td>
                    <td class="p-3 font-mono text-xs text-gray-700">${checkedOutTime}</td>
                    <td class="p-3 font-mono text-xs text-gray-700">${returnedTime}</td>
                    <td class="p-3 text-center">${statusBadge}</td>
                `;

                activeBorrowingsTbody.appendChild(tr);
            });
        } catch (err) {
            console.error("Error rendering active borrowings:", err);
            activeBorrowingsTbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-red-500 font-semibold text-xs">Error rendering records: ${escapeHtml(err.message)}</td></tr>`;
        }
    }, (error) => {
        console.error("Firestore active borrowings snapshot error:", error);
        activeBorrowingsTbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-red-500 font-semibold text-xs">Database error: ${escapeHtml(error.message)}</td></tr>`;
    });
}

function computeBorrowStatusBadge(record) {
    if (record.status === 'RETURNED' || record.status === 'RETURNED_DAMAGED') {
        return `<span class="bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full font-bold">Returned</span>`;
    }

    try {
        const now = new Date();
        const closeTimeString = labOperatingHours?.close_time || "17:00";
        const timeParts = closeTimeString.split(':');
        const closeHour = parseInt(timeParts[0], 10) || 17;
        const closeMin = parseInt(timeParts[1], 10) || 0;

        const closingTimeToday = new Date();
        closingTimeToday.setHours(closeHour, closeMin, 0, 0);

        if (now > closingTimeToday && (record.status === 'BORROWED' || record.status === 'STAGED')) {
            return `<span class="bg-red-100 text-red-800 text-xs px-2.5 py-1 rounded-full font-bold animate-pulse">Overdue</span>`;
        }
    } catch (e) {
        console.warn("Overdue calculation fallback:", e);
    }

    if (record.status === 'REQUESTED') {
        return `<span class="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-bold">Requested</span>`;
    }

    return `<span class="bg-blue-100 text-blue-800 text-xs px-2.5 py-1 rounded-full font-bold">Checked Out</span>`;
}

// USER SEARCH & CLEAR HOLD HANDLERS
userSearchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    userSearchMsg.classList.add('hidden');
    userSearchResult.classList.add('hidden');

    const emailToSearch = userSearchEmail.value.trim().toLowerCase();

    try {
        const q = query(collection(db, "users"), where("email", "==", emailToSearch));
        const snap = await getDocs(q);

        if (snap.empty) {
            userSearchMsg.textContent = `No user account found with email "${emailToSearch}".`;
            userSearchMsg.classList.remove('hidden');
            return;
        }

        const userDocSnap = snap.docs[0];
        currentFoundUser = { id: userDocSnap.id, ...userDocSnap.data() };
        renderUserSearchCard(currentFoundUser);

    } catch (error) {
        console.error("User search error:", error);
        userSearchMsg.textContent = "Error searching for user: " + error.message;
        userSearchMsg.classList.remove('hidden');
    }
});

function renderUserSearchCard(user) {
    searchedUserEmail.textContent = user.email;
    searchedUserRole.textContent = `Role: ${user.role || 'student'}`;

    if (user.is_on_hold) {
        searchedUserHoldBadge.textContent = "ACCOUNT LOCKED (ON HOLD)";
        searchedUserHoldBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-red-100 text-red-800";
        
        toggleHoldBtn.textContent = "Clear Hold & Unlock";
        toggleHoldBtn.className = "text-xs font-semibold px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white shadow-xs transition cursor-pointer";
        toggleHoldBtn.onclick = () => toggleUserHoldStatus(user.id, false);
    } else {
        searchedUserHoldBadge.textContent = "ACCOUNT CLEAR (ACTIVE)";
        searchedUserHoldBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-green-100 text-green-800";
        
        toggleHoldBtn.textContent = "Place Account On Hold";
        toggleHoldBtn.className = "text-xs font-semibold px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-xs transition cursor-pointer";
        toggleHoldBtn.onclick = () => toggleUserHoldStatus(user.id, true);
    }

    userSearchResult.classList.remove('hidden');
}

async function toggleUserHoldStatus(uid, newHoldState) {
    try {
        await updateDoc(doc(db, "users", uid), {
            is_on_hold: newHoldState,
            updated_at: serverTimestamp()
        });

        if (currentFoundUser && currentFoundUser.id === uid) {
            currentFoundUser.is_on_hold = newHoldState;
            renderUserSearchCard(currentFoundUser);
        }
    } catch (error) {
        console.error("Toggle hold error:", error);
        alert("Failed to update user hold status: " + error.message);
    }
}

let adminTimerInterval = null;

// REAL-TIME COUNTER PICKUP REQUESTS LISTENER
function listenToPendingRequests() {
    const q = query(collection(db, "borrow_records"), where("status", "==", "REQUESTED"));
    const requestsTbody = document.getElementById('requests-tbody');
    const requestsCountBadge = document.getElementById('requests-count-badge');

    onSnapshot(q, (snapshot) => {
        if (!requestsTbody) return;
        if (requestsCountBadge) requestsCountBadge.textContent = `${snapshot.size} Pending`;

        if (snapshot.empty) {
            requestsTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-400">No pending pickups.</td></tr>`;
            return;
        }

        requestsTbody.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const record = docSnap.data();
            const recordId = docSnap.id;
            const requestedTime = record.requested_at?.toDate ? record.requested_at.toDate().getTime() : Date.now();

            const tr = document.createElement('tr');
            tr.className = "hover:bg-blue-50/50 transition";
            tr.innerHTML = `
                <td class="p-3 font-semibold text-gray-900">${escapeHtml(record.asset_name)}</td>
                <td class="p-3 text-gray-600 font-mono text-xs">${escapeHtml(record.student_email)}</td>
                <td class="p-3 font-mono text-xs font-bold timer-cell" data-requested-at="${requestedTime}">
                    ⏱ Calculating...
                </td>
                <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button class="accept-btn bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer">✓ Hand Over</button>
                        <button class="reject-btn bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer">✕ Cancel</button>
                    </div>
                </td>
            `;

            tr.querySelector('.accept-btn').addEventListener('click', () => acceptBorrowRequest(recordId, record.asset_id));
            tr.querySelector('.reject-btn').addEventListener('click', () => rejectBorrowRequest(recordId, record.asset_id));

            requestsTbody.appendChild(tr);
        });

        // Run immediately and ensure interval is running
        updateAdminTimers();
        if (!adminTimerInterval) {
            adminTimerInterval = setInterval(updateAdminTimers, 1000);
        }
    });
}

function updateAdminTimers() {
    const timerCells = document.querySelectorAll('.timer-cell');
    const now = Date.now();

    timerCells.forEach(cell => {
        const requestedTime = parseInt(cell.getAttribute('data-requested-at'), 10);
        const elapsed = now - requestedTime;
        const remainingSecs = Math.max(0, Math.floor((PICKUP_WINDOW_MS - elapsed) / 1000));

        const mins = Math.floor(remainingSecs / 60);
        const secs = remainingSecs % 60;

        cell.className = `p-3 font-mono text-xs font-bold timer-cell ${remainingSecs < 60 ? 'text-red-600 animate-pulse' : 'text-blue-700'}`;
        cell.textContent = `⏱ ${mins}:${secs < 10 ? '0' : ''}${secs}`;
    });
}

// AUTO-SWEEP EXPIRED REQUESTS (OLDER THAN 5 MINS)
async function sweepExpiredRequests() {
    try {
        const q = query(collection(db, "borrow_records"), where("status", "==", "REQUESTED"));
        const snapshot = await getDocs(q);
        const now = Date.now();

        snapshot.forEach(async (docSnap) => {
            const record = docSnap.data();
            const requestedTime = record.requested_at?.toDate ? record.requested_at.toDate().getTime() : now;

            if (now - requestedTime > PICKUP_WINDOW_MS) {
                await runTransaction(db, async (transaction) => {
                    const recordRef = doc(db, "borrow_records", docSnap.id);
                    const assetRef = doc(db, "assets", record.asset_id);

                    transaction.update(recordRef, { status: 'EXPIRED' });
                    transaction.update(assetRef, { status: 'Available', updated_at: serverTimestamp() });
                });
            }
        });
    } catch (err) {
        console.warn("Auto-sweep error:", err);
    }
}

// ACCEPT REQUEST & HANDOVER ITEM
async function acceptBorrowRequest(recordId, assetId) {
    try {
        await runTransaction(db, async (transaction) => {
            const recordRef = doc(db, "borrow_records", recordId);
            const assetRef = doc(db, "assets", assetId);

            transaction.update(recordRef, { status: 'BORROWED', borrowed_at: serverTimestamp() });
            transaction.update(assetRef, { status: 'IN_USE', updated_at: serverTimestamp() });
        });
    } catch (error) {
        alert("Failed to accept request: " + error.message);
    }
}

// REJECT / CANCEL REQUEST
async function rejectBorrowRequest(recordId, assetId) {
    try {
        await runTransaction(db, async (transaction) => {
            const recordRef = doc(db, "borrow_records", recordId);
            const assetRef = doc(db, "assets", assetId);

            transaction.update(recordRef, { status: 'REJECTED', rejected_at: serverTimestamp() });
            transaction.update(assetRef, { status: 'Available', updated_at: serverTimestamp() });
        });
    } catch (error) {
        alert("Failed to reject request: " + error.message);
    }
}

function listenToAssets() {
    onSnapshot(collection(db, "assets"), (snapshot) => {
        let totalQty = 0;
        let inUseQty = 0;

        snapshot.forEach(docSnap => {
            const asset = docSnap.data();
            const qty = asset.quantity || 1;
            totalQty += qty;
            if (asset.status === 'IN_USE') {
                inUseQty += qty;
            }
        });

        const totalElem = document.getElementById('metric-total-assets');
        const inUseElem = document.getElementById('metric-in-use');
        if (totalElem) totalElem.textContent = totalQty;
        if (inUseElem) inUseElem.textContent = inUseQty;

        if (snapshot.empty) {
            assetsTbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-gray-400">No assets registered yet.</td></tr>`;
            return;
        }

        assetsTbody.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const asset = docSnap.data();
            const id = docSnap.id;
            
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 transition";

            tr.innerHTML = `
                <td class="p-4 font-semibold text-gray-900">${escapeHtml(asset.name)}</td>
                <td class="p-4"><span class="bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full">${escapeHtml(asset.type)}</span></td>
                <td class="p-4">${getStatusBadge(asset.status)}</td>
                <td class="p-4 text-gray-600 font-mono text-xs">${escapeHtml(asset.location_id)}</td>
                <td class="p-4 font-bold text-gray-800">${asset.quantity}</td>
                <td class="p-4 font-mono text-xs text-blue-600">${escapeHtml(asset.qr_code_str)}</td>
                <td class="p-4 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button class="edit-btn bg-blue-50 hover:bg-blue-100 text-blue-700 p-2 rounded-lg text-xs font-medium transition cursor-pointer">Edit</button>
                        <button class="delete-btn bg-red-50 hover:bg-red-100 text-red-700 p-2 rounded-lg text-xs font-medium transition cursor-pointer">Delete</button>
                    </div>
                </td>
            `;

            tr.querySelector('.edit-btn').addEventListener('click', () => openEditModal(id, asset));
            tr.querySelector('.delete-btn').addEventListener('click', () => deleteAsset(id));

            assetsTbody.appendChild(tr);
        });
    });
}

function listenToPendingInspections() {
    const q = query(collection(db, "borrow_records"), where("status", "==", "STAGED"));

    onSnapshot(q, (snapshot) => {
        if (!inspectionsTbody) return;
        pendingCountBadge.textContent = `${snapshot.size} Pending`;

        const pendingMetric = document.getElementById('metric-pending-returns');
        if (pendingMetric) pendingMetric.textContent = snapshot.size;

        if (snapshot.empty) {
            inspectionsTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-400">No items currently awaiting inspection.</td></tr>`;
            return;
        }

        inspectionsTbody.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const record = docSnap.data();
            const recordId = docSnap.id;

            const tr = document.createElement('tr');
            tr.className = "hover:bg-amber-50/50 transition";
            tr.innerHTML = `
                <td class="p-3 font-semibold text-gray-900">${escapeHtml(record.asset_name)}</td>
                <td class="p-3 text-gray-600 font-mono text-xs">${escapeHtml(record.student_email)}</td>
                <td class="p-3 text-blue-600 font-mono text-xs">${escapeHtml(record.qr_code_str)}</td>
                <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button class="grade-good-btn bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer">✓ Good</button>
                        <button class="grade-damaged-btn bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer">⚠ Damaged</button>
                    </div>
                </td>
            `;

            tr.querySelector('.grade-good-btn').addEventListener('click', () => gradeReturnGood(recordId, record.asset_id));
            tr.querySelector('.grade-damaged-btn').addEventListener('click', () => openDamageModal(recordId, record.asset_id));

            inspectionsTbody.appendChild(tr);
        });
    });
}

// REAL-TIME MAINTENANCE QUEUE LISTENER
function listenToMaintenanceQueue() {
    const q = query(collection(db, "assets"), where("status", "==", "Maintenance"));

    onSnapshot(q, (snapshot) => {
        if (!maintenanceTbody) return;

        if (snapshot.empty) {
            maintenanceTbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-400">No assets currently in maintenance.</td></tr>`;
            return;
        }

        maintenanceTbody.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const asset = docSnap.data();
            const assetId = docSnap.id;

            const tr = document.createElement('tr');
            tr.className = "hover:bg-rose-50/50 transition";
            tr.innerHTML = `
                <td class="p-3 font-semibold text-gray-900">${escapeHtml(asset.name)}</td>
                <td class="p-3"><span class="bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full">${escapeHtml(asset.type)}</span></td>
                <td class="p-3 font-mono text-xs text-gray-600">${escapeHtml(asset.location_id)}</td>
                <td class="p-3 font-mono text-xs text-blue-600">${escapeHtml(asset.qr_code_str)}</td>
                <td class="p-3 text-center">
                    <button class="resolve-maint-btn bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer">
                        ✓ Mark Repaired
                    </button>
                </td>
            `;

            tr.querySelector('.resolve-maint-btn').addEventListener('click', () => resolveMaintenance(assetId));
            maintenanceTbody.appendChild(tr);
        });
    });
}

async function resolveMaintenance(assetId) {
    try {
        await updateDoc(doc(db, "assets", assetId), {
            status: 'Available',
            updated_at: serverTimestamp()
        });
    } catch (err) {
        alert("Failed to mark repaired: " + err.message);
    }
}

// REAL-TIME HOLD COUNT
function listenToHoldCount() {
    const q = query(collection(db, "users"), where("is_on_hold", "==", true));
    onSnapshot(q, (snapshot) => {
        const holdMetric = document.getElementById('metric-on-hold');
        if (holdMetric) {
            holdMetric.textContent = snapshot.size;
        }
    });
}

// REAL-TIME STUDENT ROSTER & FILTER
function listenToStudentDirectory() {
    const studentsTbody = document.getElementById('students-tbody');
    const filterInput = document.getElementById('student-filter-input');
    if (!studentsTbody) return;

    let allStudents = [];

    onSnapshot(collection(db, "users"), (snapshot) => {
        allStudents = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.role !== 'admin') {
                const studentData = { id: docSnap.id, ...data };
                allStudents.push(studentData);
                usersCache[docSnap.id] = studentData;
                usersCache[data.email] = studentData;
            }
        });
        renderStudentTable(allStudents);
    });

    if (filterInput) {
        filterInput.addEventListener('input', (e) => {
            const queryStr = e.target.value.toLowerCase();
            const filtered = allStudents.filter(s => 
                (s.name && s.name.toLowerCase().includes(queryStr)) ||
                (s.id_number && s.id_number.toLowerCase().includes(queryStr)) ||
                (s.email && s.email.toLowerCase().includes(queryStr)) ||
                (s.course && s.course.toLowerCase().includes(queryStr))
            );
            renderStudentTable(filtered);
        });
    }

    function renderStudentTable(students) {
        if (students.length === 0) {
            studentsTbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-400">No student accounts found.</td></tr>`;
            return;
        }

        studentsTbody.innerHTML = '';
        students.forEach((student) => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 transition";
            tr.innerHTML = `
                <td class="p-3 font-semibold text-gray-900">${escapeHtml(student.name || 'N/A')}</td>
                <td class="p-3 font-mono text-xs text-gray-600">${escapeHtml(student.id_number || 'N/A')}</td>
                <td class="p-3 text-xs text-gray-600">${escapeHtml(student.course || 'N/A')}</td>
                <td class="p-3 font-mono text-xs text-blue-600">${escapeHtml(student.email)}</td>
                <td class="p-3">
                    ${student.is_on_hold 
                        ? `<span class="bg-red-100 text-red-800 text-xs px-2.5 py-1 rounded-full font-bold">LOCKED</span>` 
                        : `<span class="bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full font-medium">ACTIVE</span>`}
                </td>
                <td class="p-3 text-center">
                    <button class="toggle-hold-btn text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer ${
                        student.is_on_hold 
                            ? 'bg-green-600 hover:bg-green-700 text-white' 
                            : 'bg-red-50 hover:bg-red-100 text-red-600'
                    }">
                        ${student.is_on_hold ? 'Clear Hold' : 'Place Hold'}
                    </button>
                </td>
            `;

            tr.querySelector('.toggle-hold-btn').addEventListener('click', () => {
                toggleUserHoldStatus(student.id, !student.is_on_hold);
            });

            studentsTbody.appendChild(tr);
        });
    }
}

// GRADE RETURN LOGIC
async function gradeReturnGood(recordId, assetId) {
    try {
        await runTransaction(db, async (transaction) => {
            const recordRef = doc(db, "borrow_records", recordId);
            const assetRef = doc(db, "assets", assetId);

            transaction.update(recordRef, { status: 'RETURNED', returned_at: serverTimestamp(), condition: 'GOOD' });
            transaction.update(assetRef, { status: 'Available', updated_at: serverTimestamp() });
        });
    } catch (error) {
        alert("Failed to grade return: " + error.message);
    }
}

function openDamageModal(recordId, assetId) {
    currentInspectingRecord = { recordId, assetId };
    damageNotes.value = '';
    damageModal.classList.remove('hidden');
}

cancelDamageBtn.addEventListener('click', () => {
    damageModal.classList.add('hidden');
    currentInspectingRecord = null;
});

damageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentInspectingRecord) return;

    const notes = damageNotes.value.trim();
    const { recordId, assetId } = currentInspectingRecord;

    try {
        await runTransaction(db, async (transaction) => {
            const recordRef = doc(db, "borrow_records", recordId);
            const assetRef = doc(db, "assets", assetId);

            transaction.update(recordRef, { 
                status: 'RETURNED_DAMAGED', 
                returned_at: serverTimestamp(), 
                condition: 'DAMAGED',
                damage_notes: notes 
            });
            transaction.update(assetRef, { status: 'Maintenance', updated_at: serverTimestamp() });
        });

        damageModal.classList.add('hidden');
        currentInspectingRecord = null;
    } catch (error) {
        alert("Failed to record damage: " + error.message);
    }
});

// CSV INVENTORY AUDIT EXPORT
exportCsvBtn.addEventListener('click', async () => {
    try {
        const snap = await getDocs(collection(db, "assets"));
        if (snap.empty) {
            alert("No inventory assets to export.");
            return;
        }

        let csv = "Asset Name,Type,Status,Location ID,Quantity,Asset Tag\n";
        snap.forEach(docSnap => {
            const a = docSnap.data();
            const name = `"${(a.name || '').replace(/"/g, '""')}"`;
            const type = `"${(a.type || '').replace(/"/g, '""')}"`;
            const status = `"${(a.status || '').replace(/"/g, '""')}"`;
            const loc = `"${(a.location_id || '').replace(/"/g, '""')}"`;
            const qty = a.quantity || 1;
            const tag = `"${(a.qr_code_str || '').replace(/"/g, '""')}"`;

            csv += `${name},${type},${status},${loc},${qty},${tag}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `EE_Lab_Inventory_Audit_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (err) {
        alert("Failed to export CSV: " + err.message);
    }
});

// ASSET CRUD
async function addAsset(assetData) { await addDoc(collection(db, "assets"), assetData); }
async function updateAsset(id, assetData) { await updateDoc(doc(db, "assets", id), assetData); }
async function deleteAsset(id) {
    if (confirm("Are you sure you want to delete this asset?")) {
        await deleteDoc(doc(db, "assets", id));
    }
}

// FORM HANDLERS
openAddModalBtn.addEventListener('click', () => {
    assetForm.reset();
    document.getElementById('asset-id').value = '';
    modalTitle.textContent = 'Add Asset';
    assetModal.classList.remove('hidden');
});

closeAssetModalBtn.addEventListener('click', () => assetModal.classList.add('hidden'));

function openEditModal(id, asset) {
    document.getElementById('asset-id').value = id;
    document.getElementById('asset-name').value = asset.name;
    document.getElementById('asset-type').value = asset.type;
    document.getElementById('asset-status').value = asset.status;
    document.getElementById('asset-location').value = asset.location_id;
    document.getElementById('asset-quantity').value = asset.quantity;
    document.getElementById('asset-qr-str').value = asset.qr_code_str;
    modalTitle.textContent = 'Edit Asset';
    assetModal.classList.remove('hidden');
}

assetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('asset-id').value;
    const assetData = {
        name: document.getElementById('asset-name').value.trim(),
        type: document.getElementById('asset-type').value,
        status: document.getElementById('asset-status').value,
        location_id: document.getElementById('asset-location').value.trim(),
        quantity: parseInt(document.getElementById('asset-quantity').value, 10),
        qr_code_str: document.getElementById('asset-qr-str').value.trim()
    };

    try {
        if (id) { await updateAsset(id, assetData); } 
        else { await addAsset(assetData); }
        assetModal.classList.add('hidden');
        assetForm.reset();
    } catch (error) {
        alert("Failed to save asset: " + error.message);
    }
});

function getStatusBadge(status) {
    switch (status) {
        case 'Available':
        case 'AVAILABLE':
            return `<span class="bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full font-medium">Available</span>`;
        case 'IN_USE':
            return `<span class="bg-blue-100 text-blue-800 text-xs px-2.5 py-1 rounded-full font-medium">In Use</span>`;
        case 'PENDING_APPROVAL':
            return `<span class="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-medium animate-pulse">Awaiting Pickup</span>`;
        case 'PENDING_INSPECTION':
            return `<span class="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-medium animate-pulse">Pending Inspection</span>`;
        case 'OVERDUE':
            return `<span class="bg-red-100 text-red-800 text-xs px-2.5 py-1 rounded-full font-medium font-bold">Overdue</span>`;
        case 'Maintenance':
            return `<span class="bg-gray-100 text-gray-800 text-xs px-2.5 py-1 rounded-full font-medium">Maintenance</span>`;
        default:
            return `<span class="bg-gray-100 text-gray-800 text-xs px-2.5 py-1 rounded-full font-medium">${escapeHtml(status)}</span>`;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}