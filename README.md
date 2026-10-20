# Komşu · Apartman Yönetimi

8 daire ve 1 dükkân için mobil uyumlu apartman yönetimi. Bölüm adları yönetim ekranından değiştirilebilir. Node.js 24 ve SQLite kullanır; harici paket veya ücretli veritabanı gerektirmez.

## Özellikler

- Yönetici şifresiyle giriş; herkese açık ortak takip ekranı.
- Tek tutarla seçili ayın tüm muaf olmayan bölümlerine aidat oluşturma.
- Aynı bölüm ve ay için ikinci kez borç oluşturulmasının veritabanında engellenmesi.
- Bölüm bazında **Aidattan muaf tut**: yeni borçlandırmada uygulanır; eski borç ve ödemeler korunur. Yönetici dairesini Bölümler ekranından muaf yapın.
- Tam/kısmi ödeme onayı ve onaylı ödemeyi onay sorusuyla iptal etme.
- Temizlik, elektrik, su, asansör, bakım/onarım, **yönetim gideri** ve diğer giderler.
- Kasa = açılış bakiyesi + onaylı ödemeler − giderler.
- **Toplam alacak** = tüm dönemlerdeki aidatlar − ödemeler.
- Duyurular, aylık CSV, JSON veri yedeği ve son 100 işlemin geçmişi.
- Ortak ekranda bölüm bazında aidat durumu; malik/oturan adları, ödeme notları ve işlem geçmişi yalnızca yöneticiye gösterilir.
- Finansal kayıtlar kuruş cinsinden tamsayı tutulur; tarayıcı hafızasında saklanmaz.

## Çalıştırma

Node.js **24 veya üstü** kurulu olmalı.

macOS / Linux:

```sh
export ADMIN_PASSWORD='buraya-en-az-12-karakterlik-ozel-sifre'
npm start
```

Windows PowerShell:

```powershell
$env:ADMIN_PASSWORD = 'buraya-en-az-12-karakterlik-ozel-sifre'
npm start
```

Tarayıcıda http://localhost:3000 açın. Yönetici girişi için belirlediğiniz şifreyi kullanın.
Örnek şifreyi canlı ortamda kullanmayın. `.env.example` bir ayar rehberidir; uygulama `.env` dosyasını kendiliğinden okumaz. Ortam değişkenlerini sunucudan verin veya Node'un `--env-file` seçeneğini kullanın.

## İlk kullanım

1. Yönetici girişi yapın.
2. Yönetim ekranında apartman adını, güncel aidatı ve varsa sistem öncesinden devreden kasa bakiyesini kaydedin.
3. Bölümler ekranında adları kontrol edin; yönetici dairesinde “Aidattan muaf tut” seçeneğini açın.
4. Aidatlar ekranından ayı seçip “Aylık aidat oluştur” deyin.
5. Gelen ödemeleri “Ödeme onayla” ile kaydedin; kısmi ödeme de kabul edilir.
6. Giderleri gerçek ödeme tarihleriyle ekleyin. Düzenli JSON yedeği indirin.

Bir ayın aidat tutarını sonradan değiştirmek mevcut tahakkukları değiştirmez. Muafiyeti açmak geçmiş tahakkukları silmez. Aidatlar ay esasına, giderler gider tarihine göre filtrelenir. Genel bakışın üstündeki dört toplam tüm dönemleri kapsar. Açılış bakiyesi negatif olamaz.

## Yayınlama

**GitHub Pages bu uygulamanın sunucu ve ortak SQLite veritabanını çalıştırmaz.** Node.js veya Docker çalıştırabilen bir sunucu gerekir. Repo oluşturulması canlı yayın anlamına gelmez.

- `ADMIN_PASSWORD`: en az 12 karakter, yalnızca sunucunun gizli ortam ayarına yazın.
- `DB_PATH`: kalıcı disk üzerindeki SQLite dosyasının yolu. Varsayılan `data/apartman.sqlite`.
- `PORT`: varsayılan 3000; barındırma hizmetinin verdiği değer de kullanılır.
- `NODE_ENV=production`: canlı ortamda zorunlu. Oturum çerezi Secure olarak gönderilir; dışarıdan HTTPS kullanın.
- `APP_ORIGIN`: tam HTTPS alan adı; örn. `https://apartman.example.com`, sonunda / olmadan. Ters proxy kullanıyorsanız bunu mutlaka ayarlayın.
- Tek sunucu örneği kullanın. SQLite için kalıcı disk/volume bağlayın; geçici sunucu diski kayıtları kaybettirir.
- `Dockerfile` hazırdır. `/app/data` dizinine yazılabilir kalıcı disk bağlanmalıdır.
- Oturum süresi 8 saat; giriş denemeleri doğrudan bağlantı adresine göre sınırlanır. Ters proxy tüm ziyaretçileri aynı adresten gösterebilir.
- Bu sürümde tek yönetici şifresi vardır; kendiliğinden kayıt olma veya şifre sıfırlama e-postası yoktur.
- Ortak ekran bağlantıyı bilen herkese açıktır; daire adları ve ödeme durumları görülebilir. İsimler yalnızca yöneticiye gösterilir.

## Yedekleme

Yönetim ekranındaki JSON yedeği oturum/şifre içermez; malik ve oturan bilgilerini içerir. Özel bir yerde saklayın. Otomatik JSON geri yükleme bu sürümde yoktur; yedeğin tabloları bakım sırasında SQLite'a aktarılabilir.

Sunucu kapalıyken SQLite dosyasının kopyası tam yedek olarak saklanabilir. Çalışan sunucunun dosyasını normal dosya kopyalama ile yedeklemeyin; WAL dosyasında henüz ana dosyaya yazılmamış işlemler olabilir. Canlı tam yedek için SQLite backup API/komutunu kullanın.

## Kontroller

```sh
npm run check
npm test
```

GitHub Actions her push ve pull request'te Node.js 24 üzerinde sözdizimi ve gerçek HTTP/SQLite entegrasyon testini çalıştırır. Testler erişim kontrolü, isimlerin ortak ekrana sızmaması, muafiyet, yinelenen tahakkuk, kısmi ödeme, fazla ödeme engeli, hatalı tarih, ödeme iptali, yönetim gideri, kasa hesabı ve oturum kapatmayı kontrol eder.

Önceki Sites uygulamasındaki gerçek kayıtlar bu repoya taşınmamıştır. Veritabanı ilk çalıştırmada boş finansal kayıtlarla başlar.
