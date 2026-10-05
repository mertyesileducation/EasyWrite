/* EasyWrite — PWA: service worker, yükleme, çevrimdışı durum, dosya açma */
(() => {
  'use strict';

  const { $$, toast } = EW;
  let deferredPrompt = null;
  let waitingWorker = null;

  /* Service worker */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('sw.js');
        const watch = worker => {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              waitingWorker = worker;
              document.getElementById('updateBar').hidden = false;
            }
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) {
          waitingWorker = reg.waiting;
          document.getElementById('updateBar').hidden = false;
        }
        reg.addEventListener('updatefound', () => reg.installing && watch(reg.installing));
        // Uzun açık kalan oturumlarda güncellemeleri kontrol et
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      } catch (err) {
        console.warn('Service worker kaydedilemedi', err);
      }
    });

    // Yalnızca kullanıcı güncellemeyi onayladığında yeniden yükle (ilk kurulumda değil)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updateRequested) return;
      updateRequested = false;
      location.reload();
    });
  }

  let updateRequested = false;
  EW.actions.applyUpdate = () => {
    updateRequested = true;
    if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  };

  /* Yükleme (Ana ekrana ekle) */
  const installButtons = () => $$('[data-action="install"]');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    installButtons().forEach(b => { b.hidden = false; });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installButtons().forEach(b => { b.hidden = true; });
    toast('EasyWrite yüklendi! Artık uygulama menünüzden açabilirsiniz.');
  });

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIos && !isStandalone()) installButtons().forEach(b => { b.hidden = false; });

  EW.actions.install = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome !== 'accepted') return;
      installButtons().forEach(b => { b.hidden = true; });
    } else if (isIos) {
      EW.openDialog('Ana ekrana ekle',
        '<p>Safari\'de alttaki <b>Paylaş</b> düğmesine (⬆) dokunun ve <b>Ana Ekrana Ekle</b>\'yi seçin.</p>', { hideOk: true });
    } else {
      EW.openDialog('Uygulamayı yükle',
        '<p>Tarayıcınızın adres çubuğundaki <b>yükle</b> simgesini ya da menüdeki <b>Uygulamayı yükle / Ana ekrana ekle</b> seçeneğini kullanın.</p>', { hideOk: true });
    }
  };

  /* Çevrimiçi / çevrimdışı rozeti */
  function updateNet() {
    const offline = !navigator.onLine;
    $$('[data-net]').forEach(b => { b.hidden = !offline; });
  }
  window.addEventListener('online', () => { updateNet(); toast('Yeniden çevrimiçisiniz'); });
  window.addEventListener('offline', () => { updateNet(); toast('Çevrimdışısınız — EasyWrite çalışmaya devam eder'); });
  updateNet();

  /* İşletim sisteminden dosya açma (file_handlers) */
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async params => {
      if (!params.files || !params.files.length) return;
      const files = await Promise.all(params.files.map(h => h.getFile()));
      EW.importFiles(files);
    });
  }
})();
