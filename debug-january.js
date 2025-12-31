const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Listen to console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('📊') || text.includes('🔍') || text.includes('January') || text.includes('31')) {
      console.log('[BROWSER]', text);
    }
  });
  
  // Go to production site
  await page.goto('https://ncpa-sound.pages.dev');
  await page.waitForTimeout(3000);
  
  console.log('\n=== CLICKING NEXT TO GO TO JANUARY ===');
  
  // Click Next button
  await page.click('button:has-text("Next")');
  await page.waitForTimeout(2000);
  
  // Get the month header
  const monthHeader = await page.textContent('#currentMonthYear');
  console.log('\n=== CURRENT MONTH:', monthHeader, '===\n');
  
  // Check if day 31 has content
  const day31Content = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.calendar-day'));
    for (const cell of cells) {
      const dayNumber = cell.querySelector('div')?.textContent?.trim();
      if (dayNumber === '31') {
        const cards = cell.querySelectorAll('.text-xs.p-2.mb-1.rounded');
        return {
          found: true,
          cardCount: cards.length,
          html: cell.innerHTML
        };
      }
    }
    return { found: false };
  });
  
  console.log('\n=== DAY 31 CELL ===');
  console.log(JSON.stringify(day31Content, null, 2));
  
  await browser.close();
})();
