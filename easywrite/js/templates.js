/* EasyWrite — belge şablonları */
(() => {
  'use strict';

  const today = () => new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

  const EWTemplates = [
    {
      id: 'blank',
      name: 'Boş belge',
      title: 'Adsız belge',
      html: () => '<p><br></p>',
    },
    {
      id: 'letter',
      name: 'Mektup',
      title: 'Mektup',
      html: () => `
        <p style="text-align:right">Ad Soyad<br>Adres satırı<br>Şehir, Posta Kodu<br>${today()}</p>
        <p><br></p>
        <p>Alıcı Adı<br>Kurum / Şirket<br>Adres</p>
        <p><br></p>
        <p>Sayın [Alıcı],</p>
        <p>Bu mektubu [konu] hakkında yazıyorum. İlk paragrafta amacınızı kısa ve net biçimde belirtin.</p>
        <p>İkinci paragrafta ayrıntıları, gerekçeleri ve ilgili bilgileri paylaşın.</p>
        <p>Son paragrafta beklentinizi ve bir sonraki adımı belirtip teşekkür edin.</p>
        <p><br></p>
        <p>Saygılarımla,</p>
        <p><br></p>
        <p><b>Ad Soyad</b></p>`,
    },
    {
      id: 'cv',
      name: 'Özgeçmiş',
      title: 'Özgeçmiş',
      settings: { margin: 19.1 },
      html: () => `
        <h1 style="text-align:center">AD SOYAD</h1>
        <p style="text-align:center">E-posta · Telefon · Şehir · linkedin.com/in/kullanici</p>
        <hr>
        <h2>Özet</h2>
        <p>Deneyiminizi, uzmanlık alanlarınızı ve hedeflerinizi anlatan iki üç cümlelik bir giriş.</p>
        <h2>Deneyim</h2>
        <h3>Pozisyon — Şirket Adı</h3>
        <p><i>Ocak 2022 – Günümüz · Şehir</i></p>
        <ul><li>Ölçülebilir bir başarı veya sorumluluk</li><li>Kullandığınız teknoloji veya yöntem</li><li>Ekibe ya da şirkete katkınız</li></ul>
        <h3>Pozisyon — Şirket Adı</h3>
        <p><i>2019 – 2021 · Şehir</i></p>
        <ul><li>Başarı veya sorumluluk</li><li>Başarı veya sorumluluk</li></ul>
        <h2>Eğitim</h2>
        <p><b>Bölüm</b> — Üniversite Adı, 2015 – 2019</p>
        <h2>Yetenekler</h2>
        <table><tbody>
          <tr><td><b>Teknik</b></td><td>Yetenek 1, Yetenek 2, Yetenek 3</td></tr>
          <tr><td><b>Diller</b></td><td>Türkçe (anadil), İngilizce (ileri)</td></tr>
        </tbody></table>`,
    },
    {
      id: 'report',
      name: 'Rapor',
      title: 'Rapor',
      settings: { header: 'Rapor', pageNumbers: true },
      html: () => `
        <p><br></p><p><br></p><p><br></p>
        <h1 style="text-align:center"><span style="font-size:32pt">Rapor Başlığı</span></h1>
        <p style="text-align:center"><span style="font-size:14pt;color:#595959">Alt başlık veya proje adı</span></p>
        <p style="text-align:center">Hazırlayan: Ad Soyad<br>${today()}</p>
        <div class="ew-pagebreak" contenteditable="false"></div>
        <h1>1. Giriş</h1>
        <p>Raporun amacı, kapsamı ve arka planı.</p>
        <h1>2. Yöntem</h1>
        <p>Verilerin nasıl toplandığı ve analiz edildiği.</p>
        <h1>3. Bulgular</h1>
        <p>Temel bulgular ve destekleyici veriler.</p>
        <table><tbody>
          <tr><th>Ölçüt</th><th>Değer</th><th>Değişim</th></tr>
          <tr><td>Ölçüt A</td><td>120</td><td>+%8</td></tr>
          <tr><td>Ölçüt B</td><td>87</td><td>−%3</td></tr>
        </tbody></table>
        <h1>4. Sonuç ve Öneriler</h1>
        <ul><li>Öneri 1</li><li>Öneri 2</li></ul>`,
    },
    {
      id: 'meeting',
      name: 'Toplantı notları',
      title: 'Toplantı notları',
      html: () => `
        <h1>Toplantı Notları</h1>
        <table><tbody>
          <tr><td><b>Tarih</b></td><td>${today()}</td></tr>
          <tr><td><b>Katılımcılar</b></td><td>Ad 1, Ad 2, Ad 3</td></tr>
          <tr><td><b>Konu</b></td><td>Toplantı konusu</td></tr>
        </tbody></table>
        <h2>Gündem</h2>
        <ol><li>Gündem maddesi</li><li>Gündem maddesi</li><li>Gündem maddesi</li></ol>
        <h2>Tartışma</h2>
        <p>Konuşulan ana noktalar.</p>
        <h2>Kararlar</h2>
        <ul><li>Karar</li></ul>
        <h2>Aksiyonlar</h2>
        <table><tbody>
          <tr><th>Görev</th><th>Sorumlu</th><th>Son tarih</th></tr>
          <tr><td>Görev açıklaması</td><td>Ad</td><td>Tarih</td></tr>
        </tbody></table>`,
    },
    {
      id: 'essay',
      name: 'Ödev / Makale',
      title: 'Ödev',
      settings: { pageNumbers: true },
      html: () => `
        <p>Ad Soyad<br>Öğrenci No<br>Ders Adı<br>${today()}</p>
        <h1 style="text-align:center">Ödevin Başlığı</h1>
        <p style="text-align:justify;line-height:2">Giriş paragrafı: konuyu tanıtın ve tezinizi açıkça belirtin.</p>
        <p style="text-align:justify;line-height:2">Gelişme paragrafı: her paragrafta bir ana fikri kanıtlarla destekleyin.</p>
        <p style="text-align:justify;line-height:2">Sonuç paragrafı: tezinizi özetleyin ve çıkarımlarınızı paylaşın.</p>
        <h2>Kaynakça</h2>
        <p>Yazar, A. (Yıl). <i>Eser adı</i>. Yayınevi.</p>`,
    },
    {
      id: 'invoice',
      name: 'Fatura / Teklif',
      title: 'Teklif',
      html: () => `
        <h1>TEKLİF</h1>
        <p><b>Firma Adı</b><br>Adres · Telefon · E-posta</p>
        <p><b>Müşteri:</b> Müşteri Adı<br><b>Tarih:</b> ${today()}<br><b>Teklif No:</b> 2026-001</p>
        <table><tbody>
          <tr><th>Açıklama</th><th>Miktar</th><th>Birim fiyat</th><th>Tutar</th></tr>
          <tr><td>Ürün / hizmet</td><td>1</td><td>₺0,00</td><td>₺0,00</td></tr>
          <tr><td>Ürün / hizmet</td><td>1</td><td>₺0,00</td><td>₺0,00</td></tr>
          <tr><td></td><td></td><td><b>KDV</b></td><td>₺0,00</td></tr>
          <tr><td></td><td></td><td><b>Toplam</b></td><td><b>₺0,00</b></td></tr>
        </tbody></table>
        <p>Ödeme koşulları ve geçerlilik süresi.</p>`,
    },
    {
      id: 'blog',
      name: 'Blog yazısı',
      title: 'Blog yazısı',
      html: () => `
        <h1>Dikkat Çekici Bir Başlık</h1>
        <p><i>Okuyucuyu içeri çeken kısa bir giriş cümlesi.</i></p>
        <h2>Neden önemli?</h2>
        <p>Konunun okuyucu için değerini anlatın.</p>
        <h2>Adım adım</h2>
        <ol><li>Birinci adım</li><li>İkinci adım</li><li>Üçüncü adım</li></ol>
        <blockquote>Akılda kalıcı bir alıntı veya önemli bir not.</blockquote>
        <h2>Sonuç</h2>
        <p>Özet ve okuyucuya bir çağrı.</p>`,
    },
  ];

  EWTemplates.welcome = {
    title: "EasyWrite'a hoş geldiniz",
    html: () => `
      <h1>EasyWrite'a hoş geldiniz</h1>
      <p>EasyWrite, tarayıcınızda çalışan ve <b>uygulama olarak yüklenebilen</b> bir kelime işlemcidir. İnternet bağlantısı olmadan da çalışır; tüm belgeleriniz cihazınızda saklanır.</p>
      <h2>Neler yapabilirsiniz?</h2>
      <ul>
        <li><b>Kalın</b>, <i>italik</i>, <u>altı çizili</u>, <s>üstü çizili</s>, <span style="color:#c00000">renkli</span> ve <span style="background-color:#ffff00">vurgulu</span> metin</li>
        <li>Başlık stilleri, listeler, hizalama, satır aralığı, içindekiler tablosu</li>
        <li>Tablolar, resimler, bağlantılar, sayfa sonları, özel karakterler</li>
        <li>Sayfa boyutu, yönlendirme, kenar boşlukları, sütunlar, üst/alt bilgi</li>
        <li>Gezinti bölmesi, bul ve değiştir, sesli okuma, dikte, sürüm geçmişi</li>
        <li><b>Word (.docx)</b> açma ve kaydetme; HTML, TXT, Markdown ve PDF</li>
      </ul>
      <h2>Başlarken</h2>
      <p>Belgeleriniz yazdıkça <b>otomatik olarak kaydedilir</b>. Sol üstteki ⌂ düğmesiyle ana ekrana dönüp tüm belgelerinizi görebilir, şablonlardan yeni belge oluşturabilirsiniz.</p>
      <table><tbody>
        <tr><th>Kısayol</th><th>İşlev</th></tr>
        <tr><td>Ctrl+S</td><td>Kaydet (sürüm oluşturur)</td></tr>
        <tr><td>Ctrl+F / Ctrl+H</td><td>Bul / Değiştir</td></tr>
        <tr><td>Ctrl+Enter</td><td>Sayfa sonu</td></tr>
        <tr><td>Ctrl+Alt+N</td><td>Yeni belge</td></tr>
      </tbody></table>
      <p><br></p>`,
  };

  window.EWTemplates = EWTemplates;
})();
