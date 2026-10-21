# Komşu · Apartman Yönetimi

GitHub Pages üzerinde çalışan, Acısu United'ın mevcut Supabase projesine bağlı apartman yönetimi uygulaması. Ayrıca sunucu, SQLite veya yeni Supabase projesi gerektirmez.

## Kullanım

- **Giderler → Düzenle:** Giderin kategorisi, açıklaması, tutarı ve tarihi değiştirilebilir. Eski alanlar sunucuya önizleme olarak gönderilir; başka işlemde değiştirilmiş giderin üzerine yazılmaz. Kasa ve aylık rapor güncel değerlerden hesaplanır.
- **Giderler → Belgeler:** Kaydedilmiş gidere JPG/PNG/WEBP/PDF dosyası eklenebilir (dosya başına 10 MB, gider başına 5 belge). Finansal kaydı kaydetme ile dosya yükleme ayrı işlemlerdir; başarısız yüklemeyi tekrar denemek ikinci gider oluşturmaz. Tamamlanamayan kayıtlar yönetici tarafından kaldırılabilir.
- Belgeler varsayılan olarak yalnızca yöneticiye açıktır. Yönetici belge bazında **Ortak ekranda göster** seçebilir; ortak gösterim ayrıca onaylanır. Gizlenen dosyalar için yeni bağlantı üretilemez; önceden üretilmiş bağlantı en fazla 60 saniye geçerlidir. Özel dosya adları ortak özette bulunmaz.
- Dosyalar ayrı ve özel `apartman-expense-files` Storage bucket'ında tutulur. Her nesne kayıtlı dosya yoluyla eşleştirilir. Yükleme/silme yalnızca apartman yöneticisine açıktır; diğer Acısu yöneticileri bu yetkiyi kazanmaz. Upsert/üzerine yazma kapalıdır. Mevcut Acısu bucket ve politikaları değiştirilmez.
- Bir gideri silmeden önce belgeleri kaldırmak gerekir. Dosya kaldırma Storage API ile yapılır; gerçek dosya kaldırılmadan metadata kaydı silinemez. JSON kayıt yedeği belge listesini içerir, dosya içeriğini içermez; dosyalar ayrıca indirilmelidir.

- **Diğer → Eski borç girişi:** Yönetici daireyi, borcun ait olduğu önceki tarihini, kalan tutarı ve özel açıklamasını girer. Aynı bölüm/ay için ikinci borç açılmaz; muaf bölümün eski borcu kaydedilebilir. Devir kaydı kasayı değiştirmez, tahsilat yapıldığında kasa artar. Her eski ay ayrı kaydedilir; zaten girilmiş borcu yeniden devretmeyin.
- **Aidatlar → Ayrıntılar:** Daire hesabı; borçlandırma, ödeme ve hareket sonrası bakiye tarih sırasıyla gösterilir. Eski bir borca buradan ödeme alınabilir. Kopyalanan/indirilen döküm özel yönetici notlarını veya malik/oturan isimlerini içermez.
- **Özet → Aylık hesap özeti:** Devreden kasa + ödeme tarihine göre o ayki tahsilat − o ayki gider = ay sonu kasa. Eski aya ait aidat bu ay ödenirse bu ayın tahsilatında sayılır. Ay sonu alacağı o aya kadar oluşan borçlar ve o aya kadar girilen ödemelerle hesaplanır; raporlar güncel kayıtlardan üretilir, kilitli muhasebe kapanışı değildir. Kayıtlı açılış kasa tutarı sistemin başlangıç bakiyesidir.
- Aylık özet herkes tarafından görülebilir, metin olarak kopyalanabilir/indirilebilir. Otomatik WhatsApp gönderimi yapılmaz; kullanıcı kopyalanan metni kendisi paylaşır.

- Ana menü: Özet, Aidatlar, Giderler, Diğer. Duyurular ile yöneticiye özel daire/ayar ekranları Diğer altında toplanır.
- Özet ekranında kasa tüm dönemleri; toplanan ve kalan aidat kartları seçili aya ait tahakkukları gösterir. Ödeme bekleyenler listesi tüm dönemlerin borcunu kapsar.
- Aidatlar telefona uygun daire kartlarıyla gösterilir. Önceki aylardan borçlar ayrı belirtilir; Ayrıntılar üzerinden eski bir aya ödeme girilebilir.
- Ödeme al ekranında kalan tutar ve bugünün tarihi hazır gelir. Tarih ve not isteğe bağlı açılır.
- Düzenle/sil seçenekleri kartın işlem menüsünde, seçim kutuları ise Toplu işlem modu açıldığında görünür. Ödemeli aidatları koruyan kurallar değişmez.

- Ortak takip ekranında aidatlar, giderler, kasa ve duyurular görüntülenir.
- Yönetici girişi Supabase Auth e-posta/şifre ile yapılır. Kayıt olma akışı yoktur.
- Apartman yetkisi `apartman_admins` tablosundan kontrol edilir. Acısu yöneticisi olmak tek başına apartman yetkisi vermez.
- İlk kurulumda 8 daire + 1 dükkân tanımlıdır; bölüm adları düzenlenebilir.
- Aylık aidat tek işlemle muaf olmayan bölümlere oluşturulur. Aynı bölüm ve ay ikinci kez borçlandırılmaz.
- Bölümler → Düzenle / Muafiyet → **Aidattan muaf tut** yalnızca yeni borçlandırmalara uygulanır; eski borç ve ödemeler korunur.
- Aidatlar ekranında kutucuklardan ödeme girilmemiş kayıtları seçip **Toplu düzenle** ile ay/tutar değiştirilebilir; **Toplu sil** ile kaldırılabilir. Her satırda tekil Düzenle / Sil seçenekleri de vardır. Silmede etkilenen toplam gösterilir ve SİL yazılması istenir.
- Ödeme girilmiş aidatların seçimi ve düzenleme/silme işlemi kapalıdır. Yanlış bir ödeme onayı varsa önce ilgili ödeme kaydı iptal edilmelidir; gerçek tahsilatlar sırf aidatı düzenlemek için iptal edilmemelidir. Eski kayıtlar işlem geçmişinde saklanır.
- Tam/kısmi ödeme onayı, ödeme iptali, yönetim gideri dahil ortak giderler, duyurular, CSV ve JSON yedeği vardır.
- Özet ekranındaki kasa tüm dönemleri; aylık aidat/gider listeleri seçili ayı kapsar.
- Açılış kasa bakiyesi negatif olamaz. Aidat değişikliği geçmiş tahakkukları yeniden hesaplamaz.

## Veriler ve yetkiler

Tablolar: `apartman_expense_files`, `apartman_admins`, `apartman_units`, `apartman_charges`, `apartman_payments`, `apartman_expenses`, `apartman_notices`, `apartman_settings`, `apartman_audit`.

Bu tabloların tamamında RLS açıktır; `anon` ve `authenticated` için doğrudan tablo/sequence erişimi kapalıdır. Bu nedenle güvenlik danışmanındaki **RLS Enabled No Policy** bilgi notları bu tasarımda bilinçlidir; herkese açık tablo politikası eklemeyin.

API, public şemasındaki SECURITY INVOKER RPC fonksiyonlarından geçer:

- `apartman_state()` ortak özeti; yetkili yönetici için ayrıca özel alanları döndürür.
- `apartman_action(action,payload)` yalnızca apartman yöneticilerine işlem yaptırır.
- `apartman_manage_charges(payload)` mevcut aidatları ödeme ve eşzamanlılık kontrolleriyle yönetir.
- `apartman_opening_charge(payload)` yalnızca apartman yöneticisine eski borç girişi yaptırır.
- `apartman_expense_manage(payload)` gider düzenleme, belge rezervasyonu/onayı, görünürlük ve metadata kaldırmayı yönetici yetkisiyle yapar.

Ayrıcalıklı uygulama kodu Data API'ye açılmayan `apartman_private` şemasındadır. Yönetim işlemlerinde üyelik `auth.uid()` üzerinden kontrol edilir. Ortak ekranda malik/oturan isimleri, özel borç/ödeme notları ve yönetici işlem geçmişi yoktur. Hesap dökümü için ödeme tarihi, tutarı ve bağlı aidat kimliği ortak özette bulunur. Ortak ekran bağlantıyı bilen herkese açık olduğundan bölüm etiketleri ve ödeme durumları görülebilir.

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

`supabase/schema.sql` ilk kuruluma ait eklemeli şemadır; kurulu projede tekrar çalıştırmayın. Kurulum Supabase migration geçmişine kaydedilmiştir. Fonksiyon değişikliklerini yeni bir migration olarak uygulayın. `supabase/charge-management.sql` aidat düzenleme/silme yükseltmesidir; `supabase/verify-charge-management.sql` ilgili işlemleri ROLLBACK ile test eder.

`supabase/account-statements.sql` eski borç ve hesap dökümü yükseltmesidir; `supabase/verify-account-statements.sql` borç, kasa ve yetki kontrollerini ROLLBACK ile doğrular.

`supabase/expense-receipts.sql` gider/belge yükseltmesinin tam SQL kaydıdır. Uygulanan yükseltme küçük adımlar halinde migration geçmişine kaydedilmiştir; kurulu projede tekrar çalıştırmayın. `supabase/verify-expense-receipts.sql` gider, kasa, dosya kuralları ve yetkileri ROLLBACK ile doğrular; testte gerçek dosya yüklenmez.

`supabase/verify.sql` bütün finansal test işlemlerini **ROLLBACK** ile geri alır. Test için Auth hesabı açmaz ve gerçek finansal kayıt bırakmaz. Kimlikler mevcut `apartman_admins` ve `acisu_admins` tablolarından seçilir.

```sh
npm run check
npm test
```

JavaScript testleri oturum yenileme, ayrı yönetici kontrolü, RPC eşlemesi ve hata yönetimini kontrol eder. Canlı veritabanındaki doğrulama; muafiyet, mükerrer aidat, fazla/kısmi ödeme, gider, kasa, ödeme iptali, anonim erişim ve diğer Acısu yöneticisinin yetkisizliğini kapsar.

## Yedek ve önceki sürüm

Yönetim → JSON yedeği indir ile kayıtlar dışa aktarılabilir. Dosya malik/oturan isimlerini içerir; güvenli yerde saklayın. Otomatik yedekleme ve JSON içe aktarma bu sürümde yoktur. Supabase ücretsiz plandaysa hareketsizlikte duraklatma ve proje genelindeki ücretsiz limitler uygulanır.

Önceki Sites uygulamasının gerçek kayıtları otomatik taşınmamıştır. SQLite sunucusu Git geçmişinde korunur; güncel sürüm Supabase kullanır.
