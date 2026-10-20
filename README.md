# Komşu · Apartman Yönetimi

GitHub Pages üzerinde çalışan, Acısu United'ın mevcut Supabase projesine bağlı apartman yönetimi uygulaması. Ayrıca sunucu, SQLite veya yeni Supabase projesi gerektirmez.

## Kullanım

- Ortak takip ekranında aidatlar, giderler, kasa ve duyurular görüntülenir.
- Yönetici girişi Supabase Auth e-posta/şifre ile yapılır. Kayıt olma akışı yoktur.
- Apartman yetkisi `apartman_admins` tablosundan kontrol edilir. Acısu yöneticisi olmak tek başına apartman yetkisi vermez.
- İlk kurulumda 8 daire + 1 dükkân tanımlıdır; bölüm adları düzenlenebilir.
- Aylık aidat tek işlemle muaf olmayan bölümlere oluşturulur. Aynı bölüm ve ay ikinci kez borçlandırılmaz.
- Bölümler → Düzenle / Muafiyet → **Aidattan muaf tut** yalnızca yeni borçlandırmalara uygulanır; eski borç ve ödemeler korunur.
- Tam/kısmi ödeme onayı, ödeme iptali, yönetim gideri dahil ortak giderler, duyurular, CSV ve JSON yedeği vardır.
- Genel bakış üst kartları tüm dönemleri; aylık aidat/gider tabloları seçili ayı kapsar.
- Açılış kasa bakiyesi negatif olamaz. Aidat değişikliği geçmiş tahakkukları yeniden hesaplamaz.

## Veriler ve yetkiler

Tablolar: `apartman_admins`, `apartman_units`, `apartman_charges`, `apartman_payments`, `apartman_expenses`, `apartman_notices`, `apartman_settings`, `apartman_audit`.

Bu tabloların tamamında RLS açıktır; `anon` ve `authenticated` için doğrudan tablo/sequence erişimi kapalıdır. Bu nedenle güvenlik danışmanındaki **RLS Enabled No Policy** bilgi notları bu tasarımda bilinçlidir; herkese açık tablo politikası eklemeyin.

API yalnızca iki SECURITY INVOKER fonksiyonundan geçer:

- `apartman_state()` ortak özeti; yetkili yönetici için ayrıca özel alanları döndürür.
- `apartman_action(action,payload)` yalnızca apartman yöneticilerine işlem yaptırır.

Ayrıcalıklı uygulama kodu Data API'ye açılmayan `apartman_private` şemasındadır. Yönetim işlemlerinde üyelik `auth.uid()` üzerinden kontrol edilir. Ortak ekranda malik/oturan isimleri, ödeme notları ve işlem geçmişi yoktur. Ortak ekran bağlantıyı bilen herkese açık olduğundan bölüm etiketleri ve ödeme durumları görülebilir.

Tutarlar kuruş cinsinden tamsayıdır. Ödeme kontrolleri ve aylık borçlandırmalar bir veritabanı işlemi içinde kilitlemeyle yapılır; eşzamanlı istekler fazla ödeme veya çift aidat oluşturamaz. Oturum aynı sekmenin `sessionStorage` alanında apartmana özgü anahtarla tutulur; şifre kaydedilmez. Çıkış Supabase'in yalnızca mevcut oturumunu kapatır.

`public/config.js` yalnızca herkese açık publishable key içerir; `service_role` anahtarı asla istemciye eklenmez. Acısu'nun tabloları, politikaları, kullanıcıları veya Auth ayarları bu kurulumda değiştirilmez. Projenin Auth ve kullanım limitleri ortak kalır.

## Yayın

GitHub Settings → Pages → Source: **GitHub Actions**. `.github/workflows/check.yml` kontroller geçtikten sonra yalnızca `public/` dizinini Pages'e gönderir. Kaynak kodundaki dosya yolları alt dizin yayınına uygundur. Özel alan adı gerekmez.

Yerel önizleme:

```sh
npm start
```

Python 3 ile http://localhost:3000 açılır. Üretim yayını herhangi bir Python/Node sunucusu çalıştırmaz.

## Veritabanı kurulumu ve doğrulama

`supabase/schema.sql` ilk kuruluma ait eklemeli şemadır; kurulu projede tekrar çalıştırmayın. Kurulum Supabase migration geçmişine kaydedilmiştir. Fonksiyon değişikliklerini yeni bir migration olarak uygulayın.

`supabase/verify.sql` bütün finansal test işlemlerini **ROLLBACK** ile geri alır. Test için Auth hesabı açmaz ve gerçek finansal kayıt bırakmaz. Kimlikler mevcut `apartman_admins` ve `acisu_admins` tablolarından seçilir.

```sh
npm run check
npm test
```

JavaScript testleri oturum yenileme, ayrı yönetici kontrolü, RPC eşlemesi ve hata yönetimini kontrol eder. Canlı veritabanındaki doğrulama; muafiyet, mükerrer aidat, fazla/kısmi ödeme, gider, kasa, ödeme iptali, anonim erişim ve diğer Acısu yöneticisinin yetkisizliğini kapsar.

## Yedek ve önceki sürüm

Yönetim → JSON yedeği indir ile kayıtlar dışa aktarılabilir. Dosya malik/oturan isimlerini içerir; güvenli yerde saklayın. Otomatik yedekleme ve JSON içe aktarma bu sürümde yoktur. Supabase ücretsiz plandaysa hareketsizlikte duraklatma ve proje genelindeki ücretsiz limitler uygulanır.

Önceki Sites uygulamasının gerçek kayıtları otomatik taşınmamıştır. SQLite sunucusu Git geçmişinde korunur; güncel sürüm Supabase kullanır.
