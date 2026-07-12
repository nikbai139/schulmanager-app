// 1. Beim Laden der Seite: Hausaufgaben anzeigen und prüfen, ob Login-Daten vorhanden sind
document.addEventListener("DOMContentLoaded", () => {
    loadHausaufgaben();

    // Prüfen, ob Zugangsdaten aus index.html (Stundenplan) existieren und direkt nutzen
    const savedUser = localStorage.getItem('sm_user');
    const savedPass = localStorage.getItem('sm_pass');

    if (savedUser && savedPass) {
        // Visuell in die Felder eintragen, falls der Nutzer sie auf dieser Seite sehen möchte
        if (document.getElementById('username')) document.getElementById('username').value = savedUser;
        if (document.getElementById('password')) document.getElementById('password').value = savedPass;

        console.log("Gespeicherte Login-Daten gefunden. Starte automatischen Hausaufgaben-Abgleich...");
        // Automatisch die Hausaufgaben im Hintergrund frisch abrufen
        executeHwScraper(savedUser, savedPass);
    }
});

// 2. Formular-Handling (Falls der Nutzer manuell andere Daten eingibt und abschickt)
async function startHwScraper(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    await executeHwScraper(username, password);
}

// 3. Kern-Logik für den Hausaufgaben-Scraper (wird von Auto-Login und Formular genutzt)
async function executeHwScraper(username, password) {
    const btn = document.getElementById('submitBtn');
    const status = document.getElementById('statusText');

    if (btn) { btn.disabled = true; btn.innerText = "Lädt..."; }
    if (status) status.style.display = "block";

    try {
        const response = await fetch('/start-hw-scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
        });

        if (response.ok) {
            const frischeDaten = await response.json();
            console.log("Hausaufgaben erfolgreich aktualisiert:", frischeDaten);

            // Sofort im Handyspeicher sichern
            localStorage.setItem('hausaufgaben_cache', JSON.stringify(frischeDaten));

            // Liste neu zeichnen
            renderHausaufgaben(frischeDaten);
        } else {
            console.error("Fehler beim Abrufen der Hausaufgaben vom Server.");
        }
    } catch (err) {
        console.error("Fehler beim Hausaufgaben-Scrape:", err);
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Aufgaben aktualisieren"; }
        if (status) status.style.display = "none";
    }
}

// 4. Hausaufgaben aus dem lokalen Speicher laden
async function loadHausaufgaben() {
    // ERSTER SCHRITT: Sofort aus dem Cache laden (keine Wartezeit für den Nutzer)
    const localData = localStorage.getItem('hausaufgaben_cache');
    if (localData) {
        renderHausaufgaben(JSON.parse(localData));
    } else {
        const liste = document.getElementById('hausaufgabenListe');
        if (liste) {
            liste.innerHTML = `<div class="no-hw">Noch keine Daten geladen. Bitte Formular abschicken oder einloggen.</div>`;
        }
    }

    // ZWEITER SCHRITT: Im Hintergrund versuchen, den aktuellen Stand vom Server-Cache zu holen
    try {
        const response = await fetch('/get-hausaufgaben');
        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('hausaufgaben_cache', JSON.stringify(data));
            renderHausaufgaben(data);
        }
    } catch (err) {
        console.log("Server noch nicht erreichbar oder Server-Cache leer.");
    }
}

// 5. Die Hausaufgaben-Liste im HTML aufbauen
function renderHausaufgaben(data) {
    const liste = document.getElementById('hausaufgabenListe');
    const timestampEl = document.getElementById('timestamp');
    if (!liste) return;

    liste.innerHTML = ""; // Altes Layout leeren

    if (timestampEl && data.aktualisiertAm) {
        timestampEl.innerText = "Stand: " + new Date(data.aktualisiertAm).toLocaleString('de-DE');
    }

    if (!data.aufgaben || data.aufgaben.length === 0) {
        liste.innerHTML = `<div class="no-hw">Keine aktuellen Hausaufgaben eingetragen! 🎉</div>`;
        return;
    }

    data.aufgaben.forEach((aufgabe, index) => {
        const item = document.createElement('div');
        item.className = "hw-item";

        item.innerHTML = `
            <div class="hw-content">
                <span class="hw-fach">${aufgabe.fach}</span>
                <div class="hw-text">${aufgabe.text}</div>
            </div>
            <div class="hw-date">
                Vom: ${aufgabe.datum || 'Unbekannt'}
                <input type="checkbox" id="hw_${index}">
            </div>
        `;

        liste.appendChild(item);

        const checkbox = item.querySelector("input[type='checkbox']");

        // Gespeicherte Checkbox-Zustände (Erledigt-Haken) laden
        const saved = JSON.parse(localStorage.getItem("hw_checked") || "{}");
        checkbox.checked = !!saved[index];

        // Änderungen an den Checkboxen speichern
        checkbox.addEventListener("change", () => {
            saveCheckboxState(index, checkbox.checked);
        });
    });
}

// Helper-Funktion: Zustand der Checkboxen im Speicher sichern
function saveCheckboxState(index, checked) {
    const saved = JSON.parse(localStorage.getItem("hw_checked") || "{}");
    saved[index] = checked;
    localStorage.setItem("hw_checked", JSON.stringify(saved));
}