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

  /* Yükleme (Ana ekrana ekle) + köşedeki yükleme penceresi */
  const DISMISS_KEY = 'easywrite:installDismissed';
  const DISMISS_DAYS = 3;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(ua);
  const isFirefox = /firefox|fxios/i.test(ua);
  const isSafariMac = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua) && !isIos;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
  const canInstallHere = /^https?:$/.test(location.protocol);
  const banner = document.getElementById('installBanner');
  const installButtons = () => $$('[data-action="install"]').filter(b => !banner.contains(b));

  function recentlyDismissed() {
    const t = Number(EW.storage.get(DISMISS_KEY)) || 0;
    return Date.now() - t < DISMISS_DAYS * 86400000;
  }

  function manualHint() {
    if (isIos) return 'Safari\'de <b>Paylaş ⬆</b> → <b>Ana Ekrana Ekle</b>';
    if (isSafariMac) return 'Safari menüsünden <b>Dosya → Dock\'a Ekle</b>';
    if (isFirefox && isAndroid) return 'Menü <b>⋮</b> → <b>Yükle</b>';
    if (isFirefox) return 'Yüklemek için Chrome veya Edge ile açın';
    return 'Tarayıcı menüsünden <b>Uygulamayı yükle</b>';
  }

  function showBanner(mode) {
    if (!canInstallHere || isStandalone() || recentlyDismissed()) return;
    banner.dataset.mode = mode;
    document.getElementById('ibHint').innerHTML = mode === 'prompt'
      ? (isAndroid ? 'Ana ekranınızdan tek dokunuşla açın, internetsiz çalışın.' : 'Masaüstünüzden tek tıkla açın, internetsiz çalışın.')
      : manualHint();
    document.getElementById('ibInstall').textContent = mode === 'prompt' ? 'Yükle' : 'Nasıl?';
    banner.hidden = false;
    requestAnimationFrame(() => banner.classList.add('show'));
  }

  function hideBanner() {
    banner.classList.remove('show');
    setTimeout(() => { banner.hidden = true; }, 250);
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    installButtons().forEach(b => { b.hidden = false; });
    setTimeout(() => showBanner('prompt'), 1200);
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installButtons().forEach(b => { b.hidden = true; });
    hideBanner();
    toast('EasyWrite yüklendi! Artık uygulama menünüzden açabilirsiniz.');
  });

  // Otomatik yükleme isteği olmayan tarayıcılarda (iOS, Safari, Firefox) yönergeli pencere göster
  if (canInstallHere && !isStandalone()) {
    if (isIos || isSafariMac || isFirefox) installButtons().forEach(b => { b.hidden = false; });
    setTimeout(() => { if (!deferredPrompt && (isIos || isSafariMac || isFirefox)) showBanner('manual'); }, 2500);
  }

  function showInstructions() {
    let body;
    if (isIos) {
      body = '<ol class="steps"><li>Sayfayı <b>Safari</b> ile açın.</li><li>Alttaki <b>Paylaş</b> düğmesine (⬆) dokunun.</li>' +
        '<li><b>Ana Ekrana Ekle</b>\'yi seçin, sonra <b>Ekle</b>\'ye dokunun.</li></ol>';
    } else if (isSafariMac) {
      body = '<ol class="steps"><li>Safari menü çubuğunda <b>Dosya</b>\'ya tıklayın.</li><li><b>Dock\'a Ekle</b>\'yi seçin.</li></ol>';
    } else if (isFirefox && !isAndroid) {
      body = '<p>Firefox masaüstü uygulama yüklemeyi desteklemiyor. Bu sayfayı <b>Chrome</b> veya <b>Edge</b> ile açıp köşede çıkan <b>Yükle</b> düğmesine tıklayın.</p>';
    } else if (isAndroid) {
      body = '<ol class="steps"><li>Tarayıcı menüsünü (<b>⋮</b>) açın.</li><li><b>Uygulamayı yükle</b> veya <b>Ana ekrana ekle</b>\'yi seçin.</li></ol>';
    } else {
      body = '<ol class="steps"><li>Adres çubuğunun sağındaki <b>yükle</b> simgesine (⊕) tıklayın,</li>' +
        '<li>ya da menüden (<b>⋮</b>) <b>Kaydet ve paylaş → Uygulamayı yükle</b>\'yi seçin.</li></ol>';
    }
    EW.openDialog('EasyWrite\'ı yükle', body, { hideOk: true });
  }

  EW.actions.install = async () => {
    if (deferredPrompt) {
      hideBanner();
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') installButtons().forEach(b => { b.hidden = true; });
      else EW.storage.set(DISMISS_KEY, String(Date.now()));
    } else {
      showInstructions();
    }
  };

  EW.actions.installLater = () => {
    EW.storage.set(DISMISS_KEY, String(Date.now()));
    hideBanner();
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
