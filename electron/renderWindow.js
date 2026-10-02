// Export rendering (spec, "Architecture": PNG via a hidden BrowserWindow + capturePage, PDF via an
// HTML imposition page + printToPDF). The hidden window loads the app's #render route
// (src/designer/render/RenderHost.tsx), which draws with the same CardRender component as the
// Designer canvas, so exports match the editor.
//
// One offscreen window, one job at a time. Offscreen rendering uses a device scale factor of 1,
// so a card rendered at N px/mm is exactly N px/mm in the capture.

const { BrowserWindow, ipcMain } = require('electron');

const JOB_TIMEOUT_MS = 60000;

class RenderService {
  /**
   * @param {{ preload: string, load: (win: BrowserWindow) => Promise<void> }} opts
   */
  constructor({ preload, load }) {
    this.preload = preload;
    this.load = load;
    this.win = null;
    this.ready = null;
    this.jobs = new Map();
    this.nextId = 1;
    this.queue = Promise.resolve();

    ipcMain.handle('render:hostReady', (event) => {
      if (this.win && event.sender === this.win.webContents && this.readyResolve) this.readyResolve();
    });
    ipcMain.handle('render:done', (event, payload) => {
      if (!this.win || event.sender !== this.win.webContents) return;
      const job = this.jobs.get(payload && payload.jobId);
      if (!job) return;
      this.jobs.delete(payload.jobId);
      clearTimeout(job.timer);
      if (payload.error) job.reject(new Error(payload.error));
      else job.resolve(payload);
    });
  }

  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.ready;
    this.win = new BrowserWindow({
      show: false,
      width: 800,
      height: 800,
      useContentSize: true,
      paintWhenInitiallyHidden: true,
      // Transparent, so rounded card corners capture as alpha rather than a window colour.
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    this.win.webContents.setFrameRate(60);
    this.win.on('closed', () => {
      this.win = null;
      for (const job of this.jobs.values()) { clearTimeout(job.timer); job.reject(new Error('render window closed')); }
      this.jobs.clear();
    });
    this.ready = new Promise((resolve) => { this.readyResolve = resolve; });
    this.load(this.win).catch((err) => console.error('[render] failed to load render page:', err));
    return this.ready;
  }

  // Serialise jobs: one window, one layout at a time.
  enqueue(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async send(job, sizePx) {
    await this.ensureWindow();
    if (sizePx) this.win.setContentSize(Math.max(1, Math.ceil(sizePx.width)), Math.max(1, Math.ceil(sizePx.height)));
    const jobId = this.nextId++;
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.jobs.delete(jobId);
        reject(new Error('render timed out'));
      }, JOB_TIMEOUT_MS);
      this.jobs.set(jobId, { resolve, reject, timer });
    });
    this.win.webContents.send('render:job', { ...job, jobId });
    return done;
  }

  /**
   * Render one card and capture it.
   * @returns {Promise<{ image: Electron.NativeImage, width: number, height: number, report }>}
   */
  renderCard({ template, card, projectId, pxPerMm, showBleed, background = null }) {
    return this.enqueue(async () => {
      const b = showBleed ? template.size.bleedMm : 0;
      const width = Math.round((template.size.widthMm + 2 * b) * pxPerMm);
      const height = Math.round((template.size.heightMm + 2 * b) * pxPerMm);
      const res = await this.send({ kind: 'card', template, card, projectId, pxPerMm, showBleed, background }, { width, height });
      const image = await this.win.webContents.capturePage({ x: 0, y: 0, width, height });
      return { image, width, height, report: res.report };
    });
  }

  /**
   * Lay out pages of cards (imposition) and print them to PDF. Text stays vector.
   * @param {{ projectId, template, showBleed, pageWidthMm, pageHeightMm, pages: Array<{ items: Array<{ card, xMm, yMm }>, marks: Array<[x1,y1,x2,y2]> }> }} doc
   * @returns {Promise<{ pdf: Buffer, report }>}
   */
  printPages(doc) {
    return this.enqueue(async () => {
      const res = await this.send({ kind: 'pages', ...doc }, { width: 900, height: 900 });
      const pdf = await this.win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      return { pdf, report: res.report };
    });
  }

  close() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}

module.exports = { RenderService };
