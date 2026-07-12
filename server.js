const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
// WICHTIG FÜR RENDER: Nutzt den dynamisch zugewiesenen Port von Render oder standardmäßig 3000
const PORT = process.env.PORT || 3000; 

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

// Separate Seite -> Notenrechner
app.get('/notenrechner', (req, res) => {
  res.sendFile(path.join(__dirname, 'notenrechner.html'));
});


// ==========================================
// 2. ROUTEN FÜR DIE JSON-DATEN (GET-FALLBACK)
// ==========================================

// Da wir alles im Handy-LocalStorage cachen, senden wir hier einen Hinweis, 
// falls die alten URLs im Hintergrund noch aufgerufen werden sollten.
app.get('/get-stundenplan', (req, res) => {
  res.status(404).json({ fehler: "Bitte 'Plan aktualisieren' nutzen. Daten werden direkt im Handy gespeichert." });
});

app.get('/get-hausaufgaben', (req, res) => {
  res.status(404).json({ fehler: "Bitte 'Aufgaben aktualisieren' nutzen. Daten werden direkt im Handy gespeichert." });
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
    // WICHTIG FÜR RENDER: Spezielle Linux-Argumente, damit der Server nicht abstürzt
    browser = await chromium.launch({ 
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', 
        '--disable-gpu'
      ]
    });
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

    console.log('✅ [Stundenplan] Erfolgreich gescraped! Sende JSON direkt an den Browser...');
    
    // WICHTIG: Schickt das Ergebnis direkt als Antwort zurück an deine app.js
    res.json(datenObjekt);

  } catch (error) {
    console.error('❌ Fehler beim Stundenplan-Scraping:', error);
    res.status(500).send(error.message);
  } finally {
    if (browser) await browser.close();
  }
});


// ==========================================
// 4. SCRAPER-ROUTE: HAUSAUFGABEN (POST)
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
    // WICHTIG FÜR RENDER: Spezielle Linux-Argumente, damit der Server nicht abstürzt
    browser = await chromium.launch({ 
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', 
        '--disable-gpu'
      ]
    });
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

      const alleElemente = document.querySelectorAll('h3, h4, .card-header, div, tr, .list-group-item');

      alleElemente.forEach(el => {
        const text = el.innerText ? el.innerText.trim() : "";
        if (!text || el.getBoundingClientRect().height === 0) return;

        const datumsMatch = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
        if (datumsMatch && (text.includes("Montag") || text.includes("Dienstag") || text.includes("Mittwoch") || text.includes("Donnerstag") || text.includes("Freitag") || text.toLowerCase().includes("bis"))) {
          if (datumsMatch[0] !== aktuellesDatum) {
            aktuellesDatum = datumsMatch[0];
          }
          return;
        }

        if (text.includes("Filter") || text.includes("Hausaufgaben hinzufügen") || text.includes("Stundenplan") || text.includes("Klassenbuch") || text.includes("Berichte") || text.includes("Benutzername")) {
          return;
        }

        if (el.querySelectorAll('.card, tr, .list-group-item').length > 0) {
          return;
        }

        const zeilen = text.split('\n').map(z => z.trim()).filter(z => z.length > 0);

        if (zeilen.length >= 2) {
          const fach = zeilen[0];
          if (fach.length > 0 && fach.length < 25 && !fach.includes(",") && !/^\d{2}\./.test(fach)) {
            const aufgabenText = zeilen.slice(1).join(' ');

            if (fach === "Hausaufgaben" || aufgabenText === "Hausaufgaben" || fach === "Navigation") {
              return;
            }

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

    console.log(`[DEBUG] Rohe Aufgaben von Webseite gefunden: ${gefilterteAufgaben.length}`);

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
        return aufgabenDatum >= vor14Tagen;
      }
      return true;
    });

    console.log(`[DEBUG] Aufgaben NACH dem 14-Tage-Filter: ${finaleAufgaben.length}`);

    const datenObjekt = {
      aktualisiertAm: new Date().toISOString(),
      aufgaben: finaleAufgaben
    };

    console.log('✅ [Hausaufgaben] Erfolgreich gescraped! Sende JSON direkt an den Browser...');
    
    // WICHTIG: Schickt auch hier das Ergebnis direkt als Antwort zurück an deine hausaufgaben.js
    res.json(datenObjekt);

  } catch (error) {
    console.error('❌ Fehler beim Hausaufgaben-Scraping:', error);
    res.status(500).send(error.message);
  } finally {
    if (browser) await browser.close();
  }
});

// Server starten
app.listen(PORT, () => {
  console.log(`🚀 Kombi-Server läuft auf Port ${PORT}!`);
});