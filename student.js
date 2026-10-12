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

// Visual Category SVG Icons Helper
function getCategoryIconSvg(type) {
    const categoryLower = (type || '').toLowerCase();
    
    if (categoryLower.includes('equipment')) {
        // Oscilloscope / Lab Gear Icon
        return `<svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>`;
    } else if (categoryLower.includes('tool')) {
        // Pliers / Hand Tools Icon
        return `<svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"/></svg>`;
    } else {
        // Microchip / Component Icon
        return `<svg class="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`;
    }
}

// SKELETON LOADING UI PLACEHOLDER
function renderSkeletonGrid() {
    shelfGrid.innerHTML = Array(4).fill(0).map(() => `
        <div class="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-3 flex flex-col justify-between animate-pulse h-60">
            <div class="space-y-2.5">
                <div class="flex justify-between">
                    <div class="h-4 w-14 bg-slate-800/80 rounded-md"></div>
                    <div class="h-4 w-16 bg-slate-800/80 rounded-full"></div>
                </div>
                <div class="w-full h-20 bg-slate-950/60 rounded-xl border border-slate-800/40"></div>
                <div class="h-4 w-3/4 bg-slate-800/80 rounded"></div>
                <div class="h-3 w-1/2 bg-slate-800/50 rounded"></div>
            </div>
            <div class="h-8 w-full bg-slate-800/80 rounded-xl"></div>
        </div>
    `).join('');
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

    renderSkeletonGrid();
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
            <div class="col-span-2 text-center text-xs text-rose-300 p-6 border border-rose-900/60 rounded-2xl bg-rose-950/30 backdrop-blur-md shadow-lg">
                <svg class="w-8 h-8 text-rose-400 mx-auto mb-2 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m0 0v2m0-2h2m-2 0H10m0-6h4m-2-4v4"/></svg>
                <p class="font-extrabold text-sm">Account Temporarily On Hold</p>
                <p class="text-[11px] text-rose-300/80 mt-1">Please return overdue items at the counter to restore borrowing privileges.</p>
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
            <div class="col-span-2 text-center text-xs text-slate-500 py-12 bg-slate-900/40 border border-slate-800/60 rounded-2xl backdrop-blur-md">
                <svg class="w-8 h-8 text-slate-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <p class="italic font-medium">No available tools match your search criteria.</p>
            </div>`;
        return;
    }

    shelfGrid.innerHTML = '';
    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = "group relative bg-slate-900/60 border border-slate-800/80 hover:border-blue-500/50 rounded-2xl p-3 flex flex-col justify-between transition-all duration-300 hover:shadow-[0_8px_25px_-5px_rgba(37,99,235,0.15)] hover:-translate-y-0.5 cursor-pointer backdrop-blur-md overflow-hidden";
        
        card.innerHTML = `
            <!-- Top Gradient Accent Line on Hover -->
            <div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>

            <div>
                <!-- Category & Status Badge Header -->
                <div class="flex items-center justify-between gap-1 mb-2.5">
                    <span class="text-[9px] font-extrabold px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700/60 uppercase tracking-wider">
                        ${escapeHtml(item.type)}
                    </span>
                    <span class="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-[0_0_8px_rgba(16,185,129,0.15)]">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Available
                    </span>
                </div>

                <!-- Asset Graphic Placeholder Box -->
                <div class="w-full h-20 rounded-xl bg-gradient-to-b from-slate-950/80 to-slate-900/40 border border-slate-800/60 flex items-center justify-center my-1 group-hover:border-blue-500/30 transition-colors">
                    <div class="p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg group-hover:scale-110 transition-transform duration-300">
                        ${getCategoryIconSvg(item.type)}
                    </div>
                </div>

                <!-- Title & Metadata -->
                <div class="mt-2.5 space-y-1">
                    <h3 class="font-extrabold text-white text-xs leading-snug group-hover:text-blue-300 transition-colors line-clamp-2">
                        ${escapeHtml(item.name)}
                    </h3>
                    <div class="flex items-center justify-between text-[10px] text-slate-400 pt-1.5 border-t border-slate-800/50">
                        <span class="font-mono bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 text-slate-300">${escapeHtml(item.qr_code_str)}</span>
                        <span>Loc: <strong class="text-slate-200 font-medium">${escapeHtml(item.location_id)}</strong></span>
                    </div>
                </div>
            </div>

            <!-- Action Button -->
            <button class="borrow-btn mt-3 w-full py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/20 transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.98]">
                <span>Request Item</span>
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
            </button>
        `;

        // Interactive tap handler for entire card and borrow button
        const handleCardTap = (e) => {
            e.stopPropagation();
            openChecklistModal(item);
        };

        card.addEventListener('click', handleCardTap);
        card.querySelector('.borrow-btn').addEventListener('click', handleCardTap);
        shelfGrid.appendChild(card);
    });
}

// SEARCH & CATEGORY FILTER LISTENERS
shelfSearchInput.addEventListener('input', renderDigitalShelf);
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        document.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.remove('bg-blue-600', 'text-white', 'active-filter', 'shadow-md', 'shadow-blue-600/30');
            b.classList.add('text-slate-400', 'hover:text-slate-200');
        });
        button.classList.add('bg-blue-600', 'text-white', 'active-filter', 'shadow-md', 'shadow-blue-600/30');
        button.classList.remove('text-slate-400', 'hover:text-slate-200');
        selectedCategory = button.getAttribute('data-type');
        renderDigitalShelf();
    });
});

// CHECKLIST MODAL & TOUCH-FRIENDLY SELECTION LOGIC
function openChecklistModal(asset) {
    if (isUserOnHold) return;
    currentSelectedAsset = asset;
    modalAssetName.textContent = asset.name;
    modalAssetQr.textContent = `ID: ${asset.qr_code_str} • Location: ${asset.location_id}`;
    modalErrorMsg.classList.add('hidden');
    
    // Reset selection checkboxes and touch card styling
    document.querySelectorAll('.accessory-checkbox').forEach(cb => {
        cb.checked = false;
        updateChecklistCardStyle(cb);
    });
    
    checklistModal.classList.remove('hidden');
}

document.querySelectorAll('.accessory-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => updateChecklistCardStyle(e.target));
});

function updateChecklistCardStyle(checkbox) {
    const card = checkbox.closest('.checklist-card');
    if (!card) return;

    if (checkbox.checked) {
        card.classList.add('border-blue-500', 'bg-blue-950/40', 'ring-1', 'ring-blue-500/50');
        card.classList.remove('border-slate-800/80', 'bg-slate-950/60');
    } else {
        card.classList.remove('border-blue-500', 'bg-blue-950/40', 'ring-1', 'ring-blue-500/50');
        card.classList.add('border-slate-800/80', 'bg-slate-950/60');
    }
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

// ACTIVE CHECKOUTS & LIVE PICKUP TIMER WITH COLOR-SHIFTING PROGRESS BAR
function listenToActiveCheckouts(uid) {
    const q = query(
        collection(db, "borrow_records"),
        where("student_uid", "==", uid),
        where("status", "in", ["BORROWED", "REQUESTED"])
    );

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            activeCheckoutsList.innerHTML = `
                <div class="text-center py-3.5 bg-slate-950/50 rounded-xl border border-slate-800/80">
                    <p class="text-xs text-slate-500 italic font-medium">No active borrowings or pending pickup requests.</p>
                </div>`;
            return;
        }

        activeCheckoutsList.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const record = docSnap.data();
            const recordId = docSnap.id;
            const card = document.createElement('div');
            card.className = "bg-slate-900/80 border border-slate-800/90 rounded-xl p-3 flex flex-col gap-2 shadow-lg backdrop-blur-sm";
            
            let statusHtml = '';
            if (record.status === 'REQUESTED') {
                const requestedTime = record.requested_at?.toDate ? record.requested_at.toDate().getTime() : Date.now();

                statusHtml = `
                    <div class="w-full space-y-1.5 pt-1">
                        <div class="flex items-center justify-between">
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-950/80 text-amber-300 border border-amber-700/60 shadow-[0_0_10px_rgba(245,158,11,0.15)]">
                                <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span> Awaiting Counter Pickup
                            </span>
                            <span class="text-[10px] text-amber-300 font-mono font-bold student-timer-text" data-requested-at="${requestedTime}">⏱ Calculating...</span>
                        </div>
                        <!-- Live Pickup Color-Shifting Progress Bar -->
                        <div class="w-full bg-slate-950 rounded-full h-2 border border-slate-800/80 overflow-hidden shadow-inner">
                            <div class="student-timer-bar h-full rounded-full transition-all duration-500 bg-emerald-500" data-requested-at="${requestedTime}" style="width: 100%;"></div>
                        </div>
                    </div>
                `;
            } else {
                statusHtml = `
                    <div class="flex items-center justify-between pt-1">
                        <span class="text-[9px] font-extrabold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.15)]">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Checked Out
                        </span>
                        <button class="return-btn bg-amber-600 hover:bg-amber-500 active:scale-95 text-white font-bold text-[11px] px-3 py-1.5 rounded-xl shadow-md transition cursor-pointer flex items-center gap-1">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 15v-1a4 4 0 00-4-4H4m0 0l4 4m-4-4l4-4"/></svg>
                            <span>Return Item</span>
                        </button>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="min-w-0 flex-1">
                    <p class="font-extrabold text-white text-xs sm:text-sm truncate">${escapeHtml(record.asset_name)}</p>
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
    const timerTexts = document.querySelectorAll('.student-timer-text');
    const timerBars = document.querySelectorAll('.student-timer-bar');
    const now = Date.now();

    timerTexts.forEach(cell => {
        const requestedTime = parseInt(cell.getAttribute('data-requested-at'), 10);
        const remainingSecs = Math.max(0, Math.floor((requestedTime + PICKUP_WINDOW_MS - now) / 1000));
        const mins = Math.floor(remainingSecs / 60);
        const secs = remainingSecs % 60;

        cell.textContent = `⏱ ${mins}m ${secs < 10 ? '0' : ''}${secs}s left`;
    });

    timerBars.forEach(bar => {
        const requestedTime = parseInt(bar.getAttribute('data-requested-at'), 10);
        const elapsed = now - requestedTime;
        const remainingMs = Math.max(0, PICKUP_WINDOW_MS - elapsed);
        const percentage = Math.min(100, Math.max(0, (remainingMs / PICKUP_WINDOW_MS) * 100));

        bar.style.width = `${percentage}%`;

        // Color-Shifting Progress Bar (Green -> Amber -> Rose)
        bar.classList.remove('bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'animate-pulse');
        if (percentage > 50) {
            bar.classList.add('bg-emerald-500');
        } else if (percentage > 20) {
            bar.classList.add('bg-amber-500');
        } else {
            bar.classList.add('bg-rose-500', 'animate-pulse');
        }
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
            item.className = "bg-slate-950/80 border border-slate-800/80 rounded-2xl p-3 flex justify-between items-center text-xs backdrop-blur-sm";
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