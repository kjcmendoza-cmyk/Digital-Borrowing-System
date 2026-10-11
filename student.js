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

// DOM Elements
const userEmailDisplay = document.getElementById('user-email-display');
const logoutBtn = document.getElementById('logout-btn');
const scannerWrapper = document.getElementById('scanner-wrapper');
const scannerControls = document.getElementById('scanner-controls');
const accountLockedAlert = document.getElementById('account-locked-alert');
const scannerStatus = document.getElementById('scanner-status');
const toggleCameraBtn = document.getElementById('toggle-camera-btn');
const torchBtn = document.getElementById('torch-btn');
const feedbackCard = document.getElementById('feedback-card');
const offlineBanner = document.getElementById('offline-banner');
const activeCheckoutsList = document.getElementById('active-checkouts-list');

// Manual Entry Modal Elements
const openManualBtn = document.getElementById('open-manual-btn');
const manualModal = document.getElementById('manual-modal');
const manualForm = document.getElementById('manual-form');
const manualQrInput = document.getElementById('manual-qr-input');
const closeManualModalBtn = document.getElementById('close-manual-modal-btn');
const cancelManualBtn = document.getElementById('cancel-manual-btn');

// History Modal Elements
const openHistoryBtn = document.getElementById('open-history-btn');
const historyModal = document.getElementById('history-modal');
const historyList = document.getElementById('history-list');
const closeHistoryModalBtn = document.getElementById('close-history-modal-btn');

// Checklist Modal Elements
const checklistModal = document.getElementById('checklist-modal');
const modalAssetName = document.getElementById('modal-asset-name');
const modalAssetQr = document.getElementById('modal-asset-qr');
const modalErrorMsg = document.getElementById('modal-error-msg');
const cancelCheckoutBtn = document.getElementById('cancel-checkout-btn');
const confirmCheckoutBtn = document.getElementById('confirm-checkout-btn');

// App State
let currentUser = null;
let html5QrCode = null;
let isScanning = false;
let isTorchOn = false;
let currentScannedAsset = null;
let isUserOnHold = false;

// Connectivity Listener
function handleConnectivityChange() {
    if (!navigator.onLine) {
        offlineBanner.classList.remove('hidden');
    } else {
        offlineBanner.classList.add('hidden');
    }
}
window.addEventListener('offline', handleConnectivityChange);
window.addEventListener('online', handleConnectivityChange);
handleConnectivityChange();

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
                scannerWrapper.classList.add('hidden');
                scannerControls.classList.add('hidden');
                openManualBtn.classList.add('hidden');
                showFeedback("Account Locked", "Please return overdue items to clear your hold.", "red");
                pauseScanner();
            } else {
                accountLockedAlert.classList.add('hidden');
                scannerWrapper.classList.remove('hidden');
                scannerControls.classList.remove('hidden');
                openManualBtn.classList.remove('hidden');
                if (!html5QrCode) {
                    initScanner();
                } else if (!isScanning) {
                    resumeScanner();
                }
            }
        }
    });

    listenToActiveCheckouts(user.uid);
});

logoutBtn.addEventListener('click', () => signOut(auth).then(() => window.location.href = 'login.html'));

// ACTIVE CHECKOUTS & DUE TIMERS
function listenToActiveCheckouts(uid) {
    const q = query(
        collection(db, "borrow_records"),
        where("student_uid", "==", uid),
        where("status", "==", "BORROWED")
    );

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            activeCheckoutsList.innerHTML = `<p class="text-xs text-slate-500 italic text-center py-2">No active borrowings.</p>`;
            return;
        }

        activeCheckoutsList.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const record = docSnap.data();
            const isPendingSync = snapshot.metadata.hasPendingWrites || docSnap.metadata.hasPendingWrites;
            const dueStatusHtml = calculateDueHtml(record.borrowed_at);

            const card = document.createElement('div');
            card.className = "bg-slate-900 border border-slate-800 rounded-2xl p-3 flex justify-between items-center text-xs shadow-md";
            card.innerHTML = `
                <div>
                    <p class="font-bold text-white text-sm">${escapeHtml(record.asset_name)}</p>
                    <p class="text-slate-400 font-mono text-[10px]">${escapeHtml(record.qr_code_str)}</p>
                    <div class="mt-1">${dueStatusHtml}</div>
                </div>
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${
                    isPendingSync 
                        ? 'bg-amber-900/60 text-amber-300 border border-amber-700/50 animate-pulse' 
                        : 'bg-emerald-950 text-emerald-400 border border-emerald-800/80'
                }">
                    ${isPendingSync ? 'Queued (Offline)' : 'Checked Out'}
                </span>
            `;
            activeCheckoutsList.appendChild(card);
        });
    });
}

function calculateDueHtml(borrowedAt) {
    if (!borrowedAt) return `<span class="text-slate-500 text-[11px]">Due Today</span>`;
    const borrowedTime = borrowedAt.toDate ? borrowedAt.toDate() : new Date(borrowedAt);
    const dueTime = new Date(borrowedTime.getTime() + (4 * 60 * 60 * 1000)); // Standard 4-hour loan
    const now = new Date();

    const formattedTime = dueTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (now > dueTime) {
        return `<span class="text-rose-400 font-bold text-[11px] flex items-center gap-1">⚠️ OVERDUE (Was due ${formattedTime})</span>`;
    }
    return `<span class="text-slate-400 text-[11px]">🕒 Due by ${formattedTime}</span>`;
}

// SCANNER CONTROLLERS
function pauseScanner() {
    if (html5QrCode && isScanning) {
        try {
            html5QrCode.pause(true);
        } catch (e) {
            console.warn("Pause scanner warning:", e);
        }
    }
}

function resumeScanner() {
    if (html5QrCode && !isUserOnHold) {
        try {
            html5QrCode.resume();
        } catch (e) {
            console.warn("Resume scanner warning:", e);
        }
    }
}

function initScanner() {
    if (isUserOnHold) return;

    html5QrCode = new Html5Qrcode("qr-reader");
    const config = { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 };

    html5QrCode.start(
        { facingMode: "environment" }, 
        config, 
        onScanSuccess, 
        onScanFailure
    ).then(() => {
        isScanning = true;
        updateScannerStatus(true, "Camera Active");
    }).catch((err) => {
        console.error("Camera Start Error:", err);
        updateScannerStatus(false, "Camera Offline");
    });
}

async function onScanSuccess(decodedText) {
    if (isUserOnHold) return;

    pauseScanner();
    const scannedCode = decodedText.trim();

    if (scannedCode === 'RETURN_SHELF' || scannedCode === 'EE-RETURN-SHELF') {
        await handleReturnShelfDropOff();
        return;
    }

    try {
        const q = query(collection(db, "assets"), where("qr_code_str", "==", scannedCode));
        const querySnap = await getDocs(q);

        if (querySnap.empty) {
            showFeedback("Unrecognized Asset", `No asset found matching "${scannedCode}".`, "red");
            setTimeout(resumeScanner, 3000);
            return;
        }

        const assetDocSnap = querySnap.docs[0];
        currentScannedAsset = { id: assetDocSnap.id, ...assetDocSnap.data() };

        if (currentScannedAsset.status !== 'AVAILABLE' && currentScannedAsset.status !== 'Available') {
            showTransferLockoutError(`Transfer Lockout: Asset is currently ${currentScannedAsset.status}.`);
            setTimeout(resumeScanner, 3500);
            return;
        }

        openChecklistModal(currentScannedAsset);

    } catch (error) {
        console.error("Lookup Error:", error);
        showFeedback("Database Error", "Failed to query asset.", "red");
        setTimeout(resumeScanner, 3000);
    }
}

function onScanFailure() {}

async function handleReturnShelfDropOff() {
    try {
        const q = query(
            collection(db, "borrow_records"),
            where("student_uid", "==", currentUser.uid),
            where("status", "==", "BORROWED")
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            showFeedback("No Active Items", "You have no borrowed items to return.", "gray");
            setTimeout(resumeScanner, 3000);
            return;
        }

        await runTransaction(db, async (transaction) => {
            for (const docSnap of snap.docs) {
                const record = docSnap.data();
                const recordRef = doc(db, "borrow_records", docSnap.id);
                const assetRef = doc(db, "assets", record.asset_id);

                const assetSnap = await transaction.get(assetRef);
                if (assetSnap.exists()) {
                    transaction.update(recordRef, { status: 'STAGED', staged_at: serverTimestamp() });
                    transaction.update(assetRef, { status: 'PENDING_INSPECTION', updated_at: serverTimestamp() });
                }
            }
        });

        showFeedback("Return Staged!", "Placed on Return Shelf. Awaiting Admin Inspection.", "green");
        setTimeout(resumeScanner, 4000);

    } catch (error) {
        showFeedback("Staging Failed", error.message, "red");
        setTimeout(resumeScanner, 3000);
    }
}

// CHECKLIST MODAL CONTROLLERS
function openChecklistModal(asset) {
    modalAssetName.textContent = asset.name;
    modalAssetQr.textContent = `QR: ${asset.qr_code_str}`;
    modalErrorMsg.classList.add('hidden');
    document.querySelectorAll('.accessory-checkbox').forEach(cb => cb.checked = false);
    checklistModal.classList.remove('hidden');
}

cancelCheckoutBtn.addEventListener('click', () => {
    checklistModal.classList.add('hidden');
    currentScannedAsset = null;
    resumeScanner();
});

confirmCheckoutBtn.addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.accessory-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);

    if (!allChecked) {
        modalErrorMsg.textContent = "Please verify and check all items before proceeding.";
        modalErrorMsg.classList.remove('hidden');
        return;
    }

    confirmCheckoutBtn.disabled = true;

    try {
        await executeCheckoutTransaction(currentScannedAsset.id);
        checklistModal.classList.add('hidden');
        showFeedback("Checkout Successful!", `You have borrowed ${currentScannedAsset.name}.`, "green");
    } catch (error) {
        showFeedback("Transaction Failed", error.message, "red");
        checklistModal.classList.add('hidden');
    } finally {
        confirmCheckoutBtn.disabled = false;
        currentScannedAsset = null;
        setTimeout(resumeScanner, 4000);
    }
});

async function executeCheckoutTransaction(assetId) {
    await runTransaction(db, async (transaction) => {
        const assetRef = doc(db, "assets", assetId);
        const assetSnap = await transaction.get(assetRef);

        if (!assetSnap.exists()) throw new Error("Asset document no longer exists.");
        const assetData = assetSnap.data();

        if (assetData.status !== 'AVAILABLE' && assetData.status !== 'Available') {
            throw new Error(`Transfer Lockout: Asset "${assetData.name}" is already ${assetData.status}.`);
        }

        transaction.update(assetRef, { 
            status: 'IN_USE',
            last_borrowed_by: currentUser.email,
            updated_at: serverTimestamp()
        });

        const recordRef = doc(collection(db, "borrow_records"));
        transaction.set(recordRef, {
            asset_id: assetId,
            asset_name: assetData.name,
            qr_code_str: assetData.qr_code_str,
            student_uid: currentUser.uid,
            student_email: currentUser.email,
            borrowed_at: serverTimestamp(),
            status: 'BORROWED',
            checklist_verified: true
        });
    });
}

// MANUAL QR CODE MODAL HANDLERS
openManualBtn.addEventListener('click', () => {
    pauseScanner();
    manualQrInput.value = '';
    manualModal.classList.remove('hidden');
});

const closeManualModal = () => {
    manualModal.classList.add('hidden');
    resumeScanner();
};

closeManualModalBtn.addEventListener('click', closeManualModal);
cancelManualBtn.addEventListener('click', closeManualModal);

manualForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = manualQrInput.value.trim();
    if (!val) return;
    manualModal.classList.add('hidden');
    await onScanSuccess(val);
});

// TORCH / FLASHLIGHT CONTROLLER
torchBtn.addEventListener('click', async () => {
    if (!html5QrCode || !isScanning) {
        alert("Camera is not active.");
        return;
    }

    try {
        const videoElem = document.querySelector('#qr-reader video');
        if (videoElem && videoElem.srcObject) {
            const track = videoElem.srcObject.getVideoTracks()[0];
            if (track && track.getCapabilities && track.getCapabilities().torch) {
                isTorchOn = !isTorchOn;
                await track.applyConstraints({ advanced: [{ torch: isTorchOn }] });
                torchBtn.classList.toggle('bg-amber-500/40', isTorchOn);
            } else {
                alert("Flashlight is not supported on this camera/device.");
            }
        }
    } catch (err) {
        console.warn("Torch toggle error:", err);
        alert("Could not activate camera torch.");
    }
});

// BORROWING HISTORY LOG MODAL
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

        // Filter and sort locally to avoid composite index requirements
        const pastRecords = records
            .filter(r => r.status !== 'BORROWED')
            .sort((a, b) => (b.borrowed_at || 0) - (a.borrowed_at || 0));

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

// CAMERA HARDWARE CONTROLS
async function startCamera() {
    if (isUserOnHold) return;

    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
    }

    if (!isScanning) {
        const config = { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 };
        try {
            await html5QrCode.start(
                { facingMode: "environment" }, 
                config, 
                onScanSuccess, 
                onScanFailure
            );
            isScanning = true;
            updateScannerStatus(true, "Camera On");
            showFeedback("Ready to scan equipment", "Point camera at any asset or Return Shelf label.", "gray");
        } catch (err) {
            console.error("Camera Hardware Start Error:", err);
            updateScannerStatus(false, "Camera Off");
            showFeedback("Camera Access Error", "Please allow camera permissions in browser settings.", "red");
        }
    }
}

async function stopCamera() {
    if (html5QrCode && isScanning) {
        try {
            await html5QrCode.stop();
            isScanning = false;
            updateScannerStatus(false, "Camera Off");
        } catch (err) {
            console.error("Failed to release camera hardware:", err);
            isScanning = false;
            updateScannerStatus(false, "Camera Off");
        }
    }
}

toggleCameraBtn.addEventListener('click', async () => {
    toggleCameraBtn.disabled = true;
    if (isScanning) {
        await stopCamera();
    } else {
        await startCamera();
    }
    toggleCameraBtn.disabled = false;
});

function updateScannerStatus(active, label) {
    scannerStatus.textContent = label;
    const statusDot = document.getElementById('status-ping');
    const cameraOffScreen = document.getElementById('camera-off-screen');

    if (active) {
        scannerStatus.className = "text-xs font-bold text-emerald-400 tracking-wide";
        if (statusDot) statusDot.classList.remove('hidden');
        if (cameraOffScreen) cameraOffScreen.classList.add('hidden');
        
        toggleCameraBtn.textContent = "Turn Off Camera";
        toggleCameraBtn.className = "text-xs font-semibold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1 rounded-lg transition-all cursor-pointer";
    } else {
        scannerStatus.className = "text-xs font-bold text-slate-400 tracking-wide";
        if (statusDot) statusDot.classList.add('hidden');
        if (cameraOffScreen) cameraOffScreen.classList.remove('hidden');

        toggleCameraBtn.textContent = "Turn On Camera";
        toggleCameraBtn.className = "text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1 rounded-lg transition-all cursor-pointer";
    }
}

function showTransferLockoutError(message) {
    feedbackCard.className = "bg-red-950/80 border border-red-700 rounded-xl p-4 text-center text-red-200 animate-pulse";
    feedbackCard.innerHTML = `<p class="text-sm font-bold text-red-400">⚠️ Transfer Lockout</p><p class="text-xs text-red-300 mt-1">${escapeHtml(message)}</p>`;
}

function showFeedback(title, subtitle, theme = "gray") {
    const themeStyles = {
        gray: "bg-gray-800 border-gray-700 text-gray-300",
        blue: "bg-blue-950/60 border-blue-800 text-blue-200",
        green: "bg-green-950/60 border-green-800 text-green-200",
        red: "bg-red-950/60 border-red-800 text-red-200"
    };

    feedbackCard.className = `${themeStyles[theme] || themeStyles.gray} border rounded-xl p-4 text-center transition-all duration-200`;
    feedbackCard.innerHTML = `<p class="text-sm font-bold">${escapeHtml(title)}</p><p class="text-xs opacity-80 mt-1">${escapeHtml(subtitle)}</p>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}