import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Listen to all console logs
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
  });
  
  console.log('Loading https://ncpa-sound.pages.dev...');
  await page.goto('https://ncpa-sound.pages.dev');
  await page.waitForTimeout(4000);
  
  console.log('\n=== CLICKING NEXT TO GO TO JANUARY ===\n');
  
  // Click Next button
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(3000);
  
  // Get the month header
  const monthHeader = await page.textContent('#currentMonthYear');
  console.log('Current Month Header:', monthHeader);
  
  // Look for relevant console logs
  console.log('\n=== BROWSER CONSOLE LOGS (filtered) ===');
  logs.forEach(log => {
    if (log.includes('January') || log.includes('2026-01-31') || log.includes('day 31') || log.includes('📊')) {
      console.log(log);
    }
  });
  
  // Check if day 31 has content
  const day31Info = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.calendar-day'));
    for (const cell of cells) {
      const dayNumber = cell.querySelector('div')?.textContent?.trim();
      if (dayNumber === '31') {
        const eventCards = cell.querySelectorAll('[class*="event-card"]');
        return {
          found: true,
          cardCount: eventCards.length,
          className: cell.className,
          innerHTML: cell.innerHTML.substring(0, 500)
        };
      }
    }
    return { found: false };
  });
  
  console.log('\n=== DAY 31 CELL INFO ===');
  console.log(JSON.stringify(day31Info, null, 2));
  
  await browser.close();
})();
