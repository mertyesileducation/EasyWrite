# EasyWrite

EasyWrite, Microsoft Word muadili, **yüklenebilir (PWA) ve çevrimdışı çalışan** bir kelime işlemcidir.
Saf HTML, CSS ve JavaScript ile yazılmıştır; hiçbir bağımlılığı ve sunucu tarafı yoktur.
Belgeler tarayıcının IndexedDB deposunda, yani kullanıcının kendi cihazında saklanır.


**Yayınlama:** `main` dalına gönderilen her değişiklik `.github/workflows/pages.yml` ile GitHub Pages'e
yayınlanır (depo ayarlarında *Pages → Source: GitHub Actions* seçili olmalı). Yayınlanan adresi telefon ya da
bilgisayarda açıp **Uygulamayı yükle / Ana ekrana ekle** ile kurabilirsiniz.

## Özellikler

**Ana ekran (belge yöneticisi)**
- Şablonlar: Boş belge, Mektup, Özgeçmiş, Rapor, Toplantı notları, Ödev, Teklif, Blog yazısı
- Küçük resimli belge listesi (ızgara/liste), arama (başlık ve içerik), sıralama
- Yıldızlama, yeniden adlandırma, kopya oluşturma, .docx/.ewrite indirme
- Çöp kutusu (30 gün saklama, geri yükleme, kalıcı silme)
- Dosyaları sürükleyip bırakarak içe aktarma; depolama kullanımı göstergesi

**Kayıt**
- Yazarken otomatik kayıt (IndexedDB), birden çok belge
- Sürüm geçmişi: Ctrl+S ve 5 dakikada bir otomatik sürüm, önizleme ve geri yükleme
- Kalıcı depolama izni istenir (tarayıcının veriyi silmesini önlemek için)

**Düzenleme**
- Yazı tipi/boyutu, kalın/italik/altı çizili/üstü çizili, alt/üst simge, renk, vurgu, biçim boyacısı
- Büyük/küçük harf dönüştürme (Türkçe uyumlu: i/İ, ı/I)
- Listeler, hizalama, girinti, satır aralığı; Başlık 1–3, Alıntı, Kod stilleri
- Tablo (ızgara seçicili) ve tablo araçları, resim (yapıştır/sürükle, otomatik küçültme), bağlantı
- Otomatik güncellenen **İçindekiler** tablosu (sayfa numaralı)
- Sayfa sonu, yatay çizgi, tarih/saat, simgeler ve emoji
- Bul ve değiştir

**Düzen ve görünüm**
- A4/Letter/A5, dikey/yatay, kenar boşlukları, çok sütun, üst/alt bilgi, sayfa numaraları
- Gezinti bölmesi, cetvel, yakınlaştırma, sayfa genişliğine sığdır, odak modu, tam ekran, koyu tema
- Mobilde ekrana akan yazım düzeni

**Gözden geçir**
- Ayrıntılı sözcük sayımı (karakter, paragraf, cümle, okuma süresi), sözcük hedefi
- Sesli okuma ve dikte (konuşarak yazma, tr-TR)

**Dosya biçimleri**
- **Word (.docx)** dışa ve içe aktarma (başlıklar, biçimler, listeler, tablolar, resimler, bağlantılar,
  sayfa düzeni, üst/alt bilgi)
- `.ewrite` (EasyWrite yerel biçimi), HTML, Markdown, TXT; Yazdır ile PDF

## Klavye kısayolları

| Kısayol | İşlev |
| --- | --- |
| Ctrl+B / I / U | Kalın / İtalik / Altı çizili |
| Ctrl+S | Kaydet (sürüm oluşturur) |
| Ctrl+O | Aç / içe aktar |
| Ctrl+Alt+N | Yeni belge |
| Ctrl+P | Yazdır / PDF |
| Ctrl+F / Ctrl+H | Bul / Değiştir |
| Ctrl+K | Bağlantı |
| Ctrl+Enter | Sayfa sonu |
| Ctrl+L / E / R / J | Hizalama |
| Ctrl+Alt+1/2/3/0 | Başlık 1/2/3 / Normal |
| Ctrl+] / Ctrl+[ | Yazıyı büyüt / küçült |
| Ctrl+Shift+V | Biçimsiz yapıştır |

## Proje yapısı

```
easywrite/
├── index.html            # Ana ekran + editör arayüzü
├── manifest.webmanifest  # PWA bildirimi
├── sw.js                 # Service worker (çevrimdışı önbellek)
├── css/style.css         # Tema, düzen, mobil ve yazdırma stilleri
├── icons/                # Uygulama simgeleri
└── js/
    ├── store.js          # IndexedDB belge ve sürüm deposu
    ├── templates.js      # Belge şablonları
    ├── docx.js           # .docx dışa/içe aktarma (ZIP dahil, bağımlılıksız)
    ├── app.js            # Editör çekirdeği ve yönlendirme
    ├── home.js           # Ana ekran / belge yöneticisi
    └── pwa.js            # Yükleme, güncelleme, çevrimdışı durum, dosya açma
```

Uygulamayı güncellerken `sw.js` içindeki `VERSION` değerini artırın; kullanıcılar "Yeni bir sürüm hazır"
bildirimini görür.
