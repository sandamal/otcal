// Firebase Configuration
// REPLACE THESE WITH YOUR OWN FIREBASE CONFIGURATION
const firebaseConfig = {
    apiKey: "AIzaSyANN1IPnC6vODqIWiOpZgWutnP-LlmH48s",
    authDomain: "gelanigama-roster-team-a.firebaseapp.com",
    projectId: "gelanigama-roster-team-a",
    storageBucket: "gelanigama-roster-team-a.firebasestorage.app",
    messagingSenderId: "806907017930",
    appId: "1:806907017930:web:0c8265ba9beda797cc9233"
};

// Initialize Firebase
// Initialize Firebase with Persistence
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Modern Persistence (Silences Deprecation Warnings)
const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true })
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log('Persistence failed: Multiple tabs open');
        } else if (err.code == 'unimplemented') {
            console.log('Persistence not supported by browser');
        }
    });

// --- Auth Helpers ---

async function loginUser(email, password) {
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        return userCredential.user;
    } catch (error) {
        throw error;
    }
}

async function signupUser(email, password, additionalData) {
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;

        // Store additional user data in Firestore
        await db.collection('tellers').doc(user.uid).set({
            ...additionalData,
            uid: user.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        return user;
    } catch (error) {
        throw error;
    }
}

async function logoutUser() {
    return auth.signOut();
}

// --- Data Helpers ---

async function getTellerProfile(uid) {
    const doc = await db.collection('tellers').doc(uid).get();
    return doc.exists ? doc.data() : null;
}

// Get all tellers for reports
async function getAllTellers() {
    const snapshot = await db.collection('tellers').get();
    return snapshot.docs.map(doc => doc.data());
}

// Get all tellers with their document IDs
async function getAllTellersWithIds() {
    const snapshot = await db.collection('tellers').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Roster: Get roster for a specific date and team
async function getRoster(team, dateStr) {
    const doc = await db.collection(`${team}Roster`).doc(dateStr).get();
    return doc.exists ? doc.data() : null;
}

// Optimized Monthly Roster Fetch
async function getMonthlyRoster(team, monthStr) {
    const startId = `${monthStr}-01`;
    const endId = `${monthStr}-31`;
    const snapshot = await db.collection(`${team}Roster`)
        .where(firebase.firestore.FieldPath.documentId(), '>=', startId)
        .where(firebase.firestore.FieldPath.documentId(), '<=', endId)
        .get();
    return snapshot.docs.map(doc => ({ date: doc.id, ...doc.data() }));
}

// Attendance: Get attendance for a specific date (all tellers)
// This is a bit tricky because attendance is stored by tellerId.
// For the main table, we might want to query by date if possible, but the prompt says:
// attendance/{tellerId}/{YYYY-MM-DD}
// We will iterate through all tellers and fetch their attendance for the day.
// Or, improved design: Store a daily collection for easier querying? 
// The prompt specified: attendance/{tellerId}/{YYYY-MM-DD}. 
// To show the table for ALL tellers, we need to fetch all tellers first, then fetch their specific attendance doc.
async function getAttendanceForTeller(tellerId, dateStr) {
    const doc = await db.collection('attendance').doc(tellerId).collection('records').doc(dateStr).get();
    // Prompt said: attendance/{tellerId}/{YYYY-MM-DD} which usually implies subcollection or nested paths.
    // Let's assume structure: collection('attendance').doc(tellerId).collection('daily').doc(dateStr) 
    // OR collection('attendance').doc(tellerId + '_' + dateStr) -> flat structure?
    // Prompt: attendance/{tellerId}/{YYYY-MM-DD} -> likely subcollection.
    // Let's stick to subcollection pattern: db.collection('attendance').doc(tellerId).collection('history').doc(dateStr)
    // Actually, prompt says: attendance/{tellerId}/{YYYY-MM-DD}
    // This could also mean root collection 'attendance', doc '{tellerId}', field '{YYYY-MM-DD}'? No, that's 16MB limit risk.
    // It likely means: collection('attendance').doc(tellerId) ... wait.
    // If it's literally `attendance/{tellerId}/{YYYY-MM-DD}`, it implies `attendance` (col) -> `tellerId` (doc) -> `YYYY-MM-DD` (subcol? No, date can't be col).
    // It probably means `attendance` (col) -> `tellerId` (doc) -> `records` (subcol) -> `YYYY-MM-DD` (doc).
    // Let's use that.

    const record = await db.collection('attendance').doc(tellerId).collection('history').doc(dateStr).get();
    return record.exists ? record.data() : null;
}

// Optimized Monthly Fetch: Get all records for a month in one query
async function getMonthlyAttendance(tellerId, monthStr) {
    // monthStr is YYYY-MM
    // We want all docs where ID starts with YYYY-MM
    // Firestore doesn't support "startsWith" on documentId easily in client SDK without a range hack.
    // documentId >= "2024-02" and documentId < "2024-03" works for YYYY-MM-DD format

    // Calculate range
    const startId = `${monthStr}-01`;
    const endId = `${monthStr}-32`; // Simple hack, or calculate next month prefix
    // Better: lexicographical comparison. '2024-02-01' to '2024-02-31'

    // Actually, just using the string prefix logic:
    // "2024-02" <= docId < "2024-03"

    // Get next month string for upper bound
    // We assume dateStr format is YYYY-MM-DD

    return db.collection('attendance')
        .doc(tellerId)
        .collection('history')
        .where(firebase.firestore.FieldPath.documentId(), '>=', startId)
        .where(firebase.firestore.FieldPath.documentId(), '<=', endId)
        .get()
        .then(snapshot => {
            return snapshot.docs.map(doc => ({ date: doc.id, ...doc.data() }));
        });
}

async function saveAttendance(tellerId, dateStr, data) {
    await db.collection('attendance').doc(tellerId).collection('history').doc(dateStr).set(data, { merge: true });
}

// Get tellers filtered by team
async function getTellersByTeam(team) {
    const snapshot = await db.collection('tellers').where('team', '==', team).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Export global
window.FB = {
    auth,
    db,
    loginUser,
    signupUser,
    logoutUser,
    getTellerProfile,
    getAllTellers,
    getAllTellersWithIds,
    getTellersByTeam,
    getRoster,
    getMonthlyRoster,
    getAttendanceForTeller,
    getMonthlyAttendance,
    saveAttendance
};
