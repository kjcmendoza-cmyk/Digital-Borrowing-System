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

// Checklist Modal Elements
const checklistModal = document.getElementById('checklist-modal');
const modalAssetName = document.getElementById('modal-asset-name');
const modalAssetQr = document.getElementById('modal-asset-qr');
const modalErrorMsg = document.getElementById('modal-error-msg');
const cancelCheckoutBtn = document.getElementById('cancel-checkout-btn');
const confirmCheckoutBtn = document.getElementById('confirm-checkout-btn');

// App State
let currentUser = null;
let currentSelectedAsset = null;
let isUserOnHold = false;
let availableAssets = [];
let selectedCategory = 'ALL';

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
            const userData = userSnap.data();
            isUserOnHold = userData.is_on_hold || false;

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
        renderDigitalShelf();
    });
}

function renderDigitalShelf() {
    if (isUserOnHold) {
        shelfGrid.innerHTML = `<div class="col-span-2 text-center text-xs text-rose-400 p-4 border border-rose-900/50 rounded-2xl bg-rose-950/20">Account locked. Clear overdue items at the counter to borrow tools.</div>`;
        return;
    }

    const searchStr = shelfSearchInput.value.toLowerCase().trim();
    const filtered = availableAssets.filter(item => {
        const matchesCategory = selectedCategory === 'ALL' || item.type === selectedCategory;
        const matchesSearch = item.name.toLowerCase().includes(searchStr) || item.qr_code_str.toLowerCase().includes(searchStr);
        return matchesCategory && matchesSearch;
    });

    if (filtered.length === 0) {
        shelfGrid.innerHTML = `<div class="col-span-2 text-center text-xs text-slate-500 py-8 italic">No available tools match your search.</div>`;
        return;
    }

    shelfGrid.innerHTML = '';
    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = "bg-slate-900 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between shadow-md hover:border-blue-500/50 transition";
        card.innerHTML = `
            <div>
                <span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">${escapeHtml(item.type)}</span>
                <h3 class="font-bold text-white text-xs mt-2 leading-tight">${escapeHtml(item.name)}</h3>
                <p class="text-[10px] text-slate-400 font-mono mt-1">${escapeHtml(item.qr_code_str)} • Loc: ${escapeHtml(item.location_id)}</p>
            </div>
            <button class="borrow-btn mt-3 w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[11px] font-bold shadow-md transition cursor-pointer">
                Borrow Tool
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
        document.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.remove('bg-blue-600', 'text-white', 'active-filter');
            b.classList.add('bg-slate-900', 'text-slate-400');
        });
        e.target.classList.add('bg-blue-600', 'text-white', 'active-filter');
        e.target.classList.remove('bg-slate-900', 'text-slate-400');
        selectedCategory = e.target.getAttribute('data-type');
        renderDigitalShelf();
    });
});

// CHECKLIST MODAL CONTROLLERS
function openChecklistModal(asset) {
    if (isUserOnHold) return;
    currentSelectedAsset = asset;
    modalAssetName.textContent = asset.name;
    modalAssetQr.textContent = `ID: ${asset.qr_code_str}`;
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
            activeCheckoutsList.innerHTML = `<p class="text-xs text-slate-500 italic text-center py-2">No active borrowings or pending requests.</p>`;
            return;
        }

        activeCheckoutsList.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const record = docSnap.data();
            const card = document.createElement('div');
            card.className = "bg-slate-900 border border-slate-800 rounded-2xl p-3 flex justify-between items-center text-xs shadow-md";
            
            let statusHtml = '';
            if (record.status === 'REQUESTED') {
                const requestedTime = record.requested_at?.toDate ? record.requested_at.toDate().getTime() : Date.now();

                statusHtml = `
                    <div class="text-right">
                        <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-800 animate-pulse">Awaiting Pickup</span>
                        <p class="text-[10px] text-amber-300 font-mono mt-1 font-bold student-timer-cell" data-requested-at="${requestedTime}">⏱ Calculating...</p>
                    </div>
                `;
            } else {
                statusHtml = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">Checked Out</span>`;
            }

            card.innerHTML = `
                <div>
                    <p class="font-bold text-white text-sm">${escapeHtml(record.asset_name)}</p>
                    <p class="text-slate-400 font-mono text-[10px]">${escapeHtml(record.qr_code_str)}</p>
                </div>
                ${statusHtml}
            `;
            activeCheckoutsList.appendChild(card);
        });

        // Run immediately and ensure interval is running
        updateStudentTimers();
        if (!studentTimerInterval) {
            studentTimerInterval = setInterval(updateStudentTimers, 1000);
        }
    });
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