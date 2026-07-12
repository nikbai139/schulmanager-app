// 1. Beim Laden der Seite direkt versuchen, den Plan anzuzeigen
document.addEventListener("DOMContentLoaded", loadStundenplan);

function renderTable(data) {
    if (!data || !data.tage) return;

    // Zeitstempel setzen
    const timestampEl = document.getElementById('timestamp');
    if (timestampEl && data.aktualisiertAm) {
        timestampEl.innerText = "Stand: " + new Date(data.aktualisiertAm).toLocaleString('de-DE');
    }

    const body = document.getElementById('stundenplanBody');
    if (!body) return;
    body.innerHTML = ""; // Altes Layout leeren

    const wochentage = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];

    // Zeilen für die Stunden 1 bis 11 bauen
    for (let stunde = 1; stunde <= 11; stunde++) {
        const tr = document.createElement('tr');

        // Erste Spalte: Stundennummer
        const tdStunde = document.createElement('td');
        tdStunde.innerText = stunde;
        tr.appendChild(tdStunde);

        // Spalten für die Wochentage
        wochentage.forEach(tag => {
            const tdTag = document.createElement('td');

            // Suchen, ob es für diesen Tag und diese Stunde einen Eintrag im JSON gibt
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
                tdTag.innerText = ""; // Freistunde
            }
            tr.appendChild(tdTag);
        });

        body.appendChild(tr);
    }
}

async function loadStundenplan() {
    try {
        // Schritt A: Versuche vom Server zu laden
        const response = await fetch('/get-stundenplan');
        if (response.ok) {
            const data = await response.json();
            console.log("Daten erfolgreich vom Server geladen.");

            // Im lokalen Browser-Speicher als Backup sichern
            localStorage.setItem('stundenplan_cache', JSON.stringify(data));

            renderTable(data);
            return;
        }
    } catch (err) {
        console.log("Server noch nicht erreichbar oder Datei fehlt, prüfe Local Storage...");
    }

    // Schritt B: Fallback auf Local Storage (Lokaler Speicher im Browser)
    const localData = localStorage.getItem('stundenplan_cache');
    if (localData) {
        console.log("Daten erfolgreich aus dem Local Storage des Browsers geladen.");
        const data = JSON.parse(localData);
        renderTable(data);
    } else {
        console.log("Weder auf dem Server noch im Local Storage Daten gefunden.");
    }
}

// 2. Scraper im Hintergrund ausführen
async function startScraper(event) {
    event.preventDefault();
    console.log("startScraper wurde im Browser getriggert.");

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    const btn = document.getElementById('submitBtn');
    const status = document.getElementById('statusText');

    if (btn) {
        btn.disabled = true;
        btn.innerText = "Lädt...";
    }
    if (status) status.style.display = "block";

    try {
        const response = await fetch('/start-scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
        });

        if (response.ok) {
            console.log("Server hat das Scraping erfolgreich beendet.");
            // Tabelle neu laden (zieht die frischen Daten und speichert sie lokal)
            await loadStundenplan();
            alert("Stundenplan erfolgreich aktualisiert!");
        } else {
            alert("Fehler beim Scrapen. Bitte Logindaten prüfen.");
        }
    } catch (err) {
        console.error("Fehler beim Senden an den Server:", err);
        alert("Verbindungsfehler zum Server.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Plan aktualisieren";
        }
        if (status) status.style.display = "none";
    }
}
async function handleZentralLogin(event) {
    event.preventDefault();
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const merken = document.getElementById('merkenCheckbox').checked; // Checkbox abfragen

    // 1. Schicke die Daten an den Server
    const response = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
    });

    if (response.ok) {
        // 2. Wenn "gemerkt" werden soll, lokal im Browser speichern
        if (merken) {
            localStorage.setItem('sm_user', user);
            localStorage.setItem('sm_pass', pass);
        }
        alert("Erfolgreich angemeldet!");
        // Jetzt kannst du die Scraper ganz ohne Body triggern!
    }
}

// Automatischer Auto-Login beim Starten der Website:
document.addEventListener("DOMContentLoaded", async () => {
    const savedUser = localStorage.getItem('sm_user');
    const savedPass = localStorage.getItem('sm_pass');

    if (savedUser && savedPass) {
        // Automatisch im Hintergrund am Server anmelden
        await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: savedUser, password: savedPass })
        });
        console.log("Auto-Login durchgeführt!");
    }
});