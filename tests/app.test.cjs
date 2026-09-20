const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}) });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: '学習する', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: '学習開始' }).click();
    await page.locator('#flash').click();
    await page.waitForTimeout(480);
    assert.equal(await page.evaluate(() => session.revealed), true);
    assert.deepEqual(await page.locator('.controls button').allTextContents(), ['← もう一度', '↓ 保留', 'できた →']);
    await page.getByRole('button', { name: 'できた →' }).click();
    // Finishing during animation must neither record twice nor reopen study later.
    await page.getByRole('button', { name: '終了', exact: true }).click();
    await page.getByRole('button', { name: '結果を表示し続ける' }).click();
    await page.waitForTimeout(1050);
    assert.equal(await page.evaluate(() => S.sessions.length), 1);
    assert.equal(await page.locator('.modal h2').textContent(), 'ここまでの結果');
    await page.getByRole('button', { name: 'ホームへ戻る' }).click();
    // Pointer swipe and synthesized click: no accidental flip, including first-card boundary.
    await page.evaluate(() => { settings('book1'); start(); });
    async function swipe(dx, dy) {
      const f = page.locator('#flash');
      const b = await f.boundingBox(); const x = b.x + b.width/2, y = b.y + b.height/2;
      await page.mouse.move(x,y); await page.mouse.down();
      await page.mouse.move(x+dx,y+dy,{steps:6}); await page.mouse.up();
    }
    await swipe(90,0);
    assert.equal(await page.evaluate(() => session.revealed), false);
    await page.waitForTimeout(720);
    await page.getByRole('button', { name: '答えを見る' }).click();
    await page.waitForTimeout(480);
    await swipe(0,90);
    await page.waitForTimeout(1020);
    assert.equal(await page.evaluate(() => S.records.q1.last), 'hold');
    assert.equal(await page.evaluate(() => session.index), 1);
    await page.evaluate(() => { finish(false); goHome(); });
    // Create, edit metadata, save question, reorder, delete and reload.
    await page.getByRole('button', { name: '＋ 新規作成' }).click();
    await page.getByLabel('問題集名', { exact:true }).fill('テスト教材');
    await page.locator('#editor').getByRole('button', { name: '作成', exact:true }).click();
    await page.getByRole('button', { name: '＋問題', exact:true }).click();
    await page.getByLabel('問題', { exact:true }).fill('問題A');
    await page.getByLabel('答え', { exact:true }).fill('答えA');
    await page.getByLabel('難易度').selectOption('発展');
    await page.getByLabel('タグ').fill('用語');
    await page.getByRole('button', { name:'保存',exact:true }).click();
    assert.equal(await page.evaluate(() => S.books[0].questions[0].difficulty), '発展');
    await page.evaluate(() => bulk());
    const csv = '\uFEFF問題,答え,ヒント,解説,難易度,タグ\r\n"カンマ,を含む問題","答えA","ヒントA","複数行の\n解説",標準,"用語,重要"\r\n問題B,答えB,,,発展,計算';
    await page.locator('#csvFile').setInputFiles({name:'questions.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await page.waitForFunction(() => S.books[0].questions.length === 3);
    assert.deepEqual(await page.evaluate(() => {
      const q=S.books[0].questions[1]; return [q.question,q.explanation,q.difficulty,q.tags];
    }), ['カンマ,を含む問題','複数行の\n解説','標準','用語,重要']);
    const createdId = await page.evaluate(() => editId);
    await page.reload();
    assert.equal(await page.evaluate(() => S.books[0].title), 'テスト教材');
    const teacherBook = {format:'manabi-card-book',version:1,book:{id:'teacher',sourceId:'teacher-source',title:'先生教材',subject:'理科',questions:[{id:'stable-q',question:'水の式？',answer:'H₂O'}]}};
    await page.evaluate(data => {importBook(data);acceptImport(false)}, teacherBook);
    const imported = await page.evaluate(() => { const b=S.books[0];S.records[b.questions[0].id]={checked:true,last:'repeat',attempts:1,repeat:1};save();return {id:b.id,q:b.questions[0].id}; });
    teacherBook.book.questions[0].answer='H2O';
    await page.evaluate(data => {importBook(data);acceptImport(true)}, teacherBook);
    assert.deepEqual(await page.evaluate(() => ({id:S.books[0].id,q:S.books[0].questions[0].id})), imported);
    assert.equal(await page.evaluate(q => S.records[q].checked, imported.q), true);
    // Invalid IDs cannot reach inline event handlers; no partial mutation.
    assert.equal(await page.evaluate(data => {const count=S.books.length;data.book.id="x');alert(1)//";try{importBook(data);return false}catch{return S.books.length===count}},teacherBook),true);
    await page.evaluate(id => edit(id), imported.id);
    await page.locator('.qrow').click();
    assert.equal(await page.locator('#eq').isDisabled(),true);
    // Real backup download and file input restoration.
    const dl=page.waitForEvent('download'); await page.evaluate(() => backup());
    const downloaded=await dl; const backup=JSON.parse(fs.readFileSync(await downloaded.path(),'utf8'));
    assert.equal(backup.format,'manabi-card-backup');
    page.on('dialog',dialog=>dialog.accept());
    await page.evaluate(() => {S.books=[];save();importMode='backup'});
    await page.locator('#file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await page.waitForFunction(id=>S.books.some(b=>b.id===id),createdId);
    assert.equal(await page.evaluate(q=>S.records[q].last,imported.q),'repeat');
    // Export only one book and no learner records.
    const dl2=page.waitForEvent('download');await page.evaluate(id=>exportBook(id),imported.id);
    const exported=JSON.parse(fs.readFileSync(await (await dl2).path(),'utf8'));
    assert.equal(exported.book.questions[0].id,'stable-q');
    assert.equal('records' in exported,false);
    // One-card completion and actual five-second return.
    await page.evaluate(id=>{settings(id);start();session.index=session.questions.length-1;renderStudy()},createdId);
    await page.getByRole('button',{name:'次へ',exact:true}).click();
    assert.equal(await page.locator('.modal h2').textContent(),'全問終了！');
    await page.waitForTimeout(5150);
    assert.equal(await page.locator('#home').isVisible(),true);
    // Both supported responsive widths have no horizontal overflow.
    for(const width of [1024,390]){
      await page.setViewportSize({width,height:768});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    fs.mkdirSync('test-results',{recursive:true});
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    assert.equal(await page.locator('#home .book').last().evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight-68),true);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:'test-results/mobile.png',fullPage:true});
    await page.setViewportSize({width:1024,height:768});
    await page.screenshot({path:'test-results/ipad.png',fullPage:true});
    await page.evaluate(()=>{settings('book1');start()});
    await page.screenshot({path:'test-results/study.png',fullPage:true});
    // Touch input on the answer side is treated as a judgment.
    await page.getByRole('button',{name:'答えを見る'}).click();
    await page.waitForTimeout(480);
    const cdp=await page.context().newCDPSession(page);
    const rect=await page.locator('#flash').boundingBox();
    const tx=Math.round(rect.x+rect.width/2),ty=Math.round(rect.y+rect.height/2);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx-100,y:ty}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(1050);
    assert.equal(await page.evaluate(()=>S.records.q1.last),'repeat');
    await page.evaluate(()=>{finish(false);goHome();toggleTheme()});
    await page.reload();
    assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('dark')),true);
    // Corrupt data must be left intact, never silently overwritten by sample data.
    await page.evaluate(()=>localStorage.setItem(KEY,'{broken'));
    await page.reload();
    assert.equal(await page.evaluate(()=>{save();return localStorage.getItem(KEY)}),'{broken');
    assert.deepEqual(errors,[]);
    console.log('PASS: study, pointer gestures, animation cancellation, editing, persistence, import update, validation, backup restore, distribution export, countdown and responsive layouts');
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
