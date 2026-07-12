const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Sorgt dafür, dass Express Formulardaten (POST) und JSON-Daten versteht
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Aktiviert das Ausliefern von statischen Dateien (style.css, app.js, hausaufgaben.js) im aktuellen Ordner
app.use(express.static(__dirname));

// ==========================================
// 1. ROUTEN FÜR DAS FRONTEND (HTML)
// ==========================================

// Startseite -> Stundenplan
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Separate Seite -> Hausaufgaben
app.get('/hausaufgaben', (req, res) => {
  res.sendFile(path.join(__dirname, 'hausaufgaben.html'));
});
// Separate Seite -> Hausaufgaben
app.get('/notenrechner', (req, res) => {
  res.sendFile(path.join(__dirname, 'notenrechner.html'));
});


// ==========================================
// 2. ROUTEN FÜR DIE JSON-DATEN (GET)
// ==========================================

// Sendet die Stundenplan-Daten an den Browser
app.get('/get-stundenplan', (req, res) => {
  const dateiPfad = path.join(__dirname, 'stundenplan.json');
  if (fs.existsSync(dateiPfad)) {
    res.sendFile(dateiPfad);
  } else {
    res.status(404).json({ fehler: "Noch kein Plan vorhanden" });
  }
});

// Sendet die Hausaufgaben-Daten an den Browser
app.get('/get-hausaufgaben', (req, res) => {
  const dateiPfad = path.join(__dirname, 'hausaufgaben.json');
  if (fs.existsSync(dateiPfad)) {
    res.sendFile(dateiPfad);
  } else {
    res.status(404).json({ fehler: "Noch keine Hausaufgaben vorhanden" });
  }
});


// ==========================================
// 3. SCRAPER-ROUTE: STUNDENPLAN (POST)
// ==========================================
app.post('/start-scraper', async (req, res) => {
  console.log('=============================================');
  console.log('👉 [STUNDENPLAN] Anfrage vom Browser empfangen');
  console.log('=============================================');

  const { username, password } = req.body;
  if (!username || !password) {
     return res.status(400).send("Logindaten fehlen im Request.");
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();

    console.log('[Stundenplan] Öffne Schulmanager Login...');
    await page.goto('https://login.schulmanager-online.de/#/login?institutionId=14644', { waitUntil: 'commit' });
    await page.waitForTimeout(3000);

    const usernameField = page.locator('input[name="login"], input[name="username"], input[type="text"], input').first();
    const passwordField = page.locator('#password');
    await usernameField.waitFor({ timeout: 5000 });

    console.log('[Stundenplan] Logge ein...');
    await usernameField.pressSequentially(username, { delay: 40 });
    await passwordField.pressSequentially(password, { delay: 40 });
    await passwordField.press('Enter');
    await page.waitForTimeout(5000);

    console.log('[Stundenplan] Navigiere zum Stundenplan-Modul...');
    await page.goto('https://login.schulmanager-online.de/#/modules/schedules/view//', { waitUntil: 'commit' });
    await page.waitForTimeout(5000);

    console.log('[Stundenplan] Scanne Matrix...');
    const stundenplanSortiert = await page.evaluate(() => {
      const wochentage = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
      let ergebnis = { "Montag": [], "Dienstag": [], "Mittwoch": [], "Donnerstag": [], "Freitag": [] };

      const alleElemente = Array.from(document.querySelectorAll('div, th, td, span, a'));
      let tagesSpalten = [];
      wochentage.forEach(tag => {
        const headerEl = alleElemente.find(el => el.innerText && el.innerText.trim().startsWith(tag));
        if (headerEl) {
          const box = headerEl.getBoundingClientRect();
          tagesSpalten.push({ name: tag, links: box.left, rechts: box.right });
        }
      });

      let stundenZeilen = [];
      alleElemente.forEach(el => {
        const txt = el.innerText ? el.innerText.trim() : "";
        if (/^\d+$/.test(txt) && parseInt(txt) >= 1 && parseInt(txt) <= 11) {
          const box = el.getBoundingClientRect();
          if (box.width < 100 && box.height > 0) {
            stundenZeilen.push({ stunde: txt, oben: box.top, unten: box.bottom });
          }
        }
      });

      stundenZeilen = stundenZeilen.filter((v, i, a) => a.findIndex(t => t.stunde === v.stunde && Math.abs(t.oben - v.oben) < 5) === i);

      const datenKaeschen = alleElemente.filter(el => {
        const txt = el.innerText ? el.innerText.trim() : "";
        return txt.length > 0 && !wochentage.some(t => txt.startsWith(t)) && !txt.includes("Kalenderwoche") && !/^\d+$/.test(txt);
      });

      datenKaeschen.forEach(kasten => {
        const box = kasten.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;

        const kastenMitteX = box.left + (box.width / 2);
        const kastenMitteY = box.top + (box.height / 2);

        const passendeZeile = stundenZeilen.find(z => kastenMitteY >= z.oben - 15 && kastenMitteY <= z.unten + 15);
        const passenderTag = tagesSpalten.find(s => kastenMitteX >= s.links - 5 && kastenMitteX <= s.rechts + 5);

        if (passendeZeile && passenderTag) {
          const sNum = passendeZeile.stunde;
          const tName = passenderTag.name;

          const style = window.getComputedStyle(kasten);
          const istDurchgestrichen = style.textDecoration.includes('line-through') ||
                                     kasten.querySelector('del, s, .cancelled, .durchgestrichen') !== null ||
                                     kasten.closest('del, s, .cancelled, .durchgestrichen') !== null;

          let textSauber = kasten.innerText.split('\n').map(t => t.trim()).filter(t => t.length > 0).join(' | ');

          if (istDurchgestrichen) {
            textSauber = "(AUSFALL) " + textSauber;
          }

          const existiertIndex = ergebnis[tName].findIndex(e => e.stunde === sNum);
          if (existiertIndex === -1) {
            if (textSauber.length > 1) ergebnis[tName].push({ stunde: sNum, details: textSauber });
          } else {
            if (textSauber.length > ergebnis[tName][existiertIndex].details.length) {
              ergebnis[tName][existiertIndex].details = textSauber;
            }
          }
        }
      });

      wochentage.forEach(t => ergebnis[t].sort((a, b) => parseInt(a.stunde) - parseInt(b.stunde)));
      return ergebnis;
    });

    const datenObjekt = {
      aktualisiertAm: new Date().toISOString(),
      schuleId: "14644",
      tage: stundenplanSortiert
    };

    fs.writeFileSync(path.join(__dirname, 'stundenplan.json'), JSON.stringify(datenObjekt, null, 2), 'utf-8');
    console.log('✅ [Stundenplan] stundenplan.json erfolgreich aktualisiert!');
    res.sendStatus(200);

  } catch (error) {
    console.error('❌ Fehler beim Stundenplan-Scraping:', error);
    res.status(500).send(error.message);
  } finally {
    if (browser) await browser.close();
  }
});


// ==========================================
// 4. SCRAPER-ROUTE: HAUSAUFGABEN WITH DEBUG LOGS
// ==========================================
app.post('/start-hw-scraper', async (req, res) => {
  console.log('=============================================');
  console.log('👉 [HAUSAUFGABEN] Anfrage vom Browser empfangen');
  console.log('=============================================');

  const { username, password } = req.body;
  if (!username || !password) {
     return res.status(400).send("Logindaten fehlen im Request.");
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();

    console.log('[Hausaufgaben] Öffne Schulmanager Login...');
    await page.goto('https://login.schulmanager-online.de/#/login?institutionId=14644', { waitUntil: 'commit' });
    await page.waitForTimeout(3000);

    const usernameField = page.locator('input[type="text"], input').first();
    const passwordField = page.locator('#password');
    await usernameField.waitFor({ timeout: 5000 });

    console.log('[Hausaufgaben] Logge ein...');
    await usernameField.pressSequentially(username, { delay: 40 });
    await passwordField.pressSequentially(password, { delay: 40 });
    await passwordField.press('Enter');
    await page.waitForTimeout(5000);

    console.log('[Hausaufgaben] Navigiere zum Klassenbuch-Hausaufgaben-Modul...');
    await page.goto('https://login.schulmanager-online.de/#/modules/classbook/homework/', { waitUntil: 'commit' });
    await page.waitForTimeout(6000);

    console.log('[Hausaufgaben] Scanne Seite nach Elementen...');
        const gefilterteAufgaben = await page.evaluate(() => {
          let aufgabenListe = [];
          let aktuellesDatum = "Kein Datum";

          // 1. Wir suchen zuerst nach Datumszeilen, um das aktuelle Datum zu bestimmen
          // Schulmanager nutzt oft h3, h4 oder divs für das Datum über den Aufgaben
          const alleElemente = document.querySelectorAll('h3, h4, .card-header, div, tr, .list-group-item');

          alleElemente.forEach(el => {
            const text = el.innerText ? el.innerText.trim() : "";
            if (!text || el.getBoundingClientRect().height === 0) return;

            // Datum finden und merken (z.B. "Donnerstag, 09.07.2026")
            const datumsMatch = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
            if (datumsMatch && (text.includes("Montag") || text.includes("Dienstag") || text.includes("Mittwoch") || text.includes("Donnerstag") || text.includes("Freitag") || text.toLowerCase().includes("bis"))) {
              if (datumsMatch[0] !== aktuellesDatum) {
                aktuellesDatum = datumsMatch[0];
              }
              return;
            }

            // UI-Menüs und Navigation komplett ignorieren
            if (text.includes("Filter") || text.includes("Hausaufgaben hinzufügen") || text.includes("Stundenplan") || text.includes("Klassenbuch") || text.includes("Berichte") || text.includes("Benutzername")) {
              return;
            }

            // WICHTIG: Wenn das Element andere Elemente enthält, die selbst Hausaufgaben sind,
            // überspringen wir das übergeordnete Element, um Text-Verschmelzungen zu verhindern!
            if (el.querySelectorAll('.card, tr, .list-group-item').length > 0) {
              return;
            }

            const zeilen = text.split('\n').map(z => z.trim()).filter(z => z.length > 0);

            // Eine valide Hausaufgabe hat meistens das Fach in Zeile 0 und den Text in Zeile 1
            if (zeilen.length >= 2) {
              const fach = zeilen[0];
              // Verhindern, dass lange Sätze oder Datumsangaben als "Fach" erkannt werden
              if (fach.length > 0 && fach.length < 25 && !fach.includes(",") && !/^\d{2}\./.test(fach)) {
                const aufgabenText = zeilen.slice(1).join(' ');

                // Keine Menüwörter als Hausaufgabe reinlassen
                if (fach === "Hausaufgaben" || aufgabenText === "Hausaufgaben" || fach === "Navigation") {
                  return;
                }

                // Duplikate vermeiden
                if (!aufgabenListe.some(a => a.fach === fach && a.text === aufgabenText && a.datum === aktuellesDatum)) {
                  aufgabenListe.push({
                    fach: fach,
                    text: aufgabenText,
                    datum: aktuellesDatum
                  });
                }
              }
            }
          });

          return aufgabenListe;
        });

        // --- DEBUG LOG 1 ---
        console.log(`[DEBUG] Rohe Aufgaben von Webseite gefunden: ${gefilterteAufgaben.length}`);

        // FILTER FÜR DIE LETZTEN 14 TAGE (KORRIGIERT!)
        const heute = new Date();
        const vor14Tagen = new Date();
        vor14Tagen.setDate(heute.getDate() - 14);
        vor14Tagen.setHours(0, 0, 0, 0);

        const finaleAufgaben = gefilterteAufgaben.filter(aufgabe => {
          if (!aufgabe.datum || aufgabe.datum === "Kein Datum") return true;

          const datumTeile = aufgabe.datum.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
          if (datumTeile) {
            const tag = parseInt(datumTeile[1], 10);
            const monat = parseInt(datumTeile[2], 10) - 1;
            const jahr = parseInt(datumTeile[3], 10);

            const aufgabenDatum = new Date(jahr, monat, tag, 0, 0, 0, 0);

            // KORREKTUR: >= statt <= (Behalte alles, was neuer als vor 14 Tagen ist)
            return aufgabenDatum >= vor14Tagen;
          }
          return true;
        });

        // --- DEBUG LOG 2 ---
        console.log(`[DEBUG] Aufgaben NACH dem 14-Tage-Filter: ${finaleAufgaben.length}`);

        const datenObjekt = {
          aktualisiertAm: new Date().toISOString(),
          aufgaben: finaleAufgaben
        };

        fs.writeFileSync(path.join(__dirname, 'hausaufgaben.json'), JSON.stringify(datenObjekt, null, 2), 'utf-8');
        res.sendStatus(200);

  } catch (error) {
    console.error('❌ Fehler beim Hausaufgaben-Scraping:', error);
    res.status(500).send(error.message);
  } finally {
    if (browser) await browser.close();
  }
});
// Server starten
app.listen(PORT, () => {
  console.log(`🚀 Kombi-Server läuft!`);
  console.log(`📅 Stundenplan:   http://localhost:${PORT}/`);
  console.log(`📝 Hausaufgaben: http://localhost:${PORT}/hausaufgaben`);
});