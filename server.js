const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// CORS-Header erlauben, damit dein Handy von überall auf den Server zugreifen darf
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
// Server starten mit automatischem Playwright-Browser-Check
app.listen(PORT, async () => {
  console.log(`🚀 Kombi-Server läuft auf Port ${PORT}!`);

  // Dieser Trick installiert den Browser direkt im Live-System nach, falls Render ihn vergessen hat
  try {
    console.log("Prüfe Playwright-Browser-Installation...");
    const exec = require('child_process').execSync;
    // Installiert gezielt nur chromium, um Zeit und Speicherplatz zu sparen
    exec('npx playwright install chromium', { stdio: 'inherit' });
    console.log("✅ Playwright-Browser ist einsatzbereit!");
  } catch (err) {
    console.error("❌ Fehler beim automatischen Nachinstallieren des Browsers:", err);
  }
});
// ==========================================
// 1. ROUTEN FÜR DAS FRONTEND (HTML)
// ==========================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/hausaufgaben', (req, res) => res.sendFile(path.join(__dirname, 'hausaufgaben.html')));
app.get('/notenrechner', (req, res) => res.sendFile(path.join(__dirname, 'notenrechner.html')));

app.get('/get-stundenplan', (req, res) => {
  res.status(404).json({ fehler: "Bitte 'Plan aktualisieren' nutzen." });
});
app.get('/get-hausaufgaben', (req, res) => {
  res.status(404).json({ fehler: "Bitte 'Aufgaben aktualisieren' nutzen." });
});

// ==========================================
// 3. SCRAPER-ROUTE: STUNDENPLAN (POST)
// ==========================================
app.post('/start-scraper', async (req, res) => {
  console.log('=============================================');
  console.log('👉 [STUNDENPLAN] Anfrage vom Browser empfangen');
  console.log('=============================================');

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Logindaten fehlen.");

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();

    console.log('[Stundenplan] Öffne Schulmanager Login...');
    await page.goto('https://login.schulmanager-online.de/#/login?institutionId=14644', { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);

    const usernameField = page.locator('input[type="text"], input[name="login"], input').first();
    const passwordField = page.locator('input[type="password"], #password').first();
    await usernameField.waitFor({ timeout: 10000 });

    console.log('[Stundenplan] Logge ein (mit Event-Trigger)...');
        await usernameField.click();
        await usernameField.pressSequentially(username, { delay: 150 }); // Etwas langsamer tippen
        // WICHTIG: Signalisiert der Website, dass Text eingegeben wurde
        await usernameField.evaluate(el => el.dispatchEvent(new Event('input', { bubbles: true })));
        await page.waitForTimeout(500);

        await passwordField.click();
        await passwordField.pressSequentially(password, { delay: 150 });
        // WICHTIG: Signalisiert der Website, dass das Passwort da ist
        await passwordField.evaluate(el => el.dispatchEvent(new Event('input', { bubbles: true })));
        await page.waitForTimeout(1000); // Kurz warten, damit der Button aktiv wird

        // Jetzt klicken wir auf den aktivierten Button
        const loginButton = page.locator('button:has-text("Anmelden"), button[type="submit"], .btn-primary').first();
        await loginButton.click();

    console.log('[Stundenplan] Warte auf Dashboard...');
    await page.waitForTimeout(8000);

    // PRÜFUNG: Sind wir wirklich eingeloggt?
    const aktuellerUrl = page.url();
    console.log(`[DEBUG] Aktuelle URL nach Login-Versuch: ${aktuellerUrl}`);

    if (aktuellerUrl.includes('login')) {
      console.log('❌ [WARNUNG] Wir sind anscheinend immer noch auf der Login-Seite!');
      // Screenshot im Log-Ordner machen
      await page.screenshot({ path: '/tmp/error_login.png' });
      const seitenText = await page.innerText('body');
      console.log(`[DEBUG] Sichtbarer Text auf der Seite:\n${seitenText.substring(0, 500)}...`);
      throw new Error("Login fehlgeschlagen. Eventuell falsche Daten oder Bot-Schutz aktiv.");
    }

    console.log('[Stundenplan] Navigiere zum Stundenplan-Modul...');
    await page.goto('https://login.schulmanager-online.de/#/modules/schedules/view//', { waitUntil: 'commit' });
    await page.waitForTimeout(6000);

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
          const istDurchgestrichen = style.textDecoration.includes('line-through') || kasten.querySelector('del, s, .cancelled, .durchgestrichen') !== null;
          let textSauber = kasten.innerText.split('\n').map(t => t.trim()).filter(t => t.length > 0).join(' | ');
          if (istDurchgestrichen) textSauber = "(AUSFALL) " + textSauber;

          const existiertIndex = ergebnis[tName].findIndex(e => e.stunde === sNum);
          if (existiertIndex === -1) {
            if (textSauber.length > 1) ergebnis[tName].push({ stunde: sNum, details: textSauber });
          } else if (textSauber.length > ergebnis[tName][existiertIndex].details.length) {
            ergebnis[tName][existiertIndex].details = textSauber;
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

    console.log('✅ [Stundenplan] Sende JSON an den Browser...');
    res.json(datenObjekt);

  } catch (error) {
    console.error('❌ Fehler beim Stundenplan-Scraping:', error);
    res.status(500).send(error.message);
  } finally {
    if (browser) await browser.close();
  }
});

// Server starten
app.listen(PORT, () => console.log(`🚀 Kombi-Server läuft auf Port ${PORT}!`));