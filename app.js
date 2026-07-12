// 1. Beim Laden der Seite: Tabelle anzeigen und Auto-Login prüfen
document.addEventListener("DOMContentLoaded", () => {
    loadStundenplan();
    checkAutoLogin();
});

function renderTable(data) {
    if (!data || !data.tage) return;

    const timestampEl = document.getElementById('timestamp');
    if (timestampEl && data.aktualisiertAm) {
        timestampEl.innerText = "Stand: " + new Date(data.aktualisiertAm).toLocaleString('de-DE');
    }

    const body = document.getElementById('stundenplanBody');
    if (!body) return;
    body.innerHTML = "";

    const wochentage = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];

    for (let stunde = 1; stunde <= 11; stunde++) {
        const tr = document.createElement('tr');
        const tdStunde = document.createElement('td');
        tdStunde.innerText = stunde;
        tr.appendChild(tdStunde);

        wochentage.forEach(tag => {
            const tdTag = document.createElement('td');
            const eintrag = data.tage[tag] ? data.tage[tag].find(e => parseInt(e.stunde) === stunde) : null;

            if (eintrag && eintrag.details) {
                const detailsArray = eintrag.details.split(' | ');
                const istVertretung = detailsArray[0].startsWith('(');

                tdTag.innerHTML = `
                    <div class="cell-content">
                        <span class="fach ${istVertretung ? 'vertretung' : ''}">${detailsArray[0]}</span>
                        <span class="info">${detailsArray.slice(1).join(' | ')}</span>
                    </div>
                `;
            } else {
                tdTag.innerText = "";
            }
            tr.appendChild(tdTag);
        });
        body.appendChild(tr);
    }
}

async function loadStundenplan() {
    // Schnell aus Cache laden
    const localData = localStorage.getItem('stundenplan_cache');
    if (localData) {
        renderTable(JSON.parse(localData));
    }

    // Hintergrund-Update vom Server-Cache
    try {
        const response = await fetch('/get-stundenplan');
        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('stundenplan_cache', JSON.stringify(data));
            renderTable(data);
        }
    } catch (err) {
        console.log("Server noch nicht erreichbar oder Server-Cache leer.");
    }
}

// NEU: Kombinierte Funktion für Login-Speicherung und Scraper-Start
async function handleLoginUndScrape(event) {
    if (event) event.preventDefault();

    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const merken = document.getElementById('merkenCheckbox').checked;

    // 1. Zugangsdaten speichern oder löschen (je nach Checkbox)
    if (merken) {
        localStorage.setItem('sm_user', user);
        localStorage.setItem('sm_pass', pass);
    } else {
        localStorage.removeItem('sm_user');
        localStorage.removeItem('sm_pass');
    }

    // 2. Scraper mit den eingegebenen Daten starten
    await executeScraper(user, pass);
}

// Ausgelagerte Scraper-Logik
async function executeScraper(username, password) {
    const btn = document.getElementById('submitBtn');
    const status = document.getElementById('statusText');

    if (btn) { btn.disabled = true; btn.innerText = "Lädt..."; }
    if (status) status.style.display = "block";

    try {
        const response = await fetch('/start-scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
        });

        if (response.ok) {
            const frischeDaten = await response.json();
            localStorage.setItem('stundenplan_cache', JSON.stringify(frischeDaten));
            renderTable(frischeDaten);
            alert("Stundenplan erfolgreich aktualisiert!");
        } else {
            alert("Fehler beim Scrapen. Bitte Logindaten prüfen.");
        }
    } catch (err) {
        console.error("Fehler:", err);
        alert("Verbindungsfehler zum Server.");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Plan aktualisieren"; }
        if (status) status.style.display = "none";
    }
}

// Prüft beim Start, ob Daten da sind -> loggt ein und holt Daten automatisch
async function checkAutoLogin() {
    const savedUser = localStorage.getItem('sm_user');
    const savedPass = localStorage.getItem('sm_pass');

    if (savedUser && savedPass) {
        // Felder visuell befüllen und Haken setzen
        if(document.getElementById('username')) document.getElementById('username').value = savedUser;
        if(document.getElementById('password')) document.getElementById('password').value = savedPass;
        if(document.getElementById('merkenCheckbox')) document.getElementById('merkenCheckbox').checked = true;

        console.log("Gespeicherte Daten gefunden. Starte automatischen Abgleich...");
        // Führt den Scraper direkt automatisch aus
        await executeScraper(savedUser, savedPass);
    }
}