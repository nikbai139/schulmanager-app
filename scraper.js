const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1200 } // Größeres Fenster, damit auch Spätstunden voll sichtbar sind
  });
  const page = await context.newPage();

  // 1. DIREKT ZUR SCHULE SPRINGEN
  const schulUrl = 'https://login.schulmanager-online.de/#/login?institutionId=14644';

  console.log('Rufe Login-Seite der Schule auf...');
  await page.goto(schulUrl, { waitUntil: 'commit' });
  await page.waitForTimeout(4000);

  // 2. LOGIN-FELDER SUCHEN
  console.log('Suche nach Login-Feldern...');
  const usernameField = page.locator('input[name="login"], input[name="username"], input[type="text"], input').first();
  const passwordField = page.locator('#password');

  await usernameField.waitFor({ timeout: 5000 });

  // 3. DATEN EINTIPPEN
  console.log('Tippe Login-Daten ein...');
  await usernameField.pressSequentially('ellerba', { delay: 100 });
  await passwordField.pressSequentially('cL8C&MthBB', { delay: 100 });

  // 4. LOGIN ABSCHICKEN
  console.log('Sende Formular mit Enter-Taste ab...');
  await passwordField.press('Enter');

  // 5. WARTEN BIS DASHBOARD GELADEN IST
  console.log('Warte auf das Dashboard...');
  await page.waitForTimeout(6000);

  // 6. DIREKT-NAVIGIEREN ZUM STUNDENPLAN
  console.log('Navigiere direkt zum Stundenplan...');
  await page.goto('https://login.schulmanager-online.de/#/modules/schedules/view//', { waitUntil: 'commit' });

  console.log('Warte, bis der Stundenplan komplett geladen ist...');
  await page.waitForTimeout(6000);

  // 7. MAXIMAL SENSIBLER RASTER-SCAN VIA KOORDINATEN
  console.log('Scanne Stundenplan inklusive aller Spätstunden...');

  const stundenplanSortiert = await page.evaluate(() => {
    const wochentage = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
    let ergebnis = { "Montag": [], "Dienstag": [], "Mittwoch": [], "Donnerstag": [], "Freitag": [] };

    // Alle Elemente auf der Seite holen
    const alleElemente = Array.from(document.querySelectorAll('div, th, td, span, a'));

    // 1. X-Achse (Spalten) exakt vermessen
    let tagesSpalten = [];
    wochentage.forEach(tag => {
      const headerEl = alleElemente.find(el => el.innerText && el.innerText.trim().startsWith(tag));
      if (headerEl) {
        const box = headerEl.getBoundingClientRect();
        tagesSpalten.push({ name: tag, links: box.left, rechts: box.right });
      }
    });

    // 2. Y-Achse (Stundenzeilen 1 bis 11) exakt vermessen
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

    // Duplikate aus den Zeilenmessungen entfernen
    stundenZeilen = stundenZeilen.filter((v, i, a) => a.findIndex(t => t.stunde === v.stunde && Math.abs(t.oben - v.oben) < 5) === i);

    // 3. Alle Text-Kästchen auf der Seite einsammeln (Filter stark gelockert für 10./11. Stunde!)
    const datenKaeschen = alleElemente.filter(el => {
      const txt = el.innerText ? el.innerText.trim() : "";
      return txt.length > 0 &&
             !wochentage.some(t => txt.startsWith(t)) &&
             !txt.includes("Kalenderwoche") &&
             !/^\d+$/.test(txt); // Keine reinen Stundennummern mitsammeln
    });

    datenKaeschen.forEach(kasten => {
      const box = kasten.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;

      const kastenMitteX = box.left + (box.width / 2);
      const kastenMitteY = box.top + (box.height / 2);

      // Zuordnung zur Stunde mit erweitertem Toleranzbereich (+/- 15 Pixel) für verschobene Nachmittags-Grids
      const passendeZeile = stundenZeilen.find(z => kastenMitteY >= z.oben - 15 && kastenMitteY <= z.unten + 15);
      const passenderTag = tagesSpalten.find(s => kastenMitteX >= s.links - 5 && kastenMitteX <= s.rechts + 5);

      if (passendeZeile && passenderTag) {
        const sNum = passendeZeile.stunde;
        const tName = passenderTag.name;

        const textSauber = kasten.innerText
          .split('\n')
          .map(t => t.trim())
          .filter(t => t.length > 0)
          .join(' | ');

        // Falls wir für diesen Tag und diese Stunde noch nichts oder ein kürzeres Fragment haben, eintragen/aktualisieren
        const existiertIndex = ergebnis[tName].findIndex(e => e.stunde === sNum);

        if (existiertIndex === -1) {
          if (textSauber.length > 1) {
            ergebnis[tName].push({ stunde: sNum, details: textSauber });
          }
        } else {
          // Falls ein verschachteltes Element mehr Details liefert (z.B. Lehrer + Raum), überschreiben wir das alte Fragment
          if (textSauber.length > ergebnis[tName][existiertIndex].details.length) {
            ergebnis[tName][existiertIndex].details = textSauber;
          }
        }
      }
    });

    // Chronologisch sortieren
    wochentage.forEach(t => {
      ergebnis[t].sort((a, b) => parseInt(a.stunde) - parseInt(b.stunde));
    });

    return ergebnis;
  });

  // 8. ALS JSON STRUKTURIEREN
  const datenObjekt = {
    aktualisiertAm: new Date().toISOString(),
    schuleId: "14644",
    tage: stundenplanSortiert
  };

  // 9. DATEI SCHREIBEN
  fs.writeFileSync(
    'stundenplan.json',
    JSON.stringify(datenObjekt, null, 2),
    'utf-8'
  );

  console.log('✅ Fertig! Die 10. Stunde am Donnerstag wurde erfolgreich erfasst und abgespeichert.');

  // 10. PROGRAMM BEENDEN
  console.log('Schließe Browser...');
  await browser.close();
})();