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

// DOM Elements
const userEmailSpan = document.getElementById('user-email');
const logoutBtn = document.getElementById('logout-btn');
const assetsTbody = document.getElementById('assets-tbody');
const inspectionsTbody = document.getElementById('inspections-tbody');
const pendingCountBadge = document.getElementById('pending-count-badge');

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

// Modal Elements
const assetModal = document.getElementById('asset-modal');
const assetForm = document.getElementById('asset-form');
const modalTitle = document.getElementById('modal-title');
const openAddModalBtn = document.getElementById('open-add-modal-btn');
const closeAssetModalBtn = document.getElementById('close-asset-modal-btn');

// QR Modal Elements
const qrModal = document.getElementById('qr-modal');
const qrAssetTitle = document.getElementById('qr-asset-title');
const qrAssetStr = document.getElementById('qr-asset-str');
const qrcodeContainer = document.getElementById('qrcode-container');
const closeQrModalBtn = document.getElementById('close-qr-modal-btn');
const printQrBtn = document.getElementById('print-qr-btn');

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
        toggleHoldBtn.className = "text-xs font-semibold px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white shadow-xs transition";
        toggleHoldBtn.onclick = () => toggleUserHoldStatus(user.id, false);
    } else {
        searchedUserHoldBadge.textContent = "ACCOUNT CLEAR (ACTIVE)";
        searchedUserHoldBadge.className = "text-xs font-bold px-3 py-1 rounded-full bg-green-100 text-green-800";
        
        toggleHoldBtn.textContent = "Place Account On Hold";
        toggleHoldBtn.className = "text-xs font-semibold px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-xs transition";
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

        currentFoundUser.is_on_hold = newHoldState;
        renderUserSearchCard(currentFoundUser);
    } catch (error) {
        console.error("Toggle hold error:", error);
        alert("Failed to update user hold status: " + error.message);
    }
}

// REAL-TIME DASHBOARD LISTENERS
function initAdminDashboard() {
    listenToAssets();
    listenToPendingInspections();
}

function listenToAssets() {
    onSnapshot(collection(db, "assets"), (snapshot) => {
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
                        <button class="qr-btn bg-purple-50 hover:bg-purple-100 text-purple-700 p-2 rounded-lg text-xs font-medium transition">QR</button>
                        <button class="edit-btn bg-blue-50 hover:bg-blue-100 text-blue-700 p-2 rounded-lg text-xs font-medium transition">Edit</button>
                        <button class="delete-btn bg-red-50 hover:bg-red-100 text-red-700 p-2 rounded-lg text-xs font-medium transition">Delete</button>
                    </div>
                </td>
            `;

            tr.querySelector('.qr-btn').addEventListener('click', () => renderQrModal(asset.name, asset.qr_code_str));
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
                        <button class="grade-good-btn bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-lg text-xs font-semibold shadow-xs transition">✓ Good</button>
                        <button class="grade-damaged-btn bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg text-xs font-semibold shadow-xs transition">⚠ Damaged</button>
                    </div>
                </td>
            `;

            tr.querySelector('.grade-good-btn').addEventListener('click', () => gradeReturn(recordId, record.asset_id, 'GOOD'));
            tr.querySelector('.grade-damaged-btn').addEventListener('click', () => gradeReturn(recordId, record.asset_id, 'DAMAGED'));

            inspectionsTbody.appendChild(tr);
        });
    });
}

async function gradeReturn(recordId, assetId, condition) {
    try {
        await runTransaction(db, async (transaction) => {
            const recordRef = doc(db, "borrow_records", recordId);
            const assetRef = doc(db, "assets", assetId);

            if (condition === 'GOOD') {
                transaction.update(recordRef, { status: 'RETURNED', returned_at: serverTimestamp(), condition: 'GOOD' });
                transaction.update(assetRef, { status: 'Available', updated_at: serverTimestamp() });
            } else if (condition === 'DAMAGED') {
                transaction.update(recordRef, { status: 'RETURNED_DAMAGED', returned_at: serverTimestamp(), condition: 'DAMAGED' });
                transaction.update(assetRef, { status: 'Maintenance', updated_at: serverTimestamp() });
            }
        });
    } catch (error) {
        alert("Failed to grade return: " + error.message);
    }
}

// ASSET CRUD
async function addAsset(assetData) { await addDoc(collection(db, "assets"), assetData); }
async function updateAsset(id, assetData) { await updateDoc(doc(db, "assets", id), assetData); }
async function deleteAsset(id) {
    if (confirm("Are you sure you want to delete this asset?")) {
        await deleteDoc(doc(db, "assets", id));
    }
}

// QR MODAL
function renderQrModal(name, qrCodeStr) {
    qrAssetTitle.textContent = name;
    qrAssetStr.textContent = qrCodeStr;
    qrcodeContainer.innerHTML = '';
    new QRCode(qrcodeContainer, { text: qrCodeStr, width: 180, height: 180, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H });
    qrModal.classList.remove('hidden');
}

closeQrModalBtn.addEventListener('click', () => qrModal.classList.add('hidden'));
printQrBtn.addEventListener('click', () => window.print());

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