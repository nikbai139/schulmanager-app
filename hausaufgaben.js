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

    data.aufgaben.forEach(aufgabe => {
        const item = document.createElement('div');
        item.className = "hw-item";

        item.innerHTML = `
            <div class="hw-content">
                <span class="hw-fach">${aufgabe.fach}</span>
                <div class="hw-text">${aufgabe.text}</div>
            </div>
            <div class="hw-date">Bis: ${aufgabe.datum || 'Unbekannt'}</div>
        `;
        liste.appendChild(item);
    });
}

async function loadHausaufgaben() {
    try {
        const response = await fetch('/get-hausaufgaben');
        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('hausaufgaben_cache', JSON.stringify(data));
            renderHausaufgaben(data);
            return;
        }
    } catch (err) {
        console.log("Server-Datei nicht gefunden, prüfe Local Storage...");
    }

    // Backup aus dem Browser-Speicher laden
    const localData = localStorage.getItem('hausaufgaben_cache');
    if (localData) {
        renderHausaufgaben(JSON.parse(localData));
    } else {
        document.getElementById('hausaufgabenListe').innerHTML = `<div class="no-hw">Noch keine Daten geladen. Bitte Formular abschicken.</div>`;
    }
}

async function startHwScraper(event) {
    event.preventDefault();

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
            await loadHausaufgaben();
            alert("Hausaufgaben erfolgreich aktualisiert!");
        } else {
            alert("Fehler beim Abrufen der Hausaufgaben.");
        }
    } catch (err) {
        alert("Verbindungsfehler zum Server.");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Aufgaben aktualisieren"; }
        if (status) status.style.display = "none";
    }
}