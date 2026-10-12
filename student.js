import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { 
    getFirestore,
    enableIndexedDbPersistence,
    collection,
    doc,
    getDocs,
    updateDoc, 
    query,
    where,
    runTransaction,
    serverTimestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

// Firebase Config
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

// 1. OFFLINE PERSISTENCE
enableIndexedDbPersistence(db).catch((err) => {
    console.warn('Firestore offline persistence warning:', err.code);
});

const PICKUP_WINDOW_MS = 5 * 60 * 1000; // 5-minute pickup window

// DOM Elements
const userEmailDisplay = document.getElementById('user-email-display');
const logoutBtn = document.getElementById('logout-btn');
const accountLockedAlert = document.getElementById('account-locked-alert');
const shelfGrid = document.getElementById('shelf-grid');
const shelfSearchInput = document.getElementById('shelf-search-input');
const activeCheckoutsList = document.getElementById('active-checkouts-list');

// Category Counters
const countAll = document.getElementById('count-all');
const countEquipment = document.getElementById('count-equipment');
const countTool = document.getElementById('count-tool');
const countComponent = document.getElementById('count-component');

// Checklist Modal Elements
const checklistModal = document.getElementById('checklist-modal');
const modalAssetName = document.getElementById('modal-asset-name');
const modalAssetQr = document.getElementById('modal-asset-qr');
const modalErrorMsg = document.getElementById('modal-error-msg');
const cancelCheckoutBtn = document.getElementById('cancel-checkout-btn');
const confirmCheckoutBtn = document.getElementById('confirm-checkout-btn');

// App State
let currentUser = null;
let userProfile = null;
let currentSelectedAsset = null;
let isUserOnHold = false;
let availableAssets = [];
let selectedCategory = 'ALL';

// SVG Icon Helper for Item Categories
function getCategoryIconSvg(type) {
    const categoryLower = (type || '').toLowerCase();
    
    if (categoryLower.includes('equipment')) {
        return `<svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>`;
    } else if (categoryLower.includes('tool')) {
        return `<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"/></svg>`;
    } else {
        return `<svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`;
    }
}

// SECURITY GATE & REAL-TIME HOLD CHECK
onAuthStateChanged(auth, async (user) => {
    if (!user || !user.email.endsWith('@addu.edu.ph')) {
        await signOut(auth);
        window.location.href = 'login.html';
        return;
    }

    currentUser = user;
    userEmailDisplay.textContent = user.email;

    onSnapshot(doc(db, "users", user.uid), (userSnap) => {
        if (userSnap.exists()) {
            userProfile = userSnap.data();
            isUserOnHold = userProfile.is_on_hold || false;

            if (isUserOnHold) {
                accountLockedAlert.classList.remove('hidden');
            } else {
                accountLockedAlert.classList.add('hidden');
            }
            renderDigitalShelf();
        }
    });

    listenToDigitalShelf();
    listenToActiveCheckouts(user.uid);
});

logoutBtn.addEventListener('click', () => signOut(auth).then(() => window.location.href = 'login.html'));

// DIGITAL SHELF REAL-TIME LISTENER
function listenToDigitalShelf() {
    const q = query(collection(db, "assets"), where("status", "==", "Available"));

    onSnapshot(q, (snapshot) => {
        availableAssets = [];
        snapshot.forEach(docSnap => availableAssets.push({ id: docSnap.id, ...docSnap.data() }));
        
        updateCategoryCounts();
        renderDigitalShelf();
    });
}

function updateCategoryCounts() {
    const total = availableAssets.length;
    const equipCount = availableAssets.filter(i => i.type === 'Equipment').length;
    const toolCount = availableAssets.filter(i => i.type === 'Tool').length;
    const compCount = availableAssets.filter(i => i.type === 'Component').length;

    if (countAll) countAll.textContent = total;
    if (countEquipment) countEquipment.textContent = equipCount;
    if (countTool) countTool.textContent = toolCount;
    if (countComponent) countComponent.textContent = compCount;
}

function renderDigitalShelf() {
    if (isUserOnHold) {
        shelfGrid.innerHTML = `
            <div class="col-span-2 text-center text-xs text-rose-300 p-5 border border-rose-900/60 rounded-2xl bg-rose-950/30 backdrop-blur-sm">
                <svg class="w-6 h-6 text-rose-400 mx-auto mb-1.5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m0 0v2m0-2h2m-2 0H10m0-6h4m-2-4v4"/></svg>
                <p class="font-bold">Account Temporarily On Hold</p>
                <p class="text-[11px] text-rose-400/80 mt-1">Please return overdue items at the counter to restore borrowing privileges.</p>
            </div>`;
        return;
    }

    const searchStr = shelfSearchInput.value.toLowerCase().trim();
    const filtered = availableAssets.filter(item => {
        const matchesCategory = selectedCategory === 'ALL' || item.type === selectedCategory;
        const matchesSearch = item.name.toLowerCase().includes(searchStr) || 
                              item.qr_code_str.toLowerCase().includes(searchStr) ||
                              (item.location_id && item.location_id.toLowerCase().includes(searchStr));
        return matchesCategory && matchesSearch;
    });

    if (filtered.length === 0) {
        shelfGrid.innerHTML = `
            <div class="col-span-2 text-center text-xs text-slate-500 py-10 bg-slate-900/30 border border-slate-800/50 rounded-2xl">
                <svg class="w-8 h-8 text-slate-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <p class="italic">No available tools match your search criteria.</p>
            </div>`;
        return;
    }

    shelfGrid.innerHTML = '';
    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = "bg-slate-900/90 border border-slate-800 hover:border-blue-500/50 rounded-2xl p-3.5 flex flex-col justify-between shadow-lg transition duration-200 group relative";
        
        card.innerHTML = `
            <div>
                <!-- Top Badge & Stock Status -->
                <div class="flex items-center justify-between gap-1 mb-2">
                    <span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wider">
                        ${escapeHtml(item.type)}
                    </span>
                    <span class="text-[9px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> In Stock
                    </span>
                </div>

                <!-- Icon & Title Row -->
                <div class="flex items-start gap-2.5 my-1">
                    <div class="p-2 bg-slate-950 border border-slate-800 rounded-xl shrink-0 group-hover:border-blue-500/40 transition">
                        ${getCategoryIconSvg(item.type)}
                    </div>
                    <div class="min-w-0 flex-1">
                        <h3 class="font-bold text-white text-xs sm:text-sm leading-snug group-hover:text-blue-300 transition line-clamp-2">
                            ${escapeHtml(item.name)}
                        </h3>
                    </div>
                </div>

                <!-- Metadata Row -->
                <div class="mt-2.5 space-y-1 pt-2 border-t border-slate-800/60">
                    <div class="flex items-center justify-between text-[10px] text-slate-400">
                        <span class="font-mono bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800/80 text-slate-300">${escapeHtml(item.qr_code_str)}</span>
                        <span class="flex items-center gap-1 text-slate-400">
                            <svg class="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                            <strong class="text-slate-300 font-medium">${escapeHtml(item.location_id)}</strong>
                        </span>
                    </div>
                </div>
            </div>

            <!-- Action Button -->
            <button class="borrow-btn mt-3 w-full py-2 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 transition cursor-pointer flex items-center justify-center gap-1.5">
                <span>Borrow Tool</span>
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
            </button>
        `;

        card.querySelector('.borrow-btn').addEventListener('click', () => openChecklistModal(item));
        shelfGrid.appendChild(card);
    });
}

// SEARCH & CATEGORY FILTER LISTENERS
shelfSearchInput.addEventListener('input', renderDigitalShelf);
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        document.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.remove('bg-blue-600', 'text-white', 'active-filter', 'shadow-sm', 'shadow-blue-600/30');
            b.classList.add('bg-slate-900', 'text-slate-400', 'border', 'border-slate-800');
        });
        button.classList.add('bg-blue-600', 'text-white', 'active-filter', 'shadow-sm', 'shadow-blue-600/30');
        button.classList.remove('bg-slate-900', 'text-slate-400', 'border', 'border-slate-800');
        selectedCategory = button.getAttribute('data-type');
        renderDigitalShelf();
    });
});

// CHECKLIST MODAL CONTROLLERS
function openChecklistModal(asset) {
    if (isUserOnHold) return;
    currentSelectedAsset = asset;
    modalAssetName.textContent = asset.name;
    modalAssetQr.textContent = `ID: ${asset.qr_code_str} • Location: ${asset.location_id}`;
    modalErrorMsg.classList.add('hidden');
    document.querySelectorAll('.accessory-checkbox').forEach(cb => cb.checked = false);
    checklistModal.classList.remove('hidden');
}

cancelCheckoutBtn.addEventListener('click', () => {
    checklistModal.classList.add('hidden');
    currentSelectedAsset = null;
});

confirmCheckoutBtn.addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.accessory-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);

    if (!allChecked) {
        modalErrorMsg.textContent = "Please verify all checklist items before submitting.";
        modalErrorMsg.classList.remove('hidden');
        return;
    }

    confirmCheckoutBtn.disabled = true;

    try {
        await submitBorrowRequest(currentSelectedAsset.id);
        checklistModal.classList.add('hidden');
        alert(`Request placed! Please proceed to the counter within 5 minutes to collect ${currentSelectedAsset.name}.`);
    } catch (error) {
        alert("Request Failed: " + error.message);
    } finally {
        confirmCheckoutBtn.disabled = false;
        currentSelectedAsset = null;
    }
});

async function submitBorrowRequest(assetId) {
    await runTransaction(db, async (transaction) => {
        const assetRef = doc(db, "assets", assetId);
        const assetSnap = await transaction.get(assetRef);

        if (!assetSnap.exists()) throw new Error("Asset document no longer exists.");
        const assetData = assetSnap.data();

        if (assetData.status !== 'Available' && assetData.status !== 'AVAILABLE') {
            throw new Error(`Asset "${assetData.name}" is no longer available.`);
        }

        transaction.update(assetRef, { 
            status: 'PENDING_APPROVAL',
            updated_at: serverTimestamp()
        });

        const recordRef = doc(collection(db, "borrow_records"));
        transaction.set(recordRef, {
            asset_id: assetId,
            asset_name: assetData.name,
            qr_code_str: assetData.qr_code_str,
            student_uid: currentUser.uid,
            student_email: currentUser.email,
            student_name: (userProfile && userProfile.name) ? userProfile.name : 'Student Account',
            student_course: (userProfile && userProfile.course) ? userProfile.course : 'AdDU Student',
            student_year_level: (userProfile && userProfile.year_level) ? userProfile.year_level : '1st Year',
            requested_at: serverTimestamp(),
            status: 'REQUESTED',
            checklist_verified: true
        });
    });
}

let studentTimerInterval = null;

// ACTIVE CHECKOUTS & LIVE PICKUP TIMER
function listenToActiveCheckouts(uid) {
    const q = query(
        collection(db, "borrow_records"),
        where("student_uid", "==", uid),
        where("status", "in", ["BORROWED", "REQUESTED"])
    );

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            activeCheckoutsList.innerHTML = `
                <div class="text-center py-3 bg-slate-950/50 rounded-xl border border-slate-800/80">
                    <p class="text-xs text-slate-500 italic">No active borrowings or pending pickup requests.</p>
                </div>`;
            return;
        }

        activeCheckoutsList.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const record = docSnap.data();
            const recordId = docSnap.id;
            const card = document.createElement('div');
            card.className = "bg-slate-900 border border-slate-800 rounded-xl p-3 flex justify-between items-center text-xs shadow-md";
            
            let statusHtml = '';
            if (record.status === 'REQUESTED') {
                const requestedTime = record.requested_at?.toDate ? record.requested_at.toDate().getTime() : Date.now();

                statusHtml = `
                    <div class="text-right">
                        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-400 border border-amber-700/60">
                            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Awaiting Pickup
                        </span>
                        <p class="text-[11px] text-amber-300 font-mono mt-1 font-bold student-timer-cell" data-requested-at="${requestedTime}">⏱ Calculating...</p>
                    </div>
                `;
            } else {
                statusHtml = `
                    <button class="return-btn bg-amber-600 hover:bg-amber-500 active:scale-95 text-white font-bold text-[11px] px-3 py-1.5 rounded-xl shadow-md transition cursor-pointer flex items-center gap-1">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 15v-1a4 4 0 00-4-4H4m0 0l4 4m-4-4l4-4"/></svg>
                        <span>Return Item</span>
                    </button>
                `;
            }

            card.innerHTML = `
                <div class="min-w-0 flex-1 pr-2">
                    <p class="font-bold text-white text-xs sm:text-sm truncate">${escapeHtml(record.asset_name)}</p>
                    <p class="text-slate-400 font-mono text-[10px] mt-0.5">${escapeHtml(record.qr_code_str)}</p>
                </div>
                ${statusHtml}
            `;

            if (record.status === 'BORROWED') {
                card.querySelector('.return-btn').addEventListener('click', () => stageReturn(recordId, record.asset_name));
            }

            activeCheckoutsList.appendChild(card);
        });

        // Run immediately and ensure interval is running
        updateStudentTimers();
        if (!studentTimerInterval) {
            studentTimerInterval = setInterval(updateStudentTimers, 1000);
        }
    });
}

async function stageReturn(recordId, assetName) {
    if (!confirm(`Are you sure you want to return ${assetName} to the Return Shelf?`)) return;

    try {
        await updateDoc(doc(db, "borrow_records", recordId), {
            status: 'STAGED',
            staged_at: serverTimestamp()
        });
        alert(`"${assetName}" staged for return! Please place it on the Return Shelf for admin inspection.`);
    } catch (err) {
        alert("Failed to return item: " + err.message);
    }
}

function updateStudentTimers() {
    const timerCells = document.querySelectorAll('.student-timer-cell');
    const now = Date.now();

    timerCells.forEach(cell => {
        const requestedTime = parseInt(cell.getAttribute('data-requested-at'), 10);
        const remainingSecs = Math.max(0, Math.floor((requestedTime + PICKUP_WINDOW_MS - now) / 1000));
        const mins = Math.floor(remainingSecs / 60);
        const secs = remainingSecs % 60;

        cell.textContent = `⏱ ${mins}m ${secs < 10 ? '0' : ''}${secs}s left`;
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

// BORROWING HISTORY LOG MODAL HANDLERS
const openHistoryBtn = document.getElementById('open-history-btn');
const historyModal = document.getElementById('history-modal');
const historyList = document.getElementById('history-list');
const closeHistoryModalBtn = document.getElementById('close-history-modal-btn');

openHistoryBtn.addEventListener('click', async () => {
    historyModal.classList.remove('hidden');
    historyList.innerHTML = `<p class="text-xs text-slate-500 italic text-center py-4">Loading borrowing history...</p>`;

    try {
        const q = query(
            collection(db, "borrow_records"),
            where("student_uid", "==", currentUser.uid)
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            historyList.innerHTML = `<p class="text-xs text-slate-500 italic text-center py-4">No past borrowing history found.</p>`;
            return;
        }

        const records = [];
        snap.forEach(d => records.push({ id: d.id, ...d.data() }));

        const pastRecords = records
            .filter(r => r.status !== 'BORROWED' && r.status !== 'REQUESTED')
            .sort((a, b) => (b.requested_at || 0) - (a.requested_at || 0));

        if (pastRecords.length === 0) {
            historyList.innerHTML = `<p class="text-xs text-slate-500 italic text-center py-4">No past returned records found.</p>`;
            return;
        }

        historyList.innerHTML = '';
        pastRecords.forEach(rec => {
            const dateStr = rec.borrowed_at?.toDate ? rec.borrowed_at.toDate().toLocaleDateString() : 'Recent';
            let badgeHtml = '';

            if (rec.status === 'STAGED') {
                badgeHtml = `<span class="bg-amber-900/60 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-700/50">Staged Return</span>`;
            } else if (rec.status === 'RETURNED' && rec.condition === 'GOOD') {
                badgeHtml = `<span class="bg-emerald-950 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-800">Returned (Good)</span>`;
            } else if (rec.condition === 'DAMAGED') {
                badgeHtml = `<span class="bg-rose-950 text-rose-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-800">Returned (Damaged)</span>`;
            } else {
                badgeHtml = `<span class="bg-slate-800 text-slate-300 text-[10px] font-bold px-2 py-0.5 rounded-full">${escapeHtml(rec.status)}</span>`;
            }

            const item = document.createElement('div');
            item.className = "bg-slate-950 border border-slate-800 rounded-2xl p-3 flex justify-between items-center text-xs";
            item.innerHTML = `
                <div>
                    <p class="font-bold text-slate-200">${escapeHtml(rec.asset_name)}</p>
                    <p class="text-[10px] text-slate-500 font-mono">${escapeHtml(rec.qr_code_str)} • ${dateStr}</p>
                </div>
                <div>${badgeHtml}</div>
            `;
            historyList.appendChild(item);
        });

    } catch (err) {
        console.error("History fetch error:", err);
        historyList.innerHTML = `<p class="text-xs text-rose-400 text-center py-4">Failed to load history.</p>`;
    }
});

closeHistoryModalBtn.addEventListener('click', () => historyModal.classList.add('hidden'));