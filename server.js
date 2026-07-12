document.addEventListener("DOMContentLoaded", loadHausaufgaben);

function renderHausaufgaben(data) {
    const liste = document.getElementById('hausaufgabenListe');
    const timestampEl = document.getElementById('timestamp');
    if (!liste) return;

    liste.innerHTML = ""; // Leeren

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

        // Gespeicherte Checkbox-Zustände laden
        const saved = JSON.parse(localStorage.getItem("hw_checked") || "{}");
        checkbox.checked = !!saved[index];

        // Änderungen speichern
        checkbox.addEventListener("change", () => {
            saveCheckboxState(index, checkbox.checked);
        });
    });
}

async function loadHausaufgaben() {
    // ERSTER SCHRITT: Sofort aus dem lokalen Speicher (Handy) laden, damit keine Wartezeit entsteht
    const localData = localStorage.getItem('hausaufgaben_cache');
    if (localData) {
        console.log("Hausaufgaben direkt aus dem Local Storage geladen.");
        renderHausaufgaben(JSON.parse(localData));
    } else {
        const liste = document.getElementById('hausaufgabenListe');
        if (liste) {
            liste.innerHTML = `<div class="no-hw">Noch keine Daten geladen. Bitte Formular abschicken.</div>`;
        }
    }

    // ZWEITER SCHRITT: Im Hintergrund versuchen, den aktuellen Stand vom Server-Cache zu holen
    try {
        const response = await fetch('/get-hausaufgaben');
        if (response.ok) {
            const data = await response.json();
            console.log("Frische Hausaufgaben erfolgreich vom Server geladen.");
            
            // Lokalen Speicher aktualisieren
            localStorage.setItem('hausaufgaben_cache', JSON.stringify(data));
            renderHausaufgaben(data);
        }
    } catch (err) {
        console.log("Server noch nicht erreichbar oder Server-Cache leer.");
    }
}

async function startHwScraper(event) {
    event.preventDefault();
    console.log("startHwScraper wurde im Browser getriggert.");

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
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
            // WICHTIG: Wir holen uns das JSON direkt aus der Server-Antwort!
            const frischeDaten = await response.json();
            console.log("Server hat Hausaufgaben erfolgreich gescraped und gesendet:", frischeDaten);

            // Sofort im Handyspeicher sichern
            localStorage.setItem('hausaufgaben_cache', JSON.stringify(frischeDaten));
            
            // Liste sofort mit den neuen Hausaufgaben zeichnen
            renderHausaufgaben(frischeDaten);

            alert("Hausaufgaben erfolgreich aktualisiert!");
        } else {
            alert("Fehler beim Abrufen der Hausaufgaben. Bitte Logindaten prüfen.");
        }
    } catch (err) {
        console.error("Fehler beim Senden an den Server:", err);
        alert("Verbindungsfehler zum Server.");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Aufgaben aktualisieren"; }
        if (status) status.style.display = "none";
    }
}

function saveCheckboxState(index, checked) {
    const saved = JSON.parse(localStorage.getItem("hw_checked") || "{}");
    saved[index] = checked;
    localStorage.setItem("hw_checked", JSON.stringify(saved));
}