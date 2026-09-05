// Analyse le plateau : détecte les lignes gravées (sombres) et les nœuds
// Usage: node analyze_grid.js
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
  await page.goto("file:///d:/Project/D-Aona/Root/test-tools/shots/plateau.png");
  const res = await page.evaluate(async () => {
    const img = document.querySelector("img");
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    const lum = (x, y) => {
      const i = (y * W + x) * 4;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    // Profil de sombreur moyenne par colonne / ligne dans la zone de jeu estimée
    const colDark = new Array(W).fill(0);
    const rowDark = new Array(H).fill(0);
    for (let y = 100; y < 850; y++)
      for (let x = 100; x < 1550; x++) {
        const l = lum(x, y);
        if (l < 110) { colDark[x]++; rowDark[y]++; }
      }
    // pics locaux
    const peaks = (arr, min, gap) => {
      const out = [];
      for (let i = 2; i < arr.length - 2; i++) {
        if (arr[i] >= min && arr[i] >= arr[i - 1] && arr[i] >= arr[i + 1] &&
            arr[i] > arr[i - 2] && arr[i] > arr[i + 2]) {
          if (!out.length || i - out[out.length - 1].i > gap) out.push({ i, v: arr[i] });
          else if (arr[i] > out[out.length - 1].v) out[out.length - 1] = { i, v: arr[i] };
        }
      }
      return out;
    };
    return {
      w: W, h: H,
      colPeaks: peaks(colDark, 8, 30),
      rowPeaks: peaks(rowDark, 8, 30),
    };
  });
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
})();
