// ==================== GLOBALE VARIABLEN (aus index.html) ====================
// app, auth, und db werden in index.html initialisiert und sind hier global verfügbar.
// let app, auth, db; // (Nur zur Erinnerung)

// ==================== DATA STRUCTURE ====================
let userData = {
    profile: {
        name: '',
        age: 0,
        gender: 'male',
        height: 0,
        currentWeight: 0,
        targetWeight: 0,
        activityLevel: 1.55,
        deficit: 500,
        startWeight: 0,
        startDate: null,
        bmr: 0,
        tdee: 0,
        targetCalories: 0,
        targetProtein: 0,
        motivationReason: ''
    },
    dailyEntries: {},
    weightEntries: [],
    settings: {
        supplementReminder: false,
        supplementTakenToday: false
    },
    ranking: {
        currentRank: 0, // 0-7 (Iron to Infernal)
        rankPoints: 0,
        totalPointsEarned: 0,
        totalPointsLost: 0,
        rankHistory: [],
        lastCalculated: null
    },
    setupComplete: false // Wird jetzt in Firestore gespeichert
};

// NEU: Hält den Echtzeit-Listener für das Leaderboard
let leaderboardListener = null;
// NEU: Hält die vollen Leaderboard-Daten für die UI-Updates
let fullLeaderboardData = [];

// ==================== INITIALIZATION (NEU: Auth-Gesteuert) ====================
document.addEventListener('DOMContentLoaded', function() {
    
    // Auth State Listener: Der NEUE EINSTIEGSPUNKT der App
    auth.onAuthStateChanged(user => {
        if (user) {
            // User ist eingeloggt
            console.log("User ist eingeloggt:", user.uid);
            loadData(user.uid); // Lade Daten aus Firestore
        } else {
            // User ist ausgeloggt
            console.log("User ist ausgeloggt.");
            // Alte Daten (falls vorhanden) zurücksetzen
            resetLocalData(); 
            // Stoppe Leaderboard-Updates, wenn ausgeloggt
            if (leaderboardListener) {
                leaderboardListener(); // unsubscriben
                leaderboardListener = null;
            }
            showLoginScreen(); // Zeige Login-Bildschirm
        }
    });
    
    // Set today's date for weight input
    document.getElementById('weightDate').valueAsDate = new Date();
    
    // Real-time steps calculation
    document.getElementById('stepsValue').addEventListener('input', function() {
        const steps = parseInt(this.value) || 0;
        const calories = Math.round(steps * 0.04);
        document.getElementById('estimatedStepsCalories').textContent = calories + ' kcal';
    });
});

// ==================== DATA PERSISTENCE (NEU: Firestore) ====================

async function saveData() {
    const user = auth.currentUser;
    if (!user) {
        console.warn("Versuch zu speichern, aber kein User eingeloggt.");
        return;
    }

    try {
        // Speichert das *gesamte* userData-Objekt in Firestore unter der User-ID
        await db.collection('users').doc(user.uid).set(userData);
        console.log("Daten in Firestore gespeichert.");
    } catch (error) {
        console.error("Fehler beim Speichern in Firestore:", error);
        showNotification("Fehler: Daten konnten nicht synchronisiert werden.", "error");
    }
}

async function loadData(uid) {
    try {
        const docRef = db.collection('users').doc(uid);
        const doc = await docRef.get();

        if (doc.exists) {
            // Daten aus Firestore laden und mit Standardstruktur zusammenführen
            // (falls neue Features hinzugefügt wurden, die im alten Objekt fehlen)
            const firestoreData = doc.data();
            userData = {
                ...userData, // Standardstruktur
                ...firestoreData, // Firestore-Daten überschreiben
                profile: { ...userData.profile, ...firestoreData.profile },
                ranking: { ...userData.ranking, ...firestoreData.ranking },
                settings: { ...userData.settings, ...firestoreData.settings }
            };
            
            console.log("Daten aus Firestore geladen.");
            
            if (userData.setupComplete) {
                // Setup ist abgeschlossen, Dashboard anzeigen
                showDashboard();
                initDashboard();
                
                // Starte Leaderboard-Listener
                if (!leaderboardListener) {
                    leaderboardListener = startLeaderboardListener(); // ANGEPASST
                }
            } else {
                // User ist eingeloggt, hat aber Setup nicht beendet
                // (sollte nicht passieren, aber als Fallback)
                showSetup();
            }

        } else {
            // User ist eingeloggt (z.B. gerade registriert), aber hat noch keine Daten
            // Das ist der Fall *während* des Setups.
            console.log("Keine Daten in Firestore gefunden (neuer User). Zeige Setup.");
            resetLocalData(); // Stelle sicher, dass keine alten Daten rumliegen
            showSetup();
        }
    } catch (error) {
        console.error("Fehler beim Laden der Daten:", error);
        showNotification("Fehler beim Laden der Profildaten.", "error");
        handleLogout(); // Bei Ladefehler ausloggen
    }
}

// Setzt das lokale userData-Objekt zurück
function resetLocalData() {
    userData = {
        profile: { name: '', age: 0, gender: 'male', height: 0, currentWeight: 0, targetWeight: 0, activityLevel: 1.55, deficit: 500, startWeight: 0, startDate: null, bmr: 0, tdee: 0, targetCalories: 0, targetProtein: 0, motivationReason: '' },
        dailyEntries: {},
        weightEntries: [],
        settings: { supplementReminder: false, supplementTakenToday: false },
        ranking: { currentRank: 0, rankPoints: 0, totalPointsEarned: 0, totalPointsLost: 0, rankHistory: [], lastCalculated: null },
        setupComplete: false
    };
}


// ==================== AUTH FUNCTIONS (NEU) ====================

async function handleRegistration() {
    // Schritt 7 (Zusammenfassung) ist aktiv, also sind alle Daten validiert
    // 1. Lade E-Mail und Passwort
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (password.length < 6) {
        showNotification("Passwort muss mindestens 6 Zeichen lang sein.", "error");
        return;
    }
    if (!email) {
        showNotification("Bitte gib eine gültige E-Mail an.", "error");
        return;
    }

    try {
        // 2. Erstelle User in Firebase Auth
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        console.log("User erstellt:", user.uid);

        // 3. Setup-Daten finalisieren (ersetzt completeSetup())
        userData.setupComplete = true;
        userData.profile.startDate = new Date().toISOString();
        
        // Add initial weight entry
        const today = getDateString(new Date());
        userData.weightEntries.push({
            date: today,
            weight: userData.profile.currentWeight
        });

        // 4. Speichere das erste userData-Objekt in Firestore
        // WICHTIG: Wir rufen saveData() auf. Der auth.onAuthStateChanged-Listener
        // wird fast zeitgleich getriggert, lädt die Daten (die wir hier speichern)
        // und zeigt dann das Dashboard an.
        await saveData(); 
        
        showNotification('🎉 Profil erfolgreich erstellt! Viel Erfolg!', 'success');
        // Der onAuthStateChanged-Listener übernimmt ab hier.
        
    } catch (error) {
        console.error("Fehler bei der Registrierung:", error);
        if (error.code === 'auth/email-already-in-use') {
            showNotification("Diese E-Mail wird bereits verwendet.", "error");
        } else {
            showNotification("Fehler bei der Registrierung. " + error.message, "error");
        }
    }
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        showNotification("Bitte E-Mail und Passwort eingeben.", "error");
        return;
    }

    try {
        await auth.signInWithEmailAndPassword(email, password);
        // Login erfolgreich. Der onAuthStateChanged-Listener übernimmt den Rest.
        showNotification("Willkommen zurück!", "success");
    } catch (error) {
        console.error("Fehler beim Login:", error);
        showNotification("Login fehlgeschlagen. Prüfe E-Mail und Passwort.", "error");
    }
}

async function handleLogout() {
    try {
        if (leaderboardListener) { // Sicherstellen, dass der Listener gestoppt wird
            leaderboardListener();
            leaderboardListener = null;
        }
        await auth.signOut();
        // Logout erfolgreich. Der onAuthStateChanged-Listener übernimmt den Rest.
        showNotification("Erfolgreich abgemeldet.", "success");
    } catch (error) {
        console.error("Fehler beim Logout:", error);
    }
}

async function handleDeleteAccount() {
    const user = auth.currentUser;
    if (!user) return;

    if (confirm('⚠️ ACHTUNG: Dein Konto und alle deine Daten in der Cloud werden unwiderruflich gelöscht! Bist du sicher?')) {
        if (confirm('Wirklich alle Daten löschen? Diese Aktion kann nicht rückgängig gemacht werden!')) {
            try {
                // 1. Firestore-Dokument löschen
                await db.collection('users').doc(user.uid).delete();
                
                // 2. Auth-User löschen
                await user.delete();
                
                showNotification("Konto erfolgreich gelöscht.", "success");
                // Der onAuthStateChanged-Listener wird getriggert (user ist null)
                // und zeigt den Login-Screen an.
            } catch (error) {
                console.error("Fehler beim Löschen des Kontos:", error);
                if (error.code === 'auth/requires-recent-login') {
                    showNotification("Bitte melde dich kurz ab und wieder an, um dein Konto zu löschen.", "error");
                } else {
                    showNotification("Fehler beim Löschen des Kontos.", "error");
                }
            }
        }
    }
}


// ==================== SETUP FLOW (Größtenteils unverändert) ====================
let currentSetupStep = 1;

function nextStep() {
    const step = currentSetupStep;
    
    // Validation
    if (step === 1) {
        const name = document.getElementById('name').value.trim();
        const age = parseInt(document.getElementById('age').value);
        const gender = document.getElementById('gender').value;
        // NEU: E-Mail/Passwort-Validierung passiert erst in handleRegistration()
        
        if (!name || !age || age < 10 || age > 120) {
            showNotification('Bitte fülle Name und Alter korrekt aus', 'error');
            return;
        }
        
        userData.profile.name = name;
        userData.profile.age = age;
        userData.profile.gender = gender;
    }
    
    if (step === 2) {
        const height = parseInt(document.getElementById('height').value);
        const currentWeight = parseFloat(document.getElementById('currentWeight').value);
        const targetWeight = parseFloat(document.getElementById('targetWeight').value);
        
        if (!height || !currentWeight || !targetWeight || height < 100 || height > 250 || currentWeight < 30 || targetWeight < 30) {
            showNotification('Bitte gib gültige Werte ein', 'error');
            return;
        }
        
        if (targetWeight >= currentWeight) {
            showNotification('Dein Zielgewicht sollte niedriger als dein aktuelles Gewicht sein', 'error');
            return;
        }
        
        userData.profile.height = height;
        userData.profile.currentWeight = currentWeight;
        userData.profile.targetWeight = targetWeight;
        userData.profile.startWeight = currentWeight;
    }
    
    if (step === 3) {
        const activity = document.querySelector('input[name="activity"]:checked');
        if (!activity) {
            showNotification('Bitte wähle dein Aktivitätslevel', 'error');
            return;
        }
        userData.profile.activityLevel = parseFloat(activity.value);
    }
    
    if (step === 4) {
        const deficit = document.querySelector('input[name="deficit"]:checked');
        if (!deficit) {
            showNotification('Bitte wähle dein Abnehmziel', 'error');
            return;
        }
        userData.profile.deficit = parseInt(deficit.value);
    }
    
    // Step 5 (Ranking) - no validation needed
    
    if (step === 6) {
        const motivation = document.getElementById('motivationReason').value.trim();
        if (!motivation) {
            showNotification('Bitte gib deinen Grund ein - er wird dich motivieren!', 'error');
            return;
        }
        userData.profile.motivationReason = motivation;
    }
    
    // Move to next step
    document.getElementById(`step${step}`).classList.remove('active');
    currentSetupStep++;
    document.getElementById(`step${currentSetupStep}`).classList.add('active');
    document.getElementById('currentStep').textContent = currentSetupStep;
    
    // Update progress bar
    const progress = (currentSetupStep / 7) * 100;
    document.getElementById('setupProgress').style.width = progress + '%';
    
    // If we're on the summary step, calculate and display
    if (currentSetupStep === 7) {
        calculateAndDisplaySummary();
    }
}

function prevStep() {
    document.getElementById(`step${currentSetupStep}`).classList.remove('active');
    currentSetupStep--;
    document.getElementById(`step${currentSetupStep}`).classList.add('active');
    document.getElementById('currentStep').textContent = currentSetupStep;
    
    const progress = (currentSetupStep / 7) * 100; // Angepasst auf 7 Schritte
    document.getElementById('setupProgress').style.width = progress + '%';
}

function calculateAndDisplaySummary() {
    const p = userData.profile;
    
    // Calculate BMR (Mifflin-St Jeor Equation)
    if (p.gender === 'male') {
        p.bmr = Math.round(10 * p.currentWeight + 6.25 * p.height - 5 * p.age + 5);
    } else {
        p.bmr = Math.round(10 * p.currentWeight + 6.25 * p.height - 5 * p.age - 161);
    }
    
    // Calculate TDEE
    p.tdee = Math.round(p.bmr * p.activityLevel);
    
    // Calculate target calories
    p.targetCalories = p.tdee - p.deficit;
    
    // Calculate protein target (2g per kg body weight)
    p.targetProtein = Math.round(p.currentWeight * 2);
    
    // Calculate BMI
    const bmi = (p.currentWeight / ((p.height / 100) ** 2)).toFixed(1);
    
    // Display summary
    document.getElementById('summaryBMI').textContent = bmi;
    document.getElementById('summaryBMR').textContent = p.bmr + ' kcal';
    document.getElementById('summaryTDEE').textContent = p.tdee + ' kcal';
    document.getElementById('summaryTarget').textContent = p.targetCalories + ' kcal';
    document.getElementById('summaryToLose').textContent = (p.currentWeight - p.targetWeight).toFixed(1) + ' kg';
    document.getElementById('summaryProtein').textContent = p.targetProtein + 'g';
}

// Hieß vorher completeSetup(), wird jetzt von handleRegistration() aufgerufen
// function completeSetup() { ... } // (ENTFERNT, Logik ist in handleRegistration)


// ==================== NAVIGATION (NEU) ====================
function showSetup(event) {
    if (event) event.preventDefault();
    document.getElementById('setupScreen').style.display = 'flex';
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboard').classList.add('hidden');
}

function showLoginScreen(event) {
    if (event) event.preventDefault();
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
}

function showDashboard() {
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
}

// ==================== DASHBOARD (Unverändert) ====================
function initDashboard() {
    updateDashboard();
    initChart();
    
    // Load supplement reminder setting
    if (userData.settings && userData.settings.supplementReminder !== undefined) {
        document.getElementById('supplementReminderToggle').checked = userData.settings.supplementReminder;
    }
    
    // Check supplement reminder
    checkSupplementReminder();
    
    // Calculate rank for completed days
    calculateRankForPastDays(); // Wichtig: Diese Funktion ruft am Ende saveData() auf!

    setInterval(updateDashboard, 60000); // Update every minute
}

function updateDashboard() {
    const today = getDateString(new Date());
    const p = userData.profile;
    
    // Update header
    document.getElementById('userName').textContent = p.name;
    document.getElementById('todayDate').textContent = formatDateShort(new Date());
    
    // Get today's data
    const todayData = getTodayData();
    
    // Update calories
    document.getElementById('caloriesConsumed').textContent = todayData.calories;
    document.getElementById('caloriesTarget').textContent = p.targetCalories;
    
    // Update protein
    document.getElementById('proteinConsumed').textContent = todayData.protein;
    document.getElementById('proteinTarget').textContent = p.targetProtein;
    
    // Update steps
    document.getElementById('stepsToday').textContent = todayData.steps || 0;
    
    // Update weight
    const latestWeight = getLatestWeight();
    document.getElementById('currentWeightDisplay').textContent = latestWeight.toFixed(1);
    
    const remaining = latestWeight - p.targetWeight;
    document.getElementById('remainingWeight').textContent = remaining > 0 ? remaining.toFixed(1) : '0.0';
    
    // Update streak
    const streak = calculateStreak();
    document.getElementById('streakBadge').textContent = streak + (streak === 1 ? ' Tag' : ' Tage');
    
    // Update status message
    updateStatusMessage(todayData);
    
    // Update meals overview
    updateMealsOverview();
    
    // Update rank display
    updateRankDisplay();
    
    // Update statistics
    updateStatistics();
    
    // Update chart
    updateChart();
    
    // Check supplement reminder
    checkSupplementReminder();
}

function getTodayData() {
    const today = getDateString(new Date());
    const entry = userData.dailyEntries[today] || { 
        calories: 0, 
        protein: 0, 
        meals: [],
        steps: 0,
        stepsCalories: 0
    };
    // Stelle sicher, dass heutige Daten im Objekt sind, falls es das erste Mal ist
    if (!userData.dailyEntries[today]) {
        userData.dailyEntries[today] = entry;
    }
    return entry;
}

// ... (Restliche Dashboard-Helferfunktionen bleiben unverändert) ...
// updateProgressBar, updateStatusMessage, calculateStreak, updateStatistics,
// getLastNDaysData, getWeightEntriesInRange, getDaysSinceStart, getLatestWeight

function updateProgressBar(elementId, current, target) {
    const percentage = Math.min((current / target) * 100, 100);
    document.getElementById(elementId).style.width = percentage + '%';
    
    // Change color based on percentage
    const element = document.getElementById(elementId);
    if (percentage >= 90 && percentage <= 110) {
        element.style.background = 'linear-gradient(90deg, #10b981 0%, #059669 100%)';
    } else if (percentage > 110) {
        element.style.background = 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)';
    } else {
        element.style.background = 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)';
    }
}

function updateStatusMessage(todayData) {
    const p = userData.profile;
    const remaining = p.targetCalories - todayData.calories;
    const proteinRemaining = p.targetProtein - todayData.protein;
    
    let message = '';
    let emoji = '';
    
    // Add motivation reminder sometimes
    const showMotivation = Math.random() > 0.7 && p.motivationReason;
    
    if (todayData.calories === 0) {
        emoji = '🌅';
        message = `Guten Morgen, ${p.name}! Heute hast du noch <strong>${p.targetCalories} kcal</strong> zur Verfügung. Starte deinen Tag mit einem proteinreichen Frühstück!`;
    } else if (remaining > 500) {
        emoji = '💪';
        message = `Super! Du hast noch <strong>${remaining} kcal</strong> übrig. `;
        if (proteinRemaining > 50) {
            message += `Achte darauf, noch <strong>${proteinRemaining}g Protein</strong> zu dir zu nehmen.`;
        } else if (proteinRemaining > 0) {
            message += `Fast geschafft! Nur noch <strong>${proteinRemaining}g Protein</strong> fehlen.`;
        } else {
            message += `Dein Proteinziel hast du bereits erreicht! 🎯`;
        }
    } else if (remaining > 0 && remaining <= 500) {
        emoji = '⚡';
        message = `Gut gemacht! Du hast noch <strong>${remaining} kcal</strong> für heute. Wähle eine leichte Mahlzeit oder einen gesunden Snack.`;
    } else if (remaining >= -100) {
        emoji = '🎯';
        message = `Perfekt! Du bist genau im Zielbereich. Deine Disziplin zahlt sich aus!`;
    } else {
        emoji = '⚠️';
        const over = Math.abs(remaining);
        message = `Du hast dein Tagesziel um <strong>${over} kcal</strong> überschritten. Kein Problem! Morgen ist ein neuer Tag. Bleib dran!`;
    }
    
    // Add motivation reminder
    if (showMotivation) {
        message += `<br><br><em style="color: var(--primary-color); font-style: italic;">💭 Denk daran: ${p.motivationReason}</em>`;
    }
    
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) {
        statusElement.innerHTML = `<span style="font-size: 1.25rem; margin-right: 0.5rem;">${emoji}</span> ${message}`;
    }
}

function calculateStreak() {
    const dates = Object.keys(userData.dailyEntries).sort().reverse();
    let streak = 0;
    let currentDate = new Date();
    
    for (let i = 0; i < dates.length; i++) {
        const checkDate = getDateString(currentDate);
        if (dates.includes(checkDate)) {
            // Prüfen, ob an diesem Tag auch wirklich was getrackt wurde
            const entry = userData.dailyEntries[checkDate];
            if (entry && (entry.calories > 0 || entry.meals.length > 0 || entry.steps > 0)) {
                streak++;
                currentDate.setDate(currentDate.getDate() - 1);
            } else {
                // Tag ist vorhanden, aber leer
                break;
            }
        } else {
            // Datum fehlt in der Liste
            // Ausnahme: Wenn der *erste* Eintrag (heute) noch leer ist,
            // aber der davor nicht, zählen wir weiter
            if (i === 0 && dates.length > 1 && dates[1] === getDateString(new Date(new Date().setDate(new Date().getDate() - 1)))) {
                // Heute ist leer, aber gestern wurde getrackt.
                // Wir tun so, als wäre "heute" der Start der Zählung
            } else {
                break;
            }
        }
    }
    
    return streak;
}

function updateStatistics() {
    // Week statistics
    const weekData = getLastNDaysData(7);
    const weekAvgCalories = weekData.length > 0 
        ? Math.round(weekData.reduce((sum, d) => sum + d.calories, 0) / weekData.length)
        : 0;
    document.getElementById('weekAvgCalories').textContent = weekAvgCalories + ' kcal';
    
    const weekWeights = getWeightEntriesInRange(7);
    if (weekWeights.length >= 2) {
        const weekChange = weekWeights[weekWeights.length - 1].weight - weekWeights[0].weight;
        const sign = weekChange > 0 ? '+' : '';
        const color = weekChange > 0 ? '#ef4444' : '#10b981';
        document.getElementById('weekWeightChange').innerHTML = 
            `<span style="color: ${color}">${sign}${weekChange.toFixed(1)} kg</span>`;
    } else {
        document.getElementById('weekWeightChange').textContent = '-';
    }
    
    // Total progress
    const totalLost = userData.profile.startWeight - getLatestWeight();
    const sign = totalLost > 0 ? '-' : '+'; // Logik umgedreht für Anzeige
    document.getElementById('totalWeightLost').textContent = `${totalLost > 0 ? '📉' : '📈'} ${Math.abs(totalLost).toFixed(1)} kg`;
    
    const totalToLose = userData.profile.startWeight - userData.profile.targetWeight;
    const progressPct = ((totalLost / totalToLose) * 100).toFixed(1);
    document.getElementById('progressPercentage').textContent = progressPct + '%';
    
    // Estimated completion
    const daysActive = Math.max(1, getDaysSinceStart());
    const avgWeeklyLoss = (totalLost / daysActive) * 7;
    const remaining = getLatestWeight() - userData.profile.targetWeight;
    
    if (avgWeeklyLoss > 0 && remaining > 0) {
        const weeksRemaining = Math.ceil(remaining / avgWeeklyLoss);
        const daysRemaining = weeksRemaining * 7;
        const estimatedDate = new Date();
        estimatedDate.setDate(estimatedDate.getDate() + daysRemaining);
        
        document.getElementById('estimatedDate').textContent = formatDate(estimatedDate);
        document.getElementById('daysRemaining').textContent = `${daysRemaining} Tage`;
    } else {
        document.getElementById('estimatedDate').textContent = 'Berechne...';
        document.getElementById('daysRemaining').textContent = '-';
    }
}

function getLastNDaysData(n) {
    const data = [];
    const currentDate = new Date();
    
    for (let i = 0; i < n; i++) {
        const dateStr = getDateString(currentDate);
        const entry = userData.dailyEntries[dateStr];
        if (entry) {
            data.push(entry);
        }
        currentDate.setDate(currentDate.getDate() - 1);
    }
    
    return data;
}

function getWeightEntriesInRange(days) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return userData.weightEntries.filter(entry => {
        const entryDate = new Date(entry.date);
        return entryDate >= startDate;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function getDaysSinceStart() {
    const start = new Date(userData.profile.startDate);
    const now = new Date();
    const diff = now - start;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getLatestWeight() {
    if (userData.weightEntries.length === 0) {
        return userData.profile.currentWeight;
    }
    
    const sorted = [...userData.weightEntries].sort((a, b) => 
        new Date(b.date) - new Date(a.date)
    );
    
    return sorted[0].weight;
}

// ==================== CHART (Unverändert) ====================
let weightChart = null;
let chartPeriod = 'month';
// ... (initChart, updateChart, changeChartPeriod bleiben unverändert) ...
function initChart() {
    const ctx = document.getElementById('weightChart').getContext('2d');
    
    weightChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Gewicht',
                data: [],
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointRadius: 5,
                pointHoverRadius: 7,
                pointBackgroundColor: '#667eea',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }, {
                label: 'Zielgewicht',
                data: [],
                borderColor: '#10b981',
                borderWidth: 2,
                borderDash: [5, 5],
                fill: false,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#f1f5f9',
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#f1f5f9',
                    bodyColor: '#f1f5f9',
                    borderColor: '#334155',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return context.parsed.y.toFixed(1) + ' kg';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: {
                        color: '#94a3b8',
                        callback: function(value) {
                            return value.toFixed(1) + ' kg';
                        }
                    },
                    grid: {
                        color: 'rgba(51, 65, 85, 0.5)'
                    }
                },
                x: {
                    ticks: {
                        color: '#94a3b8',
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        color: 'rgba(51, 65, 85, 0.5)'
                    }
                }
            }
        }
    });
    
    updateChart();
}

function updateChart() {
    if (!weightChart) return;
    
    let entries = [...userData.weightEntries];
    const now = new Date();
    
    // Filter based on period
    if (chartPeriod === 'week') {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        entries = entries.filter(e => new Date(e.date) >= weekAgo);
    } else if (chartPeriod === 'month') {
        const monthAgo = new Date(now);
        monthAgo.setDate(monthAgo.getDate() - 30);
        entries = entries.filter(e => new Date(e.date) >= monthAgo);
    }
    
    // Sort by date
    entries.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Update chart data
    weightChart.data.labels = entries.map(e => formatDateShort(new Date(e.date)));
    weightChart.data.datasets[0].data = entries.map(e => e.weight);
    weightChart.data.datasets[1].data = entries.map(() => userData.profile.targetWeight);
    
    weightChart.update();
}

function changeChartPeriod(period) {
    chartPeriod = period;
    
    // Update button styles
    document.querySelectorAll('.chart-controls .btn-small').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    updateChart();
}

// ==================== MEALS (WICHTIG: ruft saveData() auf) ====================
function addMeal() {
    const category = document.getElementById('mealCategory').value;
    const name = document.getElementById('mealName').value.trim();
    const calories = parseInt(document.getElementById('mealCalories').value);
    const protein = parseInt(document.getElementById('mealProtein').value) || 0;
    
    if (!name || !calories || calories <= 0) {
        showNotification('Bitte fülle alle Pflichtfelder aus', 'error');
        return;
    }
    
    const today = getDateString(new Date());
    
    if (!userData.dailyEntries[today]) {
        userData.dailyEntries[today] = {
            calories: 0,
            protein: 0,
            meals: [],
            steps: 0,
            stepsCalories: 0
        };
    }
    
    const meal = {
        id: Date.now(),
        name: name,
        calories: calories,
        protein: protein,
        category: category,
        time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    };
    
    userData.dailyEntries[today].meals.push(meal);
    userData.dailyEntries[today].calories += calories;
    userData.dailyEntries[today].protein += protein;
    
    saveData(); // <--- NEU: Speichert in Firestore
    
    // Clear inputs
    document.getElementById('mealName').value = '';
    document.getElementById('mealCalories').value = '';
    document.getElementById('mealProtein').value = '';
    
    // Update displays
    updateDashboard();
    displayTodayMeals();
    
    showNotification('✅ Mahlzeit hinzugefügt!', 'success');
}

function displayTodayMeals() {
    const container = document.getElementById('todayMeals');
    const todayData = getTodayData();
    
    if (!todayData.meals || todayData.meals.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 1rem;">Noch keine Einträge für heute</p>';
        return;
    }
    
    const categoryNames = {
        breakfast: '🌅 Frühstück',
        lunch: '☀️ Mittagessen',
        dinner: '🌙 Abendessen',
        snack: '🍪 Snack'
    };
    
    container.innerHTML = todayData.meals.map(meal => `
        <div class="meal-item">
            <div class="meal-info">
                <h4>${meal.name}</h4>
                <p>${categoryNames[meal.category] || meal.category} • ${meal.calories} kcal${meal.protein > 0 ? ` • ${meal.protein}g Protein` : ''} • ${meal.time}</p>
            </div>
            <button class="meal-delete" onclick="deleteMeal(${meal.id})">🗑️</button>
        </div>
    `).join('');
}

function deleteMeal(mealId) {
    const today = getDateString(new Date());
    const todayData = userData.dailyEntries[today];
    
    if (!todayData) return;
    
    const mealIndex = todayData.meals.findIndex(m => m.id === mealId);
    if (mealIndex === -1) return;
    
    const meal = todayData.meals[mealIndex];
    todayData.calories -= meal.calories;
    todayData.protein -= meal.protein;
    todayData.meals.splice(mealIndex, 1);
    
    saveData(); // <--- NEU: Speichert in Firestore
    updateDashboard();
    displayTodayMeals();
    
    showNotification('Mahlzeit gelöscht', 'success');
}

// ==================== WEIGHT (WICHTIG: ruft saveData() auf) ====================
function addWeight() {
    const dateInput = document.getElementById('weightDate').value;
    const weight = parseFloat(document.getElementById('weightValue').value);
    
    if (!dateInput || !weight || weight <= 0) {
        showNotification('Bitte fülle alle Felder aus', 'error');
        return;
    }
    
    const dateStr = dateInput;
    
    // Check if entry exists for this date
    const existingIndex = userData.weightEntries.findIndex(e => e.date === dateStr);
    
    if (existingIndex >= 0) {
        userData.weightEntries[existingIndex].weight = weight;
        showNotification('Gewichtseintrag aktualisiert', 'success');
    } else {
        userData.weightEntries.push({
            date: dateStr,
            weight: weight
        });
        showNotification('✅ Gewicht gespeichert!', 'success');
    }
    
    // Update current weight if it's today or the latest entry
    const latestEntry = [...userData.weightEntries].sort((a, b) => 
        new Date(b.date) - new Date(a.date)
    )[0];
    
    userData.profile.currentWeight = latestEntry.weight;
    
    saveData(); // <--- NEU: Speichert in Firestore
    updateDashboard();
    closeModal('addWeight');
    
    // Clear input
    document.getElementById('weightValue').value = '';
}

// ==================== MODALS (Unverändert) ====================
function openModal(type) {
    const modalId = type + 'Modal';
    const modal = document.getElementById(modalId);
    modal.classList.add('active');
    
    if (type === 'addCalories') {
        displayTodayMeals();
    } else if (type === 'viewHistory') {
        displayHistory('calories');
    }
}

function closeModal(type) {
    const modalId = type + 'Modal';
    const modal = document.getElementById(modalId);
    modal.classList.remove('active');
}

// Close modal on background click
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// ==================== HISTORY (Unverändert) ====================
// ... (switchHistoryTab, displayHistory bleiben unverändert) ...
function switchHistoryTab(type) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    document.getElementById('caloriesHistory').classList.add('hidden');
    document.getElementById('weightHistory').classList.add('hidden');
    
    displayHistory(type);
}

function displayHistory(type) {
    if (type === 'calories') {
        const container = document.getElementById('caloriesHistory');
        container.classList.remove('hidden');
        
        const entries = Object.entries(userData.dailyEntries)
            .sort((a, b) => new Date(b[0]) - new Date(a[0]))
            .slice(0, 30);
        
        if (entries.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Noch keine Einträge vorhanden</p>';
            return;
        }
        
        container.innerHTML = entries.map(([date, data]) => {
            const percentage = ((data.calories / userData.profile.targetCalories) * 100).toFixed(0);
            const color = percentage >= 90 && percentage <= 110 ? '#10b981' : 
                         percentage > 110 ? '#ef4444' : '#667eea';
            
            return `
                <div class="history-item">
                    <div>
                        <div class="history-date">${formatDate(new Date(date))}</div>
                        <div class="history-value">${data.calories} kcal • ${data.protein}g Protein • ${data.meals.length} Mahlzeiten</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 1.25rem; font-weight: 700; color: ${color}">${percentage}%</div>
                        <div class="history-value">vom Ziel</div>
                    </div>
                </div>
            `;
        }).join('');
        
    } else if (type === 'weight') {
        const container = document.getElementById('weightHistory');
        container.classList.remove('hidden');
        
        const entries = [...userData.weightEntries]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 30);
        
        if (entries.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Noch keine Einträge vorhanden</p>';
            return;
        }
        
        container.innerHTML = entries.map((entry, index) => {
            let change = '';
            if (index < entries.length - 1) {
                const diff = entry.weight - entries[index + 1].weight;
                const sign = diff > 0 ? '+' : '';
                const color = diff > 0 ? '#ef4444' : '#10b981';
                change = `<span style="color: ${color}">${sign}${diff.toFixed(1)} kg</span>`;
            }
            
            return `
                <div class="history-item">
                    <div>
                        <div class="history-date">${formatDate(new Date(entry.date))}</div>
                        <div class="history-value">${entry.weight.toFixed(1)} kg</div>
                    </div>
                    <div style="text-align: right; font-weight: 700;">
                        ${change}
                    </div>
                </div>
            `;
        }).join('');
    }
}

// ==================== SETTINGS (Angepasst) ====================
function openSettings() {
    openModal('settings');
}

function editProfile() {
    // Diese Funktion ist jetzt komplizierter, da das Profil in Firestore liegt.
    // Einfache Lösung: Zum Setup-Screen zurückleiten, um Daten zu ändern.
    if (confirm('Möchtest du dein Profil bearbeiten? Du wirst zum Setup zurückgeleitet, um deine Daten zu aktualisieren.')) {
        closeModal('settings');
        currentSetupStep = 1;
        document.querySelectorAll('.setup-step').forEach(step => step.classList.remove('active'));
        document.getElementById('step1').classList.add('active');
        document.getElementById('setupProgress').style.width = (1/7 * 100) + '%';
        document.getElementById('currentStep').textContent = '1';
        
        // Pre-fill form mit aktuellen Daten
        document.getElementById('name').value = userData.profile.name;
        document.getElementById('age').value = userData.profile.age;
        document.getElementById('gender').value = userData.profile.gender;
        document.getElementById('height').value = userData.profile.height;
        document.getElementById('currentWeight').value = getLatestWeight();
        document.getElementById('targetWeight').value = userData.profile.targetWeight;
        
        // E-Mail/Passwort ausblenden, da sie nicht geändert werden sollen
        document.getElementById('email').parentElement.style.display = 'none';
        document.getElementById('password').parentElement.style.display = 'none';
        
        // "Konto erstellen"-Button zu "Speichern" ändern
        const setupBtn = document.querySelector('#step7 .btn-large');
        setupBtn.textContent = 'Änderungen speichern';
        // WICHTIG: Die Registrierungsfunktion muss angepasst werden, um
        // eine *Aktualisierung* statt einer *Neuerstellung* zu erkennen.
        // Wir ändern den OnClick-Handler zu einer neuen Funktion:
        setupBtn.setAttribute('onclick', 'handleProfileUpdate()');

        showSetup();
    }
}

// NEU: Funktion zum Aktualisieren des Profils
async function handleProfileUpdate() {
    // Schritt 7 ist aktiv, alle Daten sind in userData
    // Wir müssen nicht auth.createUser... aufrufen, nur saveData().
    try {
        await saveData();
        showNotification("Profil erfolgreich aktualisiert!", "success");
        // E-Mail/Passwort wieder einblenden für den Fall einer Neuregistrierung
        document.getElementById('email').parentElement.style.display = 'block';
        document.getElementById('password').parentElement.style.display = 'block';
        // Button-Text und OnClick zurücksetzen
        const setupBtn = document.querySelector('#step7 .btn-large');
        setupBtn.textContent = 'Konto erstellen & Los geht\'s!';
        setupBtn.setAttribute('onclick', 'handleRegistration()');
        
        // Dashboard neu laden
        showDashboard();
        initDashboard();

    } catch (error) {
        console.error("Fehler beim Profil-Update:", error);
        showNotification("Fehler beim Speichern des Profils.", "error");
    }
}


// resetApp() wurde durch handleDeleteAccount() ersetzt

function exportData() {
    // Diese Funktion exportiert jetzt nur noch die *lokalen* Daten,
    // was nützlich sein kann, aber nicht das Firebase-Backup ist.
    const dataStr = JSON.stringify(userData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `calrank-lokal-backup-${getDateString(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    showNotification('✅ Lokale Daten exportiert!', 'success');
}

function importData(event) {
    // Importiert auch nur LOKAL.
    // Dies überschreibt die Firebase-Daten beim nächsten saveData()!
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            
            if (confirm('Möchtest du die importierten Daten wirklich verwenden? Deine aktuellen Cloud-Daten werden beim nächsten Speichern überschrieben!')) {
                userData = imported;
                saveData(); // Sofort in die Cloud pushen
                location.reload(); // Neu laden, um Daten sauber zu initialisieren
            }
        } catch (error) {
            showNotification('❌ Fehler beim Importieren der Daten', 'error');
        }
    };
    reader.readAsText(file);
}

// ==================== UTILITY FUNCTIONS (Unverändert) ====================
// ... (getDateString, formatDate, formatDateShort, showNotification) ...
function getDateString(date) {
    return date.toISOString().split('T')[0];
}

function formatDate(date) {
    return date.toLocaleDateString('de-DE', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatDateShort(date) {
    return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit'
    });
}

// ==================== NOTIFICATIONS ====================
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#667eea'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        font-weight: 500;
        max-width: 400px;
    `;
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// ==================== KEYBOARD SHORTCUTS (Unverändert) ====================
document.addEventListener('keydown', function(e) {
    // ESC to close modals
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(modal => {
            modal.classList.remove('active');
        });
    }
});

// ==================== SERVICE WORKER (Unverändert) ====================
// ...

// ==================== VIEW SWITCHING (ANGEPASST) ====================
function switchView(view) {
    const dashboardView = document.getElementById('dashboardView');
    const rankingView = document.getElementById('rankingView');
    const leaderboardView = document.getElementById('leaderboardView'); // NEU
    
    const dashboardTab = document.querySelectorAll('.nav-tab')[0];
    const rankingTab = document.querySelectorAll('.nav-tab')[1];
    const leaderboardTab = document.querySelectorAll('.nav-tab')[2]; // NEU
    
    // Alle Views ausblenden
    dashboardView.classList.add('hidden');
    rankingView.classList.add('hidden');
    leaderboardView.classList.add('hidden'); // NEU
    
    // Alle Tabs deaktivieren
    dashboardTab.classList.remove('active');
    rankingTab.classList.remove('active');
    leaderboardTab.classList.remove('active'); // NEU
    
    if (view === 'dashboard') {
        dashboardView.classList.remove('hidden');
        dashboardTab.classList.add('active');
    } else if (view === 'ranking') {
        rankingView.classList.remove('hidden');
        rankingTab.classList.add('active');
        loadRankingContent();
    } else if (view === 'leaderboard') { // NEU
        leaderboardView.classList.remove('hidden');
        leaderboardTab.classList.add('active');
        loadLeaderboardPage(); // Lädt die UI mit den bereits vorhandenen Daten
    }
}

// ==================== MOTIVATION HELPER (Unverändert) ====================
// ...
function setMotivation(text) {
    document.getElementById('motivationReason').value = text;
}

// ==================== RANKING CONTENT LOADER (Unverändert) ====================
// ...
function loadRankingContent() {
    const container = document.getElementById('rankingContent');
    if (container.innerHTML.trim() !== '' && !container.innerHTML.includes('wird dynamisch')) {
        return; // Already loaded
    }
    
    container.innerHTML = `
        <div class="ranking-hero">
            <h1>🏆 Das CalRank Ranking-System</h1>
            <p>Gamifiziere deinen Abnehm-Prozess und steige in den Rängen auf!</p>
        </div>

        <div class="ranks-section">
            <h2>Die 8 Ränge</h2>
            <div class="ranks-grid">
                ${RANKS.map(rank => `
                    <div class="rank-card-info" style="border-color: ${rank.color};">
                        <img src="${rank.icon}" alt="${rank.name}" onerror="this.style.display='none'">
                        <h3 style="color: ${rank.color};">${rank.name}</h3>
                        <p class="rank-threshold">${rank.threshold} Punkte</p>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="points-explanation">
            <div class="points-column positive-points">
                <h2>✅ Punkte sammeln</h2>
                <div class="point-item priority-high">
                    <div class="point-header">
                        <span class="point-icon">🏋️</span>
                        <span class="point-name">Gewichtsverlust</span>
                    </div>
                    <span class="point-value">+150 Punkte/kg</span>
                    <p class="point-note">HÖCHSTE PRIORITÄT! Das Hauptziel der App</p>
                </div>
                <div class="point-item">
                    <div class="point-header">
                        <span class="point-icon">⚖️</span>
                        <span class="point-name">Gewicht eintragen</span>
                    </div>
                    <span class="point-value">+30 Punkte</span>
                    <p class="point-note">Täglich oder wöchentlich</p>
                </div>
                <div class="point-item">
                    <div class="point-header">
                        <span class="point-icon">🎯</span>
                        <span class="point-name">Kalorienziel erreicht</span>
                    </div>
                    <span class="point-value">+40 Punkte</span>
                    <p class="point-note">Im Zielbereich bleiben</p>
                </div>
                <div class="point-item">
                    <div class="point-header">
                        <span class="point-icon">💪</span>
                        <span class="point-name">Proteinziel (>90%)</span>
                    </div>
                    <span class="point-value">+35 Punkte</span>
                    <p class="point-note">Schützt Muskelmasse</p>
                </div>
                <div class="point-item">
                    <div class="point-header">
                        <span class="point-icon">👟</span>
                        <span class="point-name">10.000 Schritte</span>
                    </div>
                    <span class="point-value">+25 Punkte</span>
                    <p class="point-note">Aktiv bleiben</p>
                </div>
                <div class="point-item">
                    <div class="point-header">
                        <span class="point-icon">🍽️</span>
                        <span class="point-name">3 Hauptmahlzeiten</span>
                    </div>
                    <span class="point-value">+20 Punkte</span>
                    <p class="point-note">Strukturierte Ernährung</p>
                </div>
                <div class="point-item">
                    <div class="point-header">
                        <span class="point-icon">📊</span>
                        <span class="point-name">Tracking-Konsistenz</span>
                    </div>
                    <span class="point-value">+15 Punkte</span>
                    <p class="point-note">Jeden Tag tracken</p>
                </div>
            </div>

            <div class="points-column negative-points">
                <h2>⚠️ Punkte verlieren</h2>
                <div class="point-item priority-high">
                    <div class="point-header">
                        <span class="point-icon">📈</span>
                        <span class="point-name">Gewichtszunahme</span>
                    </div>
                    <span class="point-value">-50 Punkte/kg</span>
                    <p class="point-note">Bei >0.3kg Zunahme</p>
                </div>
                <div class="point-item">
                    <div class="point-header">
                        <span class="point-icon">🍔</span>
                        <span class="point-name">Kalorienüberschreitung</span>
                    </div>
                    <span class="point-value">-10 bis -50</span>
                    <p class="point-note">Je nach Überschreitung</p>
                </div>
                <div class="point-item">
                    <div class="point-header">
                        <span class="point-icon">🥩</span>
                        <span class="point-name">Zu wenig Protein</span>
                    </div>
                    <span class="point-value">-15 Punkte</span>
                    <p class="point-note">Unter 50% vom Ziel</p>
                </div>
                <div class="point-item">
                    <div class="point-header">
                        <span class="point-icon">🛋️</span>
                        <span class="point-name">Inaktivität</span>
                    </div>
                    <span class="point-value">-10 Punkte</span>
                    <p class="point-note">Unter 1.000 Schritte</p>
                </div>
                <div class="point-item">
                    <div class="point-header">
                        <span class="point-icon">❌</span>
                        <span class="point-name">Kein Tracking</span>
                    </div>
                    <span class="point-value">-20 Punkte</span>
                    <p class="point-note">Keine Einträge für den Tag</p>
                </div>
            </div>
        </div>

        <div class="calculation-info">
            <h2>⏰ Wann werden Punkte berechnet?</h2>
            <div class="info-cards">
                <div class="info-card">
                    <span class="info-card-icon">🌙</span>
                    <h3>Jeden Tag um Mitternacht</h3>
                    <p>Deine Punkte werden automatisch am Ende jedes Tages berechnet</p>
                </div>
                <div class="info-card">
                    <span class="info-card-icon">📅</span>
                    <h3>Heutiger Tag zählt nicht</h3>
                    <p>Der aktuelle Tag wird erst berechnet, wenn er abgeschlossen ist</p>
                </div>
                <div class="info-card">
                    <span class="info-card-icon">🔄</span>
                    <h3>Beim nächsten App-Start</h3>
                    <p>Nach Mitternacht siehst du deine neuen Punkte beim Öffnen der App</p>
                </div>
            </div>
        </div>

        <div class="tips-section">
            <h2>💡 Pro-Tipps für schnellen Rank-Up</h2>
            <div class="tips-grid">
                <div class="tip-card">
                    <span class="tip-number">1</span>
                    <h3>Wiege dich 2x pro Woche</h3>
                    <p>Mehr Chancen auf Gewichtsverlust-Punkte!</p>
                </div>
                <div class="tip-card">
                    <span class="tip-number">2</span>
                    <h3>Tracke IMMER</h3>
                    <p>Selbst schlechte Tage geben mehr Punkte als keine Einträge</p>
                </div>
                <div class="tip-card">
                    <span class="tip-number">3</span>
                    <h3>Strukturiere Mahlzeiten</h3>
                    <p>3 Hauptmahlzeiten = Easy +20 Punkte</p>
                </div>
                <div class="tip-card">
                    <span class="tip-number">4</span>
                    <h3>10k Schritte täglich</h3>
                    <p>Einfache +25 Punkte jeden Tag</p>
                </div>
                <div class="tip-card">
                    <span class="tip-number">5</span>
                    <h3>Protein nicht vergessen</h3>
                    <p>+35 Punkte sind wichtig für Muskelerhalt</p>
                </div>
                <div class="tip-card">
                    <span class="tip-number">6</span>
                    <h3>Konsistenz > Perfektion</h3>
                    <p>80 Punkte jeden Tag schlagen 150/0/150/0</p>
                </div>
            </div>
        </div>

        <div class="ranking-back">
            <button class="btn btn-primary btn-large" onclick="switchView('dashboard')">
                ← Zurück zum Dashboard
            </button>
        </div>
    `;
}

// ==================== MEALS OVERVIEW (Unverändert) ====================
// ... (updateMealsOverview, updateMealCategory bleiben unverändert) ...
function updateMealsOverview() {
    const todayData = getTodayData();
    const meals = todayData.meals || [];
    
    // Initialize categories
    const categories = {
        breakfast: { items: [], total: 0 },
        lunch: { items: [], total: 0 },
        dinner: { items: [], total: 0 },
        snack: { items: [], total: 0 }
    };
    
    // Group meals by category
    meals.forEach(meal => {
        if (categories[meal.category]) {
            categories[meal.category].items.push(meal);
            categories[meal.category].total += meal.calories;
        }
    });
    
    // Update each category
    updateMealCategory('breakfast', categories.breakfast);
    updateMealCategory('lunch', categories.lunch);
    updateMealCategory('dinner', categories.dinner);
    updateMealCategory('snack', categories.snack);
}

function updateMealCategory(categoryId, data) {
    const totalElement = document.getElementById(categoryId + 'Total');
    const itemsElement = document.getElementById(categoryId + 'Items');
    
    totalElement.textContent = data.total + ' kcal';
    
    if (data.items.length === 0) {
        itemsElement.innerHTML = '<p class="empty-message">Noch keine Einträge</p>';
    } else {
        itemsElement.innerHTML = data.items.map(meal => `
            <div class="meal-entry">
                <div class="meal-entry-info">
                    <h4>${meal.name}</h4>
                    <p>${meal.time}</p>
                </div>
                <div class="meal-entry-stats">
                    <div class="meal-entry-calories">${meal.calories} kcal</div>
                    ${meal.protein > 0 ? `<div class="meal-entry-protein">${meal.protein}g Protein</div>` : ''}
                </div>
            </div>
        `).join('');
    }
}

// ==================== STEPS (WICHTIG: ruft saveData() auf) ====================
function addSteps() {
    const steps = parseInt(document.getElementById('stepsValue').value);
    
    if (!steps || steps <= 0) {
        showNotification('Bitte gib eine gültige Schrittzahl ein', 'error');
        return;
    }
    
    const today = getDateString(new Date());
    
    if (!userData.dailyEntries[today]) {
        userData.dailyEntries[today] = {
            calories: 0,
            protein: 0,
            meals: [],
            steps: 0,
            stepsCalories: 0
        };
    }
    
    // Calculate calories burned (average: 0.04 kcal per step)
    const caloriesBurned = Math.round(steps * 0.04);
    
    userData.dailyEntries[today].steps = steps;
    userData.dailyEntries[today].stepsCalories = caloriesBurned;
    
    saveData(); // <--- NEU: Speichert in Firestore
    updateDashboard();
    closeModal('addSteps');
    
    // Clear input
    document.getElementById('stepsValue').value = '';
    document.getElementById('estimatedStepsCalories').textContent = '0 kcal';
    
    showNotification(`✅ ${steps} Schritte gespeichert! (~${caloriesBurned} kcal verbrannt)`, 'success');
}

// ==================== SUPPLEMENTS (WICHTIG: ruft saveData() auf) ====================
function checkSupplementReminder() {
    const reminderCard = document.getElementById('supplementReminder');
    
    if (!userData.settings || !userData.settings.supplementReminder) {
        reminderCard.classList.add('hidden');
        return;
    }
    
    const today = getDateString(new Date());
    const lastTaken = userData.settings.supplementTakenDate;
    
    if (lastTaken === today) {
        reminderCard.classList.add('hidden');
    } else {
        reminderCard.classList.remove('hidden');
    }
}

function toggleSupplementReminder() {
    const enabled = document.getElementById('supplementReminderToggle').checked;
    
    if (!userData.settings) {
        userData.settings = {};
    }
    
    userData.settings.supplementReminder = enabled;
    saveData(); // <--- NEU: Speichert in Firestore
    
    checkSupplementReminder();
    
    showNotification(
        enabled ? '✅ Supplement-Erinnerung aktiviert' : 'Supplement-Erinnerung deaktiviert', 
        'success'
    );
}

function markSupplementsTaken() {
    const today = getDateString(new Date());
    
    if (!userData.settings) {
        userData.settings = {};
    }
    
    userData.settings.supplementTakenDate = today;
    saveData(); // <--- NEU: Speichert in Firestore
    
    checkSupplementReminder();
    showNotification('✅ Super! Supplements für heute erledigt!', 'success');
}

// ==================== RANKING SYSTEM (WICHTIG: ruft saveData() auf) ====================

const RANKS = [
    { name: 'Iron', threshold: 0, icon: 'ranks/1iron.png', color: '#94a3b8' },
    { name: 'Gold', threshold: 200, icon: 'ranks/2gold.png', color: '#fbbf24' },
    { name: 'Diamond', threshold: 500, icon: 'ranks/3diamond.png', color: '#60a5fa' },
    { name: 'Emerald', threshold: 900, icon: 'ranks/4emerald.png', color: '#34d399' },
    { name: 'Onyx', threshold: 1400, icon: 'ranks/5onyx.png', color: '#a78bfa' },
    { name: 'Celadon', threshold: 2000, icon: 'ranks/6celadon.png', color: '#2dd4bf' },
    { name: 'Celestial', threshold: 2700, icon: 'ranks/7celestial.png', color: '#f472b6' },
    { name: 'Infernal', threshold: 3500, icon: 'ranks/8infernal.png', color: '#f87171' }
];

function initializeRanking() {
    if (!userData.ranking) {
        userData.ranking = {
            currentRank: 0,
            rankPoints: 0,
            totalPointsEarned: 0,
            totalPointsLost: 0,
            rankHistory: [],
            lastCalculated: null
        };
    }
}

function calculateRankForPastDays() {
    initializeRanking();
    
    const today = getDateString(new Date());
    const lastCalculated = userData.ranking.lastCalculated;
    let calculationsDone = false;
    
    // Get all dates that need calculation
    const dates = Object.keys(userData.dailyEntries).sort();
    
    dates.forEach(date => {
        // Skip today (calculate at midnight) and already calculated dates
        if (date === today || (lastCalculated && date <= lastCalculated)) {
            return;
        }
        
        calculateDayPoints(date);
        calculationsDone = true;
    });
    
    if (calculationsDone) {
        console.log("Ranking-Neuberechnung abgeschlossen. Speichere...");
        saveData(); // <--- NEU: Speichert in Firestore nach Neuberechnung
    }
    
    updateRankDisplay();
}

function calculateDayPoints(date) {
    const entry = userData.dailyEntries[date];
    if (!entry) return;
    
    let pointsEarned = 0;
    let pointsLost = 0;
    let breakdown = [];
    
    // ===== POSITIVE POINTS =====
    
    // 1. WEIGHT LOSS (HIGHEST PRIORITY - Most Points!)
    const weightOnDate = getWeightForDate(date);
    const previousWeight = getPreviousWeight(date);
    
    if (weightOnDate && previousWeight) {
        const weightLoss = previousWeight - weightOnDate;
        if (weightLoss > 0) {
            // Reward weight loss significantly!
            // 0.1kg = 15pts, 0.5kg = 75pts, 1kg = 150pts
            const weightPoints = Math.round(weightLoss * 150);
            pointsEarned += weightPoints;
            breakdown.push(`✅ Gewichtsverlust (${weightLoss.toFixed(2)}kg): +${weightPoints}pts`);
        } else if (weightLoss < -0.3) {
            // Penalty for significant weight gain
            const gainPenalty = Math.round(Math.abs(weightLoss) * 50);
            pointsLost += gainPenalty;
            breakdown.push(`❌ Gewichtszunahme: -${gainPenalty}pts`);
        }
    }
    
    // 2. WEIGHT ENTRY BONUS (Consistency is key!)
    if (weightOnDate) {
        pointsEarned += 30; // Big bonus for weighing in
        breakdown.push(`✅ Gewicht eingetragen: +30pts`);
    }
    
    // 3. CALORIE DEFICIT (Good adherence)
    const targetCals = userData.profile.targetCalories;
    const consumedCals = entry.calories || 0;
    const calorieDeficit = targetCals - consumedCals;
    
    if (consumedCals > 0) {
        if (calorieDeficit >= 0 && calorieDeficit <= targetCals * 0.15) {
            // Perfect range: within target or 15% under
            pointsEarned += 40;
            breakdown.push(`✅ Kalorienziel erreicht: +40pts`);
        } else if (calorieDeficit > targetCals * 0.15 && calorieDeficit <= targetCals * 0.3) {
            // Good deficit (15-30% under)
            pointsEarned += 30;
            breakdown.push(`✅ Gutes Defizit: +30pts`);
        } else if (calorieDeficit > targetCals * 0.3) {
            // Too much deficit (potentially unhealthy)
            pointsEarned += 15;
            breakdown.push(`⚠️ Hohes Defizit: +15pts`);
        }
    }
    
    // 4. PROTEIN TARGET
    const targetProtein = userData.profile.targetProtein;
    const consumedProtein = entry.protein || 0;
    
    if (consumedProtein >= targetProtein * 0.9) {
        // 90%+ of protein goal
        pointsEarned += 35;
        breakdown.push(`✅ Proteinziel erreicht: +35pts`);
    } else if (consumedProtein >= targetProtein * 0.7) {
        // 70-90% of protein goal
        pointsEarned += 20;
        breakdown.push(`✅ Protein gut: +20pts`);
    } else if (consumedProtein < targetProtein * 0.5 && consumedProtein > 0) {
        // Less than 50% protein (muscle loss risk)
        pointsLost += 15;
        breakdown.push(`❌ Zu wenig Protein: -15pts`);
    }
    
    // 5. STEPS (Activity bonus)
    const steps = entry.steps || 0;
    if (steps >= 10000) {
        pointsEarned += 25;
        breakdown.push(`✅ 10.000+ Schritte: +25pts`);
    } else if (steps >= 7500) {
        pointsEarned += 20;
        breakdown.push(`✅ 7.500+ Schritte: +20pts`);
    } else if (steps >= 5000) {
        pointsEarned += 15;
        breakdown.push(`✅ 5.000+ Schritte: +15pts`);
    } else if (steps >= 2500) {
        pointsEarned += 10;
        breakdown.push(`✅ 2.500+ Schritte: +10pts`);
    } else if (steps < 1000 && steps > 0) {
        pointsLost += 10;
        breakdown.push(`❌ Unter 1.000 Schritte: -10pts`);
    }
    
    // 6. MEAL CONSISTENCY (3 main meals)
    const meals = entry.meals || [];
    const hasBreakfast = meals.some(m => m.category === 'breakfast');
    const hasLunch = meals.some(m => m.category === 'lunch');
    const hasDinner = meals.some(m => m.category === 'dinner');
    
    const mainMealsCount = [hasBreakfast, hasLunch, hasDinner].filter(Boolean).length;
    
    if (mainMealsCount === 3) {
        pointsEarned += 20;
        breakdown.push(`✅ 3 Hauptmahlzeiten: +20pts`);
    } else if (mainMealsCount === 2) {
        pointsEarned += 10;
        breakdown.push(`✅ 2 Hauptmahlzeiten: +10pts`);
    } else if (mainMealsCount === 0 && meals.length > 0) {
        pointsLost += 10;
        breakdown.push(`❌ Keine Hauptmahlzeiten: -10pts`);
   }
    
    // 7. TRACKING CONSISTENCY
    if (consumedCals > 0) {
        pointsEarned += 15;
        breakdown.push(`✅ Kalorien getrackt: +15pts`);
    } else {
        pointsLost += 20;
        breakdown.push(`❌ Keine Einträge: -20pts`);
    }
    
    // ===== NEGATIVE POINTS =====
    
    // 8. CALORIE OVERAGE
    if (calorieDeficit < 0) {
        const overage = Math.abs(calorieDeficit);
        if (overage <= 200) {
            pointsLost += 10;
            breakdown.push(`❌ Leichte Überschreitung: -10pts`);
        } else if (overage <= 500) {
            pointsLost += 25;
            breakdown.push(`❌ Überschreitung (${overage}kcal): -25pts`);
        } else {
            const severePenalty = Math.round(25 + (overage - 500) / 100 * 5);
            pointsLost += severePenalty;
            breakdown.push(`❌ Hohe Überschreitung: -${severePenalty}pts`);
        }
    }
    
    // Calculate net points for the day
    const netPoints = pointsEarned - pointsLost;
    
    // Update user ranking
    userData.ranking.rankPoints += netPoints;
    userData.ranking.totalPointsEarned += pointsEarned;
    userData.ranking.totalPointsLost += pointsLost;
    
    // Prevent negative points
    if (userData.ranking.rankPoints < 0) {
        userData.ranking.rankPoints = 0;
    }
    
    // Update rank based on points
    updateRank(); // Diese Funktion prüft auch auf Rank Up
    
    // Store in history
    userData.ranking.rankHistory.push({
        date: date,
        pointsEarned: pointsEarned,
        pointsLost: pointsLost,
        netPoints: netPoints,
        totalPoints: userData.ranking.rankPoints,
        rank: userData.ranking.currentRank,
        breakdown: breakdown
    });
    
    // Update last calculated
    userData.ranking.lastCalculated = date;
    
    // saveData() wird am Ende von calculateRankForPastDays() aufgerufen
    
    console.log(`Day ${date}: +${pointsEarned} -${pointsLost} = ${netPoints} (Total: ${userData.ranking.rankPoints})`);
}

function updateRank() {
    const points = userData.ranking.rankPoints;
    
    // Find appropriate rank
    for (let i = RANKS.length - 1; i >= 0; i--) {
        if (points >= RANKS[i].threshold) {
            const oldRank = userData.ranking.currentRank;
            userData.ranking.currentRank = i;
            
            // Show notification on rank up
            if (i > oldRank) {
                showRankUpNotification(i, oldRank);
            }
            break;
        }
    }
}

function showRankUpNotification(newRank, oldRank) {
    const rankInfo = RANKS[newRank];
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, ${rankInfo.color}22 0%, ${rankInfo.color}44 100%);
        border: 3px solid ${rankInfo.color};
        color: white;
        padding: 2rem 3rem;
        border-radius: 20px;
  d     box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        z-index: 10001;
        animation: rankUpAnimation 0.5s ease-out;
        text-align: center;
        min-width: 300px;
    `;
    
    notification.innerHTML = `
        <div style="font-size: 3rem; margin-bottom: 1rem;">🎉</div>
        <div style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">RANK UP!</div>
        <div style="font-size: 1.125rem; margin-bottom: 1rem;">
            ${RANKS[oldRank].name} → <span style="color: ${rankInfo.color}; font-weight: 700;">${rankInfo.name}</span>
        </div>
        <img src="${rankInfo.icon}" style="width: 80px; height: 80px; margin: 1rem auto;" onerror="this.style.display='none'">
        <div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 1rem;">
            ${userData.ranking.rankPoints} Punkte
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'rankUpOut 0.5s ease-out';
        setTimeout(() => notification.remove(), 500);
    }, 4000);
}

function getWeightForDate(date) {
    const entry = userData.weightEntries.find(e => e.date === date);
    return entry ? entry.weight : null;
}

function getPreviousWeight(date) {
    const currentDate = new Date(date);
    const sortedWeights = [...userData.weightEntries]
        .filter(e => new Date(e.date) < currentDate)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return sortedWeights.length > 0 ? sortedWeights[0].weight : null;
}

function updateRankDisplay() {
    initializeRanking();
    
    const currentRank = userData.ranking.currentRank;
    const rankInfo = RANKS[currentRank];
    const points = userData.ranking.rankPoints;
    
    // Update rank card
    const rankIconEl = document.getElementById('rankIcon');
    const rankNameEl = document.getElementById('rankName');
    const rankPointsEl = document.getElementById('rankPoints');
    
    if (rankIconEl) rankIconEl.src = rankInfo.icon;
    if (rankNameEl) rankNameEl.textContent = rankInfo.name;
    if (rankPointsEl) rankPointsEl.textContent = points;
    
    // Calculate progress to next rank
    const rankProgressEl = document.getElementById('rankProgress');
    const nextRankNameEl = document.getElementById('nextRankName');
    const pointsToNextEl = document.getElementById('pointsToNext');
    
    if (currentRank < RANKS.length - 1) {
        const nextRank = RANKS[currentRank + 1];
        const currentThreshold = RANKS[currentRank].threshold;
        const nextThreshold = nextRank.threshold;
        const progress = ((points - currentThreshold) / (nextThreshold - currentThreshold)) * 100;
        
        if (rankProgressEl) {
            rankProgressEl.style.width = Math.min(progress, 100) + '%';
            rankProgressEl.style.background = `linear-gradient(90deg, ${rankInfo.color} 0%, ${nextRank.color} 100%)`;
        }
        if (nextRankNameEl) nextRankNameEl.textContent = nextRank.name;
        if (pointsToNextEl) pointsToNextEl.textContent = Math.max(0, nextThreshold - points);
	} else {
        // Max rank reached
        if (rankProgressEl) {
            rankProgressEl.style.width = '100%';
            rankProgressEl.style.background = rankInfo.color;
        }
        if (nextRankNameEl) nextRankNameEl.textContent = 'MAX';
        if (pointsToNextEl) pointsToNextEl.textContent = '0';
    }
    
    // Update rank color theme
    const rankCardEl = document.getElementById('rankCard');
    if (rankCardEl) rankCardEl.style.borderColor = rankInfo.color;
    if (rankNameEl) rankNameEl.style.color = rankInfo.color;
    
    // Update time until calculation
    updateTimeUntilCalculation();
}

function updateTimeUntilCalculation() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    
    const diff = midnight - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    const rankTipEl = document.querySelector('.rank-tip');
    if (rankTipEl && !rankTipEl.innerHTML.includes('💭')) { // Nicht überschreiben, wenn Motivations-Spruch da ist
        rankTipEl.innerHTML = `⏰ Nächste Berechnung in: <strong>${hours}h ${minutes}m</strong>`;
    }
}

// Update countdown every minute
setInterval(() => {
    if (userData.setupComplete && document.getElementById('rankCard')) {
        updateTimeUntilCalculation();
    }
}, 60000);

function viewRankHistory() {
    openModal('rankHistory');
    
    // Update stats summary
    document.getElementById('totalRankPoints').textContent = userData.ranking.rankPoints || 0;
    document.getElementById('totalEarnedPoints').textContent = userData.ranking.totalPointsEarned || 0;
    document.getElementById('totalLostPoints').textContent = userData.ranking.totalPointsLost || 0;
    
    displayRankHistory();
}

function displayRankHistory() {
    const container = document.getElementById('rankHistoryContent');
    const history = [...(userData.ranking.rankHistory || [])].reverse().slice(0, 30);
    
    if (history.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Noch keine Rank-Historie vorhanden. Rank-Punkte werden am Ende jedes Tages berechnet.</p>';
        return;
    }
    
    container.innerHTML = history.map(entry => {
        const rankInfo = RANKS[entry.rank];
        const netClass = entry.netPoints >= 0 ? 'positive' : 'negative';
        const netSign = entry.netPoints >= 0 ? '+' : '';
        
        return `
            <div class="history-day-card">
                <div class="history-day-header">
                    <div>
                        <div class="history-day-date">${formatDate(new Date(entry.date))}</div>
                        <div class="history-day-rank">
                            <img src="${rankInfo.icon}" style="width: 24px; height: 24px; vertical-align: middle;" onerror="this.style.display='none'">
                            <span style="color: ${rankInfo.color}; font-weight: 600;">${rankInfo.name}</span>
                        </div>
                    </div>
                    <div class="history-day-points ${netClass}">
                        ${netSign}${entry.netPoints} pts
                    </div>
                </div>
                <div class="history-day-breakdown">
                    <div class="breakdown-stats">
                        <span class="stat-earned">+${entry.pointsEarned}</span>
                        <span class="stat-lost">-${entry.pointsLost}</span>
                        <span class="stat-total">Total: ${entry.totalPoints}</span>
                    </div>
                    <div class="breakdown-details">
                        ${entry.breakdown.map(item => `<div class="breakdown-item">${item}</div>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}


// ==================== LEADERBOARD (NEU) ====================

// NEU: Wird aufgerufen, wenn man auf den Leaderboard-Tab klickt
function loadLeaderboardPage() {
    // Aktualisiert die UI mit den Daten, die der Listener bereits geladen hat
    if (fullLeaderboardData.length > 0) {
        updateLeaderboardPage(fullLeaderboardData);
    }
    // Das Badge für "Zuletzt aktualisiert" wird ebenfalls in updateLeaderboardPage gesetzt
}

function startLeaderboardListener() {
    console.log("Leaderboard-Listener wird gestartet...");
    const container = document.getElementById('fullLeaderboardList'); // Container auf der neuen Seite

    // Erstelle eine Abfrage: Top 50, sortiert nach Punkten
    const query = db.collection('users')
                    .orderBy('ranking.rankPoints', 'desc')
                    .limit(50); // Lade Top 50 für eine genaue Platzierung
    
    // .onSnapshot erstellt einen Echtzeit-Listener
    const unsubscribe = query.onSnapshot(snapshot => {
        console.log("Leaderboard-Daten empfangen:", snapshot.docs.length, "Einträge");
        const docs = snapshot.docs;
        
        fullLeaderboardData = docs; // Speichere die Daten global
        
        // Aktualisiere beide Bereiche: Die Seite und die Rang-Karte
        updateLeaderboardPage(docs);
        updateRankPlacement(docs);

    }, error => {
        console.error("Fehler beim Abrufen des Leaderboards:", error);
        container.innerHTML = '<p class="leaderboard-placeholder">Leaderboard konnte nicht geladen werden.</p>';
        document.getElementById('rankPlacement').textContent = 'Fehler';
    });

    return unsubscribe; // Gibt die Funktion zurück, um den Listener zu stoppen (beim Logout)
}

// NEU: Aktualisiert die UI der neuen Leaderboard-Seite
function updateLeaderboardPage(docs) {
    const container = document.getElementById('fullLeaderboardList');
    const currentUserId = auth.currentUser ? auth.currentUser.uid : null;
    
    // Update "Zuletzt aktualisiert" Badge
    const timestampEl = document.getElementById('leaderboardLastUpdated');
    if (timestampEl) {
        timestampEl.textContent = `Aktualisiert: ${new Date().toLocaleTimeString('de-DE')}`;
    }

    if (!docs || docs.length === 0) {
        container.innerHTML = '<p class="leaderboard-placeholder">Noch keine Einträge im Leaderboard.</p>';
        return;
    }

    container.innerHTML = ''; // Container leeren
    
    docs.forEach((doc, index) => {
        const data = doc.data();
        const isCurrentUser = doc.id === currentUserId;
        
        const profile = data.profile;
        const ranking = data.ranking;
        
        // 1. Name
        const name = profile.name || 'Unbekannt';
        
        // 2. Rang, Icon, Punkte
        const rankInfo = RANKS[ranking.currentRank || 0];
        const points = ranking.rankPoints || 0;
        
        // 3. Streak (muss aus den Daten des Users berechnet werden)
        const streak = calculateUserStreak(data.dailyEntries || {});
        
        // 4. Gewichtsverlust
        const startWeight = profile.startWeight || 0;
        let latestWeight = profile.currentWeight || 0;
        
        if (data.weightEntries && data.weightEntries.length > 0) {
            const sortedWeights = [...data.weightEntries].sort((a, b) => new Date(b.date) - new Date(a.date));
            latestWeight = sortedWeights[0].weight;
        }
        
        const totalLost = startWeight - latestWeight;
        const totalLostDisplay = totalLost > 0 ? `-${totalLost.toFixed(1)}` : `+${Math.abs(totalLost).toFixed(1)}`;
        
        // HTML erstellen
        const userClass = isCurrentUser ? 'current-user' : '';
        const entryHTML = `
            <div class="leaderboard-entry ${userClass}">
                <span class="leaderboard-pos">${index + 1}.</span>
                <span class="leaderboard-name" title="${name}">${name} ${isCurrentUser ? '(Du)' : ''}</span>
                <div class="leaderboard-rank">
                    <img src="${rankInfo.icon}" alt="${rankInfo.name}" onerror="this.style.display='none'">
                    <span>${points}</span>
                </div>
                <div class="leaderboard-stat streak"><span>🔥</span> <strong>${streak}</strong></div>
                <div class="leaderboard-stat kg"><span>📉</span> <strong>${totalLostDisplay}</strong> kg</div>
            </div>
        `;
        
        container.innerHTML += entryHTML;
    });
}

// NEU: Aktualisiert die Platzierung auf der Rang-Karte
function updateRankPlacement(docs) {
    const currentUserId = auth.currentUser ? auth.currentUser.uid : null;
    const placementEl = document.getElementById('rankPlacement');
    if (!currentUserId || !placementEl) return;

    const userIndex = docs.findIndex(doc => doc.id === currentUserId);

    if (userIndex !== -1) {
        const rank = userIndex + 1;
        placementEl.textContent = `Platz ${rank} von ${docs.length}`;
    } else {
        placementEl.textContent = 'Nicht in Top 50';
    }
}


// Helferfunktion, um Streak für *andere* User im Leaderboard zu berechnen
function calculateUserStreak(dailyEntries) {
    const dates = Object.keys(dailyEntries).sort().reverse();
    let streak = 0;
    let currentDate = new Date();
    
    for (let i = 0; i < dates.length; i++) {
        const checkDate = getDateString(currentDate);
        if (dates.includes(checkDate)) {
            const entry = dailyEntries[checkDate];
            if (entry && (entry.calories > 0 || entry.meals.length > 0 || entry.steps > 0)) {
                streak++;
                currentDate.setDate(currentDate.getDate() - 1);
            } else {
                break;
            }
        } else {
             if (i === 0 && dates.length > 1 && dates[1] === getDateString(new Date(new Date().setDate(new Date().getDate() - 1)))) {
                // Heute ist leer, aber gestern wurde getrackt.
             } else {
                break;
            }
        }
    }
    return streak;
}